/** Base class and types for step executors. */

import { getRuntimeModel } from "../config.js";
import type { ConsoleOutput } from "../console.js";
import type { WorkflowLogger } from "../logging/logger.js";
import type { TemplateRenderer } from "../renderer.js";
import type { RuntimeAdapter } from "../runtimes/index.js";
import type { StepDefinition, WorkflowProgress, WorkflowSettings } from "../types.js";

// --- Step context ---

export interface StepContext {
	repoRoot: string;
	config: Record<string, unknown>;
	renderer: TemplateRenderer;
	runtimeAdapter: RuntimeAdapter;
	workflowSettings: WorkflowSettings | null;
	workflowId: string;
	outputDir?: string;
	variables: Record<string, unknown>;
	outputs: Record<string, unknown>;
	cwdOverride?: string | null;
}

export function buildTemplateContext(context: StepContext): Record<string, unknown> {
	return {
		variables: context.variables,
		outputs: context.outputs,
		workflow_id: context.workflowId,
		output_dir: context.outputDir ?? "",
		...(context.variables as Record<string, unknown>),
	};
}

export function resolveModel(context: StepContext, stepModel?: string | null): string {
	// Step-level model always takes priority
	if (stepModel) {
		return stepModel;
	}
	if (context.workflowSettings?.model) {
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
