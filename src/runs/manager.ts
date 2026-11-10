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

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deepMerge, getDefaultConfig } from "../config.js";
import {
	type NeedsInput,
	type ResultBlock,
	type RunStatus,
	TERMINAL_RUN_STATUSES,
	validateArtifact,
} from "../contract/index.js";
import { latestPlan } from "../contract/plan.js";
import { WorkflowExecutor, shouldRemoveWorktree } from "../executor.js";
import { type Worktree, pruneOrphaned, removeWorktree, safetyCommit } from "../git/worktree.js";
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
import type {
	StepDefinition,
	StepProgress,
	WorkflowDefinition,
	WorkflowProgress,
} from "../types.js";
import { resolveWorktreeEnabled } from "../worktree-settings.js";
import { type DispatchPayload, validateDispatch } from "./dispatch.js";
import { Inbox, type InboxMessage, type NewMessage, formatOperatorMessages } from "./inbox.js";
import { type RegistryEntry, RunRegistry } from "./registry.js";
import {
	type AmendmentEntry,
	type DecisionEntry,
	type RunEvent,
	type RunJson,
	RunStore,
} from "./run-store.js";
import {
	DEFAULT_MAX_PARALLEL_RUNS,
	DEFAULT_MAX_PARALLEL_TASKS,
	pickRunnable,
} from "./scheduler.js";

/** Step status recorded for the step that was running when the supervisor died. */
export const STEP_INTERRUPTED = STEP_STATUS.INTERRUPTED;

/** Statuses a run can be resumed from with `af resume`. */
export const RESUMABLE_STATUSES: readonly RunStatus[] = [
	"paused",
	"awaiting-human",
	"blocked",
	"failed",
];

/** Statuses `af send` accepts (the message waits for the next boundary). */
const SENDABLE_STATUSES: readonly RunStatus[] = [
	"queued",
	"running",
	"paused",
	"blocked",
	"awaiting-human",
];

/** Statuses `af pause` accepts. */
const PAUSABLE_STATUSES: readonly RunStatus[] = ["queued", "running"];

/**
 * Stop requested by the operator for an executing run. `restart` (from
 * `send --mode now`) re-queues the run at once instead of pausing it.
 */
type StopRequest = {
	status: "paused" | "canceled";
	now: boolean;
	restart?: { message: string };
};

/** Statuses `af cancel` accepts. */
const CANCELABLE_STATUSES: readonly RunStatus[] = [
	"queued",
	"running",
	"paused",
	"blocked",
	"awaiting-human",
];

/** Pending needs_input request of an awaiting-human run (af extension `x-af-needs-input`). */
export interface PendingInput {
	step: string;
	request: NeedsInput;
	asked_at: string;
	/** When the recommended option is applied (non-blocking requests only), or null. */
	deadline: string | null;
}

/** Amendment waiting for the amend step (af extension `x-af-amendments`). */
interface PendingAmendment {
	id: string;
	at: string;
	from: "user" | "overseer";
	text: string;
	affects: string[];
	/** Inbox message carrying the amendment to the amend step. */
	message: string;
}

export interface AnswerInput {
	request_id?: string;
	answer?: string;
	/** `policy` is used by the needs_input timeout. */
	from?: "user" | "overseer" | "policy";
}

export interface AnswerResult {
	id: string;
	request: string;
	message: string;
	status: RunStatus;
}

export interface AmendInput {
	text?: string;
	affects?: string[];
	from?: "user" | "overseer";
}

export interface AmendResult {
	id: string;
	amendment: string;
	/** `amend-step`: runs `settings.amend.step` at the next boundary; `message`: delivered as an operator message. */
	delivery: "amend-step" | "message";
	step: string | null;
	message: string;
}

export interface RetryInput {
	step?: string;
	context?: string;
	from?: "user" | "overseer";
}

