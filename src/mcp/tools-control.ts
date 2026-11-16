/**
 * MCP tools that steer runs: af_send, af_amend, af_answer, af_pause,
 * af_resume, af_cancel and af_retry_step. Each tool validates its input with
 * a zod schema, then makes one call to a supervisor control endpoint
 * (`/v1/runs/:id/{messages,amend,answer,pause,resume,cancel,retry}`).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SupervisorClient } from "../supervisor/client.js";
import { jsonResult, withClient } from "./errors.js";
import { type ToolContext, nonEmpty, register, runId } from "./tools.js";

/** Senders of steering input; MCP clients default to `overseer`. */
export const SENDERS = ["user", "overseer"] as const;

const DEFAULT_SENDER = "overseer";

function fromField() {
	return z
		.enum(SENDERS, { error: "from must be user or overseer" })
		.optional()
		.describe(`Who sends it: user or overseer (default ${DEFAULT_SENDER})`);
}

function control(ctx: ToolContext, run: string, action: string, body: Record<string, unknown>) {
	return withClient(ctx.clients, (client: SupervisorClient) =>
		client.request<unknown>("POST", `/v1/runs/${encodeURIComponent(run)}/${action}`, body),
	);
}

export function registerControlTools(server: McpServer, ctx: ToolContext): void {
	register(
		server,
		"af_send",
		{
			title: "Send an operator message to a run",
			description:
				"Queues an operator message for a run that has not ended (queued, running, paused, blocked or awaiting-human) and returns { id, message } with the queued message. The message is injected as an ## Operator Messages section at the start of the next step prompt (`mode: next`, the default), or of the named `step` only. `mode: now` kills the running step and restarts it at once with the message (on a run that is not executing it waits for the next step). An unknown `step` is rejected with the list of step names; a finished run returns a 409. Use af_amend instead to change the plan, af_answer to reply to a needs_input question. Next: follow the run with af_events.",
			inputSchema: {
				run: runId("Run id"),
				text: nonEmpty("text", "Message text"),
				mode: z
					.enum(["next", "now"], { error: "mode must be next or now" })
					.optional()
					.describe("next: at the next step (default); now: restart the running step with it"),
				step: nonEmpty("step", "Only deliver the message to this step").optional(),
				from: fromField(),
			},
		},
		async (input) =>
			jsonResult(
				await control(ctx, input.run, "messages", {
					text: input.text,
					mode: input.mode ?? "next",
					step: input.step ?? null,
					from: input.from ?? DEFAULT_SENDER,
				}),
			),
	);

	register(
		server,
		"af_amend",
		{
			title: "Amend a run's plan",
			description:
				"Records an amendment (a change of scope or plan) for a run that has not ended and returns { id, amendment (A001, A002, ...), delivery, step, message }. When the workflow sets settings.amend.step, delivery is amend-step: that step runs again at the next step boundary to rewrite the plan, then the later steps read the new plan. Otherwise delivery is message: the amendment is recorded at once and delivered to the next step as an operator message. `affects` lists the milestone IDs it changes (for example M2). Use af_send for guidance that does not change the plan. Next: follow the run with af_events (amendment.applied), then af_artifacts kind plan.",
			inputSchema: {
				run: runId("Run id"),
				text: nonEmpty("text", "What changes in the plan"),
				affects: z
					.array(nonEmpty("affects entry", "Milestone ID"), {
						error: "affects must be a list of milestone IDs",
					})
					.optional()
					.describe("Milestone IDs the amendment changes (for example M2)"),
				from: fromField(),
			},
		},
		async (input) =>
			jsonResult(
				await control(ctx, input.run, "amend", {
					text: input.text,
					affects: input.affects ?? [],
					from: input.from ?? DEFAULT_SENDER,
				}),
			),
	);

	register(
		server,
		"af_answer",
		{
			title: "Answer a run's question",
			description:
				"Answers the pending needs_input question of a run in awaiting-human status and resumes it; returns { id, request, message, status: queued }. `request_id` is the question id from the needs_input event (af_events) or from run['x-af-needs-input'] in af_status; when given it must match the pending request. `answer` is an option id of the question (for example a) or free text. The asking step runs again with the answer in its ## Operator Messages section. A run that is not awaiting-human returns a 409. Next: follow the run with af_events.",
			inputSchema: {
				run: runId("Run id"),
				answer: nonEmpty("answer", "Option id of the question, or free text"),
				request_id: nonEmpty(
					"request_id",
					"Id of the needs_input request (from the needs_input event or af_status)",
				).optional(),
				from: fromField(),
			},
		},
		async (input) =>
			jsonResult(
				await control(ctx, input.run, "answer", {
					...(input.request_id ? { request_id: input.request_id } : {}),
					answer: input.answer,
					from: input.from ?? DEFAULT_SENDER,
				}),
			),
	);

	register(
		server,
		"af_pause",
		{
			title: "Pause a run",
			description:
				"Pauses a queued or running run and returns { id, status }. A queued run is paused at once (status paused). A running run stops at its next step or ralph-loop iteration boundary (status pausing); with `now: true` the running step is killed and reruns on resume. Any other status returns a 409. Next: af_events until run.paused, then af_resume to continue or af_cancel to stop for good.",
			inputSchema: {
				run: runId("Run id"),
				now: z
					.boolean({ error: "now must be a boolean" })
					.optional()
					.describe("Kill the running step now instead of waiting for the step boundary"),
			},
		},
		async (input) =>
			jsonResult(await control(ctx, input.run, "pause", { now: input.now === true })),
	);

	register(
		server,
		"af_resume",
		{
			title: "Resume a run",
			description:
				"Re-queues a paused, awaiting-human, blocked or failed run and returns { id, status: queued }; it continues from the step that did not complete. Resuming an awaiting-human run without an answer reruns the asking step (prefer af_answer). Any other status (queued, running or a final one) returns a 409. Use af_retry_step to rerun an earlier step. Next: follow the run with af_events.",
			inputSchema: {
				run: runId("Run id"),
			},
		},
		async (input) => jsonResult(await control(ctx, input.run, "resume", {})),
	);

	register(
		server,
		"af_cancel",
		{
			title: "Cancel a run",
			description:
				"Cancels a run that has not ended (queued, running, paused, blocked or awaiting-human) and returns { id, status }: canceled at once for a run that is not executing, canceling for a running run (its step is killed, then the safety commit and the worktree policy apply). Canceled is final: the run cannot be resumed. A finished run returns a 409. Use af_pause to stop a run you may continue. Next: af_status to confirm the canceled status.",
			inputSchema: {
				run: runId("Run id"),
			},
		},
		async (input) => jsonResult(await control(ctx, input.run, "cancel", {})),
	);

	register(
		server,
		"af_retry_step",
		{
			title: "Retry a step of a run",
			description:
				"Reruns a top-level step of a stopped run (failed, paused, blocked or awaiting-human): that step and every later one run again, even when they completed, and the run is re-queued; returns { id, step, message, status: queued }. `context` is extra guidance queued as an operator message for that step (message is its id, or null). A step that is not top-level is rejected with the list of step names; a queued, running or finished run returns a 409. Next: follow the run with af_events.",
			inputSchema: {
				run: runId("Run id"),
				step: nonEmpty("step", "Name of the top-level step to rerun"),
				context: nonEmpty("context", "Extra guidance for the rerun").optional(),
				from: fromField(),
			},
		},
		async (input) =>
			jsonResult(
				await control(ctx, input.run, "retry", {
					step: input.step,
					...(input.context ? { context: input.context } : {}),
					from: input.from ?? DEFAULT_SENDER,
				}),
			),
	);
}
