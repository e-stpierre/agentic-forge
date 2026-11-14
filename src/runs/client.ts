/**
 * Client side of runs: dispatch a workflow to the supervisor and follow a
 * run's events. Used by `af run`, `af resume` and `af cancel`.
 */

import { TERMINAL_RUN_STATUSES } from "../contract/index.js";
import type { SupervisorClient } from "../supervisor/client.js";
import type { DispatchPayload } from "./dispatch.js";
import type { DispatchResult, EventResponse, LogsResponse } from "./manager.js";
import type { RunEvent } from "./run-store.js";
import type { TranscriptEntry } from "./transcript.js";
import { MAX_WAIT_REQUEST_SECONDS, type WaitCondition, type WaitResult } from "./wait.js";

export function dispatchRun(
	client: SupervisorClient,
	payload: DispatchPayload,
): Promise<DispatchResult> {
	return client.request<DispatchResult>("POST", "/v1/runs", payload, 30_000);
}

/** Statuses at which `--foreground` stops following a run. */
const STOP_STATUSES = new Set<string>([
	...TERMINAL_RUN_STATUSES,
	"paused",
	"awaiting-human",
	"blocked",
]);

export interface FollowOptions {
	/** Poll interval in ms (default 500). */
	intervalMs?: number;
	/** Start after this seq (default 0). */
	after?: number;
	onEvent: (event: RunEvent) => void;
	/** Resolves early (detach) when aborted. */
	signal?: AbortSignal;
}

/**
 * Follows a run's events until it reaches a terminal, paused, blocked or awaiting-human
 * status, or `signal` aborts. Returns the last status seen.
 */
export async function followRun(
	client: SupervisorClient,
	runId: string,
	options: FollowOptions,
): Promise<string> {
	let after = options.after ?? 0;
	const interval = options.intervalMs ?? 500;
	for (;;) {
		if (options.signal?.aborted) return "detached";
		const res = await client.request<{ events: RunEvent[]; status: string }>(
			"GET",
			`/v1/runs/${encodeURIComponent(runId)}/events?after=${after}`,
		);
		for (const event of res.events) {
			options.onEvent(event);
			after = Math.max(after, event.seq);
		}
		if (STOP_STATUSES.has(res.status)) return res.status;
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, interval);
			options.signal?.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
		});
	}
}

/** One-line rendering of an event for terminal output. */
export function formatEvent(event: RunEvent): string {
	const time = event.at.slice(11, 19);
	const data = event.data ?? {};
	const str = (key: string) =>
		typeof data[key] === "string" && data[key] ? (data[key] as string) : null;
	const step = str("step") ? ` ${str("step")}` : "";
	let extra = "";
	if (event.type.startsWith("iteration.") && typeof data.iteration === "number") {
		extra = ` ${data.iteration}/${data.max_iterations ?? "?"}`;
		if (str("outcome")) extra += ` (${str("outcome")})`;
	} else if (event.type === "step.retried" && str("reason")) {
		extra = ` (${str("reason")})`;
	} else if (event.type === "needs_input" && str("question")) {
		extra = `: ${str("id") ?? ""} ${str("question")}`;
	} else if (
		(event.type.startsWith("message.") || event.type === "amendment.applied") &&
		str("id")
	) {
		extra = ` ${str("id")}`;
	}
	if (str("error")) extra += `: ${str("error")}`;
	else if (!extra && str("status") && event.type.startsWith("run.")) extra = ` (${str("status")})`;
	return `[${time}] ${event.type}${step}${extra}`;
}

/** Query of `GET /v1/events` from a client. */
export interface EventsRequest {
	cursor?: string | null;
	run?: string | null;
	types?: readonly string[];
	/** Start at the end of every stream (ignored with a cursor). */
	fromNow?: boolean;
	/** Long-poll: seconds the supervisor waits for a first event (0 returns at once). */
	waitSeconds?: number;
	limit?: number;
}

