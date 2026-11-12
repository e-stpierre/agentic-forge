/** Base class and types for step executors. */

import {
	getRuntimeDriver,
	getRuntimeModel,
	getRuntimePermissions,
	getRuntimePlugins,
} from "../config.js";
import type { ConsoleOutput } from "../console.js";
import { latestPlan } from "../contract/plan.js";
import type { ResultBlock } from "../contract/result.js";
import type { WorkflowLogger } from "../logging/logger.js";
import { STEP_STATUS, WORKFLOW_STATUS, updateStepStopped } from "../progress.js";
import type { TemplateRenderer } from "../renderer.js";
import type { RuntimeAdapter, RuntimeId, RuntimeRunOptions } from "../runtimes/index.js";
import type { SessionHost } from "../runtimes/session.js";
import type { StepDefinition, WorkflowProgress, WorkflowSettings } from "../types.js";

// --- Step context ---

export interface StepContext {
	repoRoot: string;
	/** Directory of the workflow file, used to resolve `agent:` paths. Null when unknown. */
	workflowDir?: string | null;
	config: Record<string, unknown>;
	renderer: TemplateRenderer;
	runtimeAdapter: RuntimeAdapter;
	/**
	 * Runtime the workflow resolves to when a step does not override it. Used to
	 * decide whether `settings.model` applies to this step. Undefined disables
	 * the check.
	 */
	workflowRuntimeId?: RuntimeId;
	workflowSettings: WorkflowSettings | null;
	workflowId: string;
	outputDir?: string;
	variables: Record<string, unknown>;
	outputs: Record<string, unknown>;
	cwdOverride?: string | null;
	/** Environment for runtime processes (the dispatch env under the supervisor). */
	env?: NodeJS.ProcessEnv | null;
	/** Aborted by the supervisor to stop the running step now (`pause --now`, `cancel`). */
	signal?: AbortSignal | null;
	/**
	 * Returns the `## Operator Messages` section to prepend to the prompt of
	 * `step` (empty when no message is pending). Marks the returned messages
	 * delivered, so call it once per step attempt or ralph-loop iteration.
	 */
	operatorMessages?: ((step: string) => Promise<string>) | null;
	/**
	 * Supervisor side of a step on the session driver: raises `needs_input`
	 * for session requests and registers the live session for steering.
	 */
	sessionHost?: ((step: string) => SessionHost) | null;
	/** Checked at ralph-loop iteration boundaries; a workflow status stops the loop. */
	shouldStop?: (() => string | null) | null;
	/**
	 * Called with the result block a step printed. Returns the block to use: the
	 * supervisor writes it to `steps/<NN-step>/result.json`, or returns the file
	 * the step wrote itself (the file wins).
	 */
	recordResult?: ((step: string, block: ResultBlock) => Promise<ResultBlock | null>) | null;
	/**
	 * Emits a contract event from inside a step (ralph-loop iterations, prompt
	 * retries). The supervisor appends it to `events.jsonl`. Call it after the
	 * matching state is saved (event rule).
	 */
	emitEvent?: StepEventEmitter | null;
	/**
	 * The answer `af answer` gave to a `needs_input` request of this run (the
	 * `input.answered` event), or null while it is unanswered. Read by the
	 * `human-input` step when it runs again after asking. Marks the answer's
	 * own operator message delivered (other pending messages are kept).
	 */
	inputAnswer?: ((step: string, requestId: string) => Promise<InputAnswer | null>) | null;
	/**
	 * The last runtime session a step recorded (`steps/<NN-step>/session.json`,
	 * on both drivers), or null. Read by the prompt step to resume the session
	 * of an attempt that `send --mode now` killed.
	 */
	lastSession?: ((step: string) => LastSession | null) | null;
	/** The run's pull request (run.json `pr`), used by the GitHub steps when they name none. */
	runPr?: (() => string | null) | null;
	/** Logs a `policy` decision of a step to `decisions.jsonl` (the merge method). */
	recordDecision?: ((decision: StepDecision) => Promise<void>) | null;
}

