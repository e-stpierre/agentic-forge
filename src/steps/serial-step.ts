/** Serial step executor. */

import type { ConsoleOutput } from "../console.js";
import type { WorkflowLogger } from "../logging/logger.js";
import { WORKFLOW_STATUS, updateStepCompleted, updateStepFailed } from "../progress.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import {
	type BranchStepExecutor,
	type StepContext,
	StepExecutor,
	type StepResult,
} from "./base.js";

export class SerialStepExecutor extends StepExecutor {
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
			logger.warning(step.name, "Serial step has no sub-steps");
			updateStepCompleted(progress, step.name, "No sub-steps to execute");
			console.stepComplete(step.name, "No sub-steps to execute");
			return { success: true, outputSummary: "No sub-steps to execute" };
		}

		logger.info(step.name, `Starting serial execution of ${step.steps.length} steps`);
		console.info(`Serial: executing ${step.steps.length} steps in sequence`);

		let completedCount = 0;

		for (const subStep of step.steps) {
			try {
				const result = await this.branchExecutor(subStep, progress, context, logger, console);

				if (!result.success) {
					logger.warning(
						step.name,
						`Serial block stopped at step '${subStep.name}' due to failure`,
					);
					const errorMsg = `Step '${subStep.name}' failed: ${result.error}`;
					updateStepFailed(progress, step.name, errorMsg);
					console.stepFailed(step.name, `Step '${subStep.name}' failed`);
					progress.status = WORKFLOW_STATUS.FAILED;
					return { success: false, error: errorMsg };
				}

				completedCount++;

				if (progress.status === WORKFLOW_STATUS.FAILED) {
					logger.warning(
						step.name,
						`Serial block stopped at step '${subStep.name}' due to failure`,
					);
					break;
				}
			} catch (e: unknown) {
				const errStr = e instanceof Error ? e.message : String(e);
				logger.error(subStep.name, `Step failed in serial block: ${errStr}`);
				const errorMsg = `Step '${subStep.name}' failed: ${errStr}`;
				updateStepFailed(progress, step.name, errorMsg);
				console.stepFailed(step.name, `Step '${subStep.name}' failed`);
				progress.status = WORKFLOW_STATUS.FAILED;
				return { success: false, error: errorMsg };
			}
		}

		if (progress.status !== WORKFLOW_STATUS.FAILED) {
			const outputSummary = `Completed ${completedCount}/${step.steps.length} steps`;
			updateStepCompleted(progress, step.name, outputSummary);
			console.stepComplete(step.name, outputSummary);
			logger.info(step.name, outputSummary);
			return { success: true, outputSummary };
		}

		return { success: false, error: "Serial execution failed" };
	}
}
