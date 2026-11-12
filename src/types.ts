/** Core types for agentic-forge workflow engine. */

import type { WorkflowRequires } from "./requires.js";

// --- Step types ---

export type StepType =
	| "prompt"
	| "parallel"
	| "serial"
	| "conditional"
	| "ralph-loop"
	| "skill"
	| "human-input"
	| "wait-for-review"
	| "wait-for-checks"
	| "merge";

export const VALID_STEP_TYPES: StepType[] = [
	"prompt",
	"parallel",
	"serial",
	"conditional",
	"ralph-loop",
	"skill",
	"human-input",
	"wait-for-review",
	"wait-for-checks",
	"merge",
];

/** Step types that run no agent session (the model is not resolved or shown). */
export const NO_RUNTIME_STEP_TYPES: readonly StepType[] = [
	"human-input",
	"wait-for-review",
	"wait-for-checks",
];

/**
 * Step types that can stop the run `awaiting-human` from their own logic, so
 * they are not allowed inside a parallel step (every branch would rerun).
 */
export const NOT_IN_PARALLEL_STEP_TYPES: readonly StepType[] = [
	"human-input",
	"wait-for-review",
	"wait-for-checks",
	"merge",
];

/** Step types still accepted by the parser, mapped to their replacement. */
export const STEP_TYPE_ALIASES: Record<string, StepType> = {
	"wait-for-human": "human-input",
};

// --- Workflow definition types ---

export interface Variable {
	name: string;
	type: string;
	required: boolean;
	default?: unknown;
	description?: string;
}

export type WorktreeLocation = "sibling" | "nested" | "absolute";
export type WorktreeCleanup = "on-success" | "on-complete" | "on-merge" | "manual";

export interface WorktreeSettings {
	enabled: boolean | string;
	location?: WorktreeLocation;
	directory?: string | null;
	cleanup?: WorktreeCleanup;
}

export interface WorkflowSettings {
	/** `settings.max-retry`; null when unset, so `defaults.maxRetry` applies. */
	maxRetry: number | null;
	timeoutMinutes: number;
	trackProgress: boolean;
	autofix: string;
	terminalOutput: string;
	bypassPermissions: boolean;
	strictMode: boolean;
	model: string | null;
	runtime?: string | null;
	requiredTools: string[];
	worktree: WorktreeSettings;
	/** `settings.amend`: the step `af amend` runs before the next step boundary. */
	amend?: AmendSettings | null;
}

/** Amend step settings (`settings.amend.step`). */
export interface AmendSettings {
	step: string;
}

export interface StepDefinition {
	name: string;
	type: StepType;
	prompt?: string | null;
	agent?: string | null;
	steps: StepDefinition[];
	condition?: string | null;
	thenSteps: StepDefinition[];
	elseSteps: StepDefinition[];
	maxIterations: number | string;
	completionPromise?: string | null;
	/** `human-input`: the question asked. */
	message?: string | null;
	/** `skill`: skill to invoke, `<plugin>:<skill>` or a plain skill name. */
	skill?: string | null;
	/** `skill`: arguments passed after the skill name (rendered as a template). */
	args?: string | null;
	/** `human-input`: options offered (empty for a free-form answer). */
	options?: HumanInputOption[];
	/** `human-input`: id of the recommended option. */
	recommended?: string | null;
	/** `human-input`: false lets the harness apply `recommended` after the timeout. */
	blocking?: boolean;
	/** `human-input`: background the answerer needs. */
	context?: string | null;
	/** `wait-for-review`, `wait-for-checks`, `merge`: pull request (number, `#n` or URL; template). */
	pr?: string | null;
	/** `wait-for-review`: reviewer names (`github.reviewers`) or logins; a string is comma-separated (template). */
	reviewers?: string[] | string | null;
	/** `wait-for-review`: post the reviewers' trigger comments (default `github.auto_trigger`). */
	trigger?: boolean | null;
	/** `wait-for-review`, `wait-for-checks`: first polling interval in seconds (doubles up to `github.max_poll_seconds`). */
	pollSeconds?: number | null;
	/** `wait-for-checks`: `required` (default; all checks when the base requires none) or `all`. */
	checks?: "required" | "all" | null;
	/** `wait-for-checks`: `fail` (default) fails the step on a failing check, `continue` completes it. */
	onChecksFail?: "fail" | "continue" | null;
	/** `merge`: `repo` (resolve) or an explicit method (default `github.merge.method`). */
	method?: string | null;
	/** `merge`: delete the remote head branch after the merge (default `github.merge.delete_branch`). */
	deleteBranch?: boolean | null;
	model?: string | null;
	runtime?: string | null;
	stepTimeoutMinutes?: number | null;
	stepMaxRetry?: number | null;
	onError: string;
	checkpoint: boolean;
	dependsOn?: string | null;
	bypassPermissions?: boolean | null;
	worktree?: boolean | string | null;
	onFailure?: "fail" | "warn";
}

/** `human-input` option (contract `needs_input` option). */
export interface HumanInputOption {
	id: string;
	label: string;
	description?: string;
}

export interface OutputDefinition {
	name: string;
	template: string;
	path: string;
	when: string;
}

export interface WorkflowDefinition {
	name: string;
	version: string;
	description: string;
	/** `requires`: agentic-forge version range and contract version; null when unset. */
	requires?: WorkflowRequires | null;
	settings: WorkflowSettings;
	variables: Variable[];
	steps: StepDefinition[];
	outputs: OutputDefinition[];
}

// --- Progress tracking types ---

export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "paused" | "canceled";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface StepProgress {
	name: string;
	status: string;
	startedAt: string | null;
	completedAt: string | null;
	retryCount: number;
	outputSummary: string;
	error: string | null;
	humanInput: string | null;
	sessionId?: string | null;
	/** Status of the step's contract result block, when it printed one. */
	resultStatus?: string | null;
	/** Completion invalidated by `af retry-step`: the step must run again. */
	superseded?: boolean;
}

export interface ParallelBranch {
	branchId: string;
	status: string;
	worktreePath: string;
	progressFile: string;
}

export interface CurrentStepInfo {
	name: string;
	retryCount: number;
	startedAt: string;
	type?: string;
	message?: string | null;
	timeoutMinutes?: number;
	onTimeout?: string;
	humanInput?: string | null;
}

export interface WorkflowProgress {
	schemaVersion: string;
	workflowId: string;
	workflowName: string;
	status: string;
	startedAt: string | null;
	completedAt: string | null;
	currentStep: CurrentStepInfo | null;
	completedSteps: StepProgress[];
	pendingSteps: string[];
	runningSteps: string[];
	parallelBranches: ParallelBranch[];
	errors: Record<string, unknown>[];
	variables: Record<string, unknown>;
	stepOutputs: Record<string, unknown>;
	workflowFile: string;
	outputDir?: string;
	/**
	 * Top-level step that `af retry-step` asked to rerun: it and every later step
	 * run again even when already completed. Cleared once that step starts.
	 */
	retryFrom?: string | null;
}
