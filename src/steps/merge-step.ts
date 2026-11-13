/**
 * `merge` step: merges the pull request under the per-repository merge lock,
 * so two runs of one repository (from any worktree) never merge at once.
 *
 * - With `skill:` (for example `esp-skills:esp-merge`), the skill runs like a
 *   `skill` step with `AF_MERGE_LOCK` set to the lock file. The skill's merge
 *   script takes and releases the lock itself (the harness does not hold it,
 *   or the two would deadlock) and emits `merge.locked` / `merge.completed`.
 * - Without, the harness merges natively: it takes the lock, re-reads the pull
 *   request, checks that its head is the expected head (the step's `head`,
 *   else the `head` output of the run's latest `wait-for-review` or
 *   `wait-for-checks` step), resolves the method from the repository settings
 *   and rulesets, then runs `gh pr merge --repo --match-head-commit <expected>`
 *   outside the checkout, so `gh` never checks out the base branch in a
 *   worktree. The remote head branch is deleted through the API. A head that
 *   moved since it was verified stops the run `awaiting-human` with a
 *   `needs_input` request (merge it anyway, or stop); anything GitHub refuses
 *   (branch protection, conflicts) stops it `awaiting-human` too: nothing is
 *   bypassed.
 *
 * The `on-merge` worktree cleanup runs at the end of the run, once a step
 * reported `merged`: the worktree is removed, then its local branch.
 */

import os from "node:os";

import { getGithubConfig } from "../config.js";
import type { ConsoleOutput } from "../console.js";
import { GhError } from "../github/gh.js";
import { acquireMergeLock, mergeLockPath, readMergeLock } from "../github/merge-lock.js";
import { mergePolicy, resolveMergeMethod } from "../github/merge-method.js";
import {
	type PullRequest,
	branchRules,
	deleteRemoteBranch,
	mergePr,
	repoMergeSettings,
	viewPr,
} from "../github/pr.js";
import { sameCommit } from "../github/reviews.js";
import type { WorkflowLogger } from "../logging/logger.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import { type StepContext, StepExecutor, type StepResult, emitStepEvent } from "./base.js";
import {
	completeStep,
	failStep,
	ghOptions,
	idSlug,
	interrupted,
	latestWaitHead,
	minutes,
	pullRequestRef,
	renderField,
	stopAwaitingHuman,
} from "./github-base.js";
import { SkillStepExecutor } from "./skill-step.js";

/** Environment variable that names the merge lock file for a merge skill. */
export const MERGE_LOCK_ENV = "AF_MERGE_LOCK";

/** The head a native merge expects, and where it comes from. */
interface ExpectedHead {
	sha: string;
	/** What set it: the step's `head` field, the wait step that verified it, or the operator. */
	source: string;
}

/** `needs_input` id of a head mismatch: `merge-head-<step>-<short head>`. */
export function headRequestId(step: string, head: string): string {
	return `merge-head-${idSlug(step)}-${head.slice(0, 7)}`.slice(0, 200);
}

export class MergeStepExecutor extends StepExecutor {
	private readonly skillExecutor = new SkillStepExecutor();

