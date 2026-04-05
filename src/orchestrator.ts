/** Async workflow orchestration with Claude decision loop. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { getRuntimeModel, getSandboxMode, loadConfig } from "./config.js";
import { ConsoleOutput, OutputLevel, extractSummary } from "./console.js";
import { WorkflowExecutor } from "./executor.js";
import { type Worktree, createWorktree, pruneOrphaned, removeWorktree } from "./git/worktree.js";
import { WorkflowLogger } from "./logging/logger.js";
import { findOutputDir, getOutputDir } from "./paths.js";
import {
	WORKFLOW_STATUS,
	createProgress,
	generateWorkflowId,
	loadProgress,
	progressToDict,
	saveProgress,
	updateStepCompleted,
	updateStepFailed,
	updateStepStarted,
} from "./progress.js";
import {
	type RalphLoopState,
	buildRalphSystemMessage,
	createRalphState,
	deactivateRalphState,
	detectCompletionPromise,
	loadRalphState,
	updateRalphIteration,
} from "./ralph-loop.js";
import { TemplateRenderer } from "./renderer.js";
import { getAdapter, resolveRuntime } from "./runtimes/index.js";
import { runRuntime } from "./runtimes/process-runner.js";
import { SignalManager, handleGracefulShutdown } from "./signal-manager.js";
import type {
	ParallelBranch,
	StepDefinition,
	StepProgress,
	WorkflowDefinition,
	WorkflowProgress,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Data types ---

export interface OrchestratorAction {
	type: string;
	stepName?: string | null;
	contextToPass?: string | null;
	errorContext?: string | null;
}

export interface OrchestratorDecision {
	workflowStatus: string;
	action: OrchestratorAction;
	reasoning: string;
	progressUpdate: string;
}

// --- Main orchestrator ---

export class WorkflowOrchestrator {
	repoRoot: string;
	config: Record<string, unknown>;
	renderer: TemplateRenderer;
	executor: WorkflowExecutor;
	runtimeOverride: string | null;
	private _signalManager: SignalManager;

	constructor(repoRoot?: string, runtimeOverride?: string | null) {
		this.repoRoot = repoRoot ?? process.cwd();
		this.config = loadConfig(this.repoRoot);
		this.renderer = new TemplateRenderer();
		this.runtimeOverride = runtimeOverride ?? null;
		this.executor = new WorkflowExecutor(this.repoRoot, false, this.runtimeOverride);
		this._signalManager = new SignalManager();
	}

	dispose(): void {
		this._signalManager.dispose();
	}

	private get _shutdownRequested(): boolean {
		return this._signalManager.shutdownRequested;
	}

	private resolveModel(stepModel?: string | null, runtimeId?: string): string {
		if (stepModel) return stepModel;
		const effectiveRuntime =
			runtimeId ??
			((this.config.defaults as Record<string, unknown> | undefined)?.runtime as string) ??
			"claude";
		return getRuntimeModel(this.config, effectiveRuntime) ?? "sonnet";
	}

	async run(
		workflow: WorkflowDefinition,
		variables?: Record<string, unknown> | null,
		fromStep?: string | null,
		terminalOutput = "base",
		workflowFile = "",
		resumeProgress?: WorkflowProgress | null,
	): Promise<WorkflowProgress> {
		pruneOrphaned(this.repoRoot);

		const vars = variables ? { ...variables } : {};

		const outputLevel = terminalOutput === "all" ? OutputLevel.ALL : OutputLevel.BASE;
		const console = new ConsoleOutput(outputLevel);

		let progress: WorkflowProgress;

		if (resumeProgress) {
			progress = resumeProgress;
			const merged = { ...progress.variables };
			Object.assign(merged, vars);
			progress.variables = merged;
			if (!progress.workflowFile && workflowFile) {
				progress.workflowFile = workflowFile;
			}
		} else {
			progress = this.initProgress(workflow, vars, fromStep ?? null, workflowFile);
		}

		const outputDir = getOutputDir(progress.workflowId, this.config, this.repoRoot);
		progress.outputDir = outputDir;
		const logger = new WorkflowLogger(progress.workflowId, outputDir);
		logger.info("orchestrator", `Starting workflow: ${workflow.name}`);
		console.workflowStart(workflow.name, progress.workflowId);

		while (!this._shutdownRequested) {
			const decision = await this.getOrchestratorDecision(workflow, progress, logger);

			if (!decision) {
				logger.error("orchestrator", "Failed to get orchestrator decision");
				console.error("Failed to get orchestrator decision");
				progress.status = WORKFLOW_STATUS.FAILED;
				break;
			}

			logger.info("orchestrator", decision.reasoning);

			if (decision.workflowStatus === "completed") {
				progress.status = WORKFLOW_STATUS.COMPLETED;
				break;
			}
			if (decision.workflowStatus === "failed") {
				progress.status = WORKFLOW_STATUS.FAILED;
				break;
			}
			if (decision.workflowStatus === "blocked") {
				progress.status = WORKFLOW_STATUS.PAUSED;
				break;
			}

			if (decision.action.type === "execute_step") {
				await this.executeStepAction(workflow, progress, decision.action, logger, console);
			} else if (decision.action.type === "retry_step") {
				await this.retryStepAction(workflow, progress, decision.action, logger, console);
			} else if (decision.action.type === "wait_for_human") {
				this.waitForHumanAction(progress, decision.action, logger);
				break;
			} else if (decision.action.type === "abort") {
				progress.status = WORKFLOW_STATUS.FAILED;
				break;
			}

			saveProgress(progress, outputDir);

			if (this._shutdownRequested) {
				await this.handleShutdown(progress, logger);
				break;
			}
		}

		progress.completedAt = new Date().toISOString();
		saveProgress(progress, outputDir);

		console.workflowComplete(workflow.name, progress.status);
		this._signalManager.dispose();
		return progress;
	}

	private initProgress(
		workflow: WorkflowDefinition,
		variables: Record<string, unknown>,
		fromStep: string | null,
		workflowFile = "",
	): WorkflowProgress {
		const workflowId = generateWorkflowId(workflow.name);
		const stepNames = this.collectStepNames(workflow.steps);

		for (const v of workflow.variables) {
			if (!(v.name in variables)) {
				if (v.required && v.default === undefined) {
					throw new Error(`Missing required variable: ${v.name}`);
				}
				variables[v.name] = v.default;
			}
		}

		const progress = createProgress(workflowId, workflow.name, stepNames, variables, workflowFile);

		if (fromStep) {
			let skip = true;
			const newPending: string[] = [];
			for (const name of stepNames) {
				if (name === fromStep) {
					skip = false;
				}
				if (skip) {
					progress.completedSteps.push({
						name,
						status: "skipped",
						startedAt: null,
						completedAt: null,
						retryCount: 0,
						outputSummary: "Skipped (resumed from later step)",
						error: null,
						humanInput: null,
					});
				} else {
					newPending.push(name);
				}
			}
			progress.pendingSteps = newPending;
		}

		const initOutputDir = getOutputDir(workflowId, this.config, this.repoRoot);
		progress.outputDir = initOutputDir;
		saveProgress(progress, initOutputDir);
		return progress;
	}

	private collectStepNames(steps: StepDefinition[]): string[] {
		const names: string[] = [];
		for (const step of steps) {
			names.push(step.name);
			if (step.steps && step.steps.length > 0) {
				names.push(...this.collectStepNames(step.steps));
			}
			if (step.thenSteps && step.thenSteps.length > 0) {
				names.push(...this.collectStepNames(step.thenSteps));
			}
			if (step.elseSteps && step.elseSteps.length > 0) {
				names.push(...this.collectStepNames(step.elseSteps));
			}
		}
		return names;
	}

	private async getOrchestratorDecision(
		workflow: WorkflowDefinition,
		progress: WorkflowProgress,
		logger: WorkflowLogger,
	): Promise<OrchestratorDecision | null> {
		const cmdPath = path.join(__dirname, "..", "commands", "orchestrate.md");
		let cmdTemplate: string;
		try {
			cmdTemplate = readFileSync(cmdPath, "utf-8");
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			logger.error("orchestrator", `Orchestrate command not found at ${cmdPath}: ${msg}`);
			return null;
		}

		const workflowYaml = yaml.dump(this.workflowToDict(workflow));
		const progressJson = JSON.stringify(progressToDict(progress), null, 2);

		let lastStepName: string | null = null;
		let lastStepOutput: unknown = null;
		if (progress.completedSteps.length > 0) {
			const last = progress.completedSteps[progress.completedSteps.length - 1];
			lastStepName = last.name;
			lastStepOutput = progress.stepOutputs[lastStepName] ?? "";
		}

		const prompt = this.renderer.renderString(cmdTemplate, {
			workflow_yaml: workflowYaml,
			progress_json: progressJson,
			last_step_name: lastStepName,
			last_step_output: lastStepOutput ? String(lastStepOutput).slice(0, 2000) : null,
		});

		const defaults = this.config.defaults as Record<string, unknown> | undefined;
		const maxRetry = (defaults?.maxRetry as number) ?? 3;
		const orchestratorRuntimeId = resolveRuntime(
			{},
			workflow.settings,
			this.config,
			this.runtimeOverride,
		);
		const orchestratorAdapter = getAdapter(orchestratorRuntimeId);
		const orchestratorModel = this.resolveModel(null, orchestratorRuntimeId);

		for (let attempt = 0; attempt < maxRetry; attempt++) {
			const result = await runRuntime(orchestratorAdapter, {
				prompt,
				cwd: this.repoRoot,
				model: orchestratorModel,
				timeout: 120,
				printOutput: false,
				sandbox: getSandboxMode(this.config),
			});

			if (!result.success) {
				logger.warning("orchestrator", `Orchestrator call failed: ${result.stderr}`);
				continue;
			}

			try {
				return this.parseOrchestratorResponse(result.stdout);
			} catch (e: unknown) {
				const errorMsg = e instanceof Error ? e.message : String(e);
				logger.warning("orchestrator", `Failed to parse response: ${errorMsg}`);
			}
		}

		return null;
	}

	private parseOrchestratorResponse(output: string): OrchestratorDecision {
		let jsonStr = output;
		if (output.includes("```json")) {
			const start = output.indexOf("```json") + 7;
			const end = output.indexOf("```", start);
			jsonStr = output.slice(start, end).trim();
		} else if (output.includes("```")) {
			const start = output.indexOf("```") + 3;
			const end = output.indexOf("```", start);
			jsonStr = output.slice(start, end).trim();
		}

		const parsed: unknown = JSON.parse(jsonStr);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("Orchestrator response is not a JSON object");
		}
		const data = parsed as Record<string, unknown>;

		const actionRaw = data.next_action;
		const actionData =
			typeof actionRaw === "object" && actionRaw !== null && !Array.isArray(actionRaw)
				? (actionRaw as Record<string, unknown>)
				: {};
		const action: OrchestratorAction = {
			type: typeof actionData.type === "string" ? actionData.type : "abort",
			stepName: typeof actionData.step_name === "string" ? actionData.step_name : null,
			contextToPass:
				typeof actionData.context_to_pass === "string" ? actionData.context_to_pass : null,
			errorContext: typeof actionData.error_context === "string" ? actionData.error_context : null,
		};

		return {
			workflowStatus: typeof data.workflow_status === "string" ? data.workflow_status : "failed",
			action,
			reasoning: typeof data.reasoning === "string" ? data.reasoning : "",
			progressUpdate: typeof data.progress_update === "string" ? data.progress_update : "",
		};
	}

	private async executeStepAction(
		workflow: WorkflowDefinition,
		progress: WorkflowProgress,
		action: OrchestratorAction,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<void> {
		const step = this.findStep(workflow.steps, action.stepName ?? null);
		if (!step) {
			logger.error("orchestrator", `Step not found: ${action.stepName}`);
			console.error(`Step not found: ${action.stepName}`);
			return;
		}

		if (step.type === "parallel") {
			await this.executeParallelStep(workflow, step, progress, logger, console);
		} else if (step.type === "conditional") {
			await this.executeConditionalStep(workflow, step, progress, logger, console);
		} else if (step.type === "ralph-loop") {
			await this.executeRalphLoopStep(workflow, step, progress, logger, console);
		} else if (step.type === "wait-for-human") {
			this.executeWaitForHumanStep(step, progress, logger);
		} else {
			await this.executor.executeStep(step, progress, progress.variables, logger, console);
		}
	}

	private async executeParallelStep(
		workflow: WorkflowDefinition,
		step: StepDefinition,
		progress: WorkflowProgress,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<void> {
		logger.info(step.name, `Starting parallel execution with ${step.steps.length} branches`);
		console.stepStart(step.name, "parallel");
		console.info(`Parallel execution with ${step.steps.length} branches`);
		updateStepStarted(progress, step.name);

		const execution = this.config.execution as Record<string, unknown> | undefined;
		const maxWorkers = (execution?.maxWorkers as number) ?? 4;
		const worktrees: Worktree[] = [];

		try {
			for (const subStep of step.steps) {
				const wt = createWorktree(workflow.name, subStep.name, this.repoRoot);
				worktrees.push(wt);

				const branch: ParallelBranch = {
					branchId: subStep.name,
					status: "running",
					worktreePath: wt.path,
					progressFile: path.join(
						getOutputDir(progress.workflowId, { outputDirectory: "local" }, wt.path),
						"progress.json",
					),
				};
				progress.parallelBranches.push(branch);
			}

			saveProgress(progress, getOutputDir(progress.workflowId, this.config, this.repoRoot));

			// Execute branches concurrently with concurrency cap
			interface BranchResult {
				success: boolean;
				subStep: StepDefinition;
				wt: Worktree;
				error?: Error | unknown;
			}
			const results: BranchResult[] = [];
			const pending = worktrees.map((wt, i) => ({ wt, i }));
			let idx = 0;

			const runNext = async (): Promise<void> => {
				while (idx < pending.length) {
					const current = pending[idx++];
					const { wt, i } = current;
					try {
						const success = await this.executeInWorktree(
							workflow,
							step.steps[i],
							progress,
							wt,
							logger,
							console,
						);
						results.push({ success, subStep: step.steps[i], wt });
					} catch (e: unknown) {
						results.push({ success: false, subStep: step.steps[i], wt, error: e });
					}
				}
			};

			const workers = Array.from({ length: Math.min(maxWorkers, pending.length) }, () =>
				runNext().catch((e: unknown) => {
					logger.error("parallel", `Worker error: ${e instanceof Error ? e.message : String(e)}`);
				}),
			);
			await Promise.all(workers);
			let allSuccess = true;

			for (const result of results) {
				if (!result.success) {
					allSuccess = false;
					const errorMsg =
						result.error instanceof Error ? result.error.message : "Parallel branch failed";
					logger.error(result.subStep.name, errorMsg);
					console.stepFailed(result.subStep.name, errorMsg);
				}
			}

			if (allSuccess) {
				updateStepCompleted(progress, step.name, "All parallel branches completed");
				console.stepComplete(step.name, "All parallel branches completed");
				logger.info(step.name, "Parallel execution completed successfully");
			} else {
				updateStepFailed(progress, step.name, "One or more parallel branches failed");
				console.stepFailed(step.name, "One or more parallel branches failed");
			}
		} finally {
			for (const wt of worktrees) {
				try {
					removeWorktree(wt, this.repoRoot, false);
				} catch (e: unknown) {
					const errorMsg = e instanceof Error ? e.message : String(e);
					logger.warning(step.name, `Failed to clean worktree: ${errorMsg}`);
				}
			}
			progress.parallelBranches = [];
		}
	}

	private async executeInWorktree(
		workflow: WorkflowDefinition,
		step: StepDefinition,
		parentProgress: WorkflowProgress,
		worktree: Worktree,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<boolean> {
		const wtExecutor = new WorkflowExecutor(worktree.path, false, this.runtimeOverride);
		// Force local output for worktrees: they are ephemeral and output stays within the worktree
		wtExecutor.config = { ...wtExecutor.config, outputDirectory: "local" };
		const wtOutputDir = getOutputDir(parentProgress.workflowId, wtExecutor.config, worktree.path);
		const wtLogger = new WorkflowLogger(parentProgress.workflowId, wtOutputDir);

		// Clone progress so worktree branches write to their own output dir, not the parent's
		const wtProgress: WorkflowProgress = {
			...parentProgress,
			outputDir: wtOutputDir,
		};

		try {
			await wtExecutor.executeStep(step, wtProgress, parentProgress.variables, wtLogger, console);
			return true;
		} catch (e: unknown) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			logger.error(step.name, `Worktree execution failed: ${errorMsg}`);
			console.stepFailed(step.name, `Worktree execution failed: ${errorMsg}`);
			return false;
		}
	}

	private async executeConditionalStep(
		workflow: WorkflowDefinition,
		step: StepDefinition,
		progress: WorkflowProgress,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<void> {
		logger.info(step.name, `Evaluating condition: ${step.condition}`);
		console.stepStart(step.name, "conditional");
		updateStepStarted(progress, step.name);

		const context = { outputs: progress.stepOutputs, variables: progress.variables };
		let isTrue: boolean;
		try {
			const conditionResult = this.renderer.renderString(
				`{{ ${step.condition ?? "false"} }}`,
				context,
			);
			isTrue = ["true", "1", "yes"].includes(conditionResult.toLowerCase());
		} catch (e: unknown) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			logger.error(step.name, `Condition evaluation failed: ${errorMsg}`);
			console.stepFailed(step.name, `Condition evaluation failed: ${errorMsg}`);
			updateStepFailed(progress, step.name, `Condition error: ${errorMsg}`);
			return;
		}

		const stepsToRun = isTrue ? step.thenSteps : step.elseSteps;
		const branchName = isTrue ? "then" : "else";
		logger.info(
			step.name,
			`Condition ${isTrue ? "met" : "not met"}, executing ${stepsToRun.length} steps`,
		);
		console.info(`Condition ${branchName} branch: executing ${stepsToRun.length} steps`);

		for (const subStep of stepsToRun) {
			await this.executor.executeStep(subStep, progress, progress.variables, logger, console);
			if (progress.status === WORKFLOW_STATUS.FAILED) {
				break;
			}
		}

		if (progress.status !== WORKFLOW_STATUS.FAILED) {
			updateStepCompleted(progress, step.name, `Condition: ${isTrue}`);
			console.stepComplete(step.name, `Condition ${branchName} branch completed`);
		}
	}

	private async executeRalphLoopStep(
		workflow: WorkflowDefinition,
		step: StepDefinition,
		progress: WorkflowProgress,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<void> {
		const completionPromise = step.completionPromise ?? "COMPLETE";
		const maxIterations =
			typeof step.maxIterations === "string"
				? Number.parseInt(step.maxIterations, 10)
				: step.maxIterations;

		const resolvedModel = this.resolveModel(step.model);

		logger.info(
			step.name,
			`Starting Ralph loop (max ${maxIterations} iterations, promise: ${completionPromise})`,
		);
		console.stepStart(step.name, "ralph-loop", resolvedModel);
		console.info(`Ralph loop starting (max ${maxIterations} iterations)`);
		updateStepStarted(progress, step.name);

		// Render prompt template
		const templateContext = {
			variables: progress.variables,
			outputs: progress.stepOutputs,
			...progress.variables,
		};
		let prompt = step.prompt ?? "";
		if (this.renderer.hasVariables(prompt)) {
			prompt = this.renderer.renderString(prompt, templateContext);
		}

		// Check for existing state to resume
		const ralphOutputDir = getOutputDir(progress.workflowId, this.config, this.repoRoot);
		const existingState = loadRalphState(progress.workflowId, step.name, ralphOutputDir);
		let state: RalphLoopState;
		if (existingState?.active) {
			state = existingState;
			logger.info(step.name, `Resuming Ralph loop from iteration ${state.iteration}`);
			console.info(`Resuming Ralph loop from iteration ${state.iteration}`);
		} else {
			state = createRalphState(
				progress.workflowId,
				step.name,
				prompt,
				maxIterations,
				completionPromise,
				ralphOutputDir,
			);
		}

		const printOutput = console.level === OutputLevel.ALL;
		let finalOutput = "";
		let completed = false;

		while (state.iteration <= maxIterations && !this._shutdownRequested) {
			logger.info(step.name, `Ralph iteration ${state.iteration}/${maxIterations}`);

			const ralphMessage = buildRalphSystemMessage(
				state.iteration,
				maxIterations,
				completionPromise,
			);
			const fullPrompt = ralphMessage + prompt;

			console.ralphIterationStart(step.name, state.iteration, maxIterations);

			const timeout = (step.stepTimeoutMinutes ?? 60) * 60;
			const ralphRuntimeId = resolveRuntime(
				step,
				workflow.settings,
				this.config,
				this.runtimeOverride,
			);
			const ralphAdapter = getAdapter(ralphRuntimeId);
			const result = await runRuntime(ralphAdapter, {
				prompt: fullPrompt,
				cwd: this.repoRoot,
				model: this.resolveModel(step.model, ralphRuntimeId),
				timeout,
				printOutput,
				skipPermissions: true,
				console,
				sandbox: getSandboxMode(this.config),
			});

			if (!result.success) {
				const errorSummary = result.stderr ? extractSummary(result.stderr) : "Unknown error";
				logger.warning(step.name, `Iteration ${state.iteration} failed: ${result.stderr}`);
				console.ralphIteration(
					step.name,
					state.iteration,
					maxIterations,
					`Failed: ${errorSummary}`,
				);
				const newState = updateRalphIteration(progress.workflowId, step.name, ralphOutputDir);
				if (!newState) break;
				state = newState;
				continue;
			}

			const iterationSummary = extractSummary(result.stdout);
			console.ralphIteration(step.name, state.iteration, maxIterations, iterationSummary);

			const completionResult = detectCompletionPromise(result.stdout, completionPromise);

			if (completionResult.isComplete && completionResult.promiseMatched) {
				logger.info(step.name, `Completion promise matched after ${state.iteration} iterations`);
				finalOutput = result.stdout;
				completed = true;
				deactivateRalphState(progress.workflowId, step.name, ralphOutputDir);
				break;
			}

			if (completionResult.isComplete && !completionResult.promiseMatched) {
				logger.warning(
					step.name,
					`Completion signaled but promise mismatch: got '${completionResult.promiseValue}', expected '${completionPromise}'`,
				);
				console.warning(
					`Promise mismatch: got '${completionResult.promiseValue}', expected '${completionPromise}'`,
				);
			}

			const newState = updateRalphIteration(progress.workflowId, step.name, ralphOutputDir);
			if (!newState) {
				logger.error(step.name, "Failed to update Ralph state");
				console.error("Failed to update Ralph state");
				break;
			}
			state = newState;
		}

		if (completed) {
			updateStepCompleted(
				progress,
				step.name,
				`Completed after ${state.iteration} iterations`,
				finalOutput,
			);
			console.ralphComplete(step.name, state.iteration, maxIterations);
		} else if (this._shutdownRequested) {
			logger.info(step.name, "Ralph loop interrupted by shutdown");
			console.warning("Ralph loop interrupted by shutdown");
			updateStepFailed(progress, step.name, "Interrupted by shutdown");
		} else {
			logger.warning(step.name, `Max iterations (${maxIterations}) reached without completion`);
			deactivateRalphState(progress.workflowId, step.name, ralphOutputDir);
			updateStepFailed(
				progress,
				step.name,
				`Max iterations (${maxIterations}) reached without completion promise`,
			);
			console.ralphMaxIterations(step.name, maxIterations);
		}
	}

	private executeWaitForHumanStep(
		step: StepDefinition,
		progress: WorkflowProgress,
		logger: WorkflowLogger,
	): void {
		logger.info(step.name, `Waiting for human input: ${step.message}`);
		updateStepStarted(progress, step.name);

		progress.currentStep = {
			name: step.name,
			retryCount: 0,
			startedAt: new Date().toISOString(),
			type: "wait-for-human",
			message: step.message,
			timeoutMinutes: step.stepTimeoutMinutes ?? 5,
			onTimeout: step.onTimeout,
		};
		progress.status = WORKFLOW_STATUS.PAUSED;

		const sep = "=".repeat(60);
		process.stdout.write(`\n${sep}\n`);
		process.stdout.write("HUMAN INPUT REQUIRED\n");
		process.stdout.write(`${sep}\n`);
		process.stdout.write(`\n${step.message}\n\n`);
		process.stdout.write(
			`Provide input with: agentic-forge input ${progress.workflowId} "<your response>"\n`,
		);
		process.stdout.write(`${sep}\n\n`);
	}

	private async retryStepAction(
		workflow: WorkflowDefinition,
		progress: WorkflowProgress,
		action: OrchestratorAction,
		logger: WorkflowLogger,
		console: ConsoleOutput,
	): Promise<void> {
		let step = this.findStep(workflow.steps, action.stepName ?? null);
		if (!step) {
			logger.error("orchestrator", `Step not found: ${action.stepName}`);
			console.error(`Step not found: ${action.stepName}`);
			return;
		}

		console.info(`Retrying step: ${action.stepName}`);

		if (action.errorContext && step.prompt) {
			step = {
				...step,
				prompt: `${step.prompt}\n\nPrevious attempt failed:\n${action.errorContext}`,
			};
		}

		await this.executor.executeStep(step, progress, progress.variables, logger, console);
	}

	private waitForHumanAction(
		progress: WorkflowProgress,
		action: OrchestratorAction,
		logger: WorkflowLogger,
	): void {
		progress.status = WORKFLOW_STATUS.PAUSED;
		logger.info("orchestrator", "Workflow paused waiting for human input");
	}

	private findStep(steps: StepDefinition[], name: string | null): StepDefinition | null {
		if (!name) return null;
		for (const step of steps) {
			if (step.name === name) return step;
			if (step.steps?.length) {
				const found = this.findStep(step.steps, name);
				if (found) return found;
			}
			if (step.thenSteps?.length) {
				const found = this.findStep(step.thenSteps, name);
				if (found) return found;
			}
			if (step.elseSteps?.length) {
				const found = this.findStep(step.elseSteps, name);
				if (found) return found;
			}
		}
		return null;
	}

	private async handleShutdown(progress: WorkflowProgress, logger: WorkflowLogger): Promise<void> {
		await handleGracefulShutdown(progress, logger, this.repoRoot);
	}

	private workflowToDict(workflow: WorkflowDefinition): Record<string, unknown> {
		return {
			name: workflow.name,
			steps: workflow.steps.map((s) => ({ name: s.name, type: s.type })),
		};
	}
}

// --- Process human input ---

export function processHumanInput(
	workflowId: string,
	response: string,
	repoRoot?: string,
): boolean {
	const root = repoRoot ?? process.cwd();
	const humanOutputDir = findOutputDir(workflowId, root);
	if (!humanOutputDir) {
		process.stdout.write(`Workflow not found: ${workflowId}\n`);
		return false;
	}
	const progress = loadProgress(workflowId, humanOutputDir);

	if (!progress) {
		process.stdout.write(`Workflow not found: ${workflowId}\n`);
		return false;
	}

	if (progress.status !== WORKFLOW_STATUS.PAUSED) {
		process.stdout.write(`Workflow is not paused: ${progress.status}\n`);
		return false;
	}

	if (!progress.currentStep || progress.currentStep.type !== "wait-for-human") {
		process.stdout.write("Workflow is not waiting for human input\n");
		return false;
	}

	progress.currentStep.humanInput = response;
	progress.status = WORKFLOW_STATUS.RUNNING;
	saveProgress(progress, humanOutputDir);

	process.stdout.write(
		`Input received. Resume workflow with: agentic-forge resume ${workflowId}\n`,
	);
	return true;
}
