/** Ralph loop step executor. */

import type { ConsoleOutput } from "../console.js";
import { extractSummary } from "../console.js";
import type { WorkflowLogger } from "../logging/logger.js";
import { getOutputDir } from "../paths.js";
import { WORKFLOW_STATUS, updateStepCompleted, updateStepFailed } from "../progress.js";
import {
	buildRalphSystemMessage,
	createRalphState,
	deactivateRalphState,
	detectCompletionPromise,
	loadRalphState,
	updateRalphIteration,
} from "../ralph-loop.js";
import { runRuntime } from "../runtimes/process-runner.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import {
	type StepContext,
	StepExecutor,
	type StepResult,
	buildTemplateContext,
	resolveModel,
} from "./base.js";

export class RalphLoopStepExecutor extends StepExecutor {
	async execute(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<StepResult> {
		const promptTemplate = step.prompt ?? "";
		const templateContext = buildTemplateContext(context);

		let completionPromise = step.completionPromise ?? "COMPLETE";
		if (context.renderer.hasVariables(completionPromise)) {
			completionPromise = context.renderer.renderString(completionPromise, templateContext);
		}

		// Handle max_iterations which may be a template string or integer
		const maxIterationsRaw = step.maxIterations;
		let maxIterations: number;
		if (typeof maxIterationsRaw === "string" && context.renderer.hasVariables(maxIterationsRaw)) {
			maxIterations = Number.parseInt(
				context.renderer.renderString(maxIterationsRaw, templateContext),
				10,
			);
		} else {
			maxIterations = maxIterationsRaw ? Number.parseInt(String(maxIterationsRaw), 10) : 5;
		}

		const timeout = (step.stepTimeoutMinutes ?? 30) * 60;
		const bypassPermissions = context.workflowSettings?.bypassPermissions ?? false;
		const allowedTools = context.workflowSettings?.requiredTools?.length
			? context.workflowSettings.requiredTools
			: null;

		// Always enable streaming when console is provided
		const printOutput = true;

		logger.info(step.name, `Starting Ralph loop (max ${maxIterations} iterations)`);
		console.info(`Ralph loop starting (max ${maxIterations} iterations)`);

		const allOutputs: string[] = [];

		const outputDir =
			context.outputDir ?? getOutputDir(progress.workflowId, context.config, context.repoRoot);

		// Check for existing ralph state to resume from
		const existingState = loadRalphState(progress.workflowId, step.name, outputDir);
		let startIteration: number;
		if (existingState?.active) {
			startIteration = existingState.iteration;
			logger.info(step.name, `Resuming Ralph loop from iteration ${startIteration}`);
			console.info(`Resuming Ralph loop from iteration ${startIteration}`);
		} else {
			startIteration = 1;
		}

		for (let iteration = startIteration; iteration <= maxIterations; iteration++) {
			logger.info(step.name, `Ralph loop iteration ${iteration}/${maxIterations}`);

			// Render prompt with iteration context
			const iterationContext = {
				...templateContext,
				iteration,
				max_iterations: maxIterations,
			};
			let prompt: string;
			if (context.renderer.hasVariables(promptTemplate)) {
				prompt = context.renderer.renderString(promptTemplate, iterationContext);
			} else {
				prompt = promptTemplate;
			}

			// Create ralph state on first iteration
			if (iteration === startIteration && !existingState?.active) {
				createRalphState(
					progress.workflowId,
					step.name,
					prompt,
					maxIterations,
					completionPromise,
					outputDir,
				);
			}

			const systemMessage = buildRalphSystemMessage(iteration, maxIterations, completionPromise);
			const fullPrompt = `${systemMessage}${prompt}`;

			// Display iteration header BEFORE running runtime
			console.ralphIterationStart(step.name, iteration, maxIterations);

			const result = await runRuntime(context.runtimeAdapter, {
				prompt: fullPrompt,
				cwd: context.repoRoot,
				model: resolveModel(context, step.model),
				timeout,
				printOutput,
				skipPermissions: bypassPermissions,
				allowedTools,
				console,
				workflowId: context.workflowId,
				outputDir: context.outputDir,
			});

			if (!result.success) {
				const errorSummary = result.stderr ? extractSummary(result.stderr) : "Unknown error";
				logger.warning(step.name, `Iteration ${iteration} failed: ${result.stderr}`);
				console.ralphIteration(step.name, iteration, maxIterations, `Failed: ${errorSummary}`);
				if (iteration < maxIterations) {
					updateRalphIteration(progress.workflowId, step.name, outputDir);
					continue;
				}
				deactivateRalphState(progress.workflowId, step.name, outputDir);
				const errorMsg = `Ralph loop failed after ${maxIterations} iterations`;
				console.stepFailed(step.name, errorMsg);
				updateStepFailed(progress, step.name, errorMsg);
				progress.status = WORKFLOW_STATUS.FAILED;
				return { success: false, error: errorMsg };
			}

			allOutputs.push(result.stdout);

			// Print iteration summary
			const iterationSummary = extractSummary(result.stdout);
			console.ralphIteration(step.name, iteration, maxIterations, iterationSummary);

			const completionResult = detectCompletionPromise(result.stdout, completionPromise);

			// Check for failure signal first
			if (completionResult.isFailed) {
				const errorMsg = `Ralph loop failed: ${completionResult.failureReason}`;
				logger.error(step.name, errorMsg);
				deactivateRalphState(progress.workflowId, step.name, outputDir);
				const combinedOutput = allOutputs.join("\n\n---\n\n");
				console.stepFailed(step.name, errorMsg);
				updateStepFailed(progress, step.name, errorMsg);
				progress.status = WORKFLOW_STATUS.FAILED;
				return { success: false, error: errorMsg, fullOutput: combinedOutput };
			}

			if (completionResult.isComplete && completionResult.promiseMatched) {
				logger.info(step.name, `Ralph loop completed at iteration ${iteration}`);
				deactivateRalphState(progress.workflowId, step.name, outputDir);
				const combinedOutput = allOutputs.join("\n\n---\n\n");
				const outputSummary = `Completed in ${iteration} iterations`;
				updateStepCompleted(progress, step.name, outputSummary, combinedOutput);
				console.ralphComplete(step.name, iteration, maxIterations);
				return { success: true, outputSummary, fullOutput: combinedOutput };
			}

			if (iteration < maxIterations) {
				updateRalphIteration(progress.workflowId, step.name, outputDir);
			}
		}

		logger.warning(
			step.name,
			`Ralph loop reached max iterations (${maxIterations}) without completion`,
		);
		deactivateRalphState(progress.workflowId, step.name, outputDir);
		const combinedOutput = allOutputs.join("\n\n---\n\n");
		const outputSummary = `Max iterations (${maxIterations}) reached without completion promise`;
		updateStepCompleted(progress, step.name, outputSummary, combinedOutput);
		console.ralphMaxIterations(step.name, maxIterations);
		return { success: true, outputSummary, fullOutput: combinedOutput };
	}
}
