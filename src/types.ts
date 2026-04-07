/** Core types for agentic-forge workflow engine. */

// --- Step types ---

export type StepType =
	| "prompt"
	| "parallel"
	| "serial"
	| "conditional"
	| "ralph-loop"
	| "wait-for-human";

export const VALID_STEP_TYPES: StepType[] = [
	"prompt",
	"parallel",
	"serial",
	"conditional",
	"ralph-loop",
	"wait-for-human",
];

// --- Workflow definition types ---

export interface Variable {
	name: string;
	type: string;
	required: boolean;
	default?: unknown;
	description?: string;
}

export type WorktreeLocation = "sibling" | "nested" | "absolute";
export type WorktreeCleanup = "on-success" | "on-complete" | "manual";

export interface WorktreeSettings {
	enabled: boolean | string;
	location: WorktreeLocation;
	directory: string | null;
	cleanup: WorktreeCleanup;
}

export interface WorkflowSettings {
	maxRetry: number;
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
	message?: string | null;
	pollingInterval: number;
	onTimeout: string;
	model?: string | null;
	runtime?: string | null;
	stepTimeoutMinutes?: number | null;
	stepMaxRetry?: number | null;
	onError: string;
	checkpoint: boolean;
	dependsOn?: string | null;
	worktree?: boolean | string | null;
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
}