export function fetchEvents(
	client: SupervisorClient,
	request: EventsRequest,
): Promise<EventResponse> {
	const params = new URLSearchParams();
	if (request.cursor) params.set("cursor", request.cursor);
	if (request.run) params.set("run", request.run);
	if (request.types && request.types.length > 0) params.set("types", request.types.join(","));
	if (request.fromNow) params.set("from", "now");
	if (request.waitSeconds) params.set("wait", String(request.waitSeconds));
	if (request.limit) params.set("limit", String(request.limit));
	const query = params.toString();
	return client.request<EventResponse>(
		"GET",
		`/v1/events${query ? `?${query}` : ""}`,
		undefined,
		((request.waitSeconds ?? 0) + 15) * 1000,
	);
}

export interface FollowEventsOptions extends Omit<EventsRequest, "waitSeconds"> {
	onEvent: (event: RunEvent) => void;
	/** Called with the new cursor after every page (persist it to resume later). */
	onCursor?: (cursor: string) => void;
	/** Long-poll length per request in seconds (default 30). */
	waitSeconds?: number;
	/** Keep following after the events that exist now (default true). */
	follow?: boolean;
	/** With `run`, stop when the run reaches a terminal, paused, blocked or awaiting-human status. */
	untilStopped?: boolean;
	signal?: AbortSignal;
}

/**
 * Reads events after a cursor and, with `follow`, keeps long-polling for new
 * ones until `signal` aborts. Returns the last cursor.
 */
export async function followEvents(
	client: SupervisorClient,
	options: FollowEventsOptions,
): Promise<string | null> {
	let cursor = options.cursor ?? null;
	let fromNow = options.fromNow === true && !cursor;
	const follow = options.follow !== false;
	for (;;) {
		if (options.signal?.aborted) return cursor;
		const pending = fetchEvents(client, {
			...options,
			cursor,
			fromNow,
			waitSeconds: follow ? (options.waitSeconds ?? 30) : 0,
		});
		const page = await raceAbort(pending, options.signal);
		if (!page) return cursor;
		fromNow = false;
		for (const event of page.events) options.onEvent(event);
		cursor = page.cursor;
		options.onCursor?.(cursor);
		if (page.more) continue;
		if (!follow) return cursor;
		if (options.untilStopped && page.status && STOP_STATUSES.has(page.status)) return cursor;
	}
}

