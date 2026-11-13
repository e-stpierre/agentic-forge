/**
 * `wait-for-review` step: polls GitHub from the supervisor until every listed
 * reviewer has reviewed the pull request's current head commit. No agent
 * session runs while it waits. A new head (a push) restarts the wait, and its
 * timeout, for that head. On timeout the run stops `awaiting-human` with a
 * `needs_input` request: `wait` again or `continue` without the missing reviews.
 */

import { getGithubConfig } from "../config.js";
import type { ConsoleOutput } from "../console.js";
import {
	type IssueComment,
	type PullRequest,
	type Review,
	commentOnPr,
	listIssueComments,
	listReviews,
	viewPr,
} from "../github/pr.js";
import {
	type ReviewOfHead,
	type ReviewerSpec,
	resolveReviewers,
	reviewOfHead,
} from "../github/reviews.js";
import type { WorkflowLogger } from "../logging/logger.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import { type StepContext, StepExecutor, type StepResult, emitStepEvent } from "./base.js";
import {
	Backoff,
	completeStep,
	ghOptions,
	interrupted,
	minutes,
	pullRequestRef,
	renderField,
	sleep,
	stopAwaitingHuman,
	timeoutAnswer,
	timeoutRequest,
} from "./github-base.js";

const KIND = "review";

