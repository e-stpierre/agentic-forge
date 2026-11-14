/**
 * `af_ask`: lets an agent inside a running step ask a question (a
 * `needs_input` request) on any runtime, including Claude subagents where
 * `AskUserQuestion` is not available. The tool asks
 * (`POST /v1/runs/:id/ask`), then waits for the answer with supervisor
 * long-polls (`GET /v1/runs/:id/ask/:request`). When `wait_seconds` runs out
 * first it returns `pending`: the agent ends its turn and the answer arrives
 * as an operator message at its next turn.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AskCreated, AskState } from "../runs/ask.js";
import type { SupervisorClient } from "../supervisor/client.js";
import { ToolInputError, jsonResult, withClient } from "./errors.js";
import { type ToolContext, nonEmpty, register, runId } from "./tools.js";

/**
 * Default wait of one af_ask call, in seconds: under the 60 s default MCP
 * tool timeout of Codex (`tool_timeout_sec`). Claude Code's default is far
 * longer, so a Claude agent may pass a longer `wait_seconds`.
 */
export const ASK_DEFAULT_WAIT_SECONDS = 50;
/** Longest wait of one af_ask call, in seconds. */
export const ASK_MAX_WAIT_SECONDS = 3600;
/** Longest single supervisor long-poll (the supervisor caps it at 120 s). */
const POLL_SECONDS = 110;

const PENDING_SESSION =
	"No answer yet. End your turn now (say you are waiting for the answer to this request): the answer arrives as an operator message at the start of your next turn. Do not guess the answer.";
const PENDING_CLI =
	"No answer yet. This step does not run on a live session: end the step with a result block with status awaiting-human (no needs_input needed, the request is already open); the step runs again with the answer in its ## Operator Messages section.";

const optionSchema = z.union([
	nonEmpty("option", "Option label"),
	z.object({
		id: nonEmpty("option id", "Option id (letters, digits, dot, underscore, dash)").optional(),
		label: nonEmpty("option label", "Option label"),
		description: z.string().optional().describe("What choosing it means"),
	}),
]);

export function registerAskTools(server: McpServer, ctx: ToolContext): void {
	register(
		server,
		"af_ask",
		{
			title: "Ask the operator a question",
			description:
				"Asks the operator (the overseer or the user) a question from inside a running af workflow step and waits for the answer; use it instead of guessing a decision you may not take alone, on any runtime and from subagents. Returns { status: answered, request_id, answer, option, from } when answered within `wait_seconds` (default 50), else { status: pending, request_id, next }: then follow `next` (end your turn; the answer arrives at your next turn) and never guess. `run` and `step` default to the AF_RUN_ID and AF_STEP environment variables af sets for the step. `options` are labels or { id, label, description } (ids a, b, ... when omitted); empty for a free-form answer. `recommended` is an option id or label. `kind`: question (default), decision or permission. `risk` (low, medium, high) of a wrong answer: only low-risk non-blocking questions may be answered automatically. `blocking: false` lets a configured timeout apply `recommended`. Call again with only `request_id` to check a question asked before. Withdrawn means the run stopped.",
			inputSchema: {
				question: nonEmpty("question", "The question").optional(),
				options: z
					.array(optionSchema, { error: "options must be a list of labels or { id, label }" })
					.max(26, { error: "at most 26 options" })
					.optional()
					.describe("Choices: labels or { id, label, description }; omit for a free-form answer"),
				recommended: nonEmpty("recommended", "Recommended option id or label").optional(),
				context: z
					.string({ error: "context must be a string" })
					.optional()
					.describe("Evidence and trade-offs the answerer needs"),
				kind: z
					.enum(["question", "decision", "permission"], {
						error: "kind must be question, decision or permission",
					})
					.optional()
					.describe("question (default), decision or permission"),
				risk: z
					.enum(["low", "medium", "high"], { error: "risk must be low, medium or high" })
					.optional()
					.describe("Risk of a wrong answer; omitted counts as not low"),
				blocking: z
					.boolean({ error: "blocking must be a boolean" })
					.optional()
					.describe("false: a configured timeout may apply the recommended option (default true)"),
				wait_seconds: z
					.number({ error: "wait_seconds must be a number" })
					.min(0, { error: "wait_seconds must be >= 0" })
					.max(ASK_MAX_WAIT_SECONDS, {
						error: `wait_seconds must be <= ${ASK_MAX_WAIT_SECONDS}`,
					})
					.optional()
					.describe(
						`How long this call waits for the answer (default ${ASK_DEFAULT_WAIT_SECONDS}); keep it under your client's MCP tool timeout`,
					),
				request_id: nonEmpty(
					"request_id",
					"Check a question asked before instead of asking a new one",
				).optional(),
				run: runId("Run id (default: AF_RUN_ID)").optional(),
				step: nonEmpty("step", "Asking step (default: AF_STEP)").optional(),
			},
		},
		async (input, { signal }) => {
			const env = ctx.env ?? process.env;
			const run = input.run ?? env.AF_RUN_ID;
			if (!run) {
				throw new ToolInputError(
					"No run to ask in: run is not set and AF_RUN_ID is not in the environment.",
					"af_ask only works inside an af workflow step; pass run (and step) when af did not start this agent's MCP server.",
				);
			}
			const route = `/v1/runs/${encodeURIComponent(run)}/ask`;
			const seconds = input.wait_seconds ?? ASK_DEFAULT_WAIT_SECONDS;
			const end = Date.now() + seconds * 1000;
			let requestId = input.request_id;
			let state: AskState | null = null;
			if (!requestId) {
				if (!input.question) {
					throw new ToolInputError(
						"question is required to ask.",
						"Pass question, or request_id to check a question asked before.",
					);
				}
				const step = input.step ?? env.AF_STEP;
				// The first wait happens in the ask call itself
				const wait = Math.min(seconds, POLL_SECONDS);
				const created = await withClient(ctx.clients, (client: SupervisorClient) =>
					client.request<AskCreated & Partial<AskState>>(
						"POST",
						route,
						{
							question: input.question,
							options: input.options ?? [],
							recommended: input.recommended ?? null,
							context: input.context ?? null,
							kind: input.kind ?? "question",
							risk: input.risk ?? null,
							blocking: input.blocking ?? true,
							wait,
							...(step ? { step } : {}),
						},
						(wait + 10) * 1000,
						signal,
					),
				);
				requestId = created.request_id;
				state = created.status ? (created as AskState) : null;
			}
			const route2 = `${route}/${encodeURIComponent(requestId)}`;
			// A canceled call stops polling: the answer then reaches the step as an
			// operator message at its next turn
			while (
				!signal.aborted &&
				(state === null || (state.status === "pending" && Date.now() < end))
			) {
				state = await poll(ctx, route2, Math.max(0, (end - Date.now()) / 1000), signal);
			}
			if (state === null) throw new Error("af_ask was canceled");
			if (state.status === "pending") {
				return jsonResult({ ...state, next: state.session ? PENDING_SESSION : PENDING_CLI });
			}
			return jsonResult(state);
		},
	);
}

/** One long-poll of a request's state (at most `POLL_SECONDS`). */
function poll(
	ctx: ToolContext,
	route: string,
	seconds: number,
	signal: AbortSignal,
): Promise<AskState> {
	const wait = Math.min(seconds, POLL_SECONDS);
	return withClient(
		ctx.clients,
		(client: SupervisorClient) =>
			client.request<AskState>(
				"GET",
				`${route}?wait=${wait}`,
				undefined,
				(wait + 10) * 1000,
				signal,
			),
		{ idempotent: true },
	);
}
