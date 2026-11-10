/** Workflow executor for running workflows. */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { ConsoleOutput, OutputLevel } from "./console.js";
import type { ResultBlock } from "./contract/result.js";
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
	WAITING_WORKFLOW_STATUSES,
	WORKFLOW_STATUS,
	createProgress,
	generateWorkflowId,
	saveProgress,
	updateStepFailed,
	updateStepInterrupted,
	updateStepStarted,
} from "./progress.js";
import { TemplateRenderer, buildTemplateContext, renderWorkflowOutput } from "./renderer.js";
import { getAdapter, resolveRuntime } from "./runtimes/index.js";
import {
	type StepContext,
	type StepEventEmitter,
	type StepResult,
	resolveModel,
} from "./steps/base.js";
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
	WorktreeSettings,
} from "./types.js";
import { resolveStepWorktree, resolveWorktreeEnabled } from "./worktree-settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Callbacks the supervisor uses to write contract state and events. */
export interface ExecutorHooks {
	/** Called after the step's start is saved to disk. */
	onStepStarted?: (step: string) => void | Promise<void>;
	/** Called after the step's outcome is saved to disk. */
	onStepFinished?: (step: string, status: string, error: string | null) => void | Promise<void>;
	/** Called when the workflow-level worktree is created. */
	onWorktreeCreated?: (worktree: Worktree) => void | Promise<void>;
	/** Called after a step stopped by the operator is saved as `interrupted`. */
	onStepInterrupted?: (step: string, stopStatus: string) => void | Promise<void>;
}

export interface ExecutorOptions {
	/** Config snapshot; defaults to `loadConfig(repoRoot)`. */
	config?: Record<string, unknown>;
	/** Environment for runtime processes; defaults to `process.env`. */
	env?: NodeJS.ProcessEnv | null;
	/** Contract run directory; replaces the output directory when set. */
	runDir?: string | null;
	/** Worktree recorded in run.json, reused instead of creating one. */
	worktree?: Worktree | null;
	hooks?: ExecutorHooks;
	/**
	 * Checked at every step boundary. Returning a workflow status (for example
	 * "canceled") stops the run with that status before the next step. Also
	 * checked between ralph-loop iterations.
	 */
	shouldStop?: () => string | null;
	/**
	 * Aborted to stop the running step now. The step's process tree is killed,
	 * the step is recorded `interrupted`, and the run stops with the status
	 * `shouldStop()` returns (paused by default).
	 */
	signal?: AbortSignal | null;
	/** Returns the `## Operator Messages` section for a step or iteration prompt. */
	operatorMessages?: ((step: string) => Promise<string>) | null;
	/** See `StepContext.recordResult`. */
	recordResult?: ((step: string, block: ResultBlock) => Promise<ResultBlock | null>) | null;
	/** See `StepContext.emitEvent` (ralph-loop iterations, prompt retries). */
	emitEvent?: StepEventEmitter | null;
	/**
	 * Called at each top-level step boundary, before the boundary stop check.
	 * Returns true when an amendment is pending: the executor then runs the
	 * workflow's `settings.amend.step` before the next step.
	 */
	takeAmendment?: (() => Promise<boolean>) | null;
	/** Called after the amend step ran (successfully or not). */
	onAmendStepFinished?: ((step: string, status: string | null) => Promise<void>) | null;
}

/** Run endings that always keep the worktree, whatever the cleanup policy. */
const KEEP_WORKTREE_STATUSES: readonly string[] = [
	...WAITING_WORKFLOW_STATUSES,
	WORKFLOW_STATUS.HALTED,
];

/**
 * Worktree cleanup decision for a workflow-level worktree. Paused,
 * awaiting-human, blocked and halted runs always keep it; canceled runs are safety-committed first.
 */
