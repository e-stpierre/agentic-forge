/** Workflow executor for running workflows. */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { ConsoleOutput, OutputLevel } from "./console.js";
import { WorkflowLogger } from "./logging/logger.js";
import { getOutputDir, resolveOutputDir } from "./paths.js";
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
			return executor.execute(step, progress, context, logger, console);
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

		// Resolve output dir, handling collisions with resolveOutputDir
		const baseOutputDir =
			resumeProgress?.outputDir ?? getOutputDir(workflowId, this.config, this.repoRoot);
		const outputDir = resumeProgress ? baseOutputDir : resolveOutputDir(baseOutputDir);
		progress.outputDir = outputDir;
		saveProgress(progress, outputDir);

		const logger = new WorkflowLogger(workflowId, outputDir);
		logger.info("workflow", `Started workflow: ${workflow.name}`);

		console.workflowStart(workflow.name, workflowId);

		// Build set of completed step names to skip on resume
		const completedStepNames = new Set(
			progress.completedSteps
				.filter((s) => s.status === STEP_STATUS.COMPLETED || s.status === STEP_STATUS.SKIPPED)
				.map((s) => s.name),
		);

		let skipUntil = fromStep ?? null;

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
				await this.executeStep(step, progress, vars, logger, console);
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
	): Promise<void> {
		const outputDir = this.resolveOutputDir(progress);

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