/** Resolves with the promise's value, or null as soon as `signal` aborts. */
async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> {
	if (!signal) return promise;
	if (signal.aborted) return null;
	let onAbort: () => void = () => {};
	const aborted = new Promise<null>((resolve) => {
		onAbort = () => resolve(null);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	promise.catch(() => {});
	try {
		return await Promise.race([promise, aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

/** Query of `GET /v1/runs/:id/logs` from a client. */
export interface LogsRequest {
	run: string;
	step?: string | null;
	cursor?: string | null;
	limit?: number;
	/** Cut each entry's text to this length (0 or omitted: full entries). */
	maxChars?: number;
	/** Size budget of the page in bytes (0 or omitted: none). */
	maxBytes?: number;
	/** Long-poll: seconds the supervisor waits for a new entry while the step is active. */
	waitSeconds?: number;
}

export function fetchLogs(client: SupervisorClient, request: LogsRequest): Promise<LogsResponse> {
	const params = new URLSearchParams();
	if (request.step) params.set("step", request.step);
	if (request.cursor) params.set("cursor", request.cursor);
	if (request.limit) params.set("limit", String(request.limit));
	if (request.maxChars) params.set("max_chars", String(request.maxChars));
	if (request.maxBytes) params.set("max_bytes", String(request.maxBytes));
	if (request.waitSeconds) params.set("wait", String(request.waitSeconds));
	const query = params.toString();
	return client.request<LogsResponse>(
		"GET",
		`/v1/runs/${encodeURIComponent(request.run)}/logs${query ? `?${query}` : ""}`,
		undefined,
		((request.waitSeconds ?? 0) + 15) * 1000,
	);
}

export interface FollowLogsOptions extends Omit<LogsRequest, "waitSeconds"> {
	onEntry: (entry: TranscriptEntry) => void;
	/** Keep reading until the step (or run) ends (default false: one page). */
	follow?: boolean;
	/** Long-poll length per request in seconds (default 30). */
	waitSeconds?: number;
	signal?: AbortSignal;
}

/**
 * Prints a run's transcript (the tail, or after a cursor) and, with
 * `follow`, keeps long-polling until the step (or the run) is no longer
 * active and nothing is left to read, or `signal` aborts. Returns the last
 * cursor and the last response.
 */
export async function followLogs(
	client: SupervisorClient,
	options: FollowLogsOptions,
): Promise<{ cursor: string | null; last: LogsResponse | null }> {
	let cursor = options.cursor ?? null;
	let last: LogsResponse | null = null;
	for (;;) {
		if (options.signal?.aborted) return { cursor, last };
		const page = await raceAbort(
			fetchLogs(client, {
				...options,
				cursor,
				waitSeconds: options.follow && cursor ? (options.waitSeconds ?? 30) : 0,
			}),
			options.signal,
		);
		if (!page) return { cursor, last };
		last = page;
		for (const entry of page.entries) options.onEntry(entry);
		cursor = page.cursor;
		if (page.more) continue;
		if (!options.follow || !page.active) return { cursor, last };
	}
}

/** Terminal rendering of a transcript entry (one or more lines). */
export function formatTranscriptEntry(entry: TranscriptEntry, withStep = true): string {
	const time = entry.at.slice(11, 19);
	const step = withStep ? ` ${entry.step}` : "";
	const head = `[${time}]${step}`;
	const one = (text: string | undefined) => (text ?? "").replace(/\s+$/, "");
	switch (entry.type) {
		case "session":
			return `${head} session ${entry.session_id} (${entry.runtime ?? "?"} ${entry.driver ?? "?"}${entry.model ? `, ${entry.model}` : ""})`;
		case "message":
			return `${head} ${entry.role ?? "assistant"}: ${one(entry.text)}`;
		case "tool_call": {
			const input = entry.input ? JSON.stringify(entry.input) : "";
			return `${head} tool ${entry.tool ?? "?"} ${input.length > 300 ? `${input.slice(0, 300)}...` : input}`;
		}
		case "tool_result": {
			const text = one(entry.text);
			const short = text.length > 500 ? `${text.slice(0, 500)}...` : text;
			return `${head} ${entry.is_error ? "tool error" : "tool result"}: ${short}`;
		}
		case "diff":
			return `${head} diff ${entry.change ?? "update"} ${entry.path ?? ""}${entry.patch ? `\n${entry.patch}` : ""}`;
		case "request":
			return `${head} needs_input ${entry.id} (${entry.kind ?? "?"}): ${entry.question ?? ""}`;
		case "answer":
			return `${head} answer ${entry.id}: ${entry.option ?? entry.text ?? ""}`;
		case "turn":
			return `${head} turn ${entry.is_error ? "failed" : "completed"}`;
		case "notice":
			return `${head} ${one(entry.text)}`;
		case "error":
			return `${head} error: ${one(entry.text)}`;
		default:
			return `${head} ${entry.type}`;
	}
}

export interface WaitRequest {
	until?: WaitCondition;
	/** Last event seq seen (from a previous wait result); omit on the first call. */
	cursor?: number | null;
	/** Total wait in seconds (looped in requests of at most 120 s). */
	timeoutSeconds: number;
	signal?: AbortSignal;
}

/**
 * Waits for a run (`GET /v1/runs/:id/wait`), in supervisor requests of at
 * most {@link MAX_WAIT_REQUEST_SECONDS}, until it ends (or, with
 * `until: attention`, needs someone) or `timeoutSeconds` runs out. A result
 * with `state: waiting` carries the cursor to wait again.
 */
export async function waitForRun(
	client: SupervisorClient,
	runId: string,
	request: WaitRequest,
): Promise<WaitResult> {
	const deadline = Date.now() + Math.max(request.timeoutSeconds, 0) * 1000;
	let cursor = request.cursor ?? null;
	for (;;) {
		const left = Math.max(0, (deadline - Date.now()) / 1000);
		const wait = Math.min(left, MAX_WAIT_REQUEST_SECONDS);
		const params = new URLSearchParams({ until: request.until ?? "terminal", wait: String(wait) });
		if (cursor !== null) params.set("cursor", String(cursor));
		const result = await client.request<WaitResult>(
			"GET",
			`/v1/runs/${encodeURIComponent(runId)}/wait?${params.toString()}`,
			undefined,
			(wait + 15) * 1000,
		);
		cursor = result.cursor;
		if (result.state !== "waiting" || Date.now() >= deadline || request.signal?.aborted) {
			return result;
		}
	}
}
