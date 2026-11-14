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
import { getVersion } from "../commands/version.js";
import { deepMerge, getDefaultConfig } from "../config.js";
import {
	type NeedsInput,
	type NeedsInputKind,
	type ResultBlock,
	type RunStatus,
	TERMINAL_RUN_STATUSES,
	validateArtifact,
} from "../contract/index.js";
import { latestPlan } from "../contract/plan.js";
import { WorkflowExecutor, shouldRemoveWorktree } from "../executor.js";
import { type Worktree, pruneOrphaned, removeWorktree, safetyCommit } from "../git/worktree.js";
import type { NotificationTransport } from "../notifications/channels.js";
import {
	Notifier,
	NotifyError,
	type NotifyInput,
	type NotifyResult,
} from "../notifications/notifier.js";
import { WorkflowParseError, WorkflowParser } from "../parser.js";
import { getGlobalRoot, resolveRunsRoot, runDatePrefix, sanitizeSlug } from "../paths.js";
import {
	STEP_STATUS,
	WORKFLOW_STATUS,
	isStepDone,
	loadProgress,
	prepareForResume,
	saveProgress,
} from "../progress.js";
import { TemplateRenderer } from "../renderer.js";
import { checkRequires } from "../requires.js";
import type {
	LiveSession,
	SessionDecision,
	SessionHost,
	SessionRequest,
} from "../runtimes/session.js";
import type { InputAnswer } from "../steps/base.js";
import type { Supervisor } from "../supervisor/server.js";
import type {
	StepDefinition,
	StepProgress,
	WorkflowDefinition,
	WorkflowProgress,
} from "../types.js";
import { resolveWorktreeEnabled } from "../worktree-settings.js";
import {
	type AskCreated,
	type AskInput,
	AskInputError,
	type AskState,
	askRequest,
	newAskId,
} from "./ask.js";
import { BacklogService } from "./backlog-service.js";
import { BacklogError, type PolicyVerdict } from "./backlog.js";
import { type DispatchPayload, validateDispatch } from "./dispatch.js";
import {
	CursorError,
	type EventPage,
	type EventQuery,
	parseTypeFilter,
	readEventPage,
} from "./events.js";
import { Inbox, type InboxMessage, type NewMessage, formatOperatorMessages } from "./inbox.js";
import {
	OverseerError,
	type OverseerFinishInput,
	type OverseerOpenResult,
	type OverseerPayload,
	isOverseerEntry,
	openOverseer,
	writeOverseerSummary,
} from "./overseer.js";
import {
	type RegistryEntry,
	type RunListFilter,
	RunRegistry,
	filterRuns,
	parseSince,
} from "./registry.js";
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
import {
	TranscriptCursorError,
	type TranscriptPage,
	TranscriptWriter,
	readStepSession,
	readTranscriptPage,
	stepDirName,
} from "./transcript.js";

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
	/** Supervisor shutdown: leave the run `running` for the next supervisor to recover. */
	shutdown?: boolean;
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
	/**
	 * Raised by a live session step that waits for the answer (session
	 * driver). Without it, the step ended with an awaiting-human result block.
	 */
	live?: boolean;
	/** Runtime session id of the live session that asked. */
	session_id?: string | null;
	/** Permission request of a live session (written before `request.kind`; still read). */
	permission?: boolean;
	/**
	 * Risk of the request: its own `risk`, else the `max_risk` of the asking
	 * step's result block, or null.
	 */
	risk?: string | null;
	/** Answer policy verdict, for a run dispatched by an overseer. */
	overseer_policy?: PolicyVerdict | null;
	/** Asked with `af_ask` from inside the step (the step keeps running). */
	ask?: boolean;
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
	/** Inbox message carrying the answer; null when it went straight to a live session. */
	message: string | null;
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

/** Longest `wait` of an event long-poll, in seconds. */
export const MAX_EVENT_WAIT_SECONDS = 120;
/** How often a long-poll re-reads the event files. */
const EVENT_POLL_MS = 200;

/** `GET /v1/events` response. */
export interface EventResponse extends EventPage {
	/** Status of the run when the query names one. */
	status?: RunStatus | null;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done, { once: true });
	});
}

/** What recovery did with an interrupted step's runtime session (`run.recovered` `sessions`). */
export interface SessionRecovery {
	step: string;
	action: "resume" | "restart";
	session_id: string | null;
	reason: string;
}

export interface LogsQuery {
	step?: string | null;
	cursor?: string | null;
	limit?: number;
	/** Cut each entry's text to this length (0: full entries). */
	maxChars?: number;
	/** Size budget of the page in bytes (0: none). */
	maxBytes?: number;
	waitSeconds?: number;
}

export interface LogsResponse extends TranscriptPage {
	run: string;
	step: string | null;
	/** The run (or step) can still write entries: keep following. */
	active: boolean;
	status: RunStatus | null;
}

export interface RunManagerOptions {
	/** af global dir (defaults to `getGlobalRoot()`). */
	root?: string;
	log?: (message: string) => void;
	/** agentic-forge version checked against a workflow's `requires` (defaults to the package version). */
	version?: string;
	/** Notifier settings: the transport (test seam) and the poll interval. */
	notifications?: { transport?: NotificationTransport; pollMs?: number };
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
			// `wait-for-human` progress written before the human-input step (0.12)
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
	/** Live session steps of executing runs (run id -> step -> handle), for `send --mode now`. */
	private readonly liveSessions = new Map<string, Map<string, LiveSession>>();
	/** Session requests waiting for `af answer` (run id -> request id -> resolver). */
	private readonly liveRequests = new Map<string, Map<string, (d: SessionDecision) => void>>();
	/**
	 * Per-run chain that serializes the needs_input transitions of live
	 * sessions (`run.json` then registry), so parallel sessions never leave
	 * the registry status behind `run.json`.
	 */
	private readonly inputLocks = new Map<string, Promise<unknown>>();
	/** `af_ask` long-polls waiting per request (run + request key). */
	private readonly askWaiters = new Map<string, number>();
	/** `af_ask` answers handed to a waiting long-poll (run + request key). */
	private readonly askAnswers = new Map<string, Extract<AskState, { status: "answered" }>>();
	/** Wake-ups of `af_ask` long-polls and of steps waiting for their questions. */
	private readonly askWake = new Map<string, Set<() => void>>();
	private scheduling = false;
	private rescheduleRequested = false;
	private closed = false;
	/** Resolves pending event long-polls when the manager closes. */
	private readonly closing = new AbortController();
	/** Identifies this supervisor process in `supervisor.restarted` events. */
	private readonly startedAt = new Date().toISOString();
	private supervisorVersion: string | null = null;
	/** agentic-forge version checked against `requires`. */
	private readonly version: string;
	/** Sends notifications for the events of every run (and `af notify`). */
	readonly notifier: Notifier;
	/** Overseer backlogs, discovered items and the answer policy. */
	readonly backlog: BacklogService;

	constructor(options: RunManagerOptions = {}) {
		this.root = options.root ?? getGlobalRoot();
		this.registry = new RunRegistry(this.root);
		this.log = options.log ?? (() => {});
		this.version = options.version ?? getVersion();
		this.backlog = new BacklogService({ registry: this.registry, log: this.log });
		this.notifier = new Notifier({
			root: this.root,
			registry: this.registry,
			globalConfig: () => this.globalConfig(),
			log: this.log,
			transport: options.notifications?.transport,
			pollMs: options.notifications?.pollMs,
		});
	}

	/** Runs that are executing or waiting in the queue (an open overseer run executes nothing). */
	activeCount(): number {
		return this.registry
			.list()
			.filter(
				(r) =>
					!isOverseerEntry(r) &&
					(r.status === "running" || r.status === "queued" || this.executing.has(r.id)),
			).length;
	}

