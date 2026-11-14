/**
 * `af_ask`: a question an agent asks from inside a running step, through the
 * af MCP server (`POST /v1/runs/:id/ask`). The request is a contract
 * `needs_input` with the same `x-af-needs-input` entry, `needs_input` event,
 * `af answer` endpoint and decision logging as any other request. The asking
 * tool call waits for the answer with long-polls
 * (`GET /v1/runs/:id/ask/:request`); when it gives up first (`pending`), the
 * answer reaches the step as an operator message at its next turn.
 */

import { randomBytes } from "node:crypto";

import {
	type NeedsInput,
	type NeedsInputKind,
	type NeedsInputOption,
	validateArtifact,
} from "../contract/index.js";

/** Body of `POST /v1/runs/:id/ask`. */
export interface AskInput {
	/** Asking step; defaults to the run's only live session step, else its current step. */
	step?: string | null;
	question?: string;
	/** Option objects, or labels (ids `a`, `b`, ... are assigned). Empty for a free-form answer. */
	options?: (string | { id?: string; label?: string; description?: string })[];
	/** Recommended option id or label. */
	recommended?: string | null;
	context?: string | null;
	/** Default true. */
	blocking?: boolean;
	/** Default `question`. */
	kind?: string;
	risk?: string | null;
	/** Seconds to wait for the answer in the same call (max 120); 0 returns at once. */
	wait?: number;
}

/** Result of `POST /v1/runs/:id/ask` (with `wait`, also the `AskState` fields). */
export interface AskCreated {
	run: string;
	request_id: string;
	step: string;
	/** True when the step runs on a live session (the answer reaches its next turn). */
	session: boolean;
}

/** Result of `GET /v1/runs/:id/ask/:request`. */
export type AskState =
	| {
			status: "answered";
			run: string;
			request_id: string;
			answer: string;
			option: string | null;
			from: string;
	  }
	| { status: "pending"; run: string; request_id: string; session: boolean }
	/** The request is gone without an answer (the run was paused, canceled or ended). */
	| { status: "withdrawn"; run: string; request_id: string; reason: string };

const KINDS: readonly NeedsInputKind[] = ["question", "permission", "decision"];
const RISKS = ["low", "medium", "high"] as const;
const OPTION_IDS = "abcdefghijklmnopqrstuvwxyz";

export class AskInputError extends Error {}

/** Request id of an `af_ask` question. */
export function newAskId(): string {
	return `ask-${randomBytes(4).toString("hex")}`;
}

/**
 * Validates an `af_ask` body and builds its contract `needs_input` request.
 * Throws `AskInputError` with a message the agent can act on.
 */
export function askRequest(id: string, input: AskInput): NeedsInput {
	const question = typeof input.question === "string" ? input.question.trim() : "";
	if (!question) throw new AskInputError("question is required");
	const options = (input.options ?? []).map((raw, i): NeedsInputOption => {
		const o = typeof raw === "string" ? { label: raw } : (raw ?? {});
		const label = typeof o.label === "string" ? o.label.trim() : "";
		if (!label) throw new AskInputError(`options[${i}] needs a label`);
		const optionId = typeof o.id === "string" && o.id.trim() ? o.id.trim() : OPTION_IDS[i];
		if (!optionId) throw new AskInputError("at most 26 options without ids");
		return o.description
			? { id: optionId, label, description: o.description }
			: { id: optionId, label };
	});
	const ids = options.map((o) => o.id);
	if (new Set(ids).size !== ids.length) throw new AskInputError("option ids must be unique");
	let recommended: string | null = null;
	if (typeof input.recommended === "string" && input.recommended.trim()) {
		const wanted = input.recommended.trim();
		const match =
			options.find((o) => o.id === wanted) ??
			options.find((o) => o.label.toLowerCase() === wanted.toLowerCase());
		if (!match) {
			throw new AskInputError(
				`recommended '${wanted}' is not an option id or label (${ids.join(", ") || "no options"})`,
			);
		}
		recommended = match.id;
	}
	const kind = input.kind ?? "question";
	if (!KINDS.includes(kind as NeedsInputKind)) {
		throw new AskInputError(`kind must be one of ${KINDS.join(", ")}`);
	}
	const risk = input.risk ?? null;
	if (risk !== null && !(RISKS as readonly string[]).includes(risk)) {
		throw new AskInputError(`risk must be one of ${RISKS.join(", ")}`);
	}
	const request: NeedsInput = {
		id,
		question,
		options,
		recommended,
		blocking: input.blocking !== false,
		kind: kind as NeedsInputKind,
	};
	if (typeof input.context === "string" && input.context.trim()) request.context = input.context;
	if (risk) request.risk = risk as NeedsInput["risk"];
	const check = validateArtifact("needs-input", request);
	if (!check.valid) {
		throw new AskInputError(
			`invalid request: ${check.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`,
		);
	}
	return request;
}
