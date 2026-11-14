/**
 * Harness contract v1: step result blocks.
 *
 * A Reporting step prints one JSON object on the last line of its output (see
 * docs/harness-contract.md, Result Block). The harness reads it to set the step
 * and run status, and falls back to the process exit code when it is missing.
 */

import { type ResultStatus, validateArtifact } from "./index.js";

export interface NeedsInputOption {
	id: string;
	label: string;
	description?: string;
}

/** What a `needs_input` request asks for (contract `needs_input.kind`). */
export type NeedsInputKind = "question" | "permission" | "decision";

/** Contract `needs-input.schema.json`. */
export interface NeedsInput {
	id: string;
	question: string;
	options: NeedsInputOption[];
	recommended: string | null;
	context?: string;
	blocking: boolean;
	/** Absent means `decision`. */
	kind?: NeedsInputKind;
	/** Absent counts as not low (no automatic answer). */
	risk?: "low" | "medium" | "high";
	[key: `x-${string}`]: unknown;
}

/** Contract `result.schema.json`. */
export interface ResultBlock {
	contract_version?: 1;
	status: ResultStatus;
	summary: string;
	files_changed?: string[];
	commit?: string | null;
	pr?: string | null;
	gates?: Record<string, "pass" | "fail" | "skipped">;
	max_risk?: "low" | "medium" | "high" | null;
	outputs?: Record<string, unknown>;
	discovered_items?: Record<string, unknown>[];
	needs_input?: NeedsInput | null;
	blockers?: string[];
	[key: `x-${string}`]: unknown;
}

function asResultBlock(text: string): ResultBlock | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
	try {
		const value = JSON.parse(trimmed) as unknown;
		return validateArtifact("result", value).valid ? (value as ResultBlock) : null;
	} catch {
		return null;
	}
}

/**
 * Extracts the result block of a step output: the last non-empty line (code
 * fence lines ignored), or, as a tolerance for models that pretty-print it,
 * the last fenced JSON block. Returns null when there is no valid block.
 */
export function parseResultBlock(output: string | null | undefined): ResultBlock | null {
	if (!output) return null;
	const lines = output.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (line === "" || line.startsWith("```")) continue;
		const block = asResultBlock(line);
		if (block) return block;
		break;
	}
	const fenced = [...output.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)];
	for (let i = fenced.length - 1; i >= 0; i--) {
		const block = asResultBlock(fenced[i][1]);
		if (block) return block;
	}
	return null;
}

/**
 * Result status implied by a process exit code when a step printed no valid
 * result block (contract Exit Codes: 0 done, 10 awaiting-human, 20 halted,
 * 30 escalate, anything else failed).
 */
export function resultStatusFromExit(code: number): ResultStatus {
	switch (code) {
		case 0:
			return "done";
		case 10:
			return "awaiting-human";
		case 20:
			return "halted";
		case 30:
			return "escalate";
		default:
			return "failed";
	}
}

/**
 * Process exit code for a run status, used by `af run --foreground` and
 * `af resume --foreground`: a `blocked` run (a step escalated) exits 30.
 */
export function exitCodeForRun(status: string): number {
	switch (status) {
		case "done":
		case "merged":
			return 0;
		case "awaiting-human":
			return 10;
		case "halted":
			return 20;
		case "blocked":
			return 30;
		default:
			return 1;
	}
}
