/** Base class and types for step executors. */

import { getRuntimeModel } from "../config.js";
import type { ConsoleOutput } from "../console.js";
import type { WorkflowLogger } from "../logging/logger.js";
import type { TemplateRenderer } from "../renderer.js";
import type { RuntimeAdapter, RuntimeId } from "../runtimes/index.js";
import type { StepDefinition, WorkflowProgress, WorkflowSettings } from "../types.js";

// --- Step context ---

export interface StepContext {
	repoRoot: string;
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
