/**
 * Event stream across runs: cursors, type filters and reads over the
 * `events.jsonl` files of the registry's runs. Used by `GET /v1/events`
 * (`af events`, and the MCP `af_events` tool).
 *
 * A cursor records, per run, the last `seq` a client has seen. It is an opaque
 * string (`c1.` + base64url JSON `{ runId: seq }`). Reading with a cursor
 * returns every event after it, in any run, so a client that stores the cursor
 * resumes without gaps or duplicates. Filters never hold the cursor back: a
 * filtered-out event is skipped, not delivered later.
 *
 * A cursor read across all runs also holds a watermark (the reserved key
 * {@link WATERMARK_KEY}, epoch ms): a run without a position starts after it
 * instead of from its first event. That lets the cursor drop the ended runs
 * whose events are all older than the watermark, so its size follows the
 * active runs, not the whole registry.
 */

import { TERMINAL_RUN_STATUSES } from "../contract/index.js";
import type { RegistryEntry } from "./registry.js";
import { type RunEvent, RunStore } from "./run-store.js";

const CURSOR_PREFIX = "c1.";

/** Reserved cursor key: runs without a position start after this time (epoch ms). */
export const WATERMARK_KEY = "@w";

/**
 * How far the watermark stays behind the read: an event stamped just before
 * a read and written just after it is still delivered.
 */
const WATERMARK_MARGIN_MS = 5_000;

/** Last seen `seq` per run id. */
export type CursorPositions = Record<string, number>;

export class CursorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CursorError";
	}
}

export function encodeCursor(positions: CursorPositions): string {
	const json = JSON.stringify(positions);
	return `${CURSOR_PREFIX}${Buffer.from(json, "utf-8").toString("base64url")}`;
}

/** Decodes a cursor. An empty or missing cursor means "from the start". */
export function decodeCursor(cursor: string | null | undefined): CursorPositions {
	if (!cursor) return {};
	if (!cursor.startsWith(CURSOR_PREFIX)) throw new CursorError(`Invalid cursor: ${cursor}`);
	try {
		const value = JSON.parse(
			Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf-8"),
		) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not a map");
		const positions: CursorPositions = {};
		for (const [run, seq] of Object.entries(value)) {
			if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) throw new Error("bad seq");
			positions[run] = seq;
		}
		return positions;
	} catch {
		throw new CursorError(`Invalid cursor: ${cursor}`);
	}
}

/**
 * Parses a comma-separated type filter. Patterns are exact types or a prefix
 * ending in `*` (`run.*`, `step.*`). Empty means all types.
 */
export function parseTypeFilter(types: string | string[] | null | undefined): string[] {
	const list = Array.isArray(types) ? types : (types ?? "").split(",");
	return list.map((t) => t.trim()).filter((t) => t.length > 0);
}

export function matchesTypes(type: string, patterns: readonly string[]): boolean {
	if (patterns.length === 0) return true;
	return patterns.some((p) => (p.endsWith("*") ? type.startsWith(p.slice(0, -1)) : p === type));
}

export interface EventQuery {
	cursor?: string | null;
	/** Only events of this run. */
	run?: string | null;
	types?: readonly string[];
	/** Maximum number of events returned (default 500). */
	limit?: number;
	/**
	 * Maximum size of the returned events (their compact JSON); the page stops
	 * before the event that would cross it, but always holds one event. 0 or
	 * absent: no size limit.
	 */
	maxBytes?: number;
	/**
	 * Skip the events that exist now and return a cursor at the end of every
	 * stream (`af events --follow --new`). Ignored when a cursor is given.
	 */
	fromNow?: boolean;
}

export interface EventPage {
	events: RunEvent[];
	cursor: string;
	/** True when more matching events are available right away (limit reached). */
	more: boolean;
}

export const DEFAULT_EVENT_LIMIT = 500;

/**
 * Reads the events after `query.cursor` from the given runs, oldest first
 * (by `at`, then run id, then `seq`), and returns the next cursor.
 */