	async execute(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<StepResult> {
		const checkout = context.cwdOverride ?? context.repoRoot;
		const lockPath = mergeLockPath(checkout);
		if (step.skill) {
			logger.info(step.name, `Running ${step.skill} with ${MERGE_LOCK_ENV}=${lockPath}`);
			const env = { ...(context.env ?? process.env), [MERGE_LOCK_ENV]: lockPath };
			return this.skillExecutor.execute(step, progress, { ...context, env }, logger, console);
		}
		return this.mergeNative(step, progress, context, logger, console, lockPath);
	}

	private async mergeNative(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
		lockPath: string,
	): Promise<StepResult> {
		const config = getGithubConfig(context.config);
		// Only the pull request lookup of the current branch reads the checkout;
		// every other call names the repository and runs outside of it.
		let pr = await viewPr(pullRequestRef(step, context), ghOptions(context));
		const outside = ghOptions(context, context.outputDir ?? os.tmpdir());

		const early = await this.settled(step, progress, context, logger, console, pr);
		if (early) return early;
		let expected = this.expectedHead(step, progress, context);
		const earlyHead = await this.checkHead(step, progress, context, logger, console, pr, expected);
		if (earlyHead.stop) return earlyHead.stop;
		expected = earlyHead.expected;

		const lock = await acquireMergeLock(lockPath, {
			timeoutMs: minutes(config.merge.lockTimeoutMinutes),
			signal: context.signal ?? null,
			holder: { run: context.workflowId, step: step.name, repo: pr.repo, pr: pr.number },
			onBusy: (holder) => {
				const who = holder ? `${holder.run ?? `pid ${holder.pid}`}` : "another merge";
				logger.info(step.name, `Merge lock busy (held by ${who}): waiting`);
				console.info(`Waiting for the merge lock of ${pr.repo} (held by ${who})`);
			},
		});
		if (!lock) {
			if (context.signal?.aborted) return interrupted();
			const holder = readMergeLock(lockPath);
			return stopAwaitingHuman(
				step,
				progress,
				context,
				logger,
				console,
				`Merge lock ${lockPath} stayed busy for ${config.merge.lockTimeoutMinutes} min (held by ${holder?.run ?? "unknown"})`,
				{ pr: pr.url, blockers: [`merge lock ${lockPath} busy`] },
			);
		}
		try {
			await emitStepEvent(context, "merge.locked", {
				step: step.name,
				lock: lockPath,
				pr: pr.url,
			});
			// Re-read under the lock: another run may have merged or moved the base
			pr = await viewPr(pr.url, outside);
			const settled = await this.settled(step, progress, context, logger, console, pr);
			if (settled) return settled;
			const headCheck = await this.checkHead(
				step,
				progress,
				context,
				logger,
				console,
				pr,
				expected,
			);
			if (headCheck.stop) return headCheck.stop;
			expected = headCheck.expected;
			// The full id of the verified head (the expected one may be a short SHA)
			const matchHead = expected && expected.sha.length === 40 ? expected.sha : pr.headRefOid;

			let resolved: ReturnType<typeof resolveMergeMethod>;
			try {
				const policy = mergePolicy(
					await repoMergeSettings(pr.repo, outside),
					await branchRules(pr.repo, pr.baseRefName, outside),
				);
				resolved = resolveMergeMethod(
					policy,
					step.method ?? config.merge.method,
					config.merge.preference,
				);
			} catch (e) {
				if (e instanceof GhError) throw e;
				return failStep(step, progress, context, logger, console, {
					status: "failed",
					summary: e instanceof Error ? e.message : String(e),
					pr: pr.url,
				});
			}
			logger.info(step.name, `Merge method ${resolved.method}: ${resolved.reason}`);
			await context.recordDecision?.({
				id: `d-merge-${idSlug(step.name)}-${pr.headRefOid.slice(0, 7)}`.slice(0, 200),
				phase: step.name,
				risk: "low",
				decision: `${resolved.queue ? "Enqueue" : "Merge"} ${pr.url} with ${resolved.method}`,
				rationale: resolved.reason,
				alternatives: resolved.alternatives,
				refs: [pr.url],
			});

			try {
				await mergePr(pr, resolved.method, resolved.queue, outside, matchHead);
			} catch (e) {
				if (context.signal?.aborted) return interrupted();
				const detail = e instanceof Error ? e.message : String(e);
				return stopAwaitingHuman(
					step,
					progress,
					context,
					logger,
					console,
					`GitHub refused to merge ${pr.url}: ${detail}`,
					{ pr: pr.url, blockers: [detail] },
				);
			}

			const outputs: Record<string, unknown> = {
				pr: pr.number,
				url: pr.url,
				head: pr.headRefOid,
				base: pr.baseRefName,
				method: resolved.method,
				method_reason: resolved.reason,
				queue: resolved.queue,
			};
			if (resolved.queue) {
				return completeStep(step, progress, context, logger, console, {
					status: "done",
					summary: `Enqueued ${pr.url} in the merge queue (${resolved.method})`,
					pr: pr.url,
					outputs: { ...outputs, merged: false },
				});
			}

			let remote = "kept";
			if ((step.deleteBranch ?? config.merge.deleteBranch) && !pr.isCrossRepository) {
				const deleted = await deleteRemoteBranch(pr, outside);
				remote =
					deleted.outcome === "deleted"
						? "deleted"
						: deleted.outcome === "gone"
							? "already gone"
							: `delete failed: ${deleted.detail}`;
				if (deleted.outcome === "failed") {
					logger.warning(
						step.name,
						`Remote branch ${pr.headRefName} not deleted: ${deleted.detail}`,
					);
				}
			}
			await emitStepEvent(context, "merge.completed", {
				step: step.name,
				pr: pr.url,
				method: resolved.method,
				reason: resolved.reason,
				head: pr.headRefOid,
				remote_branch: remote,
			});
			return completeStep(step, progress, context, logger, console, {
				status: "merged",
				summary: `Merged ${pr.url} at ${pr.headRefOid.slice(0, 7)} with ${resolved.method} (${resolved.reason})`,
				pr: pr.url,
				max_risk: "low",
				outputs: { ...outputs, merged: true, remote_branch: remote },
			});
		} finally {
			lock.release();
		}
	}

	/**
	 * The head the merge expects: the step's `head` (template), else the `head`
	 * output of the run's latest wait step, else null (no check).
	 */
	private expectedHead(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
	): ExpectedHead | null {
		if (step.head) {
			const rendered = renderField(context, step.head).trim();
			if (rendered) return { sha: rendered, source: "the step's head field" };
		}
		const latest = latestWaitHead(progress, context);
		return latest ? { sha: latest.head, source: `step ${latest.step}` } : null;
	}

	/**
	 * Compares the pull request head with the expected head. On a mismatch the
	 * step stops `awaiting-human` with a `needs_input` request, unless the
	 * operator already answered it: `merge` takes the new head as expected,
	 * `stop` fails the step.
	 */
	private async checkHead(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
		pr: PullRequest,
		expected: ExpectedHead | null,
	): Promise<{ stop: StepResult | null; expected: ExpectedHead | null }> {
		if (!expected || sameCommit(expected.sha, pr.headRefOid)) return { stop: null, expected };
		const id = headRequestId(step.name, pr.headRefOid);
		const answer = context.inputAnswer ? await context.inputAnswer(step.name, id) : null;
		const choice = answer ? (answer.option ?? answer.answer) : null;
		const now = pr.headRefOid.slice(0, 7);
		const was = expected.sha.slice(0, 7);
		if (choice === "merge") {
			logger.info(step.name, `Head ${now} differs from ${was}: merging it (operator)`);
			return { stop: null, expected: { sha: pr.headRefOid, source: "the operator" } };
		}
		if (choice === "stop") {
			return {
				stop: await failStep(step, progress, context, logger, console, {
					status: "failed",
					summary: `Not merged: the head of ${pr.url} moved from ${was} to ${now} (operator)`,
					pr: pr.url,
				}),
				expected,
			};
		}
		return {
			stop: await stopAwaitingHuman(
				step,
				progress,
				context,
				logger,
				console,
				`The head of ${pr.url} moved from ${was} (verified by ${expected.source}) to ${now}`,
				{ pr: pr.url, blockers: [`head moved from ${was} to ${now}`] },
				{
					id,
					question: `The head of ${pr.url} is ${now}, not ${was} verified by ${expected.source}. Merge ${now} anyway, or stop?`,
					options: [
						{
							id: "merge",
							label: "Merge anyway",
							description: `Merge ${now} without the reviews or checks of the expected head`,
						},
						{ id: "stop", label: "Stop", description: "Fail the step without merging" },
					],
					recommended: null,
					blocking: true,
					context: "To verify the new head instead, rerun the wait step with af retry-step.",
				},
			),
			expected,
		};
	}

	/** An already merged, closed or draft pull request ends the step without merging. */
	private async settled(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
		pr: PullRequest,
	): Promise<StepResult | null> {
		if (pr.state === "MERGED") {
			return completeStep(step, progress, context, logger, console, {
				status: "merged",
				summary: `${pr.url} is already merged`,
				pr: pr.url,
				outputs: { pr: pr.number, url: pr.url, merged: true, already: true },
			});
		}
		if (pr.state === "CLOSED") {
			return failStep(step, progress, context, logger, console, {
				status: "failed",
				summary: `${pr.url} is closed without a merge`,
				pr: pr.url,
			});
		}
		if (pr.isDraft) {
			return stopAwaitingHuman(
				step,
				progress,
				context,
				logger,
				console,
				`${pr.url} is a draft: mark it ready for review, then af resume`,
				{ pr: pr.url, blockers: ["draft pull request"] },
			);
		}
		return null;
	}
}
