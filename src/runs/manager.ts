/**
 * Run manager: the supervisor side of runs. Owns the registry, the scheduler,
 * workflow execution and crash recovery, and registers the `/v1/runs` routes.
 *
 * Workflows execute in the supervisor process, with the inputs stored in the
 * run directory at dispatch (`dispatch.json`): repo root, workflow contents,
 * config snapshot and allowlisted environment. The supervisor never reads its
 * own cwd.
 *
 * Event rule: state is written to disk (`progress.json`, `run.json`) before
 * the matching event is appended. Recovery rebuilds missing step events from
 * `progress.json` and never emits an event twice.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { deepMerge, getDefaultConfig } from "../config.js";
import { type RunStatus, TERMINAL_RUN_STATUSES } from "../contract/index.js";
import { WorkflowExecutor } from "../executor.js";
import type { Worktree } from "../git/worktree.js";
import { WorkflowParseError, WorkflowParser } from "../parser.js";
import { getGlobalRoot, resolveRunsRoot, runDatePrefix, sanitizeSlug } from "../paths.js";
import {
	STEP_STATUS,
	WORKFLOW_STATUS,
	loadProgress,
	prepareForResume,
	saveProgress,
} from "../progress.js";
import { TemplateRenderer } from "../renderer.js";
import type { Supervisor } from "../supervisor/server.js";
import type { StepProgress, WorkflowDefinition, WorkflowProgress } from "../types.js";
import { resolveWorktreeEnabled } from "../worktree-settings.js";
import { type DispatchPayload, validateDispatch } from "./dispatch.js";
import { type RegistryEntry, RunRegistry } from "./registry.js";
import { type RunEvent, type RunJson, RunStore } from "./run-store.js";
import {
	DEFAULT_MAX_PARALLEL_RUNS,
	DEFAULT_MAX_PARALLEL_TASKS,
	pickRunnable,
} from "./scheduler.js";

/** Step status recorded for the step that was running when the supervisor died. */
export const STEP_INTERRUPTED = "interrupted";

/** Statuses a run can be resumed from with `af resume`. */
export const RESUMABLE_STATUSES: readonly RunStatus[] = ["paused", "awaiting-human", "failed"];

/** Statuses `af cancel` accepts. */
const CANCELABLE_STATUSES: readonly RunStatus[] = [
	"queued",
	"running",
	"paused",
	"blocked",
	"awaiting-human",
];

export class RunError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
		this.name = "RunError";
	}
}

export interface RunManagerOptions {
	/** af global dir (defaults to `getGlobalRoot()`). */
	root?: string;
	log?: (message: string) => void;
}

export interface DispatchResult {
	run: RunJson;
	dir: string;
	warnings: string[];
}

export interface RunDetails {
	entry: RegistryEntry;
	run: RunJson | null;
	steps: StepProgress[];
	current_step: string | null;
}

/** Maps the engine's final workflow status to a contract run status. */
export function toRunStatus(progress: WorkflowProgress): RunStatus {
	switch (progress.status) {
		case WORKFLOW_STATUS.COMPLETED:
			return "done";
		case WORKFLOW_STATUS.CANCELED:
			return "canceled";
		case WORKFLOW_STATUS.PAUSED:
			return progress.currentStep?.type === "wait-for-human" ? "awaiting-human" : "paused";
		case WORKFLOW_STATUS.RUNNING:
			return "running";
		case WORKFLOW_STATUS.PENDING:
			return "queued";
		default:
			return "failed";
	}
}

const END_EVENTS: Partial<
	Record<RunStatus, "run.completed" | "run.failed" | "run.canceled" | "run.paused" | "run.halted">
> = {
	done: "run.completed",
	merged: "run.completed",
	failed: "run.failed",
	canceled: "run.canceled",
	halted: "run.halted",
	paused: "run.paused",
	"awaiting-human": "run.paused",
};

function isTerminal(status: RunStatus): boolean {
	return TERMINAL_RUN_STATUSES.includes(status);
}

