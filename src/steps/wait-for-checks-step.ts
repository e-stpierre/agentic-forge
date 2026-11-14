/**
 * `wait-for-checks` step: polls the checks of the pull request head from the
 * supervisor until none is pending, then reports pass or fail in its result.
 * No agent session runs while it waits. `checks: required` (the default)
 * waits for the checks the base branch requires: its rules are read once, and
 * when they require none, every check is waited for until a required check
 * (classic branch protection) shows up on the head. A head with no check
 * passes after a grace period, counted from the time the step first saw that
 * head. A failing check fails the step unless
 * `on-fail: continue`. On timeout the run stops `awaiting-human`.
 */

import { getGithubConfig } from "../config.js";
import type { ConsoleOutput } from "../console.js";
import {
	type BranchRule,
	type Check,
	type PullRequest,
	branchRules,
	listChecks,
	viewPr,
} from "../github/pr.js";
import type { WorkflowLogger } from "../logging/logger.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import { type StepContext, StepExecutor, type StepResult, emitStepEvent } from "./base.js";
import {
	Backoff,
	completeStep,
	failStep,
	ghOptions,
	interrupted,
	minutes,
	pullRequestRef,
	sleep,
	stopAwaitingHuman,
	timeoutAnswer,
	timeoutRequest,
} from "./github-base.js";

const KIND = "checks";

/** Seconds without any check reported before a head with no checks counts as passing. */
export const NO_CHECKS_GRACE_SECONDS = 60;

/** Timing knobs of the step (tests shorten the grace period). */
export const checksTiming = { noChecksGraceSeconds: NO_CHECKS_GRACE_SECONDS };

/**
 * True when the branch rules require status checks (a `required_status_checks`
 * rule that lists at least one check).
 */
export function requiresChecks(rules: BranchRule[]): boolean {
	return rules.some((rule) => {
		if (rule.type !== "required_status_checks") return false;
		const list = rule.parameters?.required_status_checks;
		return Array.isArray(list) && list.length > 0;
	});
}

export interface ChecksSummary {
	conclusion: "pass" | "fail" | "pending";
	total: number;
	passed: string[];
	failed: string[];
	pending: string[];
	skipped: string[];
}

/** Sums up checks: any pending -> pending; else any failed or canceled -> fail; else pass. */
export function summarizeChecks(checks: Check[]): ChecksSummary {
	const by = (buckets: string[]) =>
		checks.filter((c) => buckets.includes(c.bucket)).map((c) => c.name);
	const pending = by(["pending"]);
	const failed = by(["fail", "cancel"]);
	return {
		conclusion: pending.length > 0 ? "pending" : failed.length > 0 ? "fail" : "pass",
		total: checks.length,
		passed: by(["pass"]),
		failed,
		pending,
		skipped: by(["skipping"]),
	};
}

