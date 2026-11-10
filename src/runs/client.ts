/**
 * Client side of runs: dispatch a workflow to the supervisor and follow a
 * run's events. Used by `af run`, `af resume` and `af cancel`.
 */

import { TERMINAL_RUN_STATUSES } from "../contract/index.js";
import type { SupervisorClient } from "../supervisor/client.js";
import type { DispatchPayload } from "./dispatch.js";
import type { DispatchResult } from "./manager.js";
import type { RunEvent } from "./run-store.js";

export function dispatchRun(
	client: SupervisorClient,
	payload: DispatchPayload,
): Promise<DispatchResult> {
	return client.request<DispatchResult>("POST", "/v1/runs", payload, 30_000);
}

/** Statuses at which `--foreground` stops following a run. */
const STOP_STATUSES = new Set<string>([...TERMINAL_RUN_STATUSES, "paused", "awaiting-human"]);

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
 * Follows a run's events until it reaches a terminal, paused or awaiting-human
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
	const step = typeof data.step === "string" ? ` ${data.step}` : "";
	const extra =
		typeof data.error === "string" && data.error
			? `: ${data.error}`
			: typeof data.status === "string" && event.type.startsWith("run.")
				? ` (${data.status})`
				: "";
	return `[${time}] ${event.type}${step}${extra}`;
}
