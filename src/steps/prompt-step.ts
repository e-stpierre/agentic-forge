/** Prompt step executor. */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSandboxMode } from "../config.js";
import type { ConsoleOutput } from "../console.js";
import { extractJson, extractSummary } from "../console.js";
import { parseResultBlock, resultStatusFromExit } from "../contract/result.js";
import type { WorkflowLogger } from "../logging/logger.js";
import {
	STEP_STATUS,
	WORKFLOW_STATUS,
	updateStepCompleted,
	updateStepFailed,
	updateStepStopped,
} from "../progress.js";
import { runRuntime } from "../runtimes/process-runner.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import {
	STEP_INTERRUPTED_ERROR,
	type StepContext,
	StepExecutor,
	type StepResult,
	buildTemplateContext,
	resolveModel,
	withOperatorMessages,
} from "./base.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Result statuses that stop the run, with the step and workflow status they record. */
const STOP_STATUSES: Record<string, { stepStatus: string; workflowStatus: string }> = {
	"awaiting-human": {
		stepStatus: STEP_STATUS.AWAITING_HUMAN,
		workflowStatus: WORKFLOW_STATUS.AWAITING_HUMAN,
	},
	halted: { stepStatus: STEP_STATUS.HALTED, workflowStatus: WORKFLOW_STATUS.HALTED },
	escalate: { stepStatus: STEP_STATUS.ESCALATED, workflowStatus: WORKFLOW_STATUS.BLOCKED },
};

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

		// Pending operator messages start the prompt (delivered once, reused by retries)
		prompt = await withOperatorMessages(context, step.name, prompt);

		const timeout = (step.stepTimeoutMinutes ?? 60) * 60;
		const defaults = context.config.defaults as Record<string, unknown> | undefined;
		const maxRetry = step.stepMaxRetry ?? (defaults?.maxRetry as number) ?? 3;
		const bypassPermissions =
			step.bypassPermissions ?? context.workflowSettings?.bypassPermissions ?? false;
		const allowedTools = context.workflowSettings?.requiredTools?.length
			? context.workflowSettings.requiredTools
			: null;

		// Always enable streaming when console is provided
		const printOutput = true;

		for (let attempt = 0; attempt <= maxRetry; attempt++) {
			const result = await runRuntime(context.runtimeAdapter, {
				prompt,
				cwd,
				model: resolveModel(context, step.model) ?? undefined,
				timeout,
				printOutput,
				skipPermissions: bypassPermissions,
				allowedTools,
				console,
				workflowId: context.workflowId,
				outputDir: context.outputDir,
				sandbox: getSandboxMode(context.config),
				env: context.env ?? null,
				signal: context.signal ?? null,
			});

			// Stopped by the supervisor: no retry, the executor records the interruption
			if (context.signal?.aborted) {
				return { success: false, error: STEP_INTERRUPTED_ERROR };
			}

			// Contract result block on the last output line; the exit code otherwise
			let block = result.sessionOutput?.result ?? parseResultBlock(result.stdout);
			if (block && context.recordResult) {
				block = (await context.recordResult(step.name, block)) ?? block;
			}
			const status =
				block?.status ?? (result.success ? "done" : resultStatusFromExit(result.returncode));

			if (STOP_STATUSES[status]) {
				const { stepStatus, workflowStatus } = STOP_STATUSES[status];
				const summary = block?.summary ?? `Step exited with status ${status}`;
				updateStepStopped(progress, step.name, stepStatus, summary, status, status !== "halted");
				progress.status = workflowStatus;
				console.info(`Step ${step.name} returned ${status}: ${summary}`);
				logger.info(step.name, `Step returned ${status}: ${summary}`);
				return { success: false, outputSummary: summary, error: `Step returned ${status}` };
			}

			if (status === "done" || status === "merged") {
				// The result block summary, else the legacy session context, else the output
				const sessionOut = result.sessionOutput;
				let outputSummary: string;
				if (block) {
					outputSummary = block.summary;
				} else if (sessionOut?.isSuccess && sessionOut.context) {
					outputSummary = sessionOut.context;
				} else {
					outputSummary = result.stdout ? extractSummary(result.stdout) : "";
				}
				if (sessionOut?.sessionId) {
					logger.info(step.name, `Session ID: ${sessionOut.sessionId}`);
				}

				// Try to extract structured JSON from skill output
				const stepOutput = result.stdout ? extractJson(result.stdout) : null;
				const outputValue = stepOutput ?? result.stdout;

				updateStepCompleted(
					progress,
					step.name,
					outputSummary,
					outputValue,
					sessionOut?.sessionId,
					block ? status : null,
				);
				console.stepComplete(step.name, outputSummary);
				logger.info(step.name, "Step completed successfully");
				return { success: true, outputSummary, fullOutput: result.stdout };
			}

			// A reported `failed` is retried like a failed process
			const failure =
				block?.status === "failed"
					? [block.summary, ...(block.blockers ?? [])].join("\n")
					: result.stderr;
			if (attempt < maxRetry) {
				const errorSummary = failure ? extractSummary(failure) : "Unknown error";
				console.stepRetry(step.name, attempt + 1, maxRetry + 1, errorSummary);
				logger.warning(step.name, `Attempt ${attempt + 1} failed, retrying...`, {
					error: failure,
				});
				if (progress.currentStep) {
					progress.currentStep.retryCount = attempt + 1;
				}
			} else {
				const errorMsg = failure || "Step failed";
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
