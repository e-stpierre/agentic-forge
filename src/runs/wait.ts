/**
 * Waiting for a run (`af_wait`, `af_dispatch` with `wait`, `af wait`, `af run
 * --wait`): the conditions a waiter wakes on and the small result it gets.
 * The supervisor evaluates them in `RunManager.waitRun()` behind
 * `GET /v1/runs/:id/wait`.
 *
 * A waiter loops with the returned `cursor` (the last event seq it has seen),
 * so an attention event is reported once.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { type RunStatus, TERMINAL_RUN_STATUSES } from "../contract/index.js";
import type { ResultBlock } from "../contract/result.js";
import type { RunEvent } from "./run-store.js";
import { stepDirName } from "./transcript.js";

export const WAIT_CONDITIONS = ["terminal", "attention"] as const;
export type WaitCondition = (typeof WAIT_CONDITIONS)[number];

/** Default wait of one af_wait call (seconds): under the 60 s MCP tool timeout of Codex and MCP SDK clients. */
export const DEFAULT_WAIT_SECONDS = 50;
/** Longest wait of one af_wait call (an agent on Claude Code, whose tool timeout is far longer, may pass more). */
export const MAX_WAIT_SECONDS = 3600;
/** Longest wait of one supervisor request; a longer wait loops on the client. */
export const MAX_WAIT_REQUEST_SECONDS = 120;

/** Result block summary length in a wait result (the full block is in `result_path`). */
export const WAIT_SUMMARY_MAX = 1000;
/** Error and question length in a wait result. */
const WAIT_TEXT_MAX = 500;

/** Run statuses that need the waiter's attention without being final. */
const ATTENTION_STATUSES: readonly RunStatus[] = ["awaiting-human", "paused", "blocked"];
/** Events after the cursor that wake an `attention` waiter. */
const ATTENTION_EVENTS = new Set(["needs_input", "step.failed", "run.paused"]);

export interface WaitResultBlock {
	status: string;
	summary: string;
	pr: string | null;
	max_risk: string | null;
	needs_input?: unknown;
	/** True when `summary` was cut (read `result_path` for the rest). */
	truncated?: boolean;
}

export interface WaitResult {
	run: string;
	/** Run status now. */
	status: RunStatus;
	/** `ended` (final status), `attention` (needs the waiter) or `waiting` (the wait ran out). */
	state: "ended" | "attention" | "waiting";
	/** Last event seq seen: pass it back to wait again without seeing the same events. */
	cursor: number;
	/** What woke the waiter: the final status, or the attention event type. */
	reason?: string;
	/** Last step that reported a result block. */
	step?: string | null;
	/** That step's result block (summary cut to {@link WAIT_SUMMARY_MAX}). */
	result?: WaitResultBlock | null;
	/** Path of its `result.json`. */
	result_path?: string | null;
	/** Open needs_input requests (answer them with af_answer). */
	needs_input?: {
		id: string;
		step: string;
		kind: string | null;
		risk: string | null;
		question: string;
		recommended: string | null;
	}[];
	/** Error of the last failed step or run, cut to 500 characters. */
	error?: string | null;
}

export function isWaitCondition(value: unknown): value is WaitCondition {
	return (WAIT_CONDITIONS as readonly unknown[]).includes(value);
}

export function isTerminal(status: string): boolean {
	return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

function cut(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/**
 * Whether a waiter wakes now: on a final status, and with `attention` on an
 * attention event after the cursor, or (first call, no cursor) a run that
 * already waits for someone. Returns the reason, or null to keep waiting.
 */
export function wakeReason(
	condition: WaitCondition,
	status: RunStatus,
	events: readonly RunEvent[],
	firstCall: boolean,
): string | null {
	if (isTerminal(status)) return status;
	if (condition !== "attention") return null;
	const event = events.find((e) => ATTENTION_EVENTS.has(e.type));
	if (event) return event.type;
	if (firstCall && ATTENTION_STATUSES.includes(status)) return status;
	return null;
}

/** The newest `steps/<NN-step>/result.json` of a run (by write time), or null. */
export function latestResult(
	runDir: string,
	names: readonly string[] | null = null,
): { step: string; path: string; block: ResultBlock } | null {
	const stepsDir = path.join(runDir, "steps");
	if (!existsSync(stepsDir)) return null;
	let best: { step: string; path: string; mtime: number } | null = null;
	for (const dir of readdirSync(stepsDir, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		const file = path.join(stepsDir, dir.name, "result.json");
		if (!existsSync(file)) continue;
		const mtime = statSync(file).mtimeMs;
		if (!best || mtime >= best.mtime) {
			const step =
				names?.find((n) => stepDirName([...names], n) === dir.name) ??
				dir.name.replace(/^\d+-/, "");
			best = { step, path: file, mtime };
		}
	}
	if (!best) return null;
	try {
		const block = JSON.parse(readFileSync(best.path, "utf-8")) as ResultBlock;
		return { step: best.step, path: best.path, block };
	} catch {
		return null;
	}
}

/** The result block fields a waiter reads, with the summary cut. */
export function waitResultBlock(block: ResultBlock): WaitResultBlock {
	const summary = typeof block.summary === "string" ? block.summary : "";
	const out: WaitResultBlock = {
		status: block.status,
		summary: cut(summary, WAIT_SUMMARY_MAX),
		pr: block.pr ?? null,
		max_risk: block.max_risk ?? null,
	};
	if (block.needs_input) out.needs_input = block.needs_input;
	if (summary.length > WAIT_SUMMARY_MAX) out.truncated = true;
	return out;
}

/** The error of the last `run.failed` or `step.failed` event, cut. */
export function lastError(events: readonly RunEvent[]): string | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i];
		if (e.type !== "run.failed" && e.type !== "step.failed") continue;
		const error = e.data?.error;
		if (typeof error === "string" && error) return cut(error, WAIT_TEXT_MAX);
	}
	return null;
}

export function cutQuestion(question: unknown): string {
	return cut(typeof question === "string" ? question : "", WAIT_TEXT_MAX);
}
