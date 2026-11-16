/**
 * Per-step live transcripts: `steps/<NN-step>/transcript.jsonl`, one
 * normalized entry per line (messages, tool calls and results, diffs,
 * requests, answers, turns), written for both drivers from the normalized
 * `SessionEvent`s. Kept apart from `events.jsonl` (state changes only) and
 * its `seq`: each transcript numbers its own entries, and `af logs` /
 * `af_logs` read them with their own cursor.
 *
 * `session.json` next to the transcript holds the step's last runtime
 * session (id, runtime, driver), read by crash recovery to resume it.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

import { sanitizeSlug } from "../paths.js";
import type { RuntimeDriver, SessionEvent } from "../runtimes/session.js";

export const TRANSCRIPT_FILE = "transcript.jsonl";
export const SESSION_FILE = "session.json";

/** Longest text kept per entry at write time (messages, tool results, results). */
export const TRANSCRIPT_TEXT_MAX = 20_000;
/** Longest string kept per tool call input value at write time. */
export const TRANSCRIPT_INPUT_MAX = 2_000;
/** Longest patch kept per diff entry at write time. */
export const TRANSCRIPT_PATCH_MAX = 8_000;

/** Entries per `af logs` page and default tail of `af_logs`. */
export const LOGS_DEFAULT_LIMIT = 50;
export const LOGS_MAX_LIMIT = 500;
/** `af_logs` defaults (Token Budget Rules): tail length, text cut per entry, result size budget. */
export const LOGS_MCP_DEFAULT_LIMIT = 20;
export const LOGS_MCP_MAX_CHARS = 500;
export const LOGS_MCP_MAX_BYTES = 8_000;

export type TranscriptEntryType =
	| "session"
	| "message"
	| "tool_call"
	| "tool_result"
	| "diff"
	| "request"
	| "answer"
	| "turn"
	| "error";

/** One line of `transcript.jsonl`. */
export interface TranscriptEntry {
	/** Position in this step's transcript (1-based). */
	seq: number;
	at: string;
	step: string;
	type: TranscriptEntryType;
	/** Item id: stable across a tool call and its result. */
	id?: string;
	role?: "assistant" | "user";
	text?: string;
	tool?: string;
	input?: Record<string, unknown>;
	is_error?: boolean;
	path?: string;
	change?: "add" | "update" | "delete";
	patch?: string;
	kind?: string;
	question?: string;
	option?: string | null;
	session_id?: string;
	runtime?: string;
	driver?: string;
	model?: string | null;
	auth?: string | null;
	/** Some text of this entry was cut (at write time, or by the reader's `max_chars`). */
	truncated?: boolean;
}

type EntryFields = Omit<TranscriptEntry, "seq" | "at" | "step">;

/** Last runtime session of a step (`session.json`). */
export interface StepSession {
	session_id: string;
	runtime: string | null;
	driver: RuntimeDriver | null;
	model: string | null;
	at: string;
}

/** Directory name of a step under `steps/` (`01-plan`): its position in the workflow, then its slug. */
export function stepDirName(names: string[], step: string): string {
	const index = Math.max(names.indexOf(step), 0) + 1;
	return `${String(index).padStart(2, "0")}-${sanitizeSlug(step) || "step"}`;
}

function cut(text: string, max: number): { text: string; truncated: boolean } {
	return text.length > max
		? { text: `${text.slice(0, max)}...`, truncated: true }
		: { text, truncated: false };
}

/** Tool input with every long string cut (deep). */
function capInput(value: unknown, flag: { cut: boolean }): unknown {
	if (typeof value === "string") {
		const c = cut(value, TRANSCRIPT_INPUT_MAX);
		if (c.truncated) flag.cut = true;
		return c.text;
	}
	if (Array.isArray(value)) return value.map((v) => capInput(v, flag));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, capInput(v, flag)]));
	}
	return value;
}

/** A minimal line patch: removed lines with `-`, added lines with `+`. */
function linePatch(before: string, after: string): string {
	const minus = before ? before.split("\n").map((l) => `-${l}`) : [];
	const plus = after ? after.split("\n").map((l) => `+${l}`) : [];
	return [...minus, ...plus].join("\n");
}

/**
 * Diffs of a file-editing tool call (Claude `Edit`, `MultiEdit`, `Write`,
 * `NotebookEdit`), derived from its input. Other tools give none.
 */
export function toolCallDiffs(
	id: string,
	tool: string,
	input: Record<string, unknown>,
): EntryFields[] {
	const file = input.file_path ?? input.notebook_path ?? input.path;
	if (typeof file !== "string") return [];
	const diff = (patch: string, change: "add" | "update"): EntryFields => {
		const c = cut(patch, TRANSCRIPT_PATCH_MAX);
		return {
			type: "diff",
			id,
			path: file,
			change,
			patch: c.text,
			...(c.truncated ? { truncated: true } : {}),
		};
	};
	const str = (v: unknown) => (typeof v === "string" ? v : "");
	switch (tool) {
		case "Edit":
			return [diff(linePatch(str(input.old_string), str(input.new_string)), "update")];
		case "MultiEdit": {
			const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
			return [
				diff(
					edits.map((e) => linePatch(str(e.old_string), str(e.new_string))).join("\n"),
					"update",
				),
			];
		}
		case "Write":
			return [diff(linePatch("", str(input.content)), "add")];
		case "NotebookEdit":
			return [diff(linePatch("", str(input.new_source)), "update")];
		default:
			return [];
	}
}