export interface RetryResult {
	id: string;
	step: string;
	message: string | null;
	status: RunStatus;
}

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
			return (progress.completedSteps ?? []).some((s) => s.resultStatus === "merged")
				? "merged"
				: "done";
		case WORKFLOW_STATUS.AWAITING_HUMAN:
			return "awaiting-human";
		case WORKFLOW_STATUS.HALTED:
			return "halted";
		case WORKFLOW_STATUS.BLOCKED:
			return "blocked";
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
	blocked: "run.paused",
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
	private readonly stopRequests = new Map<string, StopRequest>();
	private readonly controllers = new Map<string, AbortController>();
	private readonly perRepoLimit = new Map<string, number>();
	/** Last result block per executing run (read when it stops awaiting-human). */
	private readonly results = new Map<string, { step: string; block: ResultBlock }>();
	/** Start time (ms) of the running attempt of each step, keyed by run and step. */
	private readonly stepStarts = new Map<string, number>();
	/** needs_input deadlines (non-blocking requests). */
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
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
		supervisor.route("POST", "/v1/runs/:id/pause", ({ params, body }) =>
			wrap(() => this.pause(params.id, { now: (body as { now?: unknown })?.now === true }))(),
		);
		supervisor.route("POST", "/v1/runs/:id/messages", ({ params, body }) =>
			wrap(() => this.send(params.id, (body ?? {}) as NewMessage), 201)(),
		);
		supervisor.route("GET", "/v1/runs/:id/messages", ({ params }) =>
			wrap(() => ({ messages: new Inbox(this.requireEntry(params.id).dir).list() }))(),
		);
		supervisor.route("POST", "/v1/runs/:id/resume", ({ params }) =>
			wrap(() => this.resume(params.id))(),
		);
		supervisor.route("POST", "/v1/runs/:id/answer", ({ params, body }) =>
			wrap(() => this.answer(params.id, (body ?? {}) as AnswerInput))(),
		);
		supervisor.route("POST", "/v1/runs/:id/amend", ({ params, body }) =>
			wrap(() => this.amend(params.id, (body ?? {}) as AmendInput), 201)(),
		);
		supervisor.route("POST", "/v1/runs/:id/retry", ({ params, body }) =>
			wrap(() => this.retryStep(params.id, (body ?? {}) as RetryInput))(),
		);
		supervisor.route("POST", "/v1/runs/:id/priority", ({ params, body }) =>
			wrap(() => this.reprioritize(params.id, (body as { priority?: unknown })?.priority))(),
		);
	}

	/** Recovers interrupted runs, then starts the queue. Call once at startup. */
	async start(): Promise<void> {
		await this.recover();
		this.armInputTimers();
		this.schedule();
	}

	/** Stops scheduling new runs. Executing runs are not interrupted. */
	close(): void {
		this.closed = true;
		for (const id of [...this.timers.keys()]) this.clearTimer(id);
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

	/**
	 * Cancels a run. A running run is stopped now: its step's process tree is
	 * killed, then the executor runs `safetyCommit` and the worktree cleanup
	 * policy. A queued, paused or waiting run is canceled directly, with the
	 * same safety commit and policy applied to its recorded worktree.
	 */
	async cancel(id: string): Promise<{ id: string; status: RunStatus | "canceling" }> {
		const entry = this.requireEntry(id);
		if (!CANCELABLE_STATUSES.includes(entry.status)) {
			throw new RunError(`Cannot cancel run in '${entry.status}' status`, 409);
		}
		this.clearTimer(id);
		if (this.executing.has(id)) {
			this.stopRequests.set(id, { status: "canceled", now: true });
			this.controllers.get(id)?.abort();
			return { id, status: "canceling" };
		}
		const worktree = this.cleanupIdleWorktree(entry);
		await this.setStatus(entry, "canceled", {
			reason: "canceled by operator",
			...(worktree ? { worktree } : {}),
		});
		return { id, status: "canceled" };
	}

	/**
	 * Pauses a run. A running run stops at its next step or ralph-loop
	 * iteration boundary, or now with `now` (the step's process tree is killed
	 * and the step reruns on resume). A queued run is paused directly.
	 */
	async pause(
		id: string,
		options: { now?: boolean } = {},
	): Promise<{ id: string; status: RunStatus | "pausing" }> {
		const entry = this.requireEntry(id);
		if (!PAUSABLE_STATUSES.includes(entry.status)) {
			throw new RunError(`Cannot pause run in '${entry.status}' status`, 409);
		}
		if (this.executing.has(id)) {
			const current = this.stopRequests.get(id);
			if (current?.status === "canceled") return { id, status: "pausing" };
			const now = options.now === true || (current?.now ?? false);
			this.stopRequests.set(id, { status: "paused", now });
			if (now) this.controllers.get(id)?.abort();
			return { id, status: "pausing" };
		}
		await this.setStatus(entry, "paused", { reason: "paused by operator" });
		return { id, status: "paused" };
	}

	/**
	 * Queues an operator message (`mode: next`). It is injected as an
	 * `## Operator Messages` section at the start of the next step or
	 * ralph-loop iteration prompt (of the named step when `step` is set).
	 */
	async send(id: string, input: NewMessage): Promise<{ id: string; message: InboxMessage }> {
		const entry = this.requireEntry(id);
		const text = typeof input.text === "string" ? input.text.trim() : "";
		if (!text) throw new RunError("Message text is required");
		const mode = input.mode ?? "next";
		if (mode !== "next" && mode !== "now") {
			throw new RunError(`Invalid mode '${String(mode)}': expected next or now`);
		}
		const from = input.from ?? "user";
		if (from !== "user" && from !== "overseer") {
			throw new RunError(`Invalid sender '${String(from)}': expected user or overseer`);
		}
		if (!SENDABLE_STATUSES.includes(entry.status)) {
			throw new RunError(`Cannot send a message to a run in '${entry.status}' status`, 409);
		}
		const step = input.step ? String(input.step) : null;
		if (step) {
			const names = this.stepNames(entry);
			if (names && !names.includes(step)) {
				throw new RunError(`Unknown step '${step}'. Steps: ${names.join(", ")}`);
			}
		}
		const store = new RunStore(entry.dir);
		const message = new Inbox(entry.dir).queue({ text, from, mode, step });
		await store.appendEvent("message.queued", messageEventData(message));
		if (mode === "now" && this.executing.has(id)) this.interruptFor(id, message.id);
		return { id, message };
	}

	/**
	 * `send --mode now`: kills the running step and restarts it right away with
	 * the message. A pending pause still pauses (the message waits for resume);
	 * a pending cancel wins.
	 */
	private interruptFor(id: string, messageId: string): void {
		const current = this.stopRequests.get(id);
		if (current?.status === "canceled") return;
		if (current?.status === "paused" && !current.restart) {
			this.stopRequests.set(id, { status: "paused", now: true });
		} else {
			this.stopRequests.set(id, { status: "paused", now: true, restart: { message: messageId } });
		}
		this.controllers.get(id)?.abort();
	}

	/** Every step name of a run's workflow, nested steps included (null if unreadable). */
	private stepNames(entry: RegistryEntry): string[] | null {
		try {
			const workflow = this.parseWorkflow(
				new RunStore(entry.dir).readJson<DispatchPayload>("dispatch.json"),
			);
			const names: string[] = [];
			const walk = (steps: StepDefinition[] | undefined) => {
				for (const s of steps ?? []) {
					names.push(s.name);
					walk(s.steps);
					walk(s.thenSteps);
					walk(s.elseSteps);
				}
			};
			walk(workflow.steps);
			return names;
		} catch {
			return null;
		}
	}

	/**
	 * Cancel of a run that is not executing: safety-commits its recorded
	 * worktree, then applies the workflow's cleanup policy. Returns what
	 * happened to the worktree, or null when the run has none.
	 */
	private cleanupIdleWorktree(entry: RegistryEntry): "removed" | "kept" | null {
		const store = new RunStore(entry.dir);
		if (!store.exists()) return null;
		const run = store.readRun();
		if (!run.worktree || !existsSync(run.worktree)) return null;
		let repoRoot = entry.repo;
		let cleanup = "on-success";
		try {
			const payload = store.readJson<DispatchPayload>("dispatch.json");
			repoRoot = payload.repo_root;
			const configWorktree = payload.config.worktree as { cleanup?: string } | undefined;
			cleanup =
				this.parseWorkflow(payload).settings.worktree?.cleanup ??
				configWorktree?.cleanup ??
				"on-success";
		} catch {
			// Default policy
		}
		if (!existsSync(path.join(run.worktree, ".git"))) {
			// Orphaned directory of a worktree af recorded: prune only that one
			pruneOrphaned(repoRoot, undefined, [run.worktree]);
			return "removed";
		}
		const commit = safetyCommit(run.worktree);
		if (commit.failed || !shouldRemoveWorktree(cleanup, WORKFLOW_STATUS.CANCELED)) return "kept";
		removeWorktree(
			{ path: run.worktree, branch: run.branch ?? "", baseBranch: run.base ?? "" },
			repoRoot,
			false,
		);
		return "removed";
	}

	/**
	 * Appends the message events and decisions that the inbox files prove
	 * happened but the logs are missing (crash between the file write and the
	 * event). Idempotent.
	 */
	private async rebuildMessageEvents(store: RunStore): Promise<void> {
		const messages = new Inbox(store.dir).list();
		if (messages.length === 0) return;
		const events = store.readEvents();
		const has = (type: string, id: string) =>
			events.some((e) => e.type === type && e.data?.id === id);
		const decisions = store.readDecisions();
		for (const m of messages) {
			if (!has("message.queued", m.id)) {
				await store.appendEvent("message.queued", { ...messageEventData(m), rebuilt: true });
			}
			if (!m.delivered_at) continue;
			const step = deliveredTo(m);
			if (!has("message.delivered", m.id)) {
				await store.appendEvent("message.delivered", { id: m.id, step, rebuilt: true });
			}
			if (!decisions.some((d) => d.refs?.includes(m.id))) {
				await store.appendDecision(messageDecision(m, step ?? "run"));
			}
		}
	}

	/** Delivers the pending messages of `step`: files first, then events and decisions. */
	private async deliverMessages(store: RunStore, step: string): Promise<string> {
		const inbox = new Inbox(store.dir);
		const pending = inbox.pending(step);
		if (pending.length === 0) return "";
		const delivered = inbox.markDelivered(
			pending.map((m) => m.id),
			step,
		);
		for (const m of delivered) {
			await store.appendEvent("message.delivered", { id: m.id, step });
			await store.appendDecision(messageDecision(m, step));
		}
		this.log(`Run ${store.id}: delivered ${delivered.length} operator message(s) to ${step}`);
		return formatOperatorMessages(delivered);
	}

	/**
	 * Answers the pending `needs_input` request of an awaiting-human run: logs
	 * `input.answered` and an operator (or policy) decision, queues the answer
	 * as an operator message for the asking step, and resumes the run. The step
	 * runs again with the answer in its `## Operator Messages` section.
	 */
	async answer(id: string, input: AnswerInput): Promise<AnswerResult> {
		const entry = this.requireEntry(id);
		if (entry.status !== "awaiting-human") {
			throw new RunError(`Cannot answer a run in '${entry.status}' status`, 409);
		}
		const store = new RunStore(entry.dir);
		const pending = pendingInput(store.readRun());
		if (!pending) throw new RunError("Run has no pending needs_input request", 409);
		const request = pending.request;
		if (input.request_id && input.request_id !== request.id) {
			throw new RunError(`Unknown request '${input.request_id}'. Pending: ${request.id}`, 404);
		}
		const raw = typeof input.answer === "string" ? input.answer.trim() : "";
		if (!raw) throw new RunError("Answer text is required");
		const policy = input.from === "policy";
		const from = policy ? "overseer" : (input.from ?? "user");
		if (from !== "user" && from !== "overseer") {
			throw new RunError(`Invalid sender '${String(from)}': expected user or overseer`);
		}
		const option =
			request.options.find((o) => o.id === raw) ??
			request.options.find((o) => o.label.toLowerCase() === raw.toLowerCase()) ??
			null;
		const answer = option ? `${option.id} (${option.label})` : raw;
		const message = new Inbox(entry.dir).queue({
			text: `Answer to ${request.id} ("${request.question}"): ${answer}`,
			from,
			mode: "next",
			step: pending.step,
		});
		await store.updateRun({ "x-af-needs-input": null });
		this.clearTimer(id);
		await store.appendEvent("message.queued", messageEventData(message));
		await store.appendEvent("input.answered", {
			id: request.id,
			step: pending.step,
			answer: option?.id ?? raw,
			option: option?.id ?? null,
			from: policy ? "policy" : from,
			message: message.id,
		});
		await store.appendDecision({
			id: `d-${request.id}`,
			at: message.at,
			phase: pending.step,
			source: policy ? "policy" : "operator",
			risk: "low",
			decision: `Answered ${request.id} (${request.question}): ${answer}`,
			rationale: policy
				? "No answer within the needs_input timeout; applied the recommended option of a non-blocking request"
				: `Answer from ${from}`,
			alternatives: request.options.filter((o) => o.id !== option?.id).map((o) => o.label),
			refs: [request.id, message.id],
		});
		await this.resume(id);
		return { id, request: request.id, message: message.id, status: "queued" };
	}

	/**
	 * Records an amendment. With `settings.amend.step`, the amendment is queued
	 * for that step: at the next step boundary the executor runs the amend step
	 * (which writes `plan.v<N>.md`), then the harness appends it to
	 * `amendments.jsonl`, emits `amendment.applied` and logs the decision.
	 * Without an amend step, it is recorded now (`plan_version: null`) and
	 * delivered as an `Amendment:` operator message at the next boundary.
	 */
	async amend(id: string, input: AmendInput): Promise<AmendResult> {
		const entry = this.requireEntry(id);
		const text = typeof input.text === "string" ? input.text.trim() : "";
		if (!text) throw new RunError("Amendment text is required");
		const from = input.from ?? "user";
		if (from !== "user" && from !== "overseer") {
			throw new RunError(`Invalid sender '${String(from)}': expected user or overseer`);
		}
		const affects = input.affects ?? [];
		if (!Array.isArray(affects) || affects.some((a) => typeof a !== "string" || !a.trim())) {
			throw new RunError("affects must be a list of milestone IDs");
		}
		if (!SENDABLE_STATUSES.includes(entry.status)) {
			throw new RunError(`Cannot amend a run in '${entry.status}' status`, 409);
		}
		const store = new RunStore(entry.dir);
		const workflow = this.parseWorkflow(store.readJson<DispatchPayload>("dispatch.json"));
		const amendStep = workflow.settings.amend?.step ?? null;
		const pending = pendingAmendments(store.readRun());
		const number = store.readAmendments().length + pending.length + 1;
		const amendmentId = `A${String(number).padStart(3, "0")}`;
		const at = new Date().toISOString();
		const inbox = new Inbox(entry.dir);

		if (amendStep) {
			const scope = affects.length > 0 ? ` (affects ${affects.join(", ")})` : "";
			const message = inbox.queue({
				text: `Amendment ${amendmentId}${scope}: ${text}`,
				from,
				mode: "next",
				step: amendStep,
			});
			const next: PendingAmendment = {
				id: amendmentId,
				at,
				from,
				text,
				affects,
				message: message.id,
			};
			await store.updateRun({ "x-af-amendments": [...pending, next] });
			await store.appendEvent("message.queued", messageEventData(message));
			return {
				id,
				amendment: amendmentId,
				delivery: "amend-step",
				step: amendStep,
				message: message.id,
			};
		}

		const amendment: AmendmentEntry = {
			id: amendmentId,
			at,
			from,
			text,
			affects,
			plan_version: null,
		};
		const message = inbox.queue({ text: `Amendment: ${text}`, from, mode: "next", step: null });
		await store.appendAmendment(amendment);
		await store.appendDecision(amendmentDecision(amendment, "run"));
		await store.appendEvent("message.queued", messageEventData(message));
		await store.appendEvent("amendment.applied", {
			id: amendmentId,
			plan_version: null,
			delivery: "message",
			message: message.id,
		});
		return { id, amendment: amendmentId, delivery: "message", step: null, message: message.id };
	}

	/**
	 * Called by the executor after the amend step ran. On success, every
	 * pending amendment is appended to `amendments.jsonl` (unless the step did
	 * it) with the latest plan version, then `amendment.applied` and the
	 * operator decision follow, once each.
	 */
	private async finishAmendments(
		store: RunStore,
		step: string,
		status: string | null,
	): Promise<void> {
		const pending = pendingAmendments(store.readRun());
		if (pending.length === 0 || status !== STEP_STATUS.COMPLETED) return;
		const plan = latestPlan(store.dir);
		const existing = store.readAmendments();
		const decisions = store.readDecisions();
		for (const p of pending) {
			let amendment = existing.find((a) => a.id === p.id);
			if (!amendment) {
				amendment = {
					id: p.id,
					at: new Date().toISOString(),
					from: p.from,
					text: p.text,
					affects: p.affects,
					plan_version: plan.version >= 2 ? plan.version : null,
				};
				await store.appendAmendment(amendment);
			}
			await store.appendEventOnce(
				"amendment.applied",
				{ id: p.id, step, plan_version: amendment.plan_version, plan_path: plan.path },
				(e) => e.data?.id === p.id,
			);
			if (!decisions.some((d) => d.id === `d-${p.id}`)) {
				await store.appendDecision(amendmentDecision(amendment, step));
			}
		}
		await store.updateRun({ "x-af-amendments": [] });
	}

	/**
	 * Reruns a top-level step of a stopped run (failed, paused, blocked or
	 * awaiting-human): that step and every later one run again, even when they
	 * completed. Optional extra context is queued as an operator message for it.
	 */
	async retryStep(id: string, input: RetryInput): Promise<RetryResult> {
		const entry = this.requireEntry(id);
		if (!RESUMABLE_STATUSES.includes(entry.status)) {
			throw new RunError(`Cannot retry a step of a run in '${entry.status}' status`, 409);
		}
		const step = typeof input.step === "string" ? input.step.trim() : "";
		if (!step) throw new RunError("Step name is required");
		const from = input.from ?? "user";
		if (from !== "user" && from !== "overseer") {
			throw new RunError(`Invalid sender '${String(from)}': expected user or overseer`);
		}
		const store = new RunStore(entry.dir);
		const topLevel = this.parseWorkflow(store.readJson<DispatchPayload>("dispatch.json")).steps.map(
			(s) => s.name,
		);
		if (!topLevel.includes(step)) {
			throw new RunError(`'${step}' is not a top-level step. Steps: ${topLevel.join(", ")}`);
		}
		const progress = loadProgress(id, entry.dir);
		if (!progress) throw new RunError("Run has no progress to retry from", 409);
		progress.retryFrom = step;
		saveProgress(progress, entry.dir);
		const context = typeof input.context === "string" ? input.context.trim() : "";
		let messageId: string | null = null;
		if (context) {
			const message = new Inbox(entry.dir).queue({ text: context, from, mode: "next", step });
			messageId = message.id;
			await store.appendEvent("message.queued", messageEventData(message));
		}
		await store.appendEvent("step.retried", { step, reason: "operator", message: messageId });
		await this.resume(id);
		return { id, step, message: messageId, status: "queued" };
	}

	/** Changes the queue priority of a run that has not ended (higher runs first). */
	async reprioritize(id: string, priority: unknown): Promise<{ id: string; priority: number }> {
		if (typeof priority !== "number" || !Number.isInteger(priority)) {
			throw new RunError("priority must be an integer");
		}
		const entry = this.requireEntry(id);
		if (isTerminal(entry.status)) {
			throw new RunError(`Cannot reprioritize a run in '${entry.status}' status`, 409);
		}
		await this.registry.update(id, { priority });
		this.schedule();
		return { id, priority };
	}

	/**
	 * Writes a step's result block to `steps/<NN-step>/result.json`, unless the
	 * step wrote that file itself during this attempt (the file wins). Raises
	 * run.json `max_risk` and records `pr`. Returns the block to use.
	 */
	private async recordResult(
		entry: RegistryEntry,
		store: RunStore,
		step: string,
		block: ResultBlock,
	): Promise<ResultBlock> {
		const names = this.stepNames(entry) ?? [];
		const index = Math.max(names.indexOf(step), 0) + 1;
		const slug = sanitizeSlug(step) || "step";
		const dir = path.join(store.dir, "steps", `${String(index).padStart(2, "0")}-${slug}`);
		const file = path.join(dir, "result.json");
		const startedAt = this.stepStarts.get(stepKey(entry.id, step)) ?? Number.POSITIVE_INFINITY;
		let own: unknown = null;
		if (existsSync(file) && statSync(file).mtimeMs >= startedAt) {
			try {
				own = JSON.parse(readFileSync(file, "utf-8"));
			} catch {
				own = null;
			}
		}
		let effective = block;
		if (own && validateArtifact("result", own).valid) {
			effective = own as ResultBlock;
		} else {
			mkdirSync(dir, { recursive: true });
			writeFileSync(file, `${JSON.stringify(block, null, 2)}\n`, "utf-8");
		}
		const run = store.readRun();
		const patch: Partial<RunJson> = {};
		const risk = effective.max_risk;
		if (risk && RISK_RANK[risk] > RISK_RANK[run.max_risk ?? "none"]) patch.max_risk = risk;
		if (effective.pr) patch.pr = effective.pr;
		if (Object.keys(patch).length > 0) await store.updateRun(patch);
		this.results.set(entry.id, { step, block: effective });
		return effective;
	}

	/**
	 * After a run stopped `awaiting-human`: stores the step's `needs_input`
	 * request in run.json (`x-af-needs-input`) and emits `needs_input`. A
	 * non-blocking request with a recommended option gets a deadline when
	 * `supervisor.needs_input_timeout` is set.
	 */
	private async recordNeedsInput(
		entry: RegistryEntry,
		store: RunStore,
		config: Record<string, unknown>,
	): Promise<PendingInput | null> {
		const last = this.results.get(entry.id);
		this.results.delete(entry.id);
		const request =
			last?.block.status === "awaiting-human" ? (last.block.needs_input ?? null) : null;
		if (!last || !request) return null;
		const minutes = needsInputTimeout(config);
		const autoApply = request.blocking === false && request.recommended != null;
		const now = Date.now();
		const pending: PendingInput = {
			step: last.step,
			request,
			asked_at: new Date(now).toISOString(),
			deadline:
				autoApply && minutes !== null ? new Date(now + minutes * 60_000).toISOString() : null,
		};
		await store.updateRun({ "x-af-needs-input": pending });
		await store.appendEvent("needs_input", {
			...request,
			step: last.step,
			deadline: pending.deadline,
		});
		return pending;
	}

	/** Re-arms the needs_input deadlines of awaiting-human runs (supervisor start). */
	private armInputTimers(): void {
		for (const entry of this.registry.list()) {
			if (entry.status !== "awaiting-human") continue;
			try {
				const pending = pendingInput(new RunStore(entry.dir).readRun());
				if (pending?.deadline) this.armTimer(entry.id, pending);
			} catch {
				// Unreadable run.json: nothing to arm
			}
		}
	}

	private armTimer(id: string, pending: PendingInput): void {
		this.clearTimer(id);
		const recommended = pending.request.recommended;
		if (!pending.deadline || recommended == null) return;
		const delay = Math.max(0, Date.parse(pending.deadline) - Date.now());
		const timer = setTimeout(() => {
			this.timers.delete(id);
			this.answer(id, {
				request_id: pending.request.id,
				answer: recommended,
				from: "policy",
			}).catch((err: Error) => {
				this.log(`Run ${id}: needs_input timeout not applied: ${err.message}`);
			});
		}, delay);
		timer.unref?.();
		this.timers.set(id, timer);
	}

	private clearTimer(id: string): void {
		const timer = this.timers.get(id);
		if (timer) clearTimeout(timer);
		this.timers.delete(id);
	}

	/** Re-queues a paused, waiting, blocked or failed run; it resumes from the last completed step. */
	async resume(id: string): Promise<{ id: string; status: RunStatus }> {
		const entry = this.requireEntry(id);
		if (!RESUMABLE_STATUSES.includes(entry.status)) {
			throw new RunError(`Cannot resume run in '${entry.status}' status`, 409);
		}
		const store = new RunStore(entry.dir);
		const patch: Partial<RunJson> = { status: "queued", ended_at: null };
		// Resuming without an answer reruns the step, which asks again if needed
		if (pendingInput(store.readRun())) patch["x-af-needs-input"] = null;
		this.clearTimer(id);
		await store.updateRun(patch);
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
			await this.rebuildMessageEvents(store);
			const controller = new AbortController();
			this.controllers.set(entry.id, controller);
			let interruptedStep: string | null = null;
			const executor = new WorkflowExecutor(payload.repo_root, false, payload.runtime ?? null, {
				config: payload.config,
				env: payload.env,
				runDir: entry.dir,
				worktree: recorded,
				signal: controller.signal,
				shouldStop: () => {
					const request = this.stopRequests.get(entry.id);
					if (!request) return null;
					return request.status === "canceled" ? WORKFLOW_STATUS.CANCELED : WORKFLOW_STATUS.PAUSED;
				},
				operatorMessages: (step) => this.deliverMessages(store, step),
				recordResult: (step, block) => this.recordResult(entry, store, step, block),
				takeAmendment: async () => pendingAmendments(store.readRun()).length > 0,
				onAmendStepFinished: (step, status) => this.finishAmendments(store, step, status),
				hooks: {
					onStepInterrupted: (step) => {
						interruptedStep = step;
					},
					onStepStarted: async (step) => {
						this.stepStarts.set(stepKey(entry.id, step), Date.now());
						await store.appendEvent("step.started", { step });
					},
					onStepFinished: async (step, status, error) => {
						if (status === STEP_STATUS.FAILED) {
							await store.appendEvent("step.failed", { step, error });
						} else {
							const result = this.results.get(entry.id);
							const resultStatus = result?.step === step ? result.block.status : null;
							await store.appendEvent("step.completed", {
								step,
								status,
								...(resultStatus ? { result_status: resultStatus } : {}),
							});
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
			const request = this.stopRequests.get(entry.id);
			if (request?.restart && status === "paused") {
				// send --mode now: rerun the interrupted step at once with the message
				await store.updateRun({ status: "queued" });
				await this.registry.update(entry.id, { status: "queued" });
				await store.appendEvent("step.retried", {
					step: interruptedStep,
					reason: "message",
					message: request.restart.message,
				});
				this.log(`Run ${entry.id}: restarting ${interruptedStep ?? "the next step"} (send now)`);
				return;
			}
			const lastError = progress.errors.at(-1) as { error?: string } | undefined;
			const data: Record<string, unknown> = {};
			if (status === "failed") data.error = lastError?.error ?? null;
			const pendingRequest =
				status === "awaiting-human"
					? await this.recordNeedsInput(entry, store, payload.config)
					: null;
			if (pendingRequest) data.needs_input = pendingRequest.request.id;
			if ((status === "paused" || status === "canceled") && request) {
				data.reason = `${status} by operator`;
				data.now = request.now;
				if (interruptedStep) data.interrupted_step = interruptedStep;
			}
			await this.setStatus(entry, status === "running" ? "failed" : status, data);
			if (pendingRequest?.deadline) this.armTimer(entry.id, pendingRequest);
			this.log(`Run ${entry.id} ended: ${status}`);
		} catch (err) {
			const message = (err as Error).message;
			this.log(`Run ${entry.id} failed: ${message}`);
			if (store.exists()) await this.setStatus(entry, "failed", { error: message });
		} finally {
			this.stopRequests.delete(entry.id);
			this.controllers.delete(entry.id);
			this.results.delete(entry.id);
			for (const key of [...this.stepStarts.keys()]) {
				if (key.startsWith(stepKey(entry.id, ""))) this.stepStarts.delete(key);
			}
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
		await this.rebuildMessageEvents(store);
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

function messageEventData(m: InboxMessage): Record<string, unknown> {
	return { id: m.id, from: m.from, mode: m.mode, target: m.target, step: m.step ?? null };
}

/** Step a delivered message was injected into (af extension field of the inbox file). */
function deliveredTo(m: InboxMessage): string | null {
	const value = m["x-af-delivered-to"];
	return typeof value === "string" ? value : null;
}

/** `operator` decision logged for every delivered message (contract rule). */
function messageDecision(m: InboxMessage, step: string): DecisionEntry {
	return {
		id: `d-${m.id}`,
		at: m.delivered_at ?? new Date().toISOString(),
		phase: step,
		source: "operator",
		risk: "low",
		decision: `Operator message delivered to ${step}: ${m.text}`,
		rationale: `Message from ${m.from} (mode ${m.mode}), injected as an Operator Messages section`,
		refs: [m.id],
	};
}

/** Rank of a risk level; `none` sorts below every level. */
const RISK_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };

function stepKey(run: string, step: string): string {
	return `${run}\u0000${step}`;
}

/** Pending needs_input request of a run (`x-af-needs-input` in run.json). */
export function pendingInput(run: RunJson): PendingInput | null {
	const value = run["x-af-needs-input"];
	return value && typeof value === "object" ? (value as PendingInput) : null;
}

/** Amendments waiting for the amend step (`x-af-amendments` in run.json). */
function pendingAmendments(run: RunJson): PendingAmendment[] {
	const value = run["x-af-amendments"];
	return Array.isArray(value) ? (value as PendingAmendment[]) : [];
}

/** `supervisor.needs_input_timeout` in minutes, or null when unset or invalid. */
export function needsInputTimeout(config: Record<string, unknown>): number | null {
	const supervisor = config.supervisor as Record<string, unknown> | undefined;
	const value = supervisor?.needs_input_timeout;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** `operator` decision logged for every applied amendment (contract rule). */
function amendmentDecision(a: AmendmentEntry, phase: string): DecisionEntry {
	const version = a.plan_version ? `plan version ${a.plan_version}` : "delivered as a message";
	return {
		id: `d-${a.id}`,
		at: a.at,
		phase,
		source: "operator",
		risk: "low",
		decision: `Amendment ${a.id} applied (${version}): ${a.text}`,
		rationale: `Requirement change from ${a.from ?? "user"}`,
		refs: [a.id, ...a.affects],
	};
}
