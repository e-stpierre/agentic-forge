/** Conditional step executor. */

import type { ConsoleOutput } from "../console.js";
import type { WorkflowLogger } from "../logging/logger.js";
import { WORKFLOW_STATUS, updateStepCompleted, updateStepFailed } from "../progress.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import {
	type BranchStepExecutor,
	type StepContext,
	StepExecutor,
	type StepResult,
	buildTemplateContext,
} from "./base.js";

export class ConditionalStepExecutor extends StepExecutor {
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
		let condition = step.condition ?? "false";
		logger.info(step.name, `Evaluating condition: ${condition}`);

		const templateContext = buildTemplateContext(context);
		if (context.renderer.hasVariables(condition)) {
			condition = context.renderer.renderString(condition, templateContext);
		}

		const conditionResult = this.evaluateCondition(condition, templateContext);
		logger.info(step.name, `Condition evaluated to: ${conditionResult}`);
		console.info(`Conditional '${step.name}': ${condition} = ${conditionResult}`);

		const stepsToRun = conditionResult ? step.thenSteps : step.elseSteps;
		const branchName = conditionResult ? "then" : "else";

		if (!stepsToRun || stepsToRun.length === 0) {
			const outputSummary = `Condition ${conditionResult}, no '${branchName}' branch to execute`;
			updateStepCompleted(progress, step.name, outputSummary);
			console.stepComplete(step.name, outputSummary);
			return { success: true, outputSummary };
		}

		logger.info(step.name, `Executing '${branchName}' branch with ${stepsToRun.length} steps`);

		for (const subStep of stepsToRun) {
			try {
				const result = await this.branchExecutor(subStep, progress, context, logger, console);

				if (!result.success) {
					logger.warning(step.name, `Conditional '${branchName}' branch stopped due to failure`);
					const errorMsg = `Step '${subStep.name}' failed: ${result.error}`;
					updateStepFailed(progress, step.name, errorMsg);
					console.stepFailed(step.name, `Step '${subStep.name}' failed`);
					progress.status = WORKFLOW_STATUS.FAILED;
					return { success: false, error: errorMsg };
				}

				if (progress.status === WORKFLOW_STATUS.FAILED) {
					logger.warning(step.name, `Conditional '${branchName}' branch stopped due to failure`);
					break;
				}
			} catch (e: unknown) {
				const errStr = e instanceof Error ? e.message : String(e);
				logger.error(subStep.name, `Step failed in conditional branch: ${errStr}`);
				const errorMsg = `Step '${subStep.name}' failed: ${errStr}`;
				updateStepFailed(progress, step.name, errorMsg);
				console.stepFailed(step.name, `Step '${subStep.name}' failed`);
				progress.status = WORKFLOW_STATUS.FAILED;
				return { success: false, error: errorMsg };
			}
		}

		if (progress.status !== WORKFLOW_STATUS.FAILED) {
			const outputSummary = `Executed '${branchName}' branch (${stepsToRun.length} steps)`;
			updateStepCompleted(progress, step.name, outputSummary);
			console.stepComplete(step.name, outputSummary);
			logger.info(step.name, outputSummary);
			return { success: true, outputSummary };
		}

		return { success: false, error: "Conditional execution failed" };
	}

	evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
		const trimmed = condition.trim();

		if (["true", "1", "yes"].includes(trimmed.toLowerCase())) {
			return true;
		}
		if (["false", "0", "no", "none", ""].includes(trimmed.toLowerCase())) {
			return false;
		}

		if (trimmed.includes("!=")) {
			const [left, right] = trimmed.split("!=", 2);
			const leftVal = this.resolveValue(left.trim(), context);
			const rightVal = this.resolveValue(right.trim(), context);
			return leftVal !== rightVal;
		}

		if (trimmed.includes("==")) {
			const [left, right] = trimmed.split("==", 2);
			const leftVal = this.resolveValue(left.trim(), context);
			const rightVal = this.resolveValue(right.trim(), context);
			return leftVal === rightVal;
		}

		const value = this.resolveValue(trimmed, context);
		return (
			Boolean(value) && value !== "none" && value !== "None" && value !== "null" && value !== ""
		);
	}

	resolveValue(expr: string, context: Record<string, unknown>): unknown {
		const trimmed = expr.trim();

		if (
			(trimmed.startsWith("'") && trimmed.endsWith("'")) ||
			(trimmed.startsWith('"') && trimmed.endsWith('"'))
		) {
			return trimmed.slice(1, -1);
		}

		if (trimmed.startsWith("variables.")) {
			const varName = trimmed.slice(10);
			const vars = context.variables as Record<string, unknown> | undefined;
			return vars?.[varName];
		}

		if (trimmed.startsWith("outputs.")) {
			const outputName = trimmed.slice(8);
			const outputs = context.outputs as Record<string, unknown> | undefined;
			return outputs?.[outputName];
		}

		return (context as Record<string, unknown>)[trimmed] ?? trimmed;
	}
}