/** Reviewer names of a step: a list, or a comma-separated string (template). */
export function reviewerNames(step: StepDefinition, context: StepContext): string[] {
	const raw = step.reviewers;
	if (Array.isArray(raw)) return raw.map((r) => renderField(context, r).trim()).filter(Boolean);
	if (typeof raw === "string") {
		const rendered = renderField(context, raw).trim();
		// A rendered list (`["claude","codex"]`) or a comma-separated string
		if (rendered.startsWith("[")) {
			try {
				const parsed = JSON.parse(rendered);
				if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
			} catch {
				// Fall back to splitting
			}
		}
		return rendered
			.split(/[,\s]+/)
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return [];
}

export class WaitForReviewStepExecutor extends StepExecutor {
	async execute(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<StepResult> {
		const config = getGithubConfig(context.config);
		const reviewers = resolveReviewers(reviewerNames(step, context), config.reviewers);
		if (reviewers.length === 0) throw new Error(`Step '${step.name}' has no reviewer to wait for`);

		const answer = await timeoutAnswer(KIND, step.name, progress, context);
		const ref = pullRequestRef(step, context);
		const gh = ghOptions(context);
		if (answer === "continue") {
			const pr = await viewPr(ref, gh);
			const reviews = await this.reviewsOfHead(reviewers, pr, gh);
			const missing = reviewers.filter((r) => !reviews.some((x) => x.reviewer === r.name));
			return completeStep(step, progress, context, logger, console, {
				status: "done",
				summary: `Continued without reviews from ${missing.map((r) => r.name).join(", ") || "nobody"} on ${pr.headRefOid.slice(0, 7)} (operator)`,
				pr: pr.url,
				outputs: this.outputs(pr, reviews, missing, true),
			});
		}

		const trigger = step.trigger ?? config.autoTrigger;
		const timeoutMs = minutes(step.stepTimeoutMinutes ?? config.reviewTimeoutMinutes);
		const backoff = new Backoff(step.pollSeconds ?? config.pollSeconds, config.maxPollSeconds);
		let deadline = Date.now() + timeoutMs;
		const reported = new Set<string>();
		const triggered = new Set<string>();
		let head: string | null = null;
		let headSeenAt = Date.now();
		// For a head pushed during the step: the time the step first saw it. A
		// comment from before may be about the previous head, so it does not count
		let since: number | null = null;
		logger.info(
			step.name,
			`Waiting for reviews from ${reviewers.map((r) => `${r.name} (${r.login})`).join(", ")}`,
		);

		for (;;) {
			if (context.signal?.aborted) return interrupted();
			const pr = await viewPr(ref, gh);
			if (pr.state !== "OPEN") {
				throw new Error(`Pull request ${pr.url} is ${pr.state.toLowerCase()}: nothing to review`);
			}
			if (pr.headRefOid !== head) {
				if (head) {
					logger.info(step.name, `New head ${pr.headRefOid.slice(0, 7)}: waiting again`);
					// A new head restarts the wait, timeout included
					deadline = Date.now() + timeoutMs;
				}
				headSeenAt = Date.now();
				if (head) since = headSeenAt;
				head = pr.headRefOid;
				backoff.reset();
			}
			const reviews = await this.reviewsOfHead(reviewers, pr, gh, since);
			for (const review of reviews) {
				const key = `${review.reviewer}@${review.commit}`;
				if (reported.has(key)) continue;
				reported.add(key);
				logger.info(
					step.name,
					`Review from ${review.login} on ${review.commit.slice(0, 7)}: ${review.state}`,
				);
				await emitStepEvent(context, "review.received", {
					step: step.name,
					pr: pr.url,
					reviewer: review.reviewer,
					login: review.login,
					state: review.state,
					source: review.source,
					commit: review.commit,
					url: review.url,
				});
			}
			const missing = reviewers.filter((r) => !reviews.some((x) => x.reviewer === r.name));
			if (missing.length === 0) {
				return completeStep(step, progress, context, logger, console, {
					status: "done",
					summary: `Reviewed on ${pr.headRefOid.slice(0, 7)} by ${reviews.map((r) => `${r.reviewer} (${r.state.toLowerCase()})`).join(", ")}`,
					pr: pr.url,
					outputs: this.outputs(pr, reviews, [], false),
				});
			}

			// Trigger comments, once per reviewer and head, after the reviewer had its chance
			if (trigger && Date.now() - headSeenAt >= config.triggerAfterSeconds * 1000) {
				for (const reviewer of missing) {
					const key = `${reviewer.name}@${pr.headRefOid}`;
					if (!reviewer.trigger || triggered.has(key)) continue;
					triggered.add(key);
					await commentOnPr(pr, reviewer.trigger, gh);
					logger.info(step.name, `Posted trigger for ${reviewer.name}: ${reviewer.trigger}`);
				}
			}

			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				const names = missing.map((r) => r.name).join(", ");
				const question = `No review from ${names} on ${pr.headRefOid.slice(0, 7)} of ${pr.url} after ${Math.round(timeoutMs / 60_000)} min. Wait again or continue without it?`;
				return stopAwaitingHuman(
					step,
					progress,
					context,
					logger,
					console,
					`Timed out waiting for reviews from ${names}`,
					{ pr: pr.url, outputs: this.outputs(pr, reviews, missing, false) },
					timeoutRequest(
						KIND,
						step.name,
						progress,
						question,
						`Reviewers: ${reviewers.map((r) => `${r.name} (${r.login}${r.trigger ? `, trigger "${r.trigger}"` : ""})`).join(", ")}. Trigger comments ${trigger ? "enabled" : "disabled"}.`,
					),
				);
			}
			await sleep(Math.min(backoff.next(), remaining), context.signal);
		}
	}

	private async reviewsOfHead(
		reviewers: ReviewerSpec[],
		pr: PullRequest,
		gh: ReturnType<typeof ghOptions>,
		since: number | null = null,
	): Promise<ReviewOfHead[]> {
		const reviews: Review[] = await listReviews(pr, gh);
		const comments: IssueComment[] = await listIssueComments(pr, gh);
		return reviewers
			.map((r) => reviewOfHead(r, pr, reviews, comments, { since }))
			.filter((r): r is ReviewOfHead => r !== null);
	}

	private outputs(
		pr: PullRequest,
		reviews: ReviewOfHead[],
		missing: ReviewerSpec[],
		skipped: boolean,
	): Record<string, unknown> {
		return {
			pr: pr.number,
			url: pr.url,
			head: pr.headRefOid,
			reviews: reviews.map((r) => ({
				reviewer: r.reviewer,
				login: r.login,
				state: r.state,
				source: r.source,
				url: r.url,
			})),
			changes_requested: reviews.some((r) => r.state === "CHANGES_REQUESTED"),
			missing: missing.map((r) => r.name),
			skipped,
		};
	}
}
