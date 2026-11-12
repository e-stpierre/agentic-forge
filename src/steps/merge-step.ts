/**
 * `merge` step: merges the pull request under the per-repository merge lock,
 * so two runs of one repository (from any worktree) never merge at once.
 *
 * - With `skill:` (for example `esp-skills:esp-merge`), the skill runs like a
 *   `skill` step with `AF_MERGE_LOCK` set to the lock file. The skill's merge
 *   script takes and releases the lock itself (the harness does not hold it,
 *   or the two would deadlock) and emits `merge.locked` / `merge.completed`.
 * - Without, the harness merges natively: it takes the lock, re-reads the pull
 *   request, resolves the method from the repository settings and rulesets,
 *   then runs `gh pr merge --repo` outside the checkout, so `gh` never checks
 *   out the base branch in a worktree. The remote head branch is deleted
 *   through the API. Anything GitHub refuses (branch protection, a moved
 *   head, conflicts) stops the run `awaiting-human`: nothing is bypassed.
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
import type { WorkflowLogger } from "../logging/logger.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import { type StepContext, StepExecutor, type StepResult, emitStepEvent } from "./base.js";
import {
	completeStep,
	failStep,
	ghOptions,
	interrupted,
	minutes,
	pullRequestRef,
	stopAwaitingHuman,
} from "./github-base.js";
import { SkillStepExecutor } from "./skill-step.js";

/** Environment variable that names the merge lock file for a merge skill. */
export const MERGE_LOCK_ENV = "AF_MERGE_LOCK";

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
				id: `d-merge-${step.name}-${pr.headRefOid.slice(0, 7)}`,
				phase: step.name,
				risk: "low",
				decision: `${resolved.queue ? "Enqueue" : "Merge"} ${pr.url} with ${resolved.method}`,
				rationale: resolved.reason,
				alternatives: resolved.alternatives,
				refs: [pr.url],
			});

			try {
				await mergePr(pr, resolved.method, resolved.queue, outside);
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
				remote = (await deleteRemoteBranch(pr, outside)) ? "deleted" : "already gone";
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
