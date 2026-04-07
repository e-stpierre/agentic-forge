/** Parallel step executor. */

import type { ConsoleOutput } from "../console.js";
import { type Worktree, createWorktree, removeWorktree, safetyCommit } from "../git/worktree.js";
import type { WorkflowLogger } from "../logging/logger.js";
import { WORKFLOW_STATUS, updateStepCompleted, updateStepFailed } from "../progress.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import { resolveStepWorktree } from "../worktree-settings.js";
import {
	type BranchStepExecutor,
	type StepContext,
	StepExecutor,
	type StepResult,
} from "./base.js";

export class ParallelStepExecutor extends StepExecutor {
	constructor(private branchExecutor: BranchStepExecutor) {
		super();
	}

	async execute(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<StepResult> {
		if (!step.steps || step.steps.length === 0) {
			logger.warning(step.name, "Parallel step has no sub-steps");
			updateStepCompleted(progress, step.name, "No sub-steps to execute");
			console.stepComplete(step.name, "No sub-steps to execute");
			return { success: true, outputSummary: "No sub-steps to execute" };
		}

		const useWorktree = resolveStepWorktree(step.worktree, context.renderer, context.variables);

		logger.info(step.name, `Starting parallel execution of ${step.steps.length} branches`);
		if (useWorktree) {
			console.info(`Parallel: starting ${step.steps.length} branches (worktree isolation)`);
		} else {
			console.info(`Parallel: starting ${step.steps.length} branches`);
		}

		// Register branches for parallel display
		const branchNames = step.steps.map((s) => s.name);
		console.registerParallelBranches(branchNames);
		console.enterParallelMode();

		const failedBranches: string[] = [];
		const worktrees: Record<string, Worktree> = {};

		const executeBranch = async (
			branchStep: StepDefinition,
		): Promise<[string, boolean, string, Worktree | null]> => {
			const branchContext: StepContext = {
				...context,
				variables: { ...context.variables },
			};
			let worktree: Worktree | null = null;

			try {
				console.setParallelBranch(branchStep.name);

				if (useWorktree) {
					worktree = createWorktree({
						workflowName: progress.workflowName,
						stepName: branchStep.name,
						baseBranch: undefined,
						repoRoot: context.repoRoot,
						location: context.workflowSettings?.worktree?.location ?? "sibling",
						directory: context.workflowSettings?.worktree?.directory ?? null,
					});
					logger.info(branchStep.name, `Created worktree: ${worktree.path}`);
					console.info(`  Branch '${branchStep.name}' worktree: ${worktree.branch}`);
					branchContext.cwdOverride = worktree.path;
				}

				const result = await this.branchExecutor(
					branchStep,
					progress,
					branchContext,
					logger,
					console,
				);

				return [branchStep.name, result.success, result.outputSummary ?? "", worktree];
			} catch (e: unknown) {
				const errStr = e instanceof Error ? (e.stack ?? e.message) : String(e);
				logger.error(branchStep.name, `Branch failed with exception: ${errStr}`);
				return [branchStep.name, false, String(e), worktree];
			}
		};

		// Execute branches with concurrency cap from config
		const execution = context.config?.execution as Record<string, unknown> | undefined;
		const maxWorkers = (execution?.maxWorkers as number) ?? 4;
		const settled: PromiseSettledResult<[string, boolean, string, Worktree | null]>[] = [];
		const queue = [...step.steps];

		const runNext = async (): Promise<void> => {
			while (queue.length > 0) {
				const branchStep = queue.shift();
				if (!branchStep) break;
				try {
					const value = await executeBranch(branchStep);
					settled.push({ status: "fulfilled", value });
				} catch (reason) {
					settled.push({ status: "rejected", reason });
				}
			}
		};

		const workers = Array.from({ length: Math.min(maxWorkers, queue.length) }, () => runNext());
		await Promise.all(workers);
		const results = settled;

		for (const result of results) {
			if (result.status === "fulfilled") {
				const [name, success, output, worktree] = result.value;
				if (worktree) {
					worktrees[name] = worktree;
				}
				if (success) {
					console.info(`  Branch '${name}' completed`);
				} else {
					console.error(`  Branch '${name}' failed: ${output}`);
					failedBranches.push(name);
				}
			} else {
				// Promise rejected — should be rare since executeBranch catches errors
				const reason = String(result.reason);
				logger.error(step.name, `Branch promise rejected: ${reason}`);
			}
		}

		// Exit parallel mode
		console.exitParallelMode();

		// Cleanup worktrees based on policy
		const cleanup = context.workflowSettings?.worktree?.cleanup ?? "on-success";
		for (const [name, worktree] of Object.entries(worktrees)) {
			const isFailed = failedBranches.includes(name);
			const shouldRemove =
				cleanup === "on-complete" || (cleanup === "on-success" && !isFailed);

			if (shouldRemove) {
				const safetyResult = safetyCommit(worktree.path, logger);
				if (safetyResult.failed) {
					logger.warning(
						name,
						`Safety commit failed; preserving worktree to prevent data loss: ${worktree.path}`,
					);
					console.info(`  Branch '${name}' worktree preserved (safety commit failed): ${worktree.path}`);
				} else {
					removeWorktree(worktree, context.repoRoot, false);
					logger.info(name, `Worktree removed, branch preserved: ${worktree.branch}`);
				}
			} else {
				logger.info(name, `Worktree preserved (cleanup: ${cleanup}): ${worktree.path}`);
				console.info(`  Branch '${name}' worktree preserved: ${worktree.path}`);
			}
		}

		// Handle completion
		if (failedBranches.length > 0) {
			const errorMsg = `Parallel branches failed: ${failedBranches.join(", ")}`;
			updateStepFailed(progress, step.name, errorMsg);
			console.stepFailed(step.name, errorMsg);
			progress.status = WORKFLOW_STATUS.FAILED;
			return { success: false, error: errorMsg };
		}

		const completed = step.steps.length;
		const outputSummary = `Completed ${completed}/${step.steps.length} branches`;
		updateStepCompleted(progress, step.name, outputSummary);
		console.stepComplete(step.name, outputSummary);
		logger.info(step.name, outputSummary);
		return { success: true, outputSummary };
	}
}
