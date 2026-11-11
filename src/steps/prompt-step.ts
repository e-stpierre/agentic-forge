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
	type LastSession,
	STEP_INTERRUPTED_ERROR,
	type StepContext,
	StepExecutor,
	type StepResult,
	buildTemplateContext,
	driverOptions,
	emitStepEvent,
	permissionOptions,
	resolveModel,
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

/** Prompt of a resumed session: the operator messages come first. */
const RESUME_INSTRUCTION =
	"Continue the step with the operator messages above, then end with the result block as before.";

/** Prompt of a session resumed after a supervisor restart (operator messages, if any, come first). */
const RECOVERY_INSTRUCTION =
	"The harness restarted while this step was running. Continue the step where you left off, then end with the result block as before.";

/**
 * Session the step resumes (both drivers), from its last record: one that
 * stopped awaiting-human (resumed by `af answer`, so only with operator
 * messages), one that crash recovery recorded interrupted with its session
 * id, or an attempt killed by `send --mode now` (interrupted, with operator
 * messages, and a session recorded since that attempt started). Null otherwise.
 */
export function stoppedSession(
	progress: WorkflowProgress,
	step: string,
	hasMessages: boolean,
	lastSession: LastSession | null = null,
): { id: string; instruction: string } | null {
	const last = [...progress.completedSteps].reverse().find((s) => s.name === step);
	if (!last) return null;
	if (last.status === STEP_STATUS.AWAITING_HUMAN && hasMessages && last.sessionId) {
		return { id: last.sessionId, instruction: RESUME_INSTRUCTION };
	}
	if (last.status !== STEP_STATUS.INTERRUPTED) return null;
	if (last.sessionId) return { id: last.sessionId, instruction: RECOVERY_INSTRUCTION };
	const current =
		lastSession && (!last.startedAt || lastSession.at >= last.startedAt) ? lastSession : null;
	if (hasMessages && current) return { id: current.sessionId, instruction: RESUME_INSTRUCTION };
	return null;
}

/** Prepends the step's `agent:` file to a prompt (fallback to bundled agents). */
export function withAgent(step: StepDefinition, context: StepContext, prompt: string): string {
	if (!step.agent) return prompt;
	let agentPath = path.join(context.repoRoot, step.agent);
	if (!existsSync(agentPath)) {
		agentPath = path.join(__dirname, "..", "agents", path.basename(step.agent));
	}
	if (!existsSync(agentPath)) return prompt;
	return `${readFileSync(agentPath, "utf-8")}\n\n${prompt}`;
}

export class PromptStepExecutor extends StepExecutor {
	/** The step's prompt, rendered, before operator messages are prepended. */
	protected buildPrompt(step: StepDefinition, context: StepContext): string {
		let prompt = step.prompt ?? "";
		if (context.renderer.hasVariables(prompt)) {
			prompt = context.renderer.renderString(prompt, buildTemplateContext(context));
		}
		return withAgent(step, context, prompt);
	}

	/** The prompt with the `## Operator Messages` section (first by default). */
	protected withMessages(section: string, prompt: string): string {
		return `${section}${prompt}`;
	}

	async execute(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<StepResult> {
		let prompt = this.buildPrompt(step, context);
		const cwd = context.cwdOverride ?? context.repoRoot;

		// Pending operator messages start the prompt (delivered once, reused by retries)
		const operatorSection = context.operatorMessages
			? await context.operatorMessages(step.name)
			: "";
		const driver = driverOptions(context, step.name);
		// A step that stopped awaiting-human, was killed by `send --mode now` or was
		// interrupted by a supervisor restart resumes its own session instead of
		// starting over (Agent SDK resume, `claude --resume`, `codex exec resume`)
		const resumed = stoppedSession(
			progress,
			step.name,
			operatorSection.length > 0,
			context.lastSession?.(step.name) ?? null,
		);
		let resumeSessionId = resumed?.id ?? null;
		if (resumed) {
			const message = `Resuming session ${resumed.id} on the ${driver.driver ?? "cli"} driver`;
			logger.info(step.name, message);
			console.info(message);
		}
		const freshPrompt = this.withMessages(operatorSection, prompt);
		prompt = resumed ? `${operatorSection}${resumed.instruction}` : freshPrompt;

		const timeout = (step.stepTimeoutMinutes ?? 60) * 60;
		const defaults = context.config.defaults as Record<string, unknown> | undefined;
		const maxRetry = step.stepMaxRetry ?? (defaults?.maxRetry as number) ?? 3;
		const permissions = permissionOptions(context, step, logger, console);

		// Always enable streaming when console is provided
		const printOutput = true;

		for (let attempt = 0; attempt <= maxRetry; attempt++) {
			const result = await runRuntime(context.runtimeAdapter, {
				prompt,
				cwd,
				model: resolveModel(context, step.model) ?? undefined,
				timeout,
				printOutput,
				...permissions,
				console,
				workflowId: context.workflowId,
				outputDir: context.outputDir,
				sandbox: getSandboxMode(context.config),
				env: context.env ?? null,
				signal: context.signal ?? null,
				...driver,
				resumeSessionId,
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
				updateStepStopped(
					progress,
					step.name,
					stepStatus,
					summary,
					status,
					status !== "halted",
					result.sessionOutput?.sessionId ?? null,
				);
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

				// `outputs` of the result block, else a fenced JSON block, else the output:
				// later steps read it as `{{ outputs.<step>.<key> }}`
				const stepOutput = result.stdout ? extractJson(result.stdout) : null;
				const outputValue = block?.outputs ?? stepOutput ?? result.stdout;

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
			if (resumeSessionId) {
				// The resumed session failed (or no longer exists): restart the step from
				// its boundary with the original prompt, without using a retry
				const errorSummary = failure ? extractSummary(failure) : "Unknown error";
				const message = `Resumed session ${resumeSessionId} failed, restarting the step: ${errorSummary}`;
				logger.warning(step.name, message);
				console.info(message);
				await emitStepEvent(context, "step.retried", {
					step: step.name,
					reason: "resume-failed",
					session_id: resumeSessionId,
					attempt: attempt + 1,
					max_attempts: maxRetry + 1,
					error: errorSummary,
				});
				resumeSessionId = null;
				prompt = freshPrompt;
				attempt--;
				continue;
			}
			if (attempt < maxRetry) {
				const errorSummary = failure ? extractSummary(failure) : "Unknown error";
				console.stepRetry(step.name, attempt + 1, maxRetry + 1, errorSummary);
				logger.warning(step.name, `Attempt ${attempt + 1} failed, retrying...`, {
					error: failure,
				});
				if (progress.currentStep) {
					progress.currentStep.retryCount = attempt + 1;
				}
				await emitStepEvent(context, "step.retried", {
					step: step.name,
					reason: "retry",
					attempt: attempt + 2,
					max_attempts: maxRetry + 1,
					error: errorSummary,
				});
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