/** Transcript entries of one normalized event (state changes give none). */
export function transcriptEntries(event: SessionEvent): EntryFields[] {
	const text = (value: string, max = TRANSCRIPT_TEXT_MAX) => {
		const c = cut(value, max);
		return { text: c.text, ...(c.truncated ? { truncated: true } : {}) };
	};
	switch (event.type) {
		case "session.started":
			return [
				{
					type: "session",
					session_id: event.sessionId,
					runtime: event.runtime,
					driver: event.driver,
					model: event.model,
					auth: event.authSource,
				},
			];
		case "item":
			if (event.kind === "message") {
				return [{ type: "message", id: event.id, role: event.role, ...text(event.text ?? "") }];
			}
			if (event.kind === "tool_call") {
				const flag = { cut: false };
				const input = capInput(event.input ?? {}, flag) as Record<string, unknown>;
				return [
					{
						type: "tool_call",
						id: event.id,
						tool: event.tool,
						input,
						...(flag.cut ? { truncated: true } : {}),
					},
					...toolCallDiffs(event.id, event.tool ?? "", event.input ?? {}),
				];
			}
			return [
				{
					type: "tool_result",
					id: event.id,
					...(event.tool ? { tool: event.tool } : {}),
					...text(event.text ?? ""),
					is_error: event.isError === true,
				},
			];
		case "diff":
			return [
				{
					type: "diff",
					id: event.id,
					path: event.path,
					change: event.change,
					...(event.patch ? { patch: cut(event.patch, TRANSCRIPT_PATCH_MAX).text } : {}),
				},
			];
		case "request":
			return [
				{
					type: "request",
					id: event.request.id,
					kind: event.request.kind,
					tool: event.request.tool,
					question: event.request.question,
				},
			];
		case "request.resolved":
			return [
				{ type: "answer", id: event.id, option: event.decision.option, text: event.decision.text },
			];
		case "turn.completed":
			return [{ type: "turn", is_error: event.isError, ...text(event.result) }];
		case "error":
			return [{ type: "error", ...text(event.message) }];
		default:
			return [];
	}
}

/** Next `seq` per transcript file, shared by every writer of the process. */
const nextSeq = new Map<string, number>();

function countLines(file: string): number {
	if (!existsSync(file)) return 0;
	const content = readFileSync(file, "utf-8");
	let n = 0;
	for (const line of content.split("\n")) if (line.trim()) n++;
	return n;
}

/**
 * Appends a step's transcript entries. The supervisor is the only writer of
 * a run's transcripts, so appends need no lock; `seq` continues across the
 * attempts of the step.
 */
export class TranscriptWriter {
	readonly file: string;

	constructor(
		readonly dir: string,
		readonly step: string,
	) {
		this.file = path.join(dir, TRANSCRIPT_FILE);
	}

	/** Writes the entries of one normalized event; `session.started` also writes `session.json`. */
	write(event: SessionEvent): void {
		const entries = transcriptEntries(event);
		if (entries.length === 0) return;
		mkdirSync(this.dir, { recursive: true });
		const at = new Date().toISOString();
		let seq = nextSeq.get(this.file) ?? countLines(this.file) + 1;
		const lines = entries.map((fields) => {
			const entry = { seq: seq++, at, step: this.step, ...fields };
			return `${JSON.stringify(entry)}\n`;
		});
		nextSeq.set(this.file, seq);
		appendFileSync(this.file, lines.join(""), "utf-8");
		if (event.type === "session.started") {
			const session: StepSession = {
				session_id: event.sessionId,
				runtime: event.runtime ?? null,
				driver: event.driver ?? null,
				model: event.model,
				at,
			};
			writeFileSync(
				path.join(this.dir, SESSION_FILE),
				`${JSON.stringify(session, null, 2)}\n`,
				"utf-8",
			);
		}
	}
}

/** The step's last runtime session (`session.json`), or null. */
export function readStepSession(stepDir: string): StepSession | null {
	const file = path.join(stepDir, SESSION_FILE);
	if (!existsSync(file)) return null;
	try {
		const data = JSON.parse(readFileSync(file, "utf-8")) as StepSession;
		return typeof data.session_id === "string" && data.session_id ? data : null;
	} catch {
		return null;
	}
}

// --- Reading ---

/** Cursor: the last `seq` read per step directory. */
export type TranscriptCursor = Record<string, number>;

export class TranscriptCursorError extends Error {}