	/** Registers the `/v1/runs` routes, the active-run count and the shutdown hook on a supervisor. */
	attach(supervisor: Supervisor): void {
		supervisor.activeRuns = () => this.activeCount();
		supervisor.onStop(() => this.shutdown());
		this.supervisorVersion = supervisor.version;
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
					since: query.get("since") ?? undefined,
					parent: query.get("parent") ?? undefined,
				}),
			}))(),
		);
		supervisor.route("GET", "/v1/events", ({ query }) =>
			wrap(() =>
				this.events({
					cursor: query.get("cursor"),
					run: query.get("run"),
					types: parseTypeFilter(query.get("types")),
					limit: Number.parseInt(query.get("limit") ?? "", 10) || undefined,
					fromNow: query.get("from") === "now",
					waitSeconds: Number.parseFloat(query.get("wait") ?? "0") || 0,
				}),
			)(),
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
		supervisor.route("GET", "/v1/runs/:id/logs", ({ params, query }) =>
			wrap(() =>
				this.logs(params.id, {
					step: query.get("step"),
					cursor: query.get("cursor"),
					limit: Number.parseInt(query.get("limit") ?? "", 10) || undefined,
					maxChars: Number.parseInt(query.get("max_chars") ?? "", 10) || 0,
					maxBytes: Number.parseInt(query.get("max_bytes") ?? "", 10) || 0,
					waitSeconds: Number.parseFloat(query.get("wait") ?? "0") || 0,
				}),
			)(),
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
		supervisor.route("POST", "/v1/runs/:id/ask", ({ params, body }) =>
			wrap(() => this.ask(params.id, (body ?? {}) as AskInput), 201)(),
		);
		supervisor.route("GET", "/v1/runs/:id/ask/:request", ({ params, query }) =>
			wrap(() =>
				this.askState(params.id, params.request, Number.parseFloat(query.get("wait") ?? "0") || 0),
			)(),
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
		supervisor.route("POST", "/v1/notifications", ({ body }) =>
			wrap(() => this.notify((body ?? {}) as NotifyInput))(),
		);
		supervisor.route("POST", "/v1/overseer", ({ body }) =>
			wrap(() => this.openOverseer((body ?? {}) as OverseerPayload), 201)(),
		);
		supervisor.route("POST", "/v1/overseer/:id/finish", ({ params, body }) =>
			wrap(() => this.finishOverseer(params.id, (body ?? {}) as OverseerFinishInput))(),
		);
		supervisor.route("GET", "/v1/overseer/:id/backlog", ({ params, query }) =>
			wrap(() =>
				this.backlogCall(() =>
					this.backlog.list(
						params.id,
						(query.get("status") ?? "")
							.split(",")
							.map((v) => v.trim())
							.filter(Boolean),
					),
				),
			)(),
		);
		supervisor.route("POST", "/v1/overseer/:id/backlog", ({ params, body }) =>
			wrap(
				() =>
					this.backlogCall(() =>
						this.backlog.add(params.id, (body as { items?: unknown } | null)?.items),
					),
				201,
			)(),
		);
		supervisor.route("POST", "/v1/overseer/:id/backlog/:item", ({ params, body }) =>
			wrap(() =>
				this.backlogCall(() =>
					this.backlog.update(
						params.id,
						params.item,
						(body as { fields?: unknown } | null)?.fields,
					),
				),
			)(),
		);
	}

	/**
	 * `af overseer`: creates an overseer run, reuses the open one of the
	 * repository, or reopens one (`resume`). The supervisor records it and
	 * never executes it.
	 */
	async openOverseer(payload: OverseerPayload): Promise<OverseerOpenResult> {
		if (this.closed) throw new RunError("Supervisor is shutting down", 503);
		try {
			return await openOverseer(
				{
					registry: this.registry,
					log: this.log,
					allocateRunDir: (root, slug) => this.allocateRunDir(root, slug),
				},
				payload,
			);
		} catch (err) {
			if (err instanceof OverseerError) throw new RunError(err.message, err.status);
			throw err;
		}
	}

	/**
	 * Answer policy verdict of the overseer that dispatched a run, with its
	 * current config, or null when the run has no overseer parent.
	 */
	private overseerVerdict(entry: RegistryEntry, pending: PendingInput): PolicyVerdict | null {
		return this.backlog.policyFor(entry.dir, pending.request, {
			risk: pending.risk ?? null,
			kind: pendingKind(pending),
		});
	}

	/** Runs a backlog operation; its errors become `RunError`s with their status. */
	private async backlogCall<T>(fn: () => Promise<T>): Promise<T> {
		try {
			return await fn();
		} catch (err) {
			if (err instanceof BacklogError) throw new RunError(err.message, err.status);
			throw err;
		}
	}

	/** `af overseer --finish`: writes summary.md and ends the overseer run (`run.completed` for done). */
	async finishOverseer(
		id: string,
		input: OverseerFinishInput,
	): Promise<{ id: string; status: RunStatus; summary: string }> {
		const entry = this.requireEntry(id);
		let result: { status: RunStatus; summary: string };
		try {
			result = writeOverseerSummary(entry, input);
		} catch (err) {
			if (err instanceof OverseerError) throw new RunError(err.message, err.status);
			throw err;
		}
		await this.setStatus(entry, result.status, { type: "overseer", summary: "summary.md" });
		this.log(`Overseer run finished: ${id} (${result.status})`);
		return { id, status: result.status, summary: result.summary };
	}

	/** Recovers interrupted runs, then starts the queue. Call once at startup. */
	async start(): Promise<void> {
		await this.recover();
		this.armInputTimers();
		this.notifier.start();
		this.schedule();
	}

	/** `af notify` / `af_notify`: sends a message to the enabled channels (of the run's config, or the global one). */
	async notify(input: NotifyInput): Promise<NotifyResult> {
		try {
			return await this.notifier.notify(input);
		} catch (err) {
			if (err instanceof NotifyError) throw new RunError(err.message, err.status);
			throw err;
		}
	}

	/** Stops scheduling new runs. Executing runs are not interrupted. */
	close(): void {
		this.closed = true;
		this.closing.abort();
		for (const id of [...this.timers.keys()]) this.clearTimer(id);
		void this.notifier.stop();
	}

	/**
	 * Supervisor shutdown: stops scheduling, kills the process tree of every
	 * executing run and waits for the executions to end. The runs stay
	 * `running` on disk, so the next supervisor recovers them (interrupted
	 * step rerun) instead of a second supervisor executing them concurrently.
	 */
	async shutdown(): Promise<void> {
		this.close();
		for (const id of this.executing.keys()) {
			this.stopRequests.set(id, { status: "paused", now: true, shutdown: true });
			this.controllers.get(id)?.abort();
		}
		await this.idle();
	}

	/** Resolves when no run is executing (tests). */
	async idle(): Promise<void> {
		while (this.executing.size > 0 || this.scheduling) {
			await Promise.all([...this.executing.values()]);
			await new Promise((resolve) => setImmediate(resolve));
		}
	}

	list(filter: RunListFilter = {}): RegistryEntry[] {
		let since: number | null;
		try {
			since = parseSince(filter.since);
		} catch (err) {
			throw new RunError((err as Error).message);
		}
		return filterRuns(this.registry.list(), { ...filter, since });
	}

	/**
	 * Events after a cursor across runs (or one run), filtered by type. With
	 * `waitSeconds`, waits up to that long (max 120 s) for a first event:
	 * the long-poll behind `af events --follow` and `af_events`.
	 */
	async events(query: EventQuery & { waitSeconds?: number }): Promise<EventResponse> {
		if (query.run) this.requireEntry(query.run);
		const waitMs = Math.min(Math.max(query.waitSeconds ?? 0, 0), MAX_EVENT_WAIT_SECONDS) * 1000;
		const deadline = Date.now() + waitMs;
		let page: EventPage;
		let current = query;
		for (;;) {
			try {
				page = readEventPage(this.registry.list(), current);
			} catch (err) {
				if (err instanceof CursorError) throw new RunError(err.message);
				throw err;
			}
			if (page.events.length > 0 || Date.now() >= deadline || this.closing.signal.aborted) break;
			// Keep the positions reached (a `from: now` read pins the start)
			current = { ...query, cursor: page.cursor, fromNow: false };
			await abortableDelay(EVENT_POLL_MS, this.closing.signal);
		}
		const response: EventResponse = { ...page };
		if (query.run) response.status = this.registry.get(query.run)?.status ?? null;
		return response;
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

	/**
	 * A page of a run's live transcripts (all steps, or one), behind `af logs`
	 * and `af_logs`. With `waitSeconds`, waits up to that long (max 120 s) for
	 * a new entry while the run (or the step) is still active. `active` is
	 * false once the step ended (or, without a step, the run stopped
	 * executing): a follower stops when it is false and `more` is false.
	 */
	async logs(id: string, query: LogsQuery): Promise<LogsResponse> {
		const entry = this.requireEntry(id);
		const step = query.step || null;
		const names = this.stepNames(entry);
		if (step && names && !names.includes(step)) {
			throw new RunError(`Unknown step '${step}'. Steps: ${names.join(", ")}`, 404);
		}
		const stepDir = step ? stepDirName(names ?? [], step) : null;
		const waitMs = Math.min(Math.max(query.waitSeconds ?? 0, 0), MAX_EVENT_WAIT_SECONDS) * 1000;
		const deadline = Date.now() + waitMs;
		let cursor = query.cursor ?? null;
		let page: TranscriptPage;
		let active: boolean;
		for (;;) {
			try {
				page = readTranscriptPage(entry.dir, { ...query, stepDir, cursor });
			} catch (err) {
				if (err instanceof TranscriptCursorError) throw new RunError(err.message);
				throw err;
			}
			active = this.isActive(entry, step);
			if (page.entries.length > 0 || !active || Date.now() >= deadline) break;
			if (this.closing.signal.aborted) break;
			// A tail read pins the position: wait for what comes after it
			cursor = page.cursor;
			await abortableDelay(EVENT_POLL_MS, this.closing.signal);
		}
		return {
			run: id,
			step,
			...page,
			active,
			status: this.registry.get(id)?.status ?? entry.status,
		};
	}

	/**
	 * A run is active while it executes (a live session waiting for an answer
	 * included). A step is active while the run is and the step has not
	 * ended: not started yet, or started with no later step.completed or
	 * step.failed.
	 */
	private isActive(entry: RegistryEntry, step: string | null): boolean {
		if (!this.executing.has(entry.id)) return false;
		if (!step) return true;
		// Only top-level steps emit step events: a nested step follows its top-level ancestor
		const top = this.topLevelStep(entry, step) ?? step;
		const events = new RunStore(entry.dir).readEvents();
		let started = -1;
		let ended = -1;
		events.forEach((e, i) => {
			if (e.data?.step !== top) return;
			if (e.type === "step.started") started = i;
			if (e.type === "step.completed" || e.type === "step.failed") ended = i;
		});
		return started === -1 || ended < started;
	}

	private requireEntry(id: string): RegistryEntry {
		const entry = this.registry.get(id);
		if (!entry) throw new RunError(`Run not found: ${id}`, 404);
		return entry;
	}

	/** requireEntry() for the control operations an overseer run does not take (it is never executed). */
	private requireWorkflowRun(id: string, action: string): RegistryEntry {
		const entry = this.requireEntry(id);
		if (isOverseerEntry(entry)) {
			throw new RunError(
				`Cannot ${action} an overseer run: talk to the overseer in its session (af overseer --resume ${id}), or end it with af overseer --finish ${id}`,
				409,
			);
		}
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
		const parent = payload.parent ?? null;
		if (parent && !this.registry.get(parent)) {
			throw new RunError(`Parent run not found: ${parent}`);
		}
		const item = payload.item ?? null;
		if (item) {
			if (!parent) {
				throw new RunError("item needs parent: the overseer run whose backlog holds the item");
			}
			// Under the backlog lock: refused unless the scheduler allows the item now
			return this.backlogCall(() =>
				this.backlog.dispatchItem(parent, item, () => this.queueRun(payload, parent)),
			);
		}
		return this.queueRun(payload, parent);
	}

	/** Creates the queued run of a validated dispatch payload. */
	private async queueRun(payload: DispatchPayload, parent: string | null): Promise<DispatchResult> {
		const workflow = this.parseWorkflow(payload);
		// Refused before the run exists, so no step ever runs.
		const requires = checkRequires(workflow.name, workflow.requires, {
			version: this.version,
			ignoreRequires: payload.ignore_requires === true,
		});
		if (requires.errors.length > 0) throw new RunError(requires.errors.join("\n"));

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

		const warnings: string[] = [...requires.warnings];
		for (const warning of requires.warnings) this.log(`Warning: ${warning}`);
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
			parent,
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
			...(parent ? { parent } : {}),
			...(payload.item ? { item: payload.item } : {}),
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
		const entry = this.requireWorkflowRun(id, "pause");
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
	async send(
		id: string,
		input: NewMessage,
	): Promise<{ id: string; message: InboxMessage; steered: boolean }> {
		const entry = this.requireWorkflowRun(id, "send a message to");
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
		let steered = false;
		if (mode === "now" && this.executing.has(id)) {
			steered = await this.steerLive(id, store, message);
			if (!steered) this.interruptFor(id, message.id);
		}
		return { id, message, steered };
	}

	/**
	 * `send --mode now` to a step on the session driver: delivers the message
	 * into the live session (it reaches the agent at the next tool call), with
	 * no abort and no restart. Returns false when no live session takes it.
	 */
	private async steerLive(id: string, store: RunStore, message: InboxMessage): Promise<boolean> {
		const sessions = this.liveSessions.get(id);
		if (!sessions || sessions.size === 0) return false;
		const target = message.step
			? sessions.has(message.step)
				? message.step
				: null
			: [...sessions.keys()][0];
		const handle = target ? sessions.get(target) : undefined;
		if (!target || !handle) return false;
		const inbox = new Inbox(store.dir);
		if (!inbox.pending(target).some((m) => m.id === message.id)) return false;
		// Marked delivered only once the session took it (a closing session refuses it)
		if (!handle.steer(formatOperatorMessages([message]))) return false;
		const [delivered] = inbox.markDelivered([message.id], target);
		// Already delivered by a concurrent turn boundary: the session has it either way
		if (!delivered) return true;
		await store.appendEvent("message.delivered", { id: delivered.id, step: target, live: true });
		await store.appendDecision(messageDecision(delivered, target));
		this.log(`Run ${id}: steered the live session of ${target} (send now)`);
		return true;
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

	/** `steps/<NN-step>/` of a step (result block, transcript, session). */
	private stepDir(entry: RegistryEntry, step: string): string {
		return path.join(entry.dir, "steps", stepDirName(this.stepNames(entry) ?? [], step));
	}

	/** Every step name of a run's workflow, nested steps included (null if unreadable). */
	private stepNames(entry: RegistryEntry): string[] | null {
		const tree = this.stepTree(entry);
		return tree ? tree.map((s) => s.name) : null;
	}

	/** Top-level step that contains `step` (itself when top-level; null if unknown). */
	private topLevelStep(entry: RegistryEntry, step: string): string | null {
		return this.stepTree(entry)?.find((s) => s.name === step)?.top ?? null;
	}

	/** Every step of a run's workflow with its top-level ancestor (null if unreadable). */
	private stepTree(entry: RegistryEntry): { name: string; top: string }[] | null {
		try {
			const workflow = this.parseWorkflow(
				new RunStore(entry.dir).readJson<DispatchPayload>("dispatch.json"),
			);
			const steps: { name: string; top: string }[] = [];
			const walk = (list: StepDefinition[] | undefined, top: string | null) => {
				for (const s of list ?? []) {
					const root = top ?? s.name;
					steps.push({ name: s.name, top: root });
					walk(s.steps, root);
					walk(s.thenSteps, root);
					walk(s.elseSteps, root);
				}
			};
			walk(workflow.steps, null);
			return steps;
		} catch {
			return null;
		}
	}

	/**
	 * `safetyCommit` of the run's worktree before an interrupted step restarts
	 * (`send --mode now`), so the work of the killed attempt survives even when
	 * the session cannot resume. Never commits in the user's own checkout.
	 */
	private checkpointWorktree(store: RunStore, step: string | null): void {
		const worktree = store.readRun().worktree;
		if (!worktree || !existsSync(path.join(worktree, ".git"))) return;
		const commit = safetyCommit(
			worktree,
			undefined,
			`chore: auto-save work of ${step ?? "the step"} before it restarts`,
		);
		if (commit.committed)
			this.log(
				`Run ${store.id}: safety commit in ${worktree} before restarting ${step ?? "the step"}`,
			);
		if (commit.failed)
			this.log(`Run ${store.id}: safety commit failed in ${worktree}: ${commit.error}`);
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

	/**
	 * Delivers the pending messages of `step` (only the `only` ids when given):
	 * files first, then events and decisions.
	 */
	private async deliverMessages(
		store: RunStore,
		step: string,
		only: string[] | null = null,
	): Promise<string> {
		const inbox = new Inbox(store.dir);
		const pending = inbox.pending(step).filter((m) => only === null || only.includes(m.id));
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
		const entry = this.requireWorkflowRun(id, "answer");
		if (entry.status !== "awaiting-human") {
			throw new RunError(`Cannot answer a run in '${entry.status}' status`, 409);
		}
		const store = new RunStore(entry.dir);
		const list = pendingInputs(store.readRun());
		if (list.length === 0) throw new RunError("Run has no pending needs_input request", 409);
		const ids = list.map((p) => p.request.id).join(", ");
		let pending: PendingInput | undefined;
		if (input.request_id) {
			pending = list.find((p) => p.request.id === input.request_id);
			if (!pending) {
				throw new RunError(`Unknown request '${input.request_id}'. Pending: ${ids}`, 404);
			}
		} else if (list.length > 1) {
			throw new RunError(`Several requests are pending (${ids}): give a request id`);
		} else {
			pending = list[0];
		}
		const request = pending.request;
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
		// The overseer answers a child run's question itself only within its answer policy
		const verdict = from === "overseer" && !policy ? this.overseerVerdict(entry, pending) : null;
		if (verdict && !verdict.within) {
			throw new RunError(
				`Outside the overseer answer_policy (${verdict.reason}): ask the user, then answer with from: user`,
				409,
			);
		}
		if (verdict?.answer && option?.id !== verdict.answer) {
			throw new RunError(
				`The overseer answer_policy only allows the recommended option ${verdict.answer}: ask the user for any other answer, then answer with from: user`,
				409,
			);
		}
		const answer = option ? `${option.id} (${option.label})` : raw;
		if (pending.ask && this.executing.has(id)) {
			return this.answerAsk(entry, store, pending, {
				raw,
				option: option?.id ?? null,
				answer,
				from,
				source: policy ? "policy" : verdict ? "overseer-policy" : "operator",
				verdictReason: verdict?.reason ?? null,
			});
		}
		const resolve = pending.live ? this.liveRequests.get(id)?.get(request.id) : undefined;
		if (resolve) {
			return this.answerLive(entry, store, pending, resolve, {
				raw,
				option: option?.id ?? null,
				answer,
				from: policy ? "policy" : from,
			});
		}
		// A live request whose session is gone (supervisor restart) falls back to a rerun
		const message = new Inbox(entry.dir).queue({
			text: `Answer to ${request.id} ("${request.question}"): ${answer}`,
			from,
			mode: "next",
			step: pending.step,
		});
		// Only the answered request is removed: the run keeps waiting until every
		// other recovered request has its answer too
		const left = await this.withInputLock(id, async () => {
			const run = await store.updateRunWith((current) => {
				const remaining = pendingInputs(current).filter((p) => p.request.id !== request.id);
				return { "x-af-needs-input": remaining.length > 0 ? remaining : null };
			});
			return pendingInputs(run).length;
		});
		this.clearTimer(id, request.id);
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
			source: policy || verdict ? "policy" : "operator",
			risk: "low",
			decision: `Answered ${request.id} (${request.question}): ${answer}`,
			rationale: policy
				? "No answer within the needs_input timeout; applied the recommended option of a non-blocking request"
				: verdict
					? `Answered by the overseer within its answer_policy: ${verdict.reason}`
					: `Answer from ${from}`,
			alternatives: request.options.filter((o) => o.id !== option?.id).map((o) => o.label),
			refs: [request.id, message.id],
		});
		if (left > 0) {
			return { id, request: request.id, message: message.id, status: "awaiting-human" };
		}
		await this.resume(id);
		return { id, request: request.id, message: message.id, status: "queued" };
	}

	/**
	 * `af_ask`: raises a `needs_input` from inside a running step. The run is
	 * `awaiting-human` while the question is open; the step keeps running.
	 * The asking tool waits with `askState()`; an answer given while no
	 * long-poll waits goes to the step as an operator message, delivered at
	 * its next turn (session driver) or when it runs again (`cli` driver).
	 */
	async ask(id: string, input: AskInput): Promise<AskCreated & Partial<AskState>> {
		const entry = this.requireWorkflowRun(id, "ask in");
		const status = this.registry.get(id)?.status ?? entry.status;
		if (!this.executing.has(id) || (status !== "running" && status !== "awaiting-human")) {
			throw new RunError(
				`af_ask needs a running step: run ${id} is '${status}'. End the step with a needs_input result block instead`,
				409,
			);
		}
		const step = this.askStep(entry, input.step);
		let request: NeedsInput;
		try {
			request = askRequest(newAskId(), input);
		} catch (err) {
			if (err instanceof AskInputError) throw new RunError(err.message);
			throw err;
		}
		const store = new RunStore(entry.dir);
		const pending: PendingInput = {
			...newPendingInput(step, request, this.dispatchConfig(store), null),
			ask: true,
		};
		pending.overseer_policy = this.backlog.policyFor(entry.dir, request, {
			risk: pending.risk ?? null,
			kind: pendingKind(pending),
		});
		await this.withInputLock(id, async () => {
			const run = await store.updateRunWith((current) => ({
				status: "awaiting-human",
				"x-af-needs-input": [...pendingInputs(current), pending],
			}));
			await this.registry.update(id, { status: run.status });
		});
		const session = this.liveSessions.get(id)?.has(step) === true;
		// With `wait`, the call waits from before the question is visible, so an
		// answer can never arrive between the ask and the first long-poll
		const wait = typeof input.wait === "number" && input.wait > 0 ? input.wait : 0;
		const key = stepKey(id, request.id);
		if (wait > 0) this.askWaiters.set(key, (this.askWaiters.get(key) ?? 0) + 1);
		await store.appendEvent("needs_input", {
			...request,
			risk: pending.risk ?? null,
			step,
			deadline: pending.deadline,
			via: "af_ask",
			live: session,
			...(pending.overseer_policy ? { overseer_policy: pending.overseer_policy } : {}),
		});
		if (pending.deadline) this.armTimer(id, pending);
		this.log(`Run ${id}: ${step} asks ${request.id} (af_ask)`);
		const created = { run: id, request_id: request.id, step, session };
		if (wait === 0) return created;
		return { ...created, ...(await this.askState(id, request.id, wait, true)) };
	}

	/**
	 * State of an `af_ask` request, waiting up to `waitSeconds` (max 120) for
	 * its answer. An answer that arrives while this call waits is handed to
	 * it and not queued as an operator message.
	 */
	async askState(
		id: string,
		requestId: string,
		waitSeconds = 0,
		registered = false,
	): Promise<AskState> {
		const entry = this.requireWorkflowRun(id, "ask in");
		const store = new RunStore(entry.dir);
		const key = stepKey(id, requestId);
		const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), 120) * 1000;
		const asked = store
			.readEvents()
			.some((e) => e.type === "needs_input" && e.data?.id === requestId);
		if (!asked) throw new RunError(`Unknown request '${requestId}'`, 404);
		if (!registered) this.askWaiters.set(key, (this.askWaiters.get(key) ?? 0) + 1);
		let left = false;
		const leave = () => {
			if (left) return;
			left = true;
			const count = (this.askWaiters.get(key) ?? 1) - 1;
			if (count > 0) this.askWaiters.set(key, count);
			else this.askWaiters.delete(key);
		};
		const handed = (): AskState | null => {
			const answer = this.askAnswers.get(key);
			if (answer) this.askAnswers.delete(key);
			return answer ?? null;
		};
		try {
			for (;;) {
				const own = handed();
				if (own) return own;
				const answered = answerOf(store, requestId);
				if (answered) {
					// Answered while no long-poll waited: the agent gets it here, so its
					// operator message is consumed instead of delivered again next turn
					const step = answeredStep(store, requestId);
					if (answered.message && step) {
						await this.deliverMessages(store, step, [answered.message]);
					}
					return {
						status: "answered",
						run: id,
						request_id: requestId,
						answer: answered.answer,
						option: answered.option,
						from: answered.from,
					};
				}
				const pending = pendingInputs(store.readRun()).find((p) => p.request.id === requestId);
				if (!pending) {
					const now = this.registry.get(id)?.status ?? "unknown";
					return {
						status: "withdrawn",
						run: id,
						request_id: requestId,
						reason: `the request was dropped without an answer (run ${now})`,
					};
				}
				const now = Date.now();
				if (now >= deadline || this.closing.signal.aborted) {
					leave();
					// An answer handed over in the same tick is still ours
					return (
						handed() ?? {
							status: "pending",
							run: id,
							request_id: requestId,
							session: this.liveSessions.get(id)?.has(pending.step) === true,
						}
					);
				}
				await this.waitAsk(key, Math.min(deadline - now, 1000));
			}
		} finally {
			leave();
		}
	}

	/** Step an `af_ask` comes from: the given one, the only live session step, else the current step. */
	private askStep(entry: RegistryEntry, given: string | null | undefined): string {
		if (typeof given === "string" && given.trim()) return given.trim();
		const live = [...(this.liveSessions.get(entry.id)?.keys() ?? [])];
		if (live.length === 1) return live[0];
		const current = loadProgress(entry.id, entry.dir)?.currentStep?.name ?? null;
		if (live.length === 0 && current) return current;
		throw new RunError(
			live.length > 1
				? `Several steps are running (${live.join(", ")}): give the asking step`
				: "No running step found: give the asking step",
		);
	}

	/** The dispatch config snapshot of a run (empty when unreadable). */
	private dispatchConfig(store: RunStore): Record<string, unknown> {
		try {
			const payload = JSON.parse(readFileSync(path.join(store.dir, "dispatch.json"), "utf-8")) as {
				config?: Record<string, unknown>;
			};
			return payload.config ?? {};
		} catch {
			return {};
		}
	}

	/** Waits until `key` is woken or `ms` passed. */
	private waitAsk(key: string, ms: number): Promise<void> {
		return new Promise((resolve) => {
			const set = this.askWake.get(key) ?? new Set<() => void>();
			this.askWake.set(key, set);
			const done = () => {
				clearTimeout(timer);
				set.delete(done);
				if (set.size === 0 && this.askWake.get(key) === set) this.askWake.delete(key);
				resolve();
			};
			const timer = setTimeout(done, Math.max(0, ms));
			timer.unref?.();
			set.add(done);
		});
	}

	private wakeAsk(key: string): void {
		for (const done of [...(this.askWake.get(key) ?? [])]) done();
	}

	/**
	 * Before a session step's next turn: waits while the step has open
	 * `af_ask` questions (the agent ended its turn on `pending`), so the
	 * session stays open and the answer is its next turn. Ends when the run
	 * stops.
	 */
	private async waitForAsks(entry: RegistryEntry, store: RunStore, step: string): Promise<void> {
		const signal = this.controllers.get(entry.id)?.signal;
		const key = stepKey(entry.id, `step:${step}`);
		while (!signal?.aborted && !this.closing.signal.aborted) {
			const open = pendingInputs(store.readRun()).some((p) => p.ask && p.step === step);
			if (!open) return;
			await this.waitAsk(key, 1000);
		}
	}

	/**
	 * Answers an `af_ask` request of an executing run: hands the answer to a
	 * waiting long-poll, else queues it as an operator message for the step.
	 * The run is `running` again once no request is left.
	 */
	private async answerAsk(
		entry: RegistryEntry,
		store: RunStore,
		pending: PendingInput,
		a: {
			raw: string;
			option: string | null;
			answer: string;
			from: "user" | "overseer";
			source: "policy" | "overseer-policy" | "operator";
			verdictReason: string | null;
		},
	): Promise<AnswerResult> {
		const request = pending.request;
		const key = stepKey(entry.id, request.id);
		const from = a.source === "policy" ? "policy" : a.from;
		// Decided in one tick with the long-poll's own check, so the answer is never lost
		const toTool = (this.askWaiters.get(key) ?? 0) > 0;
		if (toTool) {
			this.askAnswers.set(key, {
				status: "answered",
				run: entry.id,
				request_id: request.id,
				answer: a.option ?? a.raw,
				option: a.option,
				from,
			});
		}
		const message = toTool
			? null
			: new Inbox(entry.dir).queue({
					text: `Answer to ${request.id} ("${request.question}"): ${a.answer}`,
					from: a.from,
					mode: "next",
					step: pending.step,
				});
		this.clearTimer(entry.id, request.id);
		const resumed = await this.withInputLock(entry.id, async () => {
			const run = await store.updateRunWith((current) => {
				const remaining = pendingInputs(current).filter((p) => p.request.id !== request.id);
				const running = remaining.length === 0 && current.status === "awaiting-human";
				return {
					"x-af-needs-input": remaining.length > 0 ? remaining : null,
					...(running ? { status: "running" as RunStatus } : {}),
				};
			});
			await this.registry.update(entry.id, { status: run.status });
			return run.status === "running";
		});
		if (message) await store.appendEvent("message.queued", messageEventData(message));
		await store.appendEvent("input.answered", {
			id: request.id,
			step: pending.step,
			answer: a.option ?? a.raw,
			option: a.option,
			from,
			message: message?.id ?? null,
			via: "af_ask",
		});
		const rationale =
			a.source === "policy"
				? "No answer within the needs_input timeout; applied the recommended option of a non-blocking request"
				: a.source === "overseer-policy"
					? `Answered by the overseer within its answer_policy: ${a.verdictReason}`
					: `Answer from ${a.from}, ${toTool ? "returned to the waiting af_ask call" : "queued for the asking step"}`;
		await store.appendDecision({
			id: `d-${request.id}`,
			at: new Date().toISOString(),
			phase: pending.step,
			source: a.source === "operator" ? "operator" : "policy",
			risk: "low",
			decision: `Answered ${request.id} (${request.question}): ${a.answer}`,
			rationale,
			alternatives: request.options.filter((o) => o.id !== a.option).map((o) => o.label),
			refs: message ? [request.id, message.id] : [request.id],
		});
		if (resumed) await store.appendEvent("run.resumed", { reason: "answered" });
		this.wakeAsk(key);
		this.wakeAsk(stepKey(entry.id, `step:${pending.step}`));
		return {
			id: entry.id,
			request: request.id,
			message: message?.id ?? null,
			status: resumed ? "running" : "awaiting-human",
		};
	}

	/**
	 * Answers a request of a live session: the answer goes straight to the
	 * waiting session (as the tool result), with the same `input.answered`
	 * event and decision as a rerun answer. The run is `running` again once
	 * no request is left.
	 */
	private async answerLive(
		entry: RegistryEntry,
		store: RunStore,
		pending: PendingInput,
		resolve: (d: SessionDecision) => void,
		a: { raw: string; option: string | null; answer: string; from: string },
	): Promise<AnswerResult> {
		const request = pending.request;
		this.liveRequests.get(entry.id)?.delete(request.id);
		this.clearTimer(entry.id, request.id);
		const resumed = await this.withInputLock(entry.id, async () => {
			const run = await store.updateRunWith((current) => {
				const remaining = pendingInputs(current).filter((p) => p.request.id !== request.id);
				return {
					"x-af-needs-input": remaining.length > 0 ? remaining : null,
					...(remaining.length === 0 ? { status: "running" as RunStatus } : {}),
				};
			});
			await this.registry.update(entry.id, { status: run.status });
			return run.status === "running";
		});
		await store.appendEvent("input.answered", {
			id: request.id,
			step: pending.step,
			answer: a.option ?? a.raw,
			option: a.option,
			from: a.from,
			message: null,
			live: true,
		});
		await store.appendDecision({
			id: `d-${request.id}`,
			at: new Date().toISOString(),
			phase: pending.step,
			source: a.from === "policy" ? "policy" : "operator",
			risk: "low",
			decision: `Answered ${request.id} (${request.question}): ${a.answer}`,
			rationale:
				a.from === "policy"
					? "No answer within the needs_input timeout; applied the recommended option of a non-blocking request"
					: `Answer from ${a.from}, delivered to the live session`,
			alternatives: request.options.filter((o) => o.id !== a.option).map((o) => o.label),
			refs: [request.id],
		});
		if (resumed) await store.appendEvent("run.resumed", { reason: "answered" });
		resolve({ option: a.option, text: a.raw });
		return {
			id: entry.id,
			request: request.id,
			message: null,
			status: resumed ? "running" : "awaiting-human",
		};
	}

	/**
	 * Supervisor side of a session step: requests become `needs_input` while
	 * the session waits alive, and the live session is registered for
	 * `send --mode now`.
	 */
	private sessionHost(
		entry: RegistryEntry,
		store: RunStore,
		config: Record<string, unknown>,
		step: string,
	): SessionHost {
		const transcript = new TranscriptWriter(this.stepDir(entry, step), step);
		return {
			onEvent: (event) => {
				// A request resolved by the session itself (aborted tool call), not by af answer
				if (event.type === "request.resolved" && this.liveRequests.get(entry.id)?.has(event.id)) {
					void this.endLiveRequests(entry, store, step, [event.id]);
				}
				try {
					transcript.write(event);
				} catch (err) {
					this.log(
						`Run ${entry.id}: transcript write failed for ${step}: ${(err as Error).message}`,
					);
				}
			},
			requestInput: (request, sessionId) =>
				this.requestLive(entry, store, config, step, request, sessionId),
			// Open af_ask questions keep the session open: their answers are its next turn
			nextMessages: async () => {
				await this.waitForAsks(entry, store, step);
				return this.deliverMessages(store, step);
			},
			onLive: (handle) => {
				const sessions = this.liveSessions.get(entry.id) ?? new Map<string, LiveSession>();
				sessions.set(step, handle);
				this.liveSessions.set(entry.id, sessions);
				return () => {
					if (sessions.get(step) === handle) sessions.delete(step);
					// The session ended: requests it left unanswered are gone with it
					void this.endLiveRequests(entry, store, step, null);
				};
			},
		};
	}

	/** Runs `fn` after the previous needs_input transition of the run settled. */
	private withInputLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
		const previous = this.inputLocks.get(id) ?? Promise.resolve();
		const next = previous.then(fn, fn);
		const settled = next.catch(() => undefined);
		this.inputLocks.set(id, settled);
		void settled.then(() => {
			if (this.inputLocks.get(id) === settled) this.inputLocks.delete(id);
		});
		return next;
	}

	/**
	 * Removes the live requests of `step` that its session resolved itself
	 * (`ids`: an aborted tool call) or left behind when it ended (`ids`
	 * null). The run is `running` again once no request is left. Skipped
	 * while a pause, cancel, restart or shutdown stops the run: the end of
	 * `execute()` (or the next supervisor) handles those requests.
	 */
	private async endLiveRequests(
		entry: RegistryEntry,
		store: RunStore,
		step: string,
		ids: string[] | null,
	): Promise<void> {
		if (this.stopRequests.has(entry.id) || !this.executing.has(entry.id)) return;
		try {
			await this.withInputLock(entry.id, async () => {
				if (this.stopRequests.has(entry.id)) return;
				const gone = (p: PendingInput) =>
					p.live === true && p.step === step && (ids === null || ids.includes(p.request.id));
				const current = pendingInputs(store.readRun());
				const dropped = current.filter(gone);
				if (dropped.length === 0) return;
				for (const p of dropped) {
					this.liveRequests.get(entry.id)?.delete(p.request.id);
					this.clearTimer(entry.id, p.request.id);
				}
				let resumed = false;
				const run = await store.updateRunWith((now) => {
					const remaining = pendingInputs(now).filter((p) => !gone(p));
					resumed = remaining.length === 0 && now.status === "awaiting-human";
					return {
						"x-af-needs-input": remaining.length > 0 ? remaining : null,
						...(resumed ? { status: "running" as RunStatus } : {}),
					};
				});
				await this.registry.update(entry.id, { status: run.status });
				const reason = ids === null ? "session ended" : "request withdrawn by the session";
				if (resumed) {
					await store.appendEvent("run.resumed", {
						reason: "requests withdrawn",
						step,
						requests: dropped.map((p) => p.request.id),
						detail: reason,
					});
				}
				this.log(
					`Run ${entry.id}: dropped ${dropped.length} unanswered request(s) of ${step} (${reason})`,
				);
			});
		} catch (err) {
			this.log(
				`Run ${entry.id}: could not drop the requests of ${step}: ${(err as Error).message}`,
			);
		}
	}

	/**
	 * Raises a `needs_input` for a live session request: appends it to
	 * `x-af-needs-input`, sets the run `awaiting-human` (the step process
	 * stays alive and keeps its worktree), emits `needs_input`, and resolves
	 * with the answer from `af answer`.
	 */
	private async requestLive(
		entry: RegistryEntry,
		store: RunStore,
		config: Record<string, unknown>,
		step: string,
		request: SessionRequest,
		sessionId: string | null,
	): Promise<SessionDecision> {
		const needs: NeedsInput = {
			id: request.id,
			question: request.question,
			options: request.options.map((o) =>
				o.description
					? { id: o.id, label: o.label, description: o.description }
					: { id: o.id, label: o.label },
			),
			recommended: request.recommended,
			context: request.context,
			blocking: true,
			kind: request.kind,
		};
		const pending: PendingInput = {
			...newPendingInput(step, needs, config, null),
			live: true,
			session_id: sessionId,
			overseer_policy: this.backlog.policyFor(entry.dir, needs, { risk: null, kind: request.kind }),
		};
		const requests =
			this.liveRequests.get(entry.id) ?? new Map<string, (d: SessionDecision) => void>();
		this.liveRequests.set(entry.id, requests);
		const decision = new Promise<SessionDecision>((resolve) => requests.set(request.id, resolve));
		await this.withInputLock(entry.id, async () => {
			const run = await store.updateRunWith((current) => ({
				status: "awaiting-human",
				"x-af-needs-input": [...pendingInputs(current), pending],
			}));
			await this.registry.update(entry.id, { status: run.status });
		});
		await store.appendEvent("needs_input", {
			...needs,
			risk: null,
			step,
			deadline: pending.deadline,
			live: true,
			tool: request.tool,
			...(pending.overseer_policy ? { overseer_policy: pending.overseer_policy } : {}),
		});
		if (pending.deadline) this.armTimer(entry.id, pending);
		this.log(`Run ${entry.id}: ${step} waits for ${request.id} (${request.tool})`);
		return decision;
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
		const entry = this.requireWorkflowRun(id, "amend");
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
		const entry = this.requireWorkflowRun(id, "retry a step of");
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
		const entry = this.requireWorkflowRun(id, "reprioritize");
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
		const dir = this.stepDir(entry, step);
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
		const opened = Boolean(effective.pr) && effective.pr !== run.pr;
		if (effective.pr) patch.pr = effective.pr;
		if (Object.keys(patch).length > 0) await store.updateRun(patch);
		// The first step that reports a pull request (or a new one) opened it for the run
		if (opened) await store.appendEvent("pr.opened", { step, pr: effective.pr });
		try {
			// Discovered items join the backlog of the overseer that dispatched the run
			await this.backlog.acceptDiscovered(entry.dir, entry.id, step, effective.discovered_items);
		} catch (err) {
			this.log(`Run ${entry.id}: discovered items not added: ${(err as Error).message}`);
		}
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
		const pending = newPendingInput(last.step, request, config, last.block.max_risk ?? null);
		pending.overseer_policy = this.backlog.policyFor(entry.dir, request, {
			risk: pending.risk ?? null,
			kind: pendingKind(pending),
		});
		// Open af_ask questions of a `cli` step stay: their answers rerun the step too
		const asks = pendingInputs(store.readRun()).filter((p) => p.ask);
		await store.updateRun({ "x-af-needs-input": [...asks, pending] });
		await store.appendEvent("needs_input", {
			...request,
			kind: pendingKind(pending),
			risk: pending.risk ?? null,
			step: last.step,
			deadline: pending.deadline,
			...(pending.overseer_policy ? { overseer_policy: pending.overseer_policy } : {}),
		});
		return pending;
	}

	/** Re-arms the needs_input deadlines of awaiting-human runs (supervisor start). */
	private armInputTimers(): void {
		for (const entry of this.registry.list()) {
			if (entry.status !== "awaiting-human") continue;
			try {
				for (const pending of pendingInputs(new RunStore(entry.dir).readRun())) {
					if (pending.deadline) this.armTimer(entry.id, pending);
				}
			} catch {
				// Unreadable run.json: nothing to arm
			}
		}
	}

	private armTimer(id: string, pending: PendingInput): void {
		const key = stepKey(id, pending.request.id);
		this.clearTimer(id, pending.request.id);
		const recommended = pending.request.recommended;
		if (!pending.deadline || recommended == null) return;
		const delay = Math.max(0, Date.parse(pending.deadline) - Date.now());
		const timer = setTimeout(() => {
			this.timers.delete(key);
			this.answer(id, {
				request_id: pending.request.id,
				answer: recommended,
				from: "policy",
			}).catch((err: Error) => {
				this.log(`Run ${id}: needs_input timeout not applied: ${err.message}`);
			});
		}, delay);
		timer.unref?.();
		this.timers.set(key, timer);
	}

	/** Clears the deadline timer of one request, or of every request of the run. */
	private clearTimer(id: string, requestId?: string): void {
		const prefix = stepKey(id, requestId ?? "");
		for (const [key, timer] of [...this.timers]) {
			if (requestId ? key !== prefix : !key.startsWith(prefix)) continue;
			clearTimeout(timer);
			this.timers.delete(key);
		}
	}

	/** Re-queues a paused, waiting, blocked or failed run; it resumes from the last completed step. */
	async resume(id: string): Promise<{ id: string; status: RunStatus }> {
		const entry = this.requireWorkflowRun(id, "resume");
		if (this.executing.has(id) && entry.status === "awaiting-human") {
			throw new RunError("Run is still executing: a live session waits for af answer", 409);
		}
		if (!RESUMABLE_STATUSES.includes(entry.status)) {
			throw new RunError(`Cannot resume run in '${entry.status}' status`, 409);
		}
		const store = new RunStore(entry.dir);
		const patch: Partial<RunJson> = { status: "queued", ended_at: null };
		// Resuming without an answer reruns the step, which asks again if needed
		if (pendingInputs(store.readRun()).length > 0) patch["x-af-needs-input"] = null;
		this.clearTimer(id);
		await store.updateRun(patch);
		await this.registry.update(id, { status: "queued" });
		await store.appendEvent("run.queued", { reason: "resumed", from: entry.status });
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
					// A run waiting on a live session (awaiting-human) still holds its checkout
					// An open overseer run holds no checkout and is never executed
					const running = runs.filter(
						(r) => !isOverseerEntry(r) && (r.status === "running" || this.executing.has(r.id)),
					);
					const queued = runs.filter(
						(r) => !isOverseerEntry(r) && r.status === "queued" && !this.executing.has(r.id),
					);
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
				// AF_RUN_ID (and AF_STEP, set per step) let af_ask find the asking run
				env: { ...payload.env, AF_RUN_ID: entry.id },
				runDir: entry.dir,
				worktree: recorded,
				signal: controller.signal,
				shouldStop: () => {
					const request = this.stopRequests.get(entry.id);
					if (!request) return null;
					return request.status === "canceled" ? WORKFLOW_STATUS.CANCELED : WORKFLOW_STATUS.PAUSED;
				},
				operatorMessages: (step) => this.deliverMessages(store, step),
				sessionHost: (step) => this.sessionHost(entry, store, payload.config, step),
				recordResult: (step, block) => this.recordResult(entry, store, step, block),
				inputAnswer: async (step, requestId) => {
					const answer = answerOf(store, requestId);
					// The answer's own operator message is consumed; other pending messages stay
					if (answer?.message) await this.deliverMessages(store, step, [answer.message]);
					return answer;
				},
				lastSession: (step) => {
					const saved = readStepSession(this.stepDir(entry, step));
					return saved ? { sessionId: saved.session_id, driver: saved.driver, at: saved.at } : null;
				},
				emitEvent: async (type, data) => {
					await store.appendEvent(type, data);
				},
				runPr: () => store.readRun().pr ?? null,
				recordDecision: async (decision) => {
					await store.appendDecision({
						...decision,
						at: new Date().toISOString(),
						source: "policy",
					});
				},
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
						await store.appendEvent("branch.created", {
							branch: wt.branch,
							base: wt.baseBranch,
							worktree: wt.path,
						});
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
			if (request?.shutdown) {
				// Left `running` (or `awaiting-human` with its live requests): the next
				// supervisor recovers the interrupted step.
				this.log(`Run ${entry.id}: interrupted by supervisor shutdown`);
				return;
			}
			await this.dropLiveRequests(entry.id, store, status !== "awaiting-human");
			if (request?.restart && status === "paused") {
				// send --mode now: rerun the interrupted step at once with the message. Its
				// session resumes; the worktree's work is committed first in case it cannot
				this.checkpointWorktree(store, interruptedStep);
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
			if (this.stopRequests.get(entry.id)?.shutdown) return;
			if (store.exists()) await this.setStatus(entry, "failed", { error: message });
		} finally {
			this.stopRequests.delete(entry.id);
			this.controllers.delete(entry.id);
			this.results.delete(entry.id);
			this.liveSessions.delete(entry.id);
			this.liveRequests.delete(entry.id);
			for (const key of [...this.stepStarts.keys()]) {
				if (key.startsWith(stepKey(entry.id, ""))) this.stepStarts.delete(key);
			}
		}
	}

	/** Removes the requests of live sessions that ended without an answer (canceled, paused). */
	private async dropLiveRequests(id: string, store: RunStore, asks: boolean): Promise<void> {
		this.liveRequests.delete(id);
		const gone = (p: PendingInput) => p.live === true || (asks && p.ask === true);
		await this.withInputLock(id, async () => {
			const dropped = pendingInputs(store.readRun()).filter(gone);
			if (dropped.length === 0) return;
			for (const p of dropped) this.clearTimer(id, p.request.id);
			await store.updateRunWith((current) => {
				const kept = pendingInputs(current).filter((p) => !gone(p));
				return { "x-af-needs-input": kept.length > 0 ? kept : null };
			});
			// Long-polls of dropped af_ask questions return `withdrawn`
			for (const p of dropped) this.wakeAsk(stepKey(id, p.request.id));
		});
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
			// An overseer run stays open across supervisor restarts: its session is not ours
			if (isOverseerEntry(entry)) continue;
			const store = new RunStore(entry.dir);
			if (!store.exists()) continue;
			const run = store.readRun();
			if (run.status === "running" || run.status === "queued" || entry.status === "running") {
				// Runs this supervisor takes over from a previous one (once per process)
				await store.appendEventOnce(
					"supervisor.restarted",
					{ pid: process.pid, started_at: this.startedAt, version: this.supervisorVersion },
					(e) => e.data?.pid === process.pid && e.data?.started_at === this.startedAt,
				);
			}
			if (run.status === "running" || entry.status === "running") {
				await this.recoverRun(entry, store);
				recovered.push(entry.id);
			} else if (run.status === "awaiting-human" && pendingInputs(run).some((p) => p.live)) {
				await this.recoverLiveWait(entry, store);
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
		let definitions: StepDefinition[] = [];
		try {
			definitions = this.parseWorkflow(store.readJson<DispatchPayload>("dispatch.json")).steps;
			topLevel = definitions.map((s) => s.name);
		} catch {
			topLevel = progress ? [...new Set(progress.completedSteps.map((s) => s.name))] : [];
		}
		const n = (store.readRun()["x-af-recoveries"] ?? 0) + 1;
		let sessions: SessionRecovery[] = [];
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
			// A graceful shutdown already recorded the step it stopped as interrupted
			const last = progress.completedSteps.at(-1);
			if (
				last?.status === STEP_INTERRUPTED &&
				topLevel.includes(last.name) &&
				!interrupted.includes(last.name)
			) {
				interrupted.push(last.name);
			}
			sessions = this.recoverSessions(entry, progress, definitions, interrupted);
			prepareForResume(progress);
			saveProgress(progress, entry.dir);
		}
		await this.logSessionRecovery(store, n, sessions);
		await store.updateRun({ status: "queued", "x-af-recoveries": n });
		await this.registry.update(entry.id, { status: "queued" });
		const resumeFrom =
			topLevel.find(
				(name) => !progress?.completedSteps.some((s) => s.name === name && isStepDone(s)),
			) ?? null;
		await store.appendEventOnce(
			"run.recovered",
			{ recovery: n, interrupted_steps: interrupted, resume_from: resumeFrom, sessions },
			(e) => e.data?.recovery === n,
		);
		this.log(`Recovered run ${entry.id} (interrupted: ${interrupted.join(", ") || "none"})`);
	}

	/**
	 * Recovery of a run that waited `awaiting-human` on a live session when
	 * the supervisor stopped: the session process is gone, so its step is
	 * recorded interrupted with the session id, and its requests are no
	 * longer live. The run keeps waiting; `af answer` then resumes that
	 * session with the answer (instead of a cold rerun). Runs once per
	 * restart: afterwards no request is live.
	 */
	private async recoverLiveWait(entry: RegistryEntry, store: RunStore): Promise<void> {
		const progress = loadProgress(entry.id, entry.dir);
		if (!progress) return;
		const running = new Set(progress.runningSteps);
		if (progress.currentStep?.name) running.add(progress.currentStep.name);
		let definitions: StepDefinition[] = [];
		try {
			definitions = this.parseWorkflow(store.readJson<DispatchPayload>("dispatch.json")).steps;
		} catch {
			return;
		}
		const live = pendingInputs(store.readRun()).filter((p) => p.live);
		const liveSteps = new Set(live.map((p) => p.step));
		const waiting = definitions
			.map((d) => d.name)
			.filter((name) => running.has(name) || liveSteps.has(name));
		if (waiting.length === 0) return;
		const now = new Date().toISOString();
		for (const name of waiting) {
			const last = [...progress.completedSteps].reverse().find((s) => s.name === name);
			// A graceful shutdown already recorded the step interrupted
			if (!running.has(name) && last?.status === STEP_INTERRUPTED) continue;
			progress.completedSteps.push({
				name,
				status: STEP_INTERRUPTED,
				startedAt: progress.currentStep?.name === name ? progress.currentStep.startedAt : null,
				completedAt: now,
				retryCount: 0,
				outputSummary: "",
				error: "Supervisor stopped while a live session waited for an answer",
				humanInput: null,
			});
		}
		const known = new Map(live.map((p) => [p.step, p.session_id ?? null]));
		const sessions = this.recoverSessions(entry, progress, definitions, waiting, known);
		prepareForResume(progress);
		progress.status = WORKFLOW_STATUS.AWAITING_HUMAN;
		saveProgress(progress, entry.dir);
		const n = (store.readRun()["x-af-recoveries"] ?? 0) + 1;
		await this.logSessionRecovery(store, n, sessions);
		await store.updateRunWith((current) => ({
			"x-af-recoveries": n,
			"x-af-needs-input": pendingInputs(current).map((p) => (p.live ? { ...p, live: false } : p)),
		}));
		await store.appendEventOnce(
			"run.recovered",
			{ recovery: n, interrupted_steps: waiting, resume_from: null, sessions, waiting: true },
			(e) => e.data?.recovery === n,
		);
		this.log(`Recovered run ${entry.id} waiting on ${waiting.join(", ")}`);
	}

	/**
	 * Decides, per interrupted step, whether its runtime session resumes or
	 * the step restarts from its boundary. A top-level prompt step whose last
	 * session (`session.json`, written with the transcript) was recorded during
	 * this attempt resumes, on either driver (Agent SDK resume, `claude
	 * --resume`, `codex exec resume`): its interrupted record gets the session
	 * id, and the prompt step resumes it (or restarts cold when the resume
	 * fails). Every other step restarts (ralph-loop and composite steps, no
	 * session recorded).
	 */
	private recoverSessions(
		entry: RegistryEntry,
		progress: WorkflowProgress,
		definitions: StepDefinition[],
		steps: string[],
		known: Map<string, string | null> = new Map(),
	): SessionRecovery[] {
		return steps.map((step) => {
			const record = [...progress.completedSteps]
				.reverse()
				.find((s) => s.name === step && s.status === STEP_INTERRUPTED);
			const type = definitions.find((d) => d.name === step)?.type ?? null;
			const saved = readStepSession(this.stepDir(entry, step));
			const current = saved && (!record?.startedAt || saved.at >= record.startedAt) ? saved : null;
			const sessionId = known.get(step) ?? current?.session_id ?? null;
			let reason: string | null = null;
			if (type !== "prompt" && type !== "skill") {
				reason = `a ${type ?? "composite"} step restarts from its boundary`;
			} else if (!sessionId) reason = "no runtime session was recorded for this attempt";

			if (reason) return { step, action: "restart", session_id: sessionId, reason };
			if (record) record.sessionId = sessionId;
			return {
				step,
				action: "resume",
				session_id: sessionId,
				reason: `the ${current?.driver ?? "session"} driver resumes the stored session id`,
			};
		});
	}

	/**
	 * Logs each recovery choice about a recorded session as a policy decision
	 * (once per recovery and step). Steps without a session have no choice to
	 * log; `run.recovered` `sessions` lists them all.
	 */
	private async logSessionRecovery(
		store: RunStore,
		n: number,
		sessions: SessionRecovery[],
	): Promise<void> {
		const existing = new Set(store.readDecisions().map((d) => d.id));
		for (const choice of sessions) {
			if (!choice.session_id) continue;
			const id = `d-recover-${n}-${sanitizeSlug(choice.step) || "step"}`;
			if (existing.has(id)) continue;
			const resume = choice.action === "resume";
			await store.appendDecision({
				id,
				at: new Date().toISOString(),
				phase: choice.step,
				source: "policy",
				risk: "low",
				decision: resume
					? `Resume session ${choice.session_id} of ${choice.step} after the supervisor restart`
					: `Restart ${choice.step} from its boundary after the supervisor restart`,
				rationale: choice.reason,
				alternatives: [resume ? "Restart the step from its boundary" : "Resume the session"],
				refs: choice.session_id ? [choice.session_id] : [],
			});
			this.log(`Run ${store.id}: ${choice.action} ${choice.step} (${choice.reason})`);
		}
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

/**
 * Pending needs_input requests of a run (`x-af-needs-input` in run.json): a
 * list keyed by request id (parallel session steps can each wait). The
 * single-object form written before the list is still read.
 */
export function pendingInputs(run: RunJson): PendingInput[] {
	const value = run["x-af-needs-input"];
	if (Array.isArray(value)) {
		return value.filter((p): p is PendingInput => !!p && typeof p === "object" && "request" in p);
	}
	return value && typeof value === "object" ? [value as PendingInput] : [];
}

/** First pending needs_input request of a run, or null. */
export function pendingInput(run: RunJson): PendingInput | null {
	return pendingInputs(run)[0] ?? null;
}

/** Step of an answered request, from its `input.answered` event. */
function answeredStep(store: RunStore, requestId: string): string | null {
	const event = store
		.readEvents()
		.filter((e) => e.type === "input.answered" && e.data?.id === requestId)
		.at(-1);
	return typeof event?.data?.step === "string" ? event.data.step : null;
}

/** The latest `input.answered` event of a request, as a step reads it. */
function answerOf(store: RunStore, requestId: string): InputAnswer | null {
	const event = store
		.readEvents()
		.filter((e) => e.type === "input.answered" && e.data?.id === requestId)
		.at(-1);
	if (!event?.data) return null;
	const option = event.data.option;
	return {
		answer: String(event.data.answer ?? ""),
		option: typeof option === "string" ? option : null,
		from: String(event.data.from ?? "user"),
		message: typeof event.data.message === "string" ? event.data.message : null,
	};
}

/**
 * A pending request. A non-blocking request with a recommended option gets a
 * timeout deadline: the request's `x-af-timeout-minutes` (human-input
 * `timeout-minutes`, set by the workflow author), else
 * `supervisor.needs_input_timeout`, which also requires risk `low` (the
 * request's `risk`, else `stepRisk`; a missing risk is not low).
 */
function newPendingInput(
	step: string,
	request: NeedsInput,
	config: Record<string, unknown>,
	stepRisk: string | null,
): PendingInput {
	const own = request["x-af-timeout-minutes"];
	const ownMinutes = typeof own === "number" && Number.isFinite(own) && own >= 0 ? own : null;
	const risk = request.risk ?? stepRisk ?? null;
	const minutes = ownMinutes ?? (risk === "low" ? needsInputTimeout(config) : null);
	const autoApply = request.blocking === false && request.recommended != null;
	const now = Date.now();
	return {
		step,
		request,
		asked_at: new Date(now).toISOString(),
		deadline: autoApply && minutes !== null ? new Date(now + minutes * 60_000).toISOString() : null,
		risk,
	};
}

/**
 * Kind of a pending request: the request's `kind`, else `permission` for a
 * live permission request stored before kinds existed, else `decision`.
 */
export function pendingKind(pending: PendingInput): NeedsInputKind {
	return pending.request.kind ?? (pending.permission ? "permission" : "decision");
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
