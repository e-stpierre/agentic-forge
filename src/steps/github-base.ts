/**
 * Shared pieces of the GitHub step types (`wait-for-review`,
 * `wait-for-checks`, `merge`): the pull request reference, `gh` options,
 * abortable polling with backoff, and the timeout request that stops the run
 * `awaiting-human`. No agent session runs in these steps.
 */

import type { ConsoleOutput } from "../console.js";
import type { NeedsInput, ResultBlock } from "../contract/result.js";
import type { GhOptions } from "../github/gh.js";
import type { WorkflowLogger } from "../logging/logger.js";
import {
	STEP_STATUS,
	WORKFLOW_STATUS,
	updateStepCompleted,
	updateStepFailed,
	updateStepStopped,
} from "../progress.js";
import type { StepDefinition, WorkflowProgress } from "../types.js";
import {
	STEP_INTERRUPTED_ERROR,
	type StepContext,
	type StepResult,
	buildTemplateContext,
} from "./base.js";

/** Renders a step field when it holds a template. */
export function renderField(context: StepContext, value: string): string {
	return context.renderer.hasVariables(value)
		? context.renderer.renderString(value, buildTemplateContext(context))
		: value;
}

/**
 * Pull request of a GitHub step: the step's `pr` field, else the run's
 * `pr` (run.json, set by an earlier step's result block), else null (the
 * pull request of the current branch in the step's checkout).
 */
export function pullRequestRef(step: StepDefinition, context: StepContext): string | null {
	if (step.pr) {
		const rendered = renderField(context, step.pr).trim();
		if (rendered) return rendered;
	}
	return context.runPr?.() ?? null;
}

/** `gh` options of a step: the step's checkout, the dispatch env and the abort signal. */
export function ghOptions(context: StepContext, cwd?: string | null): GhOptions {
	return {
		cwd: cwd ?? context.cwdOverride ?? context.repoRoot,
		env: context.env ?? null,
		signal: context.signal ?? null,
	};
}

/** Sleeps `ms`, waking early when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted || ms <= 0) {
			resolve();
			return;
		}
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}

/** Polling interval schedule: starts at `first` seconds and doubles up to `max`. */
export class Backoff {
	private current: number;
	constructor(
		private readonly first: number,
		private readonly max: number,
	) {
		this.current = first;
	}
	next(): number {
		const value = this.current;
		this.current = Math.min(this.current * 2, Math.max(this.max, this.first));
		return value * 1000;
	}
	reset(): void {
		this.current = this.first;
	}
}

/** The interrupted result: the executor records the step `interrupted`. */
export function interrupted(): StepResult {
	return { success: false, error: STEP_INTERRUPTED_ERROR };
}

/** Options offered when a wait times out. */
export const TIMEOUT_OPTIONS = [
	{ id: "wait", label: "Wait again", description: "Restart the wait with a fresh timeout" },
	{ id: "continue", label: "Continue", description: "Go on to the next step without it" },
];

/** `needs_input` id of the n-th timeout of a step: `<kind>-timeout-<step>-<n>`. */
export function timeoutRequestId(kind: string, step: string, n: number): string {
	const slug = step.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "step";
	return `${kind}-timeout-${slug}-${n}`.slice(0, 200);
}

/** How many times this step stopped `awaiting-human`, and whether its last record is that stop. */
function askedCount(step: string, progress: WorkflowProgress): { asked: number; waiting: boolean } {
	const records = progress.completedSteps.filter((s) => s.name === step);
	const asked = records.filter((s) => s.resultStatus === "awaiting-human").length;
	return { asked, waiting: records.at(-1)?.status === STEP_STATUS.AWAITING_HUMAN };
}

/**
 * On a rerun after a timeout: the operator's answer to the last timeout
 * request (`wait` or `continue`), or null (first run, or no answer: wait).
 */
export async function timeoutAnswer(
	kind: string,
	step: string,
	progress: WorkflowProgress,
	context: StepContext,
): Promise<string | null> {
	const { asked, waiting } = askedCount(step, progress);
	if (asked === 0 || !waiting || !context.inputAnswer) return null;
	const answer = await context.inputAnswer(step, timeoutRequestId(kind, step, asked));
	if (!answer) return null;
	return answer.option ?? answer.answer;
}

/** Records a completed GitHub step with its result block. */
export async function completeStep(
	step: StepDefinition,
	progress: WorkflowProgress,
	context: StepContext,
	logger: WorkflowLogger,
	console: ConsoleOutput,
	block: ResultBlock,
): Promise<StepResult> {
	const effective = (await context.recordResult?.(step.name, block)) ?? block;
	updateStepCompleted(
		progress,
		step.name,
		effective.summary ?? "",
		effective.outputs ?? {},
		null,
		effective.status,
	);
	console.stepComplete(step.name, effective.summary ?? "");
	logger.info(step.name, effective.summary ?? "");
	return { success: true, outputSummary: effective.summary ?? "" };
}

/** Records a failed GitHub step with its result block (no retry: waiting again would not help). */
export async function failStep(
	step: StepDefinition,
	progress: WorkflowProgress,
	context: StepContext,
	logger: WorkflowLogger,
	console: ConsoleOutput,
	block: ResultBlock,
): Promise<StepResult> {
	await context.recordResult?.(step.name, block);
	const error = block.summary ?? "Step failed";
	updateStepFailed(progress, step.name, error);
	progress.status = WORKFLOW_STATUS.FAILED;
	console.stepFailed(step.name, error);
	logger.error(step.name, error);
	return { success: false, error };
}

/**
 * Stops the run `awaiting-human`. With `request`, the result block carries
 * it as `needs_input` (answered with `af answer`); without, the operator acts
 * on GitHub and resumes with `af resume`, which reruns the step.
 */
export async function stopAwaitingHuman(
	step: StepDefinition,
	progress: WorkflowProgress,
	context: StepContext,
	logger: WorkflowLogger,
	console: ConsoleOutput,
	summary: string,
	extra: Partial<ResultBlock> = {},
	request: NeedsInput | null = null,
): Promise<StepResult> {
	const block: ResultBlock = { status: "awaiting-human", summary, ...extra };
	if (request) block.needs_input = request;
	await context.recordResult?.(step.name, block);
	updateStepStopped(progress, step.name, STEP_STATUS.AWAITING_HUMAN, summary, "awaiting-human");
	progress.status = WORKFLOW_STATUS.AWAITING_HUMAN;
	console.info(`Step ${step.name} waits for the operator: ${summary}`);
	logger.info(step.name, `Awaiting human: ${summary}`);
	return { success: false, outputSummary: summary, error: "Step returned awaiting-human" };
}

/** The timeout request of a wait step (`wait` again or `continue`). */
export function timeoutRequest(
	kind: string,
	step: string,
	progress: WorkflowProgress,
	question: string,
	context: string,
): NeedsInput {
	const { asked } = askedCount(step, progress);
	return {
		id: timeoutRequestId(kind, step, asked + 1),
		question,
		options: TIMEOUT_OPTIONS.map((o) => ({ ...o })),
		recommended: null,
		blocking: true,
		context,
	};
}

/** Minutes to milliseconds. */
export function minutes(value: number): number {
	return value * 60_000;
}
