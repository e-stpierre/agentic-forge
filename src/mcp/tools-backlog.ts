/**
 * MCP tools of the overseer backlog: af_backlog_list, af_backlog_add and
 * af_backlog_update over `/v1/overseer/:id/backlog`. The harness is the single
 * writer of `backlog.json`; these tools are the only way the overseer changes it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ITEM_SOURCES, ITEM_STATUSES, NEW_STATUSES, SETTABLE_STATUSES, TRACKS } from "../runs/backlog.js";
import type { SupervisorClient } from "../supervisor/client.js";
import { jsonResult, withClient } from "./errors.js";
import { type ToolContext, nonEmpty, register, runId } from "./tools.js";

const READ = { idempotent: true } as const;

/** Item without timestamps, empty lists, nulls or the dedupe key (smaller results). */
export function compactItem(item: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(item)) {
		if (key === "created_at" || key === "updated_at") continue;
		if (value === null || (Array.isArray(value) && value.length === 0)) continue;
		if (key === "discovered" && typeof value === "object") {
			const { key: _key, ...rest } = value as Record<string, unknown>;
			out[key] = Object.fromEntries(
				Object.entries(rest).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0)),
			);
			continue;
		}
		out[key] = value;
	}
	return out;
}

function compactItems(body: Record<string, unknown>, field: string): Record<string, unknown> {
	const list = body[field];
	if (Array.isArray(list)) return { ...body, [field]: list.map((i) => compactItem(i)) };
	if (list && typeof list === "object") return { ...body, [field]: compactItem(list as Record<string, unknown>) };
	return body;
}

function backlogPath(run: string, item?: string): string {
	const base = `/v1/overseer/${encodeURIComponent(run)}/backlog`;
	return item ? `${base}/${encodeURIComponent(item)}` : base;
}

const track = z
	.enum(TRACKS, { error: `track must be one of ${TRACKS.join(", ")}` })
	.describe("Triage: instruction (one step), light or full workflow");
const idList = (field: string, description: string) =>
	z
		.array(nonEmpty(`${field} entry`, description), { error: `${field} must be a list of strings` })
		.describe(description);

function itemFields(statuses: readonly string[]) {
	return {
		title: nonEmpty("title", "Short title of the task"),
		description: nonEmpty("description", "What to do and the acceptance, in a few lines").optional(),
		status: z
			.enum(statuses as [string, ...string[]], { error: `status must be one of ${statuses.join(", ")}` })
			.optional(),
		track: track.optional(),
		track_reason: nonEmpty("track_reason", "Why this track (required with a track)").optional(),
		depends_on: idList("depends_on", "Item ids that must be done first (for example T01)").optional(),
		conflict_zones: idList(
			"conflict_zones",
			"Paths or modules the task touches (for example src/runs, docs/cli.md); none: it runs alone",
		).optional(),
		priority: z
			.number({ error: "priority must be an integer" })
			.int({ error: "priority must be an integer" })
			.optional()
			.describe("Higher first (default 0)"),
		workflow: nonEmpty("workflow", "Workflow to dispatch for it").optional(),
		notes: nonEmpty("notes", "Notes for later sessions").optional(),
	};
}

export function registerBacklogTools(server: McpServer, ctx: ToolContext): void {
	register(
		server,
		"af_backlog_list",
		{
			title: "List an overseer backlog",
			description:
				"Returns the backlog of an overseer run: { items, runnable, waiting, running, max_parallel, halt, budgets, budgets_used }. Items whose run ended already carry its outcome (done, failed, halted, canceled). `runnable` lists the ready items af_dispatch accepts now (dependencies done, no conflict zone overlap with a running item, max_parallel); `waiting` says why each other ready item waits; `halt` is set when halt_epic_on stops new dispatches (ask the user). `status` filters the items (comma-separated statuses). Next: af_dispatch with item for a runnable id.",
			inputSchema: {
				run: runId("Overseer run id"),
				status: nonEmpty("status", `Only items of these statuses, comma-separated (${ITEM_STATUSES.join(", ")})`).optional(),
			},
		},
		async (input) => {
			const query = input.status ? `?status=${encodeURIComponent(input.status)}` : "";
			const body = await withClient(
				ctx.clients,
				(client: SupervisorClient) =>
					client.request<Record<string, unknown>>("GET", `${backlogPath(input.run)}${query}`),
				READ,
			);
			return jsonResult(compactItems(body, "items"));
		},
	);

	register(
		server,
		"af_backlog_add",
		{
			title: "Add items to an overseer backlog",
			description:
				`Adds tasks to the backlog of an open overseer run and returns { added, runnable }. Ids are assigned in order (T01, T02, ...); in one call, depends_on may name the ids the earlier items of the batch get. New items are proposed (the user approves them) unless status is ready (needs track and track_reason) or logged (recorded, never scheduled). source is ${ITEM_SOURCES.filter((s) => s !== "discovered").join(", ")} (default user). Unknown dependencies, cycles and items past budgets.max_tasks are refused. Discovered items of child runs are added by the harness. Next: af_backlog_update to triage and approve, then af_backlog_list.`,
			inputSchema: {
				run: runId("Overseer run id"),
				items: z
					.array(
						z.object({
							...itemFields(NEW_STATUSES),
							source: z
								.enum(["epic", "user", "overseer"], { error: "source must be epic, user or overseer" })
								.optional(),
						}),
						{ error: "items must be a list of items" },
					)
					.min(1, { error: "items must not be empty" })
					.describe("Items to add"),
			},
		},
		async (input) => {
			const body = await withClient(ctx.clients, (client: SupervisorClient) =>
				client.request<Record<string, unknown>>("POST", backlogPath(input.run), { items: input.items }),
			);
			return jsonResult(compactItems(body, "added"));
		},
	);

	const { title: _title, ...updatable } = itemFields(SETTABLE_STATUSES);
	register(
		server,
		"af_backlog_update",
		{
			title: "Update an overseer backlog item",
			description:
				"Changes fields of one backlog item and returns { item, runnable }. Triage: track with track_reason. Approve: status ready (needs a track). Retry a failed, halted or canceled item: status ready. Drop or log it: dropped or logged. running and the run outcomes are set by the harness (af_dispatch with item starts an item), a done item cannot change, and a running item keeps its conflict zones. Next: af_backlog_list or af_dispatch with item.",
			inputSchema: {
				run: runId("Overseer run id"),
				id: nonEmpty("id", "Item id (for example T03)"),
				fields: z
					.object({ title: nonEmpty("title", "Short title of the task").optional(), ...updatable })
					.describe("Fields to change"),
			},
		},
		async (input) => {
			const body = await withClient(ctx.clients, (client: SupervisorClient) =>
				client.request<Record<string, unknown>>("POST", backlogPath(input.run, input.id), {
					fields: input.fields,
				}),
			);
			return jsonResult(compactItems(body, "item"));
		},
	);
}