/** A decision a step made by policy (the harness adds `at` and `source: policy`). */
export interface StepDecision {
	id: string;
	phase: string;
	risk: "low" | "medium" | "high";
	decision: string;
	rationale: string;
	alternatives?: string[];
	refs?: string[];
}

/** A runtime session a step recorded. */
export interface LastSession {
	sessionId: string;
	driver: string | null;
	/** ISO time the session started. */
	at: string;
}

/** An answer to a `needs_input` request. */
export interface InputAnswer {
	/** Option id when the answer matched an option, else the free-form text. */
	answer: string;
	option: string | null;
	/** `user`, `overseer` or `policy` (the needs_input timeout). */
	from: string;
	/** Inbox message that carried the answer (null for an answer to a live session). */
	message: string | null;
}

/** Events a step emits itself; the run and step events are emitted by the executor hooks. */
export type StepEventType =
	| "iteration.started"
	| "iteration.completed"
	| "step.retried"
	| "review.received"
	| "checks.completed"
	| "merge.locked"
	| "merge.completed";

export type StepEventEmitter = (
	type: StepEventType,
	data: Record<string, unknown>,
) => Promise<void>;

/** Emits a step event when the context has an emitter; never throws into the step. */
export async function emitStepEvent(
	context: StepContext,
	type: StepEventType,
	data: Record<string, unknown>,
): Promise<void> {
	if (!context.emitEvent) return;
	try {
		await context.emitEvent(type, data);
	} catch {
		// Events are observability: a failed append must not fail the step
	}
}

/** Thrown or reported when a step was stopped through `StepContext.signal`. */
export const STEP_INTERRUPTED_ERROR = "Step interrupted by operator";

/** Workflow statuses a step result can stop the run with (not failures). */
const CHILD_STOP_STATUSES: Record<string, { stepStatus: string; resultStatus: string }> = {
	[WORKFLOW_STATUS.AWAITING_HUMAN]: {
		stepStatus: STEP_STATUS.AWAITING_HUMAN,
		resultStatus: "awaiting-human",
	},
	[WORKFLOW_STATUS.HALTED]: { stepStatus: STEP_STATUS.HALTED, resultStatus: "halted" },
	[WORKFLOW_STATUS.BLOCKED]: { stepStatus: STEP_STATUS.ESCALATED, resultStatus: "escalate" },
};

/**
 * In a composite step (serial, conditional): when a child stopped the run
 * with `awaiting-human`, `halted` or `escalate`, records the composite step
 * with the same stop status and keeps the workflow status, instead of
 * turning it into a failure. Returns the result to return, or null when the
 * child failed.
 */
export function propagateChildStop(
	progress: WorkflowProgress,
	stepName: string,
	childName: string,
	console: ConsoleOutput,
): StepResult | null {
	const stop = CHILD_STOP_STATUSES[progress.status];
	if (!stop) return null;
	const summary = `Step '${childName}' returned ${stop.resultStatus}`;
	updateStepStopped(
		progress,
		stepName,
		stop.stepStatus,
		summary,
		stop.resultStatus,
		stop.resultStatus !== "halted",
	);
	console.info(summary);
	return { success: false, outputSummary: summary, error: summary };
}

/**
 * Driver options of a step: the session driver (`runtimes.<id>.driver:
 * session`, when the runtime has one) with the supervisor's session host,
 * where pending operator messages are sent as the next turn; else `cli`.
 */
export function driverOptions(
	context: StepContext,
	step: string,
): Pick<RuntimeRunOptions, "driver" | "sessionHost" | "plugins"> {
	const runtimeId = context.runtimeAdapter.id;
	const host = context.sessionHost?.(step) ?? {};
	const session =
		getRuntimeDriver(context.config, runtimeId) === "session" &&
		Boolean(context.runtimeAdapter.createSession);
	// The `cli` driver only feeds the live transcript
	if (!session)
		return host.onEvent
			? { driver: "cli", sessionHost: { onEvent: host.onEvent } }
			: { driver: "cli" };
	const messages = context.operatorMessages;
	return {
		driver: "session",
		sessionHost: {
			...host,
			nextMessages: host.nextMessages ?? (messages ? () => messages(step) : undefined),
		},
		plugins: getRuntimePlugins(context.config, runtimeId),
	};
}