export function readEventPage(entries: readonly RegistryEntry[], query: EventQuery): EventPage {
	const readAt = Date.now();
	const positions = decodeCursor(query.cursor);
	const watermark = positions[WATERMARK_KEY];
	const runs = query.run ? entries.filter((e) => e.id === query.run) : entries;
	const types = query.types ?? [];
	const limit = query.limit && query.limit > 0 ? query.limit : DEFAULT_EVENT_LIMIT;
	const next: CursorPositions = { ...positions };

	const fresh = !query.cursor && query.fromNow === true;
	const matching: RunEvent[] = [];
	const lastSeq = new Map<string, number>();
	/** Seq and time of each run's last event, for the runs that have events. */
	const lastEvent = new Map<string, LastEvent>();
	for (const entry of runs) {
		const all = new RunStore(entry.dir).readEvents();
		const final = all.at(-1);
		if (final) lastEvent.set(entry.id, { seq: final.seq, at: Date.parse(final.at) });
		const known = positions[entry.id];
		const events =
			known !== undefined
				? all.filter((e) => e.seq > known)
				: watermark !== undefined
					? all.filter((e) => Date.parse(e.at) > watermark)
					: all;
		if (events.length === 0) continue;
		const last = events[events.length - 1].seq;
		lastSeq.set(entry.id, last);
		if (fresh) {
			next[entry.id] = last;
			continue;
		}
		for (const event of events) if (matchesTypes(event.type, types)) matching.push(event);
	}

	matching.sort((a, b) => a.at.localeCompare(b.at) || a.run.localeCompare(b.run) || a.seq - b.seq);
	const page = takePage(matching, limit, query.maxBytes ?? 0);
	const more = matching.length > page.length;

	if (!fresh) {
		// A run whose matching events were all returned moves to its last seq
		// (skipping filtered-out events); a truncated run stops at the last
		// event returned, so the rest comes with the next page.
		const truncated = new Map<string, number>();
		for (const event of matching.slice(page.length)) {
			if (!truncated.has(event.run)) truncated.set(event.run, event.seq);
		}
		for (const [run, last] of lastSeq) {
			const firstLeft = truncated.get(run);
			next[run] = firstLeft === undefined ? last : Math.max(positions[run] ?? 0, firstLeft - 1);
		}
	}
	// A read of one run leaves the other runs' positions as they were
	if (!query.run) {
		pruneEndedRuns(next, runs, lastEvent, Math.max(watermark ?? 0, readAt - WATERMARK_MARGIN_MS));
	}
	return { events: page, cursor: encodeCursor(next), more };
}

/**
 * Sets the watermark and drops the positions of the ended runs read to their
 * last event when that event is older than it: such a run starts after the
 * watermark, which is where it already is.
 */
function pruneEndedRuns(
	next: CursorPositions,
	runs: readonly RegistryEntry[],
	lastEvent: ReadonlyMap<string, LastEvent>,
	mark: number,
): void {
	next[WATERMARK_KEY] = mark;
	for (const entry of runs) {
		const last = lastEvent.get(entry.id);
		const position = next[entry.id];
		if (position === undefined || !last || position < last.seq || !(last.at <= mark)) continue;
		if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(entry.status)) delete next[entry.id];
	}
}

interface LastEvent {
	seq: number;
	at: number;
}

/** The first events of `matching` within `limit` and `maxBytes` (at least one). */
function takePage(matching: RunEvent[], limit: number, maxBytes: number): RunEvent[] {
	const page: RunEvent[] = [];
	let bytes = 0;
	for (const event of matching) {
		if (page.length >= limit) break;
		if (maxBytes > 0) {
			const size = Buffer.byteLength(JSON.stringify(event), "utf-8") + 1;
			if (page.length > 0 && bytes + size > maxBytes) break;
			bytes += size;
		}
		page.push(event);
	}
	return page;
}
