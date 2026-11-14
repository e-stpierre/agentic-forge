/**
 * Small event payloads (Token Budget Rule 6): every string in an event's
 * `data` is cut to `EVENT_STRING_MAX` characters at write time. The writer
 * keeps the full payload in a file of the run directory and names it in the
 * event (`data_path`), so a reader that needs the full text knows where it is.
 */

import { existsSync, readFileSync } from "node:fs";

/** Longest string an event `data` value keeps. */
export const EVENT_STRING_MAX = 500;

/** Run subdirectory holding the full payload of the events whose strings were cut. */
export const EVENT_DATA_DIR = "event-data";

const ELLIPSIS = "...";

/** Cuts `text` to at most `max` characters, ending with `...` when cut. */
export function cutText(text: string, max: number = EVENT_STRING_MAX): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - ELLIPSIS.length))}${ELLIPSIS}`;
}

export interface BoundedData {
	data: Record<string, unknown>;
	/** True when at least one string was cut. */
	cut: boolean;
}

/** Copies `data` with every string (at any depth) cut to `max` characters. */
export function boundEventData(
	data: Record<string, unknown>,
	max: number = EVENT_STRING_MAX,
): BoundedData {
	let cut = false;
	const visit = (value: unknown): unknown => {
		if (typeof value === "string") {
			if (value.length <= max) return value;
			cut = true;
			return cutText(value, max);
		}
		if (Array.isArray(value)) return value.map(visit);
		if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
			const out: Record<string, unknown> = {};
			for (const [key, inner] of Object.entries(value)) out[key] = visit(inner);
			return out;
		}
		return value;
	};
	const bounded = visit(data) as Record<string, unknown>;
	return { data: cut ? bounded : data, cut };
}

/** The full `data` of an event: the payload file named by `data_path` when present and readable. */
export function fullEventData(
	data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const file = data?.data_path;
	if (typeof file !== "string" || !existsSync(file)) return data;
	try {
		const full = JSON.parse(readFileSync(file, "utf-8")) as unknown;
		return full && typeof full === "object" && !Array.isArray(full)
			? (full as Record<string, unknown>)
			: data;
	} catch {
		return data;
	}
}
