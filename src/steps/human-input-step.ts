/** Human-input step executor: asks a question through the contract `needs_input` protocol. */

import type { ConsoleOutput } from "../console.js";
import type { NeedsInput, ResultBlock } from "../contract/result.js";
import type { WorkflowLogger } from "../logging/logger.js";
import {
	STEP_STATUS,
	WORKFLOW_STATUS,
	updateStepCompleted,
	updateStepStopped,
} from "../progress.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import {
	type StepContext,
	StepExecutor,
	type StepResult,
	buildTemplateContext,
} from "./base.js";

/** `needs_input` id of the n-th question a step asks: `input-<step>-<n>`. */
export function humanInputRequestId(step: string, n: number): string {
	const slug = step.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "step";
	return `input-${slug}-${n}`.slice(0, 200);
}

/**
 * Stops the run `awaiting-human` with a `needs_input` request (the step's
 * result block), and completes once `af answer` answered it: the supervisor
 * reruns the step, which finds the answer and records it as its outputs
 * (`{{ outputs.<step>.answer }}`, `option`, `from`, `request_id`). No runtime
 * runs. A non-blocking request with a `recommended` option is answered by
 * policy after `timeout-minutes` (else `supervisor.needs_input_timeout`).
 */
export class HumanInputStepExecutor extends StepExecutor {
	async execute(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<StepResult> {
		const records = progress.completedSteps.filter((s) => s.name === step.name);
		const asked = records.filter((s) => s.resultStatus === "awaiting-human").length;
		const last = records.at(-1);

		// Rerun after asking: the answer completes the step
		if (asked > 0 && last?.status === STEP_STATUS.AWAITING_HUMAN && context.inputAnswer) {
			const requestId = humanInputRequestId(step.name, asked);
			const answer = await context.inputAnswer(step.name, requestId);
			if (answer) {
				// Consume the answer message queued for this step (marks it delivered)
				if (context.operatorMessages) await context.operatorMessages(step.name);
				const outputs = {
					answer: answer.answer,
					option: answer.option,
					from: answer.from,
					request_id: requestId,
				};
				const summary = `Answered ${requestId}: ${answer.answer}`;
				await context.recordResult?.(step.name, { status: "done", summary, outputs });
				updateStepCompleted(progress, step.name, summary, outputs, null, "done");
				console.stepComplete(step.name, summary);
				logger.info(step.name, summary);
				return { success: true, outputSummary: summary };
			}
		}

		const request = this.request(step, context, humanInputRequestId(step.name, asked + 1));
		const block: ResultBlock = {
			status: "awaiting-human",
			summary: request.question,
			needs_input: request,
		};
		if (context.recordResult) await context.recordResult(step.name, block);
		updateStepStopped(
			progress,
			step.name,
			STEP_STATUS.AWAITING_HUMAN,
			request.question,
			"awaiting-human",
		);
		progress.status = WORKFLOW_STATUS.AWAITING_HUMAN;
		console.info(`Step ${step.name} waits for input (${request.id}): ${request.question}`);
		logger.info(step.name, `Waiting for human input (${request.id}): ${request.question}`);
		return {
			success: false,
			outputSummary: request.question,
			error: "Step returned awaiting-human",
		};
	}

	/** The `needs_input` request, with `message` and `context` rendered as templates. */
	private request(step: StepDefinition, context: StepContext, id: string): NeedsInput {
		const templateContext = buildTemplateContext(context);
		const render = (value: string): string =>
			context.renderer.hasVariables(value)
				? context.renderer.renderString(value, templateContext)
				: value;
		const recommended = step.recommended ?? null;
		const request: NeedsInput = {
			id,
			question: render(step.message ?? "Continue?").trim() || "Continue?",
			options: (step.options ?? []).map((o) => ({ ...o })),
			recommended,
			blocking: step.blocking ?? true,
		};
		if (step.context) request.context = render(step.context);
		if (!request.blocking && recommended !== null && step.stepTimeoutMinutes != null) {
			request["x-af-timeout-minutes"] = step.stepTimeoutMinutes;
		}
		return request;
	}
}
