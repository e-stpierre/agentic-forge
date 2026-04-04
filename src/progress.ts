/** Workflow progress tracking. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { lockSync } from "proper-lockfile";
import type { CurrentStepInfo, ParallelBranch, StepProgress, WorkflowProgress } from "./types.js";

// --- Constants ---

export const WORKFLOW_STATUS = {
	PENDING: "pending",
	RUNNING: "running",
	COMPLETED: "completed",
	FAILED: "failed",
	PAUSED: "paused",
	CANCELED: "canceled",
} as const;

export const STEP_STATUS = {
	PENDING: "pending",
	RUNNING: "running",
	COMPLETED: "completed",
	FAILED: "failed",
	SKIPPED: "skipped",
} as const;

// --- ID and path helpers ---

export function generateWorkflowId(workflowName: string): string {
	const now = new Date();
	const pad = (n: number, len = 2) => String(n).padStart(len, "0");
	const timestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

	let safeName = workflowName.toLowerCase().replace(/ /g, "-").replace(/_/g, "-");
	safeName = safeName.replace(/[^a-z0-9-]/g, "");
	return `${timestamp}-${safeName}`;
}

export function getProgressPath(workflowId: string, outputDir: string): string {
	return path.join(outputDir, "progress.json");
}

// --- CRUD operations ---

export function loadProgress(workflowId: string, outputDir: string): WorkflowProgress | null {
	const progressPath = getProgressPath(workflowId, outputDir);
	if (!existsSync(progressPath)) {
		return null;
	}
	try {
		const data = JSON.parse(readFileSync(progressPath, "utf-8"));
		return dictToProgress(data);
	} catch {
		return null;
	}
}

export function saveProgress(progress: WorkflowProgress, outputDir: string): void {
	const progressPath = getProgressPath(progress.workflowId, outputDir);
	const dir = path.dirname(progressPath);
	mkdirSync(dir, { recursive: true });

	// Ensure the file exists so proper-lockfile can resolve its path
	if (!existsSync(progressPath)) {
		writeFileSync(progressPath, "{}", "utf-8");
	}

	let release: (() => void) | undefined;
	try {
		release = lockSync(progressPath);
		writeFileSync(progressPath, JSON.stringify(progressToDict(progress), null, 2), "utf-8");
	} finally {
		if (release) {
			release();
		}
	}
}

export function createProgress(
	workflowId: string,
	workflowName: string,
	stepNames: string[],
	variables: Record<string, unknown>,
	workflowFile = "",
): WorkflowProgress {
	return {
		schemaVersion: "1.0",
		workflowId,
		workflowName,
		status: WORKFLOW_STATUS.RUNNING,
		startedAt: new Date().toISOString(),
		completedAt: null,
		currentStep: null,
		completedSteps: [],
		pendingSteps: [...stepNames],
		runningSteps: [],
		parallelBranches: [],
		errors: [],
		variables: { ...variables },
		stepOutputs: {},
		workflowFile,
	};
}

// --- Step update functions ---

export function updateStepStarted(progress: WorkflowProgress, stepName: string): void {
	const pendingIdx = progress.pendingSteps.indexOf(stepName);
	if (pendingIdx !== -1) {
		progress.pendingSteps.splice(pendingIdx, 1);
	}
	if (!progress.runningSteps.includes(stepName)) {
		progress.runningSteps.push(stepName);
	}
	progress.currentStep = {
		name: stepName,
		retryCount: 0,
		startedAt: new Date().toISOString(),
	};
}

export function updateStepCompleted(
	progress: WorkflowProgress,
	stepName: string,
	outputSummary = "",
	output?: unknown,
): void {
	const runIdx = progress.runningSteps.indexOf(stepName);
	if (runIdx !== -1) {
		progress.runningSteps.splice(runIdx, 1);
	}

	const step: StepProgress = {
		name: stepName,
		status: STEP_STATUS.COMPLETED,
		startedAt: progress.currentStep?.startedAt ?? null,
		completedAt: new Date().toISOString(),
		retryCount: progress.currentStep?.retryCount ?? 0,
		outputSummary,
		error: null,
		humanInput: null,
	};
	progress.completedSteps.push(step);

	if (output !== undefined) {
		progress.stepOutputs[stepName] = output;
	}

	progress.currentStep = null;
}

export function updateStepFailed(
	progress: WorkflowProgress,
	stepName: string,
	error: string,
): void {
	const runIdx = progress.runningSteps.indexOf(stepName);
	if (runIdx !== -1) {
		progress.runningSteps.splice(runIdx, 1);
	}

	const step: StepProgress = {
		name: stepName,
		status: STEP_STATUS.FAILED,
		startedAt: progress.currentStep?.startedAt ?? null,
		completedAt: new Date().toISOString(),
		retryCount: progress.currentStep?.retryCount ?? 0,
		error,
		outputSummary: "",
		humanInput: null,
	};
	progress.completedSteps.push(step);
	progress.errors.push({ step: stepName, error });
	progress.currentStep = null;
}

export function updateStepSkipped(progress: WorkflowProgress, stepName: string): void {
	const pendingIdx = progress.pendingSteps.indexOf(stepName);
	if (pendingIdx !== -1) {
		progress.pendingSteps.splice(pendingIdx, 1);
	}
	const runIdx = progress.runningSteps.indexOf(stepName);
	if (runIdx !== -1) {
		progress.runningSteps.splice(runIdx, 1);
	}

	const step: StepProgress = {
		name: stepName,
		status: STEP_STATUS.SKIPPED,
		startedAt: null,
		completedAt: new Date().toISOString(),
		retryCount: 0,
		outputSummary: "",
		error: null,
		humanInput: null,
	};
	progress.completedSteps.push(step);
	progress.currentStep = null;
}

export function prepareForResume(progress: WorkflowProgress): void {
	if (progress.runningSteps.length > 0) {
		progress.pendingSteps = [...progress.runningSteps, ...progress.pendingSteps];
		progress.runningSteps = [];
	}

	if (progress.currentStep) {
		const stepName = progress.currentStep.name;
		if (stepName && !progress.pendingSteps.includes(stepName)) {
			progress.pendingSteps.unshift(stepName);
		}
		// Preserve humanInput so the resumed step can read the response
		if (!progress.currentStep.humanInput) {
			progress.currentStep = null;
		}
	}

	progress.status = WORKFLOW_STATUS.RUNNING;
	progress.completedAt = null;
}

// --- Serialization helpers ---

export function progressToDict(progress: WorkflowProgress): Record<string, unknown> {
	return {
		schema_version: progress.schemaVersion,
		workflow_id: progress.workflowId,
		workflow_name: progress.workflowName,
		status: progress.status,
		started_at: progress.startedAt,
		completed_at: progress.completedAt,
		current_step: progress.currentStep
			? {
					name: progress.currentStep.name,
					retry_count: progress.currentStep.retryCount,
					started_at: progress.currentStep.startedAt,
					type: progress.currentStep.type,
					message: progress.currentStep.message,
					timeout_minutes: progress.currentStep.timeoutMinutes,
					on_timeout: progress.currentStep.onTimeout,
					human_input: progress.currentStep.humanInput,
				}
			: null,
		completed_steps: progress.completedSteps.map((s) => ({
			name: s.name,
			status: s.status,
			started_at: s.startedAt,
			completed_at: s.completedAt,
			retry_count: s.retryCount,
			output_summary: s.outputSummary,
			error: s.error,
			human_input: s.humanInput,
		})),
		pending_steps: progress.pendingSteps,
		running_steps: progress.runningSteps,
		parallel_branches: progress.parallelBranches.map((b) => ({
			branch_id: b.branchId,
			status: b.status,
			worktree_path: b.worktreePath,
			progress_file: b.progressFile,
		})),
		errors: progress.errors,
		variables: progress.variables,
		step_outputs: progress.stepOutputs,
		workflow_file: progress.workflowFile,
	};
}

export function dictToProgress(data: Record<string, unknown>): WorkflowProgress {
	const completedSteps = ((data.completed_steps as Record<string, unknown>[]) ?? []).map(
		(s): StepProgress => ({
			name: (s.name as string) ?? "",
			status: (s.status as string) ?? "pending",
			startedAt: (s.started_at as string) ?? null,
			completedAt: (s.completed_at as string) ?? null,
			retryCount: (s.retry_count as number) ?? 0,
			outputSummary: (s.output_summary as string) ?? "",
			error: (s.error as string) ?? null,
			humanInput: (s.human_input as string) ?? null,
		}),
	);

	const parallelBranches = ((data.parallel_branches as Record<string, unknown>[]) ?? []).map(
		(b): ParallelBranch => ({
			branchId: (b.branch_id as string) ?? "",
			status: (b.status as string) ?? "",
			worktreePath: (b.worktree_path as string) ?? "",
			progressFile: (b.progress_file as string) ?? "",
		}),
	);

	return {
		schemaVersion: (data.schema_version as string) ?? "1.0",
		workflowId: (data.workflow_id as string) ?? "",
		workflowName: (data.workflow_name as string) ?? "",
		status: (data.status as string) ?? "pending",
		startedAt: (data.started_at as string) ?? null,
		completedAt: (data.completed_at as string) ?? null,
		currentStep: data.current_step
			? (() => {
					const cs = data.current_step as Record<string, unknown>;
					return {
						name: (cs.name as string) ?? "",
						retryCount: (cs.retry_count as number) ?? 0,
						startedAt: (cs.started_at as string) ?? "",
						type: cs.type as string | undefined,
						message: (cs.message as string | null) ?? null,
						timeoutMinutes: cs.timeout_minutes as number | undefined,
						onTimeout: cs.on_timeout as string | undefined,
						humanInput: (cs.human_input as string | null) ?? null,
					} satisfies CurrentStepInfo;
				})()
			: null,
		completedSteps,
		pendingSteps: (data.pending_steps as string[]) ?? [],
		runningSteps: (data.running_steps as string[]) ?? [],
		parallelBranches,
		errors: (data.errors as Record<string, unknown>[]) ?? [],
		variables: (data.variables as Record<string, unknown>) ?? {},
		stepOutputs: (data.step_outputs as Record<string, unknown>) ?? {},
		workflowFile: (data.workflow_file as string) ?? "",
	};
}