export class WaitForChecksStepExecutor extends StepExecutor {
	async execute(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<StepResult> {
		const config = getGithubConfig(context.config);
		const ref = pullRequestRef(step, context);
		const gh = ghOptions(context);
		const answer = await timeoutAnswer(KIND, step.name, progress, context);
		const timeoutMs = minutes(step.stepTimeoutMinutes ?? config.checksTimeoutMinutes);
		const backoff = new Backoff(step.pollSeconds ?? config.pollSeconds, config.maxPollSeconds);
		const deadline = Date.now() + timeoutMs;
		const mode = step.checks ?? "required";
		let head: string | null = null;
		let headSeenAt = Date.now();
		// `required`: the base's rules decide. Rules that require checks keep the
		// scope required for good; without, a required check that shows up on
		// the head (classic branch protection) narrows it, and until then every
		// check is waited for.
		let requiredKnown = false;
		let rulesRead = false;

		for (;;) {
			if (context.signal?.aborted) return interrupted();
			const pr = await viewPr(ref, gh);
			if (pr.headRefOid !== head) {
				head = pr.headRefOid;
				// A new head gets its own grace period: its checks may not be listed yet
				headSeenAt = Date.now();
				backoff.reset();
			}
			if (mode === "required" && !rulesRead) {
				rulesRead = true;
				requiredKnown = requiresChecks(await branchRules(pr.repo, pr.baseRefName, gh));
				if (!requiredKnown) {
					logger.info(
						step.name,
						"The base branch rules require no check: waiting for all checks until a required one shows up",
					);
				}
			}
			let checks: Check[];
			let requiredOnly = false;
			if (mode === "required") {
				checks = await listChecks(pr, true, gh);
				if (checks.length > 0) requiredKnown = true;
				requiredOnly = requiredKnown;
				if (!requiredKnown) checks = await listChecks(pr, false, gh);
			} else {
				checks = await listChecks(pr, false, gh);
			}
			const summary = summarizeChecks(checks);
			const scope = requiredOnly ? "required" : "all";
			const settled =
				summary.conclusion !== "pending" &&
				(summary.total > 0 || Date.now() - headSeenAt >= checksTiming.noChecksGraceSeconds * 1000);

			if (settled || answer === "continue") {
				const conclusion = summary.conclusion === "pending" ? "pending" : summary.conclusion;
				await emitStepEvent(context, "checks.completed", {
					step: step.name,
					pr: pr.url,
					commit: pr.headRefOid,
					conclusion,
					scope,
					failed: summary.failed,
					total: summary.total,
				});
				return this.finish(
					step,
					progress,
					context,
					logger,
					console,
					pr,
					summary,
					scope,
					answer === "continue",
				);
			}

			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				const pending = summary.pending.join(", ") || "no check reported yet";
				return stopAwaitingHuman(
					step,
					progress,
					context,
					logger,
					console,
					`Timed out waiting for checks on ${pr.headRefOid.slice(0, 7)} (${pending})`,
					{ pr: pr.url, outputs: this.outputs(pr, summary, scope) },
					timeoutRequest(
						KIND,
						step.name,
						progress,
						`Checks still pending on ${pr.headRefOid.slice(0, 7)} of ${pr.url} after ${Math.round(timeoutMs / 60_000)} min (${pending}). Wait again or continue?`,
						`Scope: ${scope} checks. Pending: ${pending}.`,
					),
				);
			}
			await sleep(Math.min(backoff.next(), remaining), context.signal);
		}
	}

	private finish(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
		pr: PullRequest,
		summary: ChecksSummary,
		scope: string,
		continued: boolean,
	): Promise<StepResult> {
		const short = pr.headRefOid.slice(0, 7);
		const outputs = { ...this.outputs(pr, summary, scope), continued };
		if (summary.conclusion === "fail" && (step.onChecksFail ?? "fail") === "fail") {
			return failStep(step, progress, context, logger, console, {
				status: "failed",
				summary: `Checks failed on ${short}: ${summary.failed.join(", ")}`,
				pr: pr.url,
				outputs,
				blockers: summary.failed.map((name) => `check failed: ${name}`),
			});
		}
		const text =
			summary.conclusion === "pass"
				? summary.total > 0
					? `${summary.passed.length} ${scope} check(s) passed on ${short}`
					: `No check reported on ${short}`
				: summary.conclusion === "fail"
					? `Checks failed on ${short}: ${summary.failed.join(", ")} (on-fail: continue)`
					: `Continued with checks pending on ${short} (operator)`;
		return completeStep(step, progress, context, logger, console, {
			status: "done",
			summary: text,
			pr: pr.url,
			outputs,
		});
	}

	private outputs(pr: PullRequest, summary: ChecksSummary, scope: string): Record<string, unknown> {
		return {
			pr: pr.number,
			url: pr.url,
			head: pr.headRefOid,
			result: summary.conclusion,
			passed: summary.conclusion === "pass",
			scope,
			failed: summary.failed,
			pending: summary.pending,
			total: summary.total,
		};
	}
}