function readNumber(config: Record<string, unknown>, key: string, fallback: number): number {
	const supervisor = config.supervisor as Record<string, unknown> | undefined;
	const value = supervisor?.[key];
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export class RunManager {
	readonly root: string;
	readonly registry: RunRegistry;
	private readonly log: (message: string) => void;
	private readonly executing = new Map<string, Promise<void>>();
	private readonly cancelRequests = new Set<string>();
	private readonly perRepoLimit = new Map<string, number>();
	private scheduling = false;
	private rescheduleRequested = false;
	private closed = false;

	constructor(options: RunManagerOptions = {}) {
		this.root = options.root ?? getGlobalRoot();
		this.registry = new RunRegistry(this.root);
		this.log = options.log ?? (() => {});
	}

	/** Runs that are executing or waiting in the queue. */
	activeCount(): number {
		return this.registry.list().filter((r) => r.status === "running" || r.status === "queued")
			.length;
	}

	/** Registers the `/v1/runs` routes and the active-run count on a supervisor. */
	attach(supervisor: Supervisor): void {
		supervisor.activeRuns = () => this.activeCount();
		const wrap =
			<T>(fn: () => Promise<T> | T, status = 200) =>
			async () => {
				try {
					return { status, body: await fn() };
				} catch (err) {
					if (err instanceof RunError) return { status: err.status, body: { error: err.message } };
					throw err;
				}
			};
		supervisor.route("POST", "/v1/runs", ({ body }) =>
			wrap(() => this.dispatch(body as DispatchPayload), 201)(),
		);
		supervisor.route("GET", "/v1/runs", ({ query }) =>
			wrap(() => ({
				runs: this.list({
					status: query.get("status") ?? undefined,
					repo: query.get("repo") ?? undefined,
				}),
			}))(),
		);
		supervisor.route("GET", "/v1/runs/:id", ({ params }) => wrap(() => this.details(params.id))());
		supervisor.route("GET", "/v1/runs/:id/events", ({ params, query }) =>
			wrap(() => {
				const entry = this.requireEntry(params.id);
				const after = Number.parseInt(query.get("after") ?? "0", 10) || 0;
				return {
					events: new RunStore(entry.dir).readEvents(after),
					status: this.registry.get(params.id)?.status ?? entry.status,
				};
			})(),
		);
		supervisor.route("POST", "/v1/runs/:id/cancel", ({ params }) =>
			wrap(() => this.cancel(params.id))(),
		);
		supervisor.route("POST", "/v1/runs/:id/resume", ({ params }) =>
			wrap(() => this.resume(params.id))(),
		);
	}

	/** Recovers interrupted runs, then starts the queue. Call once at startup. */
	async start(): Promise<void> {
		await this.recover();
		this.schedule();
	}

	/** Stops scheduling new runs. Executing runs are not interrupted. */
	close(): void {
		this.closed = true;
	}

	/** Resolves when no run is executing (tests). */
	async idle(): Promise<void> {
		while (this.executing.size > 0 || this.scheduling) {
			await Promise.all([...this.executing.values()]);
			await new Promise((resolve) => setImmediate(resolve));
		}
	}

	list(filter: { status?: string; repo?: string } = {}): RegistryEntry[] {
		return this.registry
			.list()
			.filter((r) => !filter.status || r.status === filter.status)
			.filter((r) => !filter.repo || path.resolve(r.repo) === path.resolve(filter.repo));
	}

	details(id: string): RunDetails {
		const entry = this.requireEntry(id);
		const store = new RunStore(entry.dir);
		const progress = loadProgress(id, entry.dir);
		return {
			entry,
			run: store.exists() ? store.readRun() : null,
			steps: progress?.completedSteps ?? [],
			current_step: progress?.currentStep?.name ?? null,
		};
	}

	private requireEntry(id: string): RegistryEntry {
		const entry = this.registry.get(id);
		if (!entry) throw new RunError(`Run not found: ${id}`, 404);
		return entry;
	}

	private parseWorkflow(payload: DispatchPayload): WorkflowDefinition {
		try {
			return new WorkflowParser(path.dirname(payload.workflow.path)).parseString(
				payload.workflow.contents,
			);
		} catch (err) {
			if (err instanceof WorkflowParseError) {
				throw new RunError(`Error parsing workflow: ${err.message}`);
			}
			throw err;
		}
	}

	/** Creates a queued run from a dispatch payload. */
	async dispatch(payload: DispatchPayload): Promise<DispatchResult> {
		const invalid = validateDispatch(payload);
		if (invalid) throw new RunError(`Invalid dispatch: ${invalid}`);
		if (this.closed) throw new RunError("Supervisor is shutting down", 503);
		const workflow = this.parseWorkflow(payload);

		const variables = { ...payload.variables };
		for (const v of workflow.variables) {
			if (v.name in variables) continue;
			if (v.required && v.default === undefined) {
				throw new RunError(`Missing required variable: ${v.name}`);
			}
			variables[v.name] = v.default;
		}
		const usesWorktree =
			workflow.settings.worktree != null &&
			resolveWorktreeEnabled(
				workflow.settings.worktree,
				new TemplateRenderer(undefined, false),
				variables,
			);

		const warnings: string[] = [];
		const runsRoot = resolveRunsRoot(payload.config, payload.repo_root);
		if (runsRoot.deprecation) warnings.push(runsRoot.deprecation);

		const store = await this.allocateRunDir(
			runsRoot.root,
			sanitizeSlug(payload.slug || workflow.name) || "run",
		);
		const now = new Date().toISOString();
		store.writeJson("dispatch.json", { ...payload, variables });
		const run = await store.create({
			type: "workflow",
			title: workflow.name,
			workflow: workflow.name,
			parent: null,
			repo: payload.repo_root,
			base: null,
			branch: null,
			worktree: null,
			pr: null,
			status: "queued",
			max_risk: null,
			started_at: now,
			ended_at: null,
			runtime: payload.runtime ?? workflow.settings.runtime ?? null,
			models: {},
			budgets_used: {},
		});
		await this.registry.upsert({
			id: store.id,
			dir: store.dir,
			repo: payload.repo_root,
			workflow: workflow.name,
			status: "queued",
			worktree: usesWorktree,
			priority: payload.priority ?? 0,
			created_at: now,
			updated_at: now,
		});
		await store.appendEvent("run.queued", {
			workflow: workflow.name,
			repo: payload.repo_root,
			workflow_path: payload.workflow.path,
		});
		this.log(`Run queued: ${store.id} (${workflow.name}, ${payload.repo_root})`);
		this.schedule();
		return { run, dir: store.dir, warnings };
	}

	/** Picks a free `YYYY-MM-DD-<slug>` directory (suffix -2, -3, ... on collision). */
	private async allocateRunDir(runsRoot: string, slug: string): Promise<RunStore> {
		const base = `${runDatePrefix()}-${slug}`;
		const taken = new Set(this.registry.list().map((r) => r.id));
		let id = base;
		let n = 2;
		while (taken.has(id) || existsSync(path.join(runsRoot, id))) {
			id = `${base}-${n++}`;
		}
		return new RunStore(path.join(runsRoot, id));
	}

	/** Cancels a queued, paused or waiting run now, or a running run at its next boundary. */
	async cancel(id: string): Promise<{ id: string; status: RunStatus | "canceling" }> {
		const entry = this.requireEntry(id);
		if (!CANCELABLE_STATUSES.includes(entry.status)) {
			throw new RunError(`Cannot cancel run in '${entry.status}' status`, 409);
		}
		if (entry.status === "running" && this.executing.has(id)) {
			this.cancelRequests.add(id);
			return { id, status: "canceling" };
		}
		await this.setStatus(entry, "canceled", { reason: "canceled by operator" });
		return { id, status: "canceled" };
	}

	/** Re-queues a paused, waiting or failed run; it resumes from the last completed step. */
	async resume(id: string): Promise<{ id: string; status: RunStatus }> {
		const entry = this.requireEntry(id);
		if (!RESUMABLE_STATUSES.includes(entry.status)) {
			throw new RunError(`Cannot resume run in '${entry.status}' status`, 409);
		}
		const store = new RunStore(entry.dir);
		await store.updateRun({ status: "queued", ended_at: null });
		await this.registry.update(id, { status: "queued" });
		this.schedule();
		return { id, status: "queued" };
	}

	/** Writes a status to run.json and the registry, then emits its event. */
	private async setStatus(
		entry: RegistryEntry,
		status: RunStatus,
		data: Record<string, unknown> = {},
	): Promise<void> {
		const store = new RunStore(entry.dir);
		await store.updateRun({
			status,
			ended_at: isTerminal(status) ? new Date().toISOString() : null,
		});
		await this.registry.update(entry.id, { status });
		const event = END_EVENTS[status];
		if (event) await store.appendEvent(event, { status, ...data });
	}

	/** Starts every queued run the scheduler allows. Safe to call at any time. */
	schedule(): void {
		if (this.closed) return;
		if (this.scheduling) {
			this.rescheduleRequested = true;
			return;
		}
		this.scheduling = true;
		void (async () => {
			try {
				do {
					this.rescheduleRequested = false;
					const runs = this.registry.list();
					const running = runs.filter((r) => r.status === "running");
					const queued = runs.filter((r) => r.status === "queued" && !this.executing.has(r.id));
					const picked = pickRunnable(queued, running, {
						maxParallelRuns: readNumber(
							this.globalConfig(),
							"max_parallel_runs",
							DEFAULT_MAX_PARALLEL_RUNS,
						),
						maxParallelTasks: (entry) => this.maxParallelTasks(entry),
					});
					for (const entry of picked) {
						await this.registry.update(entry.id, { status: "running" });
						const execution = this.execute(entry).finally(() => {
							this.executing.delete(entry.id);
							this.schedule();
						});
						this.executing.set(entry.id, execution);
					}
				} while (this.rescheduleRequested && !this.closed);
			} catch (err) {
				this.log(`Scheduler error: ${(err as Error).message}`);
			} finally {
				this.scheduling = false;
			}
		})();
	}

	/** Global config of the supervisor's af dir (only `supervisor.max_parallel_runs` is read). */
	private globalConfig(): Record<string, unknown> {
		const file = path.join(this.root, "config.json");
		if (!existsSync(file)) return getDefaultConfig();
		try {
			return deepMerge(
				getDefaultConfig(),
				JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>,
			);
		} catch {
			return getDefaultConfig();
		}
	}

	private maxParallelTasks(entry: RegistryEntry): number {
		const cached = this.perRepoLimit.get(entry.id);
		if (cached !== undefined) return cached;
		let limit = DEFAULT_MAX_PARALLEL_TASKS;
		try {
			const payload = new RunStore(entry.dir).readJson<DispatchPayload>("dispatch.json");
			limit = readNumber(payload.config, "max_parallel_tasks", DEFAULT_MAX_PARALLEL_TASKS);
		} catch {
			// Missing snapshot: default limit
		}
		this.perRepoLimit.set(entry.id, limit);
		return limit;
	}

	/** Executes (or resumes) one run inside the supervisor. */
	private async execute(entry: RegistryEntry): Promise<void> {
		const store = new RunStore(entry.dir);
		try {
			const payload = store.readJson<DispatchPayload>("dispatch.json");
			const workflow = this.parseWorkflow(payload);
			const run = store.readRun();

			const resumeProgress = loadProgress(entry.id, entry.dir);
			if (resumeProgress) prepareForResume(resumeProgress);
			if (resumeProgress) saveProgress(resumeProgress, entry.dir);

			await store.updateRun({ status: "running", ended_at: null });
			const started = store.readEvents().some((e) => e.type === "run.started");
			if (started) {
				await store.appendEvent("run.resumed", {
					reason: (run["x-af-recoveries"] ?? 0) > 0 ? "recovered" : "resumed",
				});
			} else {
				await store.appendEvent("run.started", { workflow: workflow.name });
			}

			const recorded: Worktree | null =
				run.worktree && run.branch
					? { path: run.worktree, branch: run.branch, baseBranch: run.base ?? "" }
					: null;
			const executor = new WorkflowExecutor(payload.repo_root, false, payload.runtime ?? null, {
				config: payload.config,
				env: payload.env,
				runDir: entry.dir,
				worktree: recorded,
				shouldStop: () => (this.cancelRequests.has(entry.id) ? WORKFLOW_STATUS.CANCELED : null),
				hooks: {
					onStepStarted: async (step) => {
						await store.appendEvent("step.started", { step });
					},
					onStepFinished: async (step, status, error) => {
						if (status === STEP_STATUS.FAILED) {
							await store.appendEvent("step.failed", { step, error });
						} else {
							await store.appendEvent("step.completed", { step, status });
						}
					},
					onWorktreeCreated: async (wt) => {
						await store.updateRun({ worktree: wt.path, branch: wt.branch, base: wt.baseBranch });
					},
				},
			});

			let terminalOutput = payload.terminal_output ?? workflow.settings.terminalOutput ?? "base";
			if (terminalOutput !== "all") terminalOutput = "base";
			const progress = await executor.run(
				workflow,
				payload.variables,
				resumeProgress ? null : (payload.from_step ?? null),
				terminalOutput,
				payload.workflow.path,
				resumeProgress,
			);
			const status = toRunStatus(progress);
			const lastError = progress.errors.at(-1) as { error?: string } | undefined;
			await this.setStatus(
				entry,
				status === "running" ? "failed" : status,
				status === "failed" ? { error: lastError?.error ?? null } : {},
			);
			this.log(`Run ${entry.id} ended: ${status}`);
		} catch (err) {
			const message = (err as Error).message;
			this.log(`Run ${entry.id} failed: ${message}`);
			if (store.exists()) await this.setStatus(entry, "failed", { error: message });
		} finally {
			this.cancelRequests.delete(entry.id);
		}
	}

	/**
	 * Crash recovery. For each run left `running` by a dead supervisor:
	 * rebuild missing step events from `progress.json`, mark the interrupted
	 * step, re-queue the run, and emit `run.recovered` exactly once.
	 */
	async recover(): Promise<string[]> {
		const recovered: string[] = [];
		for (const entry of this.registry.list()) {
			if (this.executing.has(entry.id)) continue;
			const store = new RunStore(entry.dir);
			if (!store.exists()) continue;
			const run = store.readRun();
			if (run.status === "running" || entry.status === "running") {
				await this.recoverRun(entry, store);
				recovered.push(entry.id);
			} else if (run.status === "queued" && (run["x-af-recoveries"] ?? 0) > 0) {
				// Crash between re-queue and the run.recovered event
				const n = run["x-af-recoveries"] ?? 0;
				await store.appendEventOnce(
					"run.recovered",
					{ recovery: n },
					(e) => e.data?.recovery === n,
				);
				if (entry.status !== "queued") await this.registry.update(entry.id, { status: "queued" });
			}
		}
		return recovered;
	}

	private async recoverRun(entry: RegistryEntry, store: RunStore): Promise<void> {
		const progress = loadProgress(entry.id, entry.dir);
		let topLevel: string[] = [];
		try {
			topLevel = this.parseWorkflow(store.readJson<DispatchPayload>("dispatch.json")).steps.map(
				(s) => s.name,
			);
		} catch {
			topLevel = progress ? [...new Set(progress.completedSteps.map((s) => s.name))] : [];
		}
		const interrupted: string[] = [];
		if (progress) {
			await this.rebuildStepEvents(store, progress, new Set(topLevel));
			const running = new Set(progress.runningSteps);
			if (progress.currentStep?.name) running.add(progress.currentStep.name);
			const now = new Date().toISOString();
			for (const name of running) {
				if (!topLevel.includes(name)) continue;
				interrupted.push(name);
				progress.completedSteps.push({
					name,
					status: STEP_INTERRUPTED,
					startedAt: progress.currentStep?.name === name ? progress.currentStep.startedAt : null,
					completedAt: now,
					retryCount: 0,
					outputSummary: "",
					error: "Supervisor stopped while the step was running",
					humanInput: null,
				});
			}
			prepareForResume(progress);
			saveProgress(progress, entry.dir);
		}
		const n = (store.readRun()["x-af-recoveries"] ?? 0) + 1;
		await store.updateRun({ status: "queued", "x-af-recoveries": n });
		await this.registry.update(entry.id, { status: "queued" });
		const resumeFrom =
			topLevel.find(
				(name) =>
					!progress?.completedSteps.some(
						(s) =>
							s.name === name &&
							(s.status === STEP_STATUS.COMPLETED || s.status === STEP_STATUS.SKIPPED),
					),
			) ?? null;
		await store.appendEventOnce(
			"run.recovered",
			{ recovery: n, interrupted_steps: interrupted, resume_from: resumeFrom },
			(e) => e.data?.recovery === n,
		);
		this.log(`Recovered run ${entry.id} (interrupted: ${interrupted.join(", ") || "none"})`);
	}

	/**
	 * Appends the step events that the state on disk proves happened but the
	 * event log is missing (crash between the state write and the event).
	 */
	private async rebuildStepEvents(
		store: RunStore,
		progress: WorkflowProgress,
		topLevel: Set<string>,
	): Promise<void> {
		const events = store.readEvents();
		const count = (type: string, step: string) =>
			events.filter((e: RunEvent) => e.type === type && e.data?.step === step).length;
		for (const name of topLevel) {
			const records = progress.completedSteps.filter((s) => s.name === name);
			const done = records.filter(
				(s) => s.status === STEP_STATUS.COMPLETED || s.status === STEP_STATUS.SKIPPED,
			);
			const failed = records.filter((s) => s.status === STEP_STATUS.FAILED);
			const isCurrent = progress.currentStep?.name === name || progress.runningSteps.includes(name);
			const startedNeeded = records.length + (isCurrent ? 1 : 0);
			for (let i = count("step.started", name); i < startedNeeded; i++) {
				await store.appendEvent("step.started", { step: name, rebuilt: true });
			}
			for (let i = count("step.completed", name); i < done.length; i++) {
				await store.appendEvent("step.completed", {
					step: name,
					status: done[i].status,
					rebuilt: true,
				});
			}
			for (let i = count("step.failed", name); i < failed.length; i++) {
				await store.appendEvent("step.failed", {
					step: name,
					error: failed[i].error,
					rebuilt: true,
				});
			}
		}
	}
}
