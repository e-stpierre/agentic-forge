/**
 * MCP tools that steer runs: af_send, af_amend, af_answer, af_pause,
 * af_resume, af_cancel and af_retry_step, plus af_notify. Each tool validates
 * its input with a zod schema, then makes one call to a supervisor control
 * endpoint (`/v1/runs/:id/{messages,amend,answer,pause,resume,cancel,retry}`,
 * `/v1/notifications`).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NOTIFICATION_LEVELS, type NotificationLevel } from "../notifications/config.js";
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

/** Run of the step whose agent calls the tool (`AF_RUN_ID`); unset for the operator and the overseer. */
function stepRun(ctx: ToolContext): string | undefined {
	return (ctx.env ?? process.env).AF_RUN_ID || undefined;
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
				"Queues an operator message for a run that has not ended; returns { id, message, steered }. mode next (default): injected as ## Operator Messages at the next step (or the named `step`), or as the next turn of a live session. mode now: steers the live session at its next tool call, or restarts a cli-driver step with it. Use af_amend to change the plan, af_answer for a needs_input.",
			inputSchema: {
				run: runId("Run id"),
				text: nonEmpty("text", "Message text"),
				mode: z
					.enum(["next", "now"], { error: "mode must be next or now" })
					.optional()
					.describe(
						"next: at the next step or session turn (default); now: steer the live session, or restart the running step with it",
					),
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
				"Records a plan amendment for a run that has not ended; returns { id, amendment, delivery, step, message }. With settings.amend.step, that step reruns at the next boundary to rewrite the plan (delivery amend-step); otherwise it is delivered as an operator message. `affects` lists milestone IDs (M2). Use af_send for guidance that keeps the plan.",
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
				"Answers an open needs_input request of an awaiting-human run and resumes it; returns { id, request, message, status }. `answer` is an option id or free text (allow or deny for a permission request). `request_id` (from af_wait, af_status or the event) is required when several are open. A live session gets the answer directly; otherwise the asking step reruns with it. From inside a run, only requests of runs it dispatched.",
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
					// From inside a run: only its descendants' non-permission requests
					...(stepRun(ctx) ? { caller: stepRun(ctx) } : {}),
				}),
			),
	);

	register(
		server,
		"af_pause",
		{
			title: "Pause a run",
			description:
				"Pauses a queued or running run; returns { id, status }. A running run stops at its next step or iteration boundary (pausing); `now: true` kills the running step, which reruns on resume. Next: af_resume to continue, af_cancel to stop for good.",
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
				"Re-queues a paused, awaiting-human, blocked or failed run from the step that did not complete; returns { id, status: queued }. For an awaiting-human run prefer af_answer; to rerun an earlier step use af_retry_step. Next: af_wait.",
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
				"Cancels a run that has not ended; returns { id, status } (canceled, or canceling while its step is killed). Final: a canceled run cannot be resumed. Use af_pause to stop a run you may continue.",
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
				"Reruns a top-level step of a failed, paused, blocked or awaiting-human run, and every later step; returns { id, step, message, status: queued }. `context` is queued as an operator message for that step. Next: af_wait.",
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

	register(
		server,
		"af_notify",
		{
			title: "Notify the user",
			description:
				"Sends a message to the user's enabled notification channels (desktop, ntfy, Slack, Discord, GitHub comment on the run's PR); returns { sent, errors, event }. With `run`, its config picks the channels and it gets a notification.sent event. Use it when the user must act; needs_input, run.failed and run.halted are already notified.",
			inputSchema: {
				text: nonEmpty("text", "Message text"),
				level: z
					.enum(NOTIFICATION_LEVELS as [NotificationLevel, ...NotificationLevel[]], {
						error: "level must be info, warning or error",
					})
					.optional()
					.describe("info (default), warning or error"),
				run: runId("Run the notification is about").optional(),
				title: nonEmpty("title", "Notification title").optional(),
			},
		},
		async (input) =>
			jsonResult(
				await withClient(ctx.clients, (client: SupervisorClient) =>
					client.request<unknown>("POST", "/v1/notifications", {
						text: input.text,
						level: input.level ?? "info",
						run: input.run ?? null,
						title: input.title ?? null,
					}),
				),
			),
	);
}
