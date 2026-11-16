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
 */

import type { RegistryEntry } from "./registry.js";
import { type RunEvent, RunStore } from "./run-store.js";

const CURSOR_PREFIX = "c1.";

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
	const positions = decodeCursor(query.cursor);
	const runs = query.run ? entries.filter((e) => e.id === query.run) : entries;
	const types = query.types ?? [];
	const limit = query.limit && query.limit > 0 ? query.limit : DEFAULT_EVENT_LIMIT;
	const next: CursorPositions = { ...positions };

	const fresh = !query.cursor && query.fromNow === true;
	const matching: RunEvent[] = [];
	const lastSeq = new Map<string, number>();
	for (const entry of runs) {
		const events = new RunStore(entry.dir).readEvents(positions[entry.id] ?? 0);
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
	const page = matching.slice(0, limit);
	const more = matching.length > page.length;

	if (!fresh) {
		// A run whose matching events were all returned moves to its last seq
		// (skipping filtered-out events); a truncated run stops at the last
		// event returned, so the rest comes with the next page.
		const truncated = new Map<string, number>();
		for (const event of matching.slice(limit)) {
			if (!truncated.has(event.run)) truncated.set(event.run, event.seq);
		}
		for (const [run, last] of lastSeq) {
			const firstLeft = truncated.get(run);
			next[run] = firstLeft === undefined ? last : Math.max(positions[run] ?? 0, firstLeft - 1);
		}
	}
	return { events: page, cursor: encodeCursor(next), more };
}
