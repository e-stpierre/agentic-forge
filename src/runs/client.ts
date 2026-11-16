/**
 * Client side of runs: dispatch a workflow to the supervisor and follow a
 * run's events. Used by `af run`, `af resume` and `af cancel`.
 */

import { TERMINAL_RUN_STATUSES } from "../contract/index.js";
import type { SupervisorClient } from "../supervisor/client.js";
import type { DispatchPayload } from "./dispatch.js";
import type { DispatchResult, EventResponse } from "./manager.js";
import type { RunEvent } from "./run-store.js";

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