export function shouldRemoveWorktree(
	cleanup: string,
	status: string,
	options: { awaitingHuman?: boolean } = {},
): boolean {
	if (KEEP_WORKTREE_STATUSES.includes(status) || options.awaitingHuman) return false;
	if (cleanup === "on-complete") return true;
	return cleanup === "on-success" && status === WORKFLOW_STATUS.COMPLETED;
}

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

	options: ExecutorOptions;
	/** Stop status returned by `shouldStop` during this run (boundary or interrupt). */
	private stopStatus: string | null = null;

	/** `shouldStop` wrapper that remembers the status it returned. */
	private readonly checkStop = (): string | null => {
		const status = this.options.shouldStop?.() ?? null;
		if (status) this.stopStatus = status;
		return status;
	};

	constructor(
		repoRoot: string,
		strictMode = false,
		runtimeOverride?: string | null,
		options: ExecutorOptions = {},
	) {
		this.repoRoot = repoRoot;
		this.options = options;
		this.config = options.config ?? loadConfig(this.repoRoot);
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
				env: this.options.env ?? null,
				signal: this.options.signal ?? null,
				operatorMessages: this.options.operatorMessages ?? null,
				shouldStop: this.checkStop,
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

		// Merge config.worktree defaults under workflow settings.
		// Layering: hardcoded defaults < config < workflow YAML.
		// The parser leaves fields undefined when not set in YAML,
		// so we fill from config first, then hardcoded defaults.
		if (this.workflowSettings?.worktree) {
			const configWorktree = this.config.worktree as Record<string, unknown> | undefined;
			const wt = this.workflowSettings.worktree;
			wt.location ??= (configWorktree?.location as WorktreeSettings["location"]) ?? "sibling";
			wt.directory ??= (configWorktree?.directory as string) ?? null;
			wt.cleanup ??= (configWorktree?.cleanup as WorktreeSettings["cleanup"]) ?? "on-success";
		}

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

			workflowId = this.options.runDir
				? path.basename(this.options.runDir)
				: generateWorkflowId(workflow.name, slug);
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
		// Under the supervisor, the contract run dir is the output dir.
		let outputDir: string;
		if (this.options.runDir) {
			outputDir = this.options.runDir;
		} else {
			const baseOutputDir =
				resumeProgress?.outputDir ??
				(worktreeEnabled
					? path.join(getWorktreeOutputRoot(this.repoRoot), workflowId)
					: getOutputDir(workflowId, this.config, this.repoRoot));
			outputDir = resumeProgress ? baseOutputDir : resolveOutputDir(baseOutputDir);
		}
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
			// These are guaranteed defined by the ??= merge above
			const wtLocation = worktreeSettings.location ?? "sibling";
			const wtDirectory = worktreeSettings.directory ?? null;

			// Reuse the worktree recorded in run.json (resume and crash recovery)
			if (this.options.worktree && existsSync(this.options.worktree.path)) {
				workflowWorktree = this.options.worktree;
				logger.info("workflow", `Reusing recorded worktree: ${workflowWorktree.path}`);
				console.info(`Worktree (resumed): ${workflowWorktree.path}`);
			} else if (resumeProgress && !this.options.runDir) {
				// Legacy resume: find the worktree by id (preserves pending changes)
				workflowWorktree = findExistingWorktree(worktreeId, this.repoRoot, wtLocation, wtDirectory);
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
					location: wtLocation,
					directory: wtDirectory,
				});
				logger.info(
					"workflow",
					`Worktree created: ${workflowWorktree.path} (branch: ${workflowWorktree.branch})`,
				);
				console.info(`Worktree: ${workflowWorktree.path}`);
				await this.options.hooks?.onWorktreeCreated?.(workflowWorktree);
			}

			if (workflowWorktree) {
				copyLocalDirs(this.repoRoot, workflowWorktree.path);
			}
		}

		// Build set of completed step names to skip on resume. `af retry-step`
		// reruns its step and every later step even when they completed.
		const retryIndex = progress.retryFrom
			? workflow.steps.findIndex((s) => s.name === progress.retryFrom)
			: -1;
		const rerun = new Set(
			retryIndex >= 0 ? workflow.steps.slice(retryIndex).map((s) => s.name) : [],
		);
		const completedStepNames = new Set(
			progress.completedSteps
				.filter((s) => s.status === STEP_STATUS.COMPLETED || s.status === STEP_STATUS.SKIPPED)
				.map((s) => s.name)
				.filter((name) => !rerun.has(name)),
		);
		const amendStep = workflow.settings.amend
			? (workflow.steps.find((s) => s.name === workflow.settings.amend?.step) ?? null)
			: null;

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

				// Boundary check: the supervisor may ask to stop before the next step
				const stopStatus = this.checkStop();
				if (stopStatus) {
					logger.info("workflow", `Stopping before step ${step.name}: ${stopStatus}`);
					progress.status = stopStatus;
					break;
				}

				if (progress.retryFrom === step.name) {
					progress.retryFrom = null;
					saveProgress(progress, outputDir);
				}

				// Pending amendment: run the amend step at this boundary, then continue
				let amending = false;
				if (amendStep && (await this.options.takeAmendment?.())) {
					amending = true;
					if (amendStep.name !== step.name) {
						logger.info("workflow", `Running amend step ${amendStep.name} before ${step.name}`);
						const amended = await this.runTopLevelStep(
							amendStep,
							progress,
							vars,
							logger,
							console,
							workflowWorktree,
							outputDir,
						);
						await this.options.onAmendStepFinished?.(amendStep.name, amended.status);
						amending = false;
						if (amended.stop || progress.status !== WORKFLOW_STATUS.RUNNING) break;
					}
				}

				const outcome = await this.runTopLevelStep(
					step,
					progress,
					vars,
					logger,
					console,
					workflowWorktree,
					outputDir,
				);
				if (amending) await this.options.onAmendStepFinished?.(step.name, outcome.status);
				if (outcome.stop || progress.status !== WORKFLOW_STATUS.RUNNING) break;
			}

			if (progress.status === WORKFLOW_STATUS.RUNNING) {
				progress.status = WORKFLOW_STATUS.COMPLETED;
			}
			if (!WAITING_WORKFLOW_STATUSES.includes(progress.status)) {
				progress.completedAt = new Date().toISOString();
			}
			saveProgress(progress, outputDir);
		} finally {
			// Cleanup workflow-level worktree according to the cleanup policy
			if (workflowWorktree && worktreeSettings) {
				const cleanup = worktreeSettings.cleanup ?? "on-success";
				const shouldRemove = shouldRemoveWorktree(cleanup, progress.status, {
					awaitingHuman: progress.currentStep?.type === "wait-for-human",
				});

				// cancel: commit pending work even when the policy keeps the worktree
				if (!shouldRemove && progress.status === WORKFLOW_STATUS.CANCELED) {
					safetyCommit(workflowWorktree.path, logger);
				}

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

	/**
	 * Runs one top-level step and fires its hooks. Returns `stop: true` when the
	 * operator stopped it or it failed with an exception, and the status of the
	 * record the step added (null when it added none).
	 */
	private async runTopLevelStep(
		step: StepDefinition,
		progress: WorkflowProgress,
		vars: Record<string, unknown>,
		logger: WorkflowLogger,
		console: ConsoleOutput,
		workflowWorktree: Worktree | null,
		outputDir: string,
	): Promise<{ stop: boolean; status: string | null }> {
		const recordsBefore = progress.completedSteps.length;
		try {
			await this.executeStep(step, progress, vars, logger, console, workflowWorktree);
			if (await this.handleInterruption(step.name, progress, recordsBefore, logger)) {
				saveProgress(progress, outputDir);
				return { stop: true, status: STEP_STATUS.INTERRUPTED };
			}
			saveProgress(progress, outputDir);
			const record = progress.completedSteps
				.slice(recordsBefore)
				.reverse()
				.find((s) => s.name === step.name);
			if (record) {
				await this.options.hooks?.onStepFinished?.(step.name, record.status, record.error);
			}
			return { stop: false, status: record?.status ?? null };
		} catch (e: unknown) {
			if (await this.handleInterruption(step.name, progress, recordsBefore, logger)) {
				saveProgress(progress, outputDir);
				return { stop: true, status: STEP_STATUS.INTERRUPTED };
			}
			const errorMsg = e instanceof Error ? e.message : String(e);
			logger.error(step.name, `Step failed: ${errorMsg}`);
			console.stepFailed(step.name, errorMsg);
			updateStepFailed(progress, step.name, errorMsg);
			progress.status = WORKFLOW_STATUS.FAILED;
			saveProgress(progress, outputDir);
			await this.options.hooks?.onStepFinished?.(step.name, STEP_STATUS.FAILED, errorMsg);
			return { stop: true, status: STEP_STATUS.FAILED };
		}
	}

	/**
	 * After a step returns or throws: when the operator stopped it (signal
	 * aborted, or a ralph-loop iteration boundary stop), records the step as
	 * `interrupted` and sets the stop status. Returns true when it did.
	 */
	private async handleInterruption(
		stepName: string,
		progress: WorkflowProgress,
		recordsBefore: number,
		logger: WorkflowLogger,
	): Promise<boolean> {
		const aborted = this.options.signal?.aborted ?? false;
		if (!aborted && !this.stopStatus) return false;
		const status = this.stopStatus ?? this.checkStop() ?? WORKFLOW_STATUS.PAUSED;
		const reason = aborted
			? `Interrupted by operator (${status})`
			: `Stopped at an iteration boundary (${status})`;
		updateStepInterrupted(progress, stepName, reason, recordsBefore);
		progress.status = status;
		logger.info(stepName, reason);
		await this.options.hooks?.onStepInterrupted?.(stepName, status);
		return true;
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

		// Namespace `settings.model` is written in. It follows the workflow/config
		// runtime, not the CLI override: `--runtime codex` on a Claude workflow must
		// fall back to the Codex model configuration rather than inherit "sonnet".
		const workflowRuntimeId = resolveRuntime(null, this.workflowSettings ?? {}, this.config);

		const context: StepContext = {
			repoRoot: this.repoRoot,
			config: this.config,
			renderer: this.renderer,
			runtimeAdapter,
			workflowRuntimeId,
			workflowSettings: this.workflowSettings,
			workflowId: progress.workflowId,
			outputDir,
			variables,
			outputs: progress.stepOutputs,
			cwdOverride: workflowWorktree?.path ?? null,
			env: this.options.env ?? null,
			signal: this.options.signal ?? null,
			operatorMessages: this.options.operatorMessages ?? null,
			recordResult: this.options.recordResult ?? null,
			emitEvent: this.options.emitEvent ?? null,
			shouldStop: this.checkStop,
		};

		const resolvedModel = resolveModel(context, step.model);

		logger.info(step.name, `Starting step: ${step.name}`);
		console.stepStart(step.name, step.type, resolvedModel);
		updateStepStarted(progress, step.name);
		saveProgress(progress, outputDir);
		await this.options.hooks?.onStepStarted?.(step.name);

		const executor = this.executors[step.type];
		if (!executor) {
			throw new Error(`Step type not yet implemented: ${step.type}`);
		}

		await executor.execute(step, progress, context, logger, console);
	}
}
