/** Prompt step executor. */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ConsoleOutput } from "../console.js";
import { extractJson, extractSummary } from "../console.js";
import type { WorkflowLogger } from "../logging/logger.js";
import { WORKFLOW_STATUS, updateStepCompleted, updateStepFailed } from "../progress.js";
import { resolveRuntime } from "../runtimes/index.js";
import { runRuntime } from "../runtimes/process-runner.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import {
	type StepContext,
	StepExecutor,
	type StepResult,
	buildTemplateContext,
	resolveModel,
} from "./base.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class PromptStepExecutor extends StepExecutor {
	async execute(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<StepResult> {
		let prompt = step.prompt ?? "";
		const templateContext = buildTemplateContext(context);

		if (context.renderer.hasVariables(prompt)) {
			prompt = context.renderer.renderString(prompt, templateContext);
		}

		const cwd = context.cwdOverride ?? context.repoRoot;

		// Load agent file if specified (fallback to bundled agents)
		if (step.agent) {
			let agentPath = path.join(context.repoRoot, step.agent);
			if (!existsSync(agentPath)) {
				agentPath = path.join(__dirname, "..", "agents", path.basename(step.agent));
			}
			if (existsSync(agentPath)) {
				const agentContent = readFileSync(agentPath, "utf-8");
				prompt = `${agentContent}\n\n${prompt}`;
			}
		}

		const timeout = (step.stepTimeoutMinutes ?? 60) * 60;
		const defaults = context.config.defaults as Record<string, unknown> | undefined;
		const maxRetry = step.stepMaxRetry ?? (defaults?.maxRetry as number) ?? 3;
		const bypassPermissions = context.workflowSettings?.bypassPermissions ?? false;
		const allowedTools = context.workflowSettings?.requiredTools?.length
			? context.workflowSettings.requiredTools
			: null;

		// Always enable streaming when console is provided
		const printOutput = true;

		for (let attempt = 0; attempt <= maxRetry; attempt++) {
			const result = await runRuntime(context.runtimeAdapter, {
				prompt,
				cwd,
				model: resolveModel(context, step.model),
				timeout,
				printOutput,
				skipPermissions: bypassPermissions,
				allowedTools,
				console,
				workflowId: context.workflowId,
				outputDir: context.outputDir,
			});

			if (result.success) {
				// Use session output context if available, fall back to extracted summary
				const sessionOut = result.sessionOutput;
				let outputSummary: string;
				if (sessionOut.isSuccess && sessionOut.context) {
					outputSummary = sessionOut.context;
					if (sessionOut.sessionId) {
						logger.info(step.name, `Session ID: ${sessionOut.sessionId}`);
					}
				} else {
					outputSummary = result.stdout ? extractSummary(result.stdout) : "";
				}

				// Try to extract structured JSON from skill output
				const stepOutput = result.stdout ? extractJson(result.stdout) : null;
				const outputValue = stepOutput ?? result.stdout;

				updateStepCompleted(progress, step.name, outputSummary, outputValue, sessionOut.sessionId);
				console.stepComplete(step.name, outputSummary);
				logger.info(step.name, "Step completed successfully");
				return { success: true, outputSummary, fullOutput: result.stdout };
			}

			if (attempt < maxRetry) {
				const errorSummary = result.stderr ? extractSummary(result.stderr) : "Unknown error";
				console.stepRetry(step.name, attempt + 1, maxRetry + 1, errorSummary);
				logger.warning(step.name, `Attempt ${attempt + 1} failed, retrying...`, {
					error: result.stderr,
				});
				if (progress.currentStep) {
					progress.currentStep.retryCount = attempt + 1;
				}
			} else {
				const errorMsg = result.stderr || "Step failed";
				const errorSummary = errorMsg ? extractSummary(errorMsg) : "Unknown error";
				console.stepFailed(step.name, errorSummary);
				updateStepFailed(progress, step.name, errorMsg);
				progress.status = WORKFLOW_STATUS.FAILED;
				logger.error(step.name, `Step failed after ${maxRetry + 1} attempts`);
				return { success: false, error: errorMsg };
			}
		}

		return { success: false, error: "Unexpected exit from retry loop" };
	}
}