/** Warning logged on every step that runs with permission checks bypassed. */
export function bypassWarning(runtimeId: string, source: string): string {
	return `Permission checks are bypassed for this step on ${runtimeId} (${source})`;
}

/**
 * Permission options of a step, from `runtimes.<id>` (same allowlist on both
 * Claude drivers): the runtime allowlist plus the workflow's `required-tools`
 * as `allowedTools`, and `skipPermissions` only when bypass is opted into
 * (`runtimes.<id>.permissions: bypass`, or `bypass-permissions: true` on the
 * step or workflow). A bypass logs a warning on every step.
 */
export function permissionOptions(
	context: StepContext,
	step: StepDefinition,
	logger: Pick<WorkflowLogger, "warning">,
	console: Pick<ConsoleOutput, "warning">,
): Pick<RuntimeRunOptions, "skipPermissions" | "allowedTools"> {
	const runtimeId = context.runtimeAdapter.id;
	const permissions = getRuntimePermissions(context.config, runtimeId);
	const flag = step.bypassPermissions ?? context.workflowSettings?.bypassPermissions ?? false;
	const source =
		permissions.mode === "bypass"
			? `runtimes.${runtimeId}.permissions: bypass`
			: flag
				? "bypass-permissions: true"
				: null;
	if (source) {
		const message = bypassWarning(runtimeId, source);
		logger.warning(step.name, message);
		console.warning(message);
	}
	const allow = new Set(permissions.allow);
	for (const tool of context.workflowSettings?.requiredTools ?? []) allow.add(tool);
	return { skipPermissions: source !== null, allowedTools: allow.size > 0 ? [...allow] : null };
}

/** Prepends pending operator messages to a prompt. */
export async function withOperatorMessages(
	context: StepContext,
	step: string,
	prompt: string,
): Promise<string> {
	const section = context.operatorMessages ? await context.operatorMessages(step) : "";
	return section ? `${section}${prompt}` : prompt;
}

export function buildTemplateContext(context: StepContext): Record<string, unknown> {
	const plan = latestPlan(context.outputDir);
	return {
		variables: context.variables,
		outputs: context.outputs,
		workflow_id: context.workflowId,
		output_dir: context.outputDir ?? "",
		plan_path: plan.path ?? "",
		plan_version: plan.version,
		...(context.variables as Record<string, unknown>),
	};
}

/**
 * Resolve the model for a step. Returns `null` when no model is configured, in
 * which case no `--model` flag is passed and the CLI uses its own default.
 */
export function resolveModel(context: StepContext, stepModel?: string | null): string | null {
	// Step-level model always takes priority
	if (stepModel) {
		return stepModel;
	}
	// `settings.model` is written in the workflow runtime's model namespace, so it
	// must not leak into a step that overrode the runtime (e.g. passing "sonnet"
	// to a codex step). Per-runtime config is namespaced already and is safe.
	const runtimeMatchesWorkflow =
		context.workflowRuntimeId === undefined ||
		context.workflowRuntimeId === context.runtimeAdapter.id;
	if (runtimeMatchesWorkflow && context.workflowSettings?.model) {
		return context.workflowSettings.model;
	}
	return (
		getRuntimeModel(context.config, context.runtimeAdapter.id) ??
		context.runtimeAdapter.defaultModel
	);
}

// --- Step result ---

export interface StepResult {
	success: boolean;
	outputSummary?: string;
	fullOutput?: string;
	error?: string;
}

// --- Abstract base ---

export abstract class StepExecutor {
	abstract execute(
		step: StepDefinition,
		progress: WorkflowProgress,
		context: StepContext,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<StepResult>;
}

// --- Branch executor type ---

/** Callable type for executing a single step within a composite executor. */
export type BranchStepExecutor = (
	step: StepDefinition,
	progress: WorkflowProgress,
	context: StepContext,
	logger: WorkflowLogger,
	console: ConsoleOutput,
) => Promise<StepResult>;
