/** Workflow executor for running workflows. */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { ConsoleOutput, OutputLevel } from "./console.js";
import {
	type Worktree,
	copyLocalDirs,
	createWorktree,
	findExistingWorktree,
	removeWorktree,
	safetyCommit,
} from "./git/worktree.js";
import { WorkflowLogger } from "./logging/logger.js";
import { getOutputDir, getWorktreeOutputRoot, resolveOutputDir } from "./paths.js";
import {
	STEP_STATUS,
	WORKFLOW_STATUS,
	createProgress,
	generateWorkflowId,
	saveProgress,
	updateStepFailed,
	updateStepStarted,
} from "./progress.js";
import { TemplateRenderer, buildTemplateContext, renderWorkflowOutput } from "./renderer.js";
import { getAdapter, resolveRuntime } from "./runtimes/index.js";
import { type StepContext, type StepResult, resolveModel } from "./steps/base.js";
import { ConditionalStepExecutor } from "./steps/conditional-step.js";
import { ParallelStepExecutor } from "./steps/parallel-step.js";
import { PromptStepExecutor } from "./steps/prompt-step.js";
import { RalphLoopStepExecutor } from "./steps/ralph-loop-step.js";
import { SerialStepExecutor } from "./steps/serial-step.js";
import type {
	OutputDefinition,
	StepDefinition,
	StepType,
	WorkflowDefinition,
	WorkflowProgress,
	WorkflowSettings,
} from "./types.js";
import { resolveStepWorktree, resolveWorktreeEnabled } from "./worktree-settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class WorkflowExecutor {
	repoRoot: string;
	config: Record<string, unknown>;
	strictMode: boolean;
	runtimeOverride: string | null;
	renderer: TemplateRenderer;
	workflowSettings: WorkflowSettings | null = null;
	executors: Record<
		string,
		| PromptStepExecutor
		| ParallelStepExecutor
		| SerialStepExecutor
		| ConditionalStepExecutor
		| RalphLoopStepExecutor
	>;

	promptExecutor: PromptStepExecutor;
	ralphLoopExecutor: RalphLoopStepExecutor;
	parallelExecutor: ParallelStepExecutor;
	serialExecutor: SerialStepExecutor;
	conditionalExecutor: ConditionalStepExecutor;

	constructor(repoRoot?: string, strictMode = false, runtimeOverride?: string | null) {
		this.repoRoot = repoRoot ?? process.cwd();
		this.config = loadConfig(this.repoRoot);
		this.strictMode = strictMode;
		this.runtimeOverride = runtimeOverride ?? null;
		this.renderer = new TemplateRenderer(undefined, strictMode);

		// Initialize step executors
		this.promptExecutor = new PromptStepExecutor();
		this.ralphLoopExecutor = new RalphLoopStepExecutor();

		// Branch executor function for nested steps
		const branchExecutors: Record<
			string,
			{
				execute: (
					step: StepDefinition,
					progress: WorkflowProgress,
					context: StepContext,
					logger: WorkflowLogger,
					console: ConsoleOutput,
				) => Promise<StepResult>;
			}
		> = {
			prompt: this.promptExecutor,
			"ralph-loop": this.ralphLoopExecutor,
		};

		const branchExecute = async (
			step: StepDefinition,
			progress: WorkflowProgress,
			context: StepContext,
			logger: WorkflowLogger,
			console: ConsoleOutput,
		): Promise<StepResult> => {
			const executor = branchExecutors[step.type] ?? this.executors[step.type];
			if (!executor) {
				throw new Error(`Step type not yet implemented: ${step.type}`);
			}

			// Re-resolve runtime for each child step so step-level runtime: is honored
			const childRuntimeId = resolveRuntime(
				step,
				this.workflowSettings ?? {},
				this.config,
				this.runtimeOverride,
			);
			const childAdapter = getAdapter(childRuntimeId);
			const childContext: StepContext = {
				...context,
				runtimeAdapter: childAdapter,
			};

			return executor.execute(step, progress, childContext, logger, console);
		};

		this.parallelExecutor = new ParallelStepExecutor(branchExecute);
		this.serialExecutor = new SerialStepExecutor(branchExecute);
		this.conditionalExecutor = new ConditionalStepExecutor(branchExecute);

		// Add complex executors to branch lookup
		branchExecutors.serial = this.serialExecutor;
		branchExecutors.conditional = this.conditionalExecutor;

		this.executors = {
			prompt: this.promptExecutor,
			parallel: this.parallelExecutor,
			serial: this.serialExecutor,
			conditional: this.conditionalExecutor,
			"ralph-loop": this.ralphLoopExecutor,
			"wait-for-human": {
				execute: async (
					step: StepDefinition,
					progress: WorkflowProgress,
					_context: StepContext,
					logger: WorkflowLogger,
				): Promise<StepResult> => {
					logger.info(step.name, `Waiting for human input: ${step.message}`);
					progress.status = WORKFLOW_STATUS.PAUSED;
					progress.currentStep = {
						name: step.name,
						retryCount: 0,
						startedAt: new Date().toISOString(),
						type: "wait-for-human",
						message: step.message,
						timeoutMinutes: step.stepTimeoutMinutes ?? 5,
						onTimeout: step.onTimeout,
					};
					return { success: true, outputSummary: "Paused for human input" };
				},
			},
		};
	}

	async run(
		workflow: WorkflowDefinition,
		variables?: Record<string, unknown>,
		fromStep?: string | null,
		terminalOutput = "base",
		workflowFile = "",
		resumeProgress?: WorkflowProgress | null,
		slug?: string,
	): Promise<WorkflowProgress> {
		let vars = variables ? { ...variables } : {};
		this.workflowSettings = workflow.settings;

		// Update renderer with workflow's strict_mode setting
		this.renderer = new TemplateRenderer(undefined, workflow.settings.strictMode);

		// Create console output handler
		const outputLevel = terminalOutput === "all" ? OutputLevel.ALL : OutputLevel.BASE;
		const console = new ConsoleOutput(outputLevel);

		let progress: WorkflowProgress;
		let workflowId: string;

		if (resumeProgress) {
			progress = resumeProgress;
			// Seed variables from stored progress, then overlay any new CLI vars
			const merged = { ...progress.variables };
			Object.assign(merged, vars);
			vars = merged;
			progress.variables = vars;
			workflowId = progress.workflowId;
			if (!progress.workflowFile && workflowFile) {
				progress.workflowFile = workflowFile;
			}
		} else {
			for (const v of workflow.variables) {
				if (!(v.name in vars)) {
					if (v.required && v.default === undefined) {
						throw new Error(`Missing required variable: ${v.name}`);
					}
					vars[v.name] = v.default;
				}
			}

			workflowId = generateWorkflowId(workflow.name, slug);
			const stepNames = workflow.steps.map((s) => s.name);
			progress = createProgress(workflowId, workflow.name, stepNames, vars, workflowFile);
		}

		// Resolve workflow-level worktree settings
		const worktreeSettings = this.workflowSettings?.worktree;
		const worktreeEnabled =
			worktreeSettings != null
				? resolveWorktreeEnabled(worktreeSettings, this.renderer, vars)
				: false;

		// Resolve output dir: worktree mode always uses global directory keyed by main repo root
		const baseOutputDir =
			resumeProgress?.outputDir ??
			(worktreeEnabled
				? path.join(getWorktreeOutputRoot(this.repoRoot), workflowId)
				: getOutputDir(workflowId, this.config, this.repoRoot));
		const outputDir = resumeProgress ? baseOutputDir : resolveOutputDir(baseOutputDir);
		progress.outputDir = outputDir;
		saveProgress(progress, outputDir);

		const logger = new WorkflowLogger(workflowId, outputDir);
		logger.info("workflow", `Started workflow: ${workflow.name}`);

		console.workflowStart(workflow.name, workflowId);

		// Create or reuse workflow-level worktree if enabled
		let workflowWorktree: Worktree | null = null;
		if (worktreeEnabled && worktreeSettings) {
			// Use the resolved output dir basename as the worktree ID so both names always match.
			// The output dir is resolved first (e.g. "my-task-6"), and the worktree adopts
			// the same name instead of incrementing independently.
			const worktreeId = path.basename(outputDir);

			// On resume, try to reuse the existing worktree (preserves pending changes)
			if (resumeProgress) {
				workflowWorktree = findExistingWorktree(
					worktreeId,
					this.repoRoot,
					worktreeSettings.location,
					worktreeSettings.directory,
				);
				if (workflowWorktree) {
					logger.info("workflow", `Reusing existing worktree: ${workflowWorktree.path}`);
					console.info(`Worktree (resumed): ${workflowWorktree.path}`);
				}
			}

			if (!workflowWorktree) {
				workflowWorktree = createWorktree({
					workflowName: workflow.name,
					stepName: "workflow",
					workflowId: worktreeId,
					repoRoot: this.repoRoot,
					location: worktreeSettings.location,
					directory: worktreeSettings.directory,
				});
				logger.info(
					"workflow",
					`Worktree created: ${workflowWorktree.path} (branch: ${workflowWorktree.branch})`,
				);
				console.info(`Worktree: ${workflowWorktree.path}`);
			}

			if (workflowWorktree) {
				copyLocalDirs(this.repoRoot, workflowWorktree.path);
			}
		}

		// Build set of completed step names to skip on resume
		const completedStepNames = new Set(
			progress.completedSteps
				.filter((s) => s.status === STEP_STATUS.COMPLETED || s.status === STEP_STATUS.SKIPPED)
				.map((s) => s.name),
		);

		let skipUntil = fromStep ?? null;

		try {
			for (const step of workflow.steps) {
				if (skipUntil) {
					if (step.name === skipUntil) {
						skipUntil = null;
					} else {
						continue;
					}
				}

				// Skip steps already completed/skipped during resume
				if (completedStepNames.has(step.name)) {
					logger.info(step.name, `Skipping already completed step: ${step.name}`);
					console.info(`Skipping completed step: ${step.name}`);
					continue;
				}

				try {
					await this.executeStep(step, progress, vars, logger, console, workflowWorktree);
					saveProgress(progress, outputDir);

					if (
						progress.status === WORKFLOW_STATUS.FAILED ||
						progress.status === WORKFLOW_STATUS.PAUSED
					) {
						break;
					}
				} catch (e: unknown) {
					const errorMsg = e instanceof Error ? e.message : String(e);
					logger.error(step.name, `Step failed: ${errorMsg}`);
					console.stepFailed(step.name, errorMsg);
					updateStepFailed(progress, step.name, errorMsg);
					progress.status = WORKFLOW_STATUS.FAILED;
					saveProgress(progress, outputDir);
					break;
				}
			}

			if (progress.status === WORKFLOW_STATUS.RUNNING) {
				progress.status = WORKFLOW_STATUS.COMPLETED;
			}
			if (progress.status !== WORKFLOW_STATUS.PAUSED) {
				progress.completedAt = new Date().toISOString();
			}
			saveProgress(progress, outputDir);
		} finally {
			// Cleanup workflow-level worktree according to the cleanup policy
			if (workflowWorktree && worktreeSettings) {
				const cleanup = worktreeSettings.cleanup;
				const succeeded = progress.status === WORKFLOW_STATUS.COMPLETED;

				const shouldRemove = cleanup === "on-complete" || (cleanup === "on-success" && succeeded);

				if (shouldRemove) {
					const commitResult = safetyCommit(workflowWorktree.path, logger);
					if (commitResult.failed) {
						logger.warning(
							"workflow",
							`Safety commit failed; preserving worktree to prevent data loss: ${workflowWorktree.path}`,
						);
						console.info(`Worktree preserved (safety commit failed): ${workflowWorktree.path}`);
					} else {
						removeWorktree(workflowWorktree, this.repoRoot, false);
						logger.info("workflow", `Worktree removed: ${workflowWorktree.path}`);
					}
				} else {
					logger.info(
						"workflow",
						`Worktree preserved: ${workflowWorktree.path} (branch: ${workflowWorktree.branch})`,
					);
					console.info(`Worktree preserved: ${workflowWorktree.path}`);
				}
			}
		}

		this.renderOutputs(workflow, progress, vars, logger);

		console.workflowComplete(workflow.name, progress.status);
		logger.info("workflow", `Workflow ${progress.status}: ${workflow.name}`);
		return progress;
	}

	private renderOutputs(
		workflow: WorkflowDefinition,
		progress: WorkflowProgress,
		variables: Record<string, unknown>,
		logger: WorkflowLogger,
	): void {
		if (!workflow.outputs || workflow.outputs.length === 0) {
			return;
		}

		const stepOutputs: Record<string, Record<string, unknown>> = {};
		for (const step of progress.completedSteps) {
			const entry: Record<string, unknown> = {
				status: step.status,
				started_at: step.startedAt,
				completed_at: step.completedAt,
				output_summary: step.outputSummary,
				error: step.error,
			};
			if (step.name in progress.stepOutputs) {
				entry.output = progress.stepOutputs[step.name];
			}
			stepOutputs[step.name] = entry;
		}

		const context = buildTemplateContext(
			workflow.name,
			progress.workflowId,
			progress.startedAt ?? "",
			progress.completedAt,
			stepOutputs,
			[],
			[],
			[],
			variables,
		);

		const pluginTemplates = path.join(__dirname, "templates");
		const templateDirs = [pluginTemplates, this.repoRoot];

		const outputDir = this.resolveOutputDir(progress);

		for (const output of workflow.outputs) {
			if (output.when === "completed" && progress.status !== WORKFLOW_STATUS.COMPLETED) {
				continue;
			}
			if (output.when === "failed" && progress.status !== WORKFLOW_STATUS.FAILED) {
				continue;
			}

			try {
				let outputPathStr = output.path;
				if (this.renderer.hasVariables(outputPathStr)) {
					outputPathStr = this.renderer.renderString(outputPathStr, {
						workflow_id: progress.workflowId,
						...variables,
					});
				}
				const outputPath = path.join(outputDir, outputPathStr);

				renderWorkflowOutput(
					output.template,
					outputPath,
					context,
					templateDirs,
					workflow.settings.strictMode,
				);
				logger.info("workflow", `Generated output: ${outputPath}`);
			} catch (e: unknown) {
				const errorMsg = e instanceof Error ? e.message : String(e);
				logger.error("workflow", `Failed to render output '${output.name}': ${errorMsg}`);
			}
		}
	}

	private resolveOutputDir(progress: WorkflowProgress): string {
		return progress.outputDir ?? getOutputDir(progress.workflowId, this.config, this.repoRoot);
	}

	async executeStep(
		step: StepDefinition,
		progress: WorkflowProgress,
		variables: Record<string, unknown>,
		logger: WorkflowLogger,
		console: ConsoleOutput,
		workflowWorktree?: Worktree | null,
	): Promise<void> {
		const outputDir = this.resolveOutputDir(progress);

		// Validate: parallel worktree is not allowed when workflow-level worktree is active
		if (workflowWorktree && step.type === "parallel" && step.worktree != null) {
			const stepWorktreeEnabled = resolveStepWorktree(step.worktree, this.renderer, variables);
			if (stepWorktreeEnabled) {
				throw new Error(
					`Step '${step.name}': parallel worktree is not supported when workflow-level worktree is enabled`,
				);
			}
		}

		// Resolve runtime and get adapter
		const runtimeId = resolveRuntime(
			step,
			this.workflowSettings ?? {},
			this.config,
			this.runtimeOverride,
		);
		const runtimeAdapter = getAdapter(runtimeId);

		const context: StepContext = {
			repoRoot: this.repoRoot,
			config: this.config,
			renderer: this.renderer,
			runtimeAdapter,
			workflowSettings: this.workflowSettings,
			workflowId: progress.workflowId,
			outputDir,
			variables,
			outputs: progress.stepOutputs,
			cwdOverride: workflowWorktree?.path ?? null,
		};

		const resolvedModel = resolveModel(context, step.model);

		logger.info(step.name, `Starting step: ${step.name}`);
		console.stepStart(step.name, step.type, resolvedModel);
		updateStepStarted(progress, step.name);
		saveProgress(progress, outputDir);

		const executor = this.executors[step.type];
		if (!executor) {
			throw new Error(`Step type not yet implemented: ${step.type}`);
		}

		await executor.execute(step, progress, context, logger, console);
	}
}