export function encodeTranscriptCursor(cursor: TranscriptCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

export function decodeTranscriptCursor(value: string | null | undefined): TranscriptCursor | null {
	if (!value) return null;
	try {
		const data = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as unknown;
		if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
		for (const v of Object.values(data)) if (typeof v !== "number") throw new Error("bad position");
		return data as TranscriptCursor;
	} catch {
		throw new TranscriptCursorError(`Invalid logs cursor '${value}'`);
	}
}

export interface TranscriptQuery {
	/** Only this step directory (`01-plan`); all steps when omitted. */
	stepDir?: string | null;
	/** Entries after this cursor; without one, the last `limit` entries (tail). */
	cursor?: string | null;
	limit?: number;
	/** Cut each entry's text, input strings and patch to this length (0: no cut). */
	maxChars?: number;
	/** Drop the oldest entries until the page's JSON is under this size (0: no budget). */
	maxBytes?: number;
}

export interface TranscriptPage {
	entries: TranscriptEntry[];
	cursor: string;
	/** More entries are available after `cursor` at once. */
	more: boolean;
	/** Entries were cut (`max_chars`) or dropped (size budget); `cursor` and `limit` page the rest. */
	truncated: boolean;
}

function readEntries(file: string): TranscriptEntry[] {
	if (!existsSync(file)) return [];
	const entries: TranscriptEntry[] = [];
	for (const line of readFileSync(file, "utf-8").split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line) as TranscriptEntry);
		} catch {
			// A partial last line (being written) is read next time
		}
	}
	return entries;
}

/** Step directories with a transcript, in workflow order. */
export function transcriptDirs(runDir: string): string[] {
	const steps = path.join(runDir, "steps");
	if (!existsSync(steps)) return [];
	return readdirSync(steps)
		.filter((d) => existsSync(path.join(steps, d, TRANSCRIPT_FILE)))
		.sort();
}

function shorten(entry: TranscriptEntry, max: number): TranscriptEntry {
	if (max <= 0) return entry;
	let truncated = entry.truncated === true;
	const c = (value: string | undefined) => {
		if (value === undefined) return undefined;
		const r = cut(value, max);
		if (r.truncated) truncated = true;
		return r.text;
	};
	const out: TranscriptEntry = { ...entry };
	if (out.text !== undefined) out.text = c(out.text);
	if (out.patch !== undefined) out.patch = c(out.patch);
	if (out.question !== undefined) out.question = c(out.question);
	// A long input becomes its cut JSON text
	if (out.input && JSON.stringify(out.input).length > max) {
		out.input = { _summary: c(JSON.stringify(out.input)) };
	}
	if (truncated) out.truncated = true;
	return out;
}

/**
 * A page of a run's transcripts, oldest first, merged across steps by time.
 * Without a cursor, the last `limit` entries; the returned cursor is past
 * every entry that exists now, so the next call returns only new ones.
 */
export function readTranscriptPage(runDir: string, query: TranscriptQuery = {}): TranscriptPage {
	const limit = Math.min(Math.max(query.limit ?? LOGS_DEFAULT_LIMIT, 1), LOGS_MAX_LIMIT);
	const start = decodeTranscriptCursor(query.cursor);
	const dirs = transcriptDirs(runDir).filter((d) => !query.stepDir || d === query.stepDir);
	const position: TranscriptCursor = { ...(start ?? {}) };
	const all: { dir: string; entry: TranscriptEntry }[] = [];
	for (const dir of dirs) {
		const after = start?.[dir] ?? 0;
		for (const entry of readEntries(path.join(runDir, "steps", dir, TRANSCRIPT_FILE))) {
			if (entry.seq > after) all.push({ dir, entry });
		}
	}
	all.sort(
		(a, b) =>
			a.entry.at.localeCompare(b.entry.at) ||
			a.dir.localeCompare(b.dir) ||
			a.entry.seq - b.entry.seq,
	);
	let page: { dir: string; entry: TranscriptEntry }[];
	let more = false;
	if (start) {
		page = all.slice(0, limit);
		more = all.length > limit;
	} else {
		page = all.slice(-limit);
	}
	let truncated = !start && all.length > limit;
	// The cursor moves past what the page returns (tail: past everything)
	for (const { dir, entry } of start ? page : all) {
		position[dir] = Math.max(position[dir] ?? 0, entry.seq);
	}
	const entries = page.map(({ entry }) => shorten(entry, query.maxChars ?? 0));
	if (entries.some((e) => e.truncated)) truncated = true;
	if (query.maxBytes && query.maxBytes > 0) {
		let size = JSON.stringify(entries).length;
		while (entries.length > 1 && size > query.maxBytes) {
			if (start) {
				// Paging forward: drop the newest, the cursor stops before them
				const dropped = page.pop();
				entries.pop();
				if (dropped) position[dropped.dir] = Math.min(position[dropped.dir], dropped.entry.seq - 1);
				more = true;
			} else {
				entries.shift();
			}
			truncated = true;
			size = JSON.stringify(entries).length;
		}
	}
	return { entries, cursor: encodeTranscriptCursor(position), more, truncated };
}
