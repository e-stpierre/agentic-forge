/**
 * MCP tools that dispatch and read runs: af_dispatch, af_status,
 * af_list_runs, af_events and af_artifacts (the steering tools are in
 * tools-control.ts). Each tool validates its input with a zod schema, then
 * makes one supervisor call (af_artifacts reads the run registry and the run
 * directory directly, like `af artifacts`).
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { listAvailableWorkflows, resolveWorkflowPath } from "../commands/run.js";
import type { RunStatus } from "../contract/index.js";
import { ARTIFACT_KINDS, listArtifacts, readArtifact } from "../runs/artifacts.js";
import { dispatchRun, fetchEvents } from "../runs/client.js";
import { buildDispatchPayload } from "../runs/dispatch.js";
import { DEFAULT_EVENT_LIMIT } from "../runs/events.js";
import type { RunDetails } from "../runs/manager.js";
import { type RegistryEntry, RunRegistry } from "../runs/registry.js";
import { type ClientCache, ToolInputError, jsonResult, toolError, withClient } from "./errors.js";

/** Everything a tool handler needs besides its input. */
export interface ToolContext {
	clients: ClientCache;
	/** af global dir of the run registry (defaults to `getGlobalRoot()`). */
	registryRoot?: string;
	/** Base directory of relative `repo` inputs and the default repository. */
	cwd: string;
}

export const RUN_STATUS_VALUES = [
	"queued",
	"running",
	"paused",
	"blocked",
	"awaiting-human",
	"halted",
	"failed",
	"canceled",
	"done",
	"merged",
] as const satisfies readonly RunStatus[];

/** Statuses of runs that have not ended (`af_status` without a run). */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = [
	"queued",
	"running",
	"paused",
	"blocked",
	"awaiting-human",
];

/** Longest `wait_seconds` of af_events (the supervisor cap, `MAX_EVENT_WAIT_SECONDS`). */
export const MAX_WAIT_SECONDS = 120;

const DEFAULT_LIST_LIMIT = 50;

export const LIST_RUNS_HINT = "use af_list_runs to find run ids";

export function runId(description: string) {
	return z
		.string({ error: `run must be a run id string (${LIST_RUNS_HINT})` })
		.min(1, { error: `run must be a non-empty run id (${LIST_RUNS_HINT})` })
		.describe(description);
}

export function nonEmpty(field: string, description: string) {
	return z
		.string({ error: `${field} must be a string` })
		.min(1, { error: `${field} must not be empty` })
		.describe(description);
}

const statusEnum = z.enum(RUN_STATUS_VALUES, {
	error: `status must be one of ${RUN_STATUS_VALUES.join(", ")}`,
});

/** Registers a tool whose handler errors become `isError` results with a next step. */
export function register<Shape extends z.ZodRawShape>(
	server: McpServer,
	name: string,
	config: { title: string; description: string; inputSchema: Shape },
	handler: (input: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>,
): void {
	server.registerTool(name, config, (async (input: z.infer<z.ZodObject<Shape>>) => {
		try {
			return await handler(input);
		} catch (err) {
			return toolError(name, err);
		}
		// The SDK's callback type is generic over every zod flavor; the handler
		// receives the input parsed by `inputSchema`.
	}) as unknown as Parameters<McpServer["registerTool"]>[2]);
}

function resolveRepo(cwd: string, repo: string | undefined): string {
	const resolved = path.resolve(cwd, repo ?? ".");
	if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
		throw new ToolInputError(
			`Repository directory not found: ${resolved}`,
			"Pass repo as the absolute path of an existing repository directory.",
		);
	}
	return resolved;
}

function resolveWorkflow(workflow: string, repo: string): { path: string; location: string } {
	const [workflowPath, location] = resolveWorkflowPath(workflow, repo);
	if (existsSync(workflowPath) && statSync(workflowPath).isFile()) {
		return { path: workflowPath, location };
	}
	const names = [...new Set(listAvailableWorkflows(repo).map(([name]) => name))];
	const shown = names.slice(0, 20).join(", ");
	const more = names.length > 20 ? ` and ${names.length - 20} more` : "";
	throw new ToolInputError(
		`Workflow not found: ${workflow} (searched ${path.join(repo, "agentic", "workflows")}, the user-global and the bundled workflows)`,
		names.length > 0
			? `Pass one of these names: ${shown}${more}; or a path to a workflow YAML file (absolute, or relative to repo).`
			: "Pass a path to a workflow YAML file (absolute, or relative to repo).",
	);
}

function newestFirst(runs: RegistryEntry[]): RegistryEntry[] {
	return [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function runsQuery(filter: Record<string, string | undefined>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filter)) {
		if (value !== undefined && value !== "") params.set(key, value);
	}
	const query = params.toString();
	return `/v1/runs${query ? `?${query}` : ""}`;
}

export function registerRunTools(server: McpServer, ctx: ToolContext): void {
	register(
		server,
		"af_dispatch",
		{
			title: "Dispatch a workflow run",
			description:
				"Queues a run of an agentic-forge workflow in the af supervisor and returns at once with { run_id, status, dir, workflow, warnings }; the run then executes in the background. `workflow` is a workflow name (looked up in <repo>/agentic/workflows, then the user-global and the bundled workflows) or a path to a YAML file (absolute, or relative to repo). `repo` is the repository the run works in (default: the MCP server's working directory). `vars` sets workflow variables; a missing required variable is rejected with its name. The returned status is usually queued or running. Next: follow the run with af_events (run, wait_seconds) or check it with af_status (run).",
			inputSchema: {
				workflow: nonEmpty("workflow", "Workflow name or path to a workflow YAML file"),
				repo: nonEmpty(
					"repo",
					"Repository root the run works in (absolute, or relative to the server's cwd)",
				).optional(),
				vars: z
					.record(z.string(), z.union([z.string(), z.number(), z.boolean()]), {
						error: "vars must be an object of variable names to string, number or boolean values",
					})
					.optional()
					.describe("Workflow variables (numbers and booleans are passed as strings)"),
				runtime: z
					.enum(["claude", "codex"], { error: "runtime must be claude or codex" })
					.optional()
					.describe("Runtime override for every step (default: the workflow's)"),
				slug: nonEmpty("slug", "Short label added to the run id").optional(),
				priority: z
					.number({ error: "priority must be an integer" })
					.int({ error: "priority must be an integer" })
					.optional()
					.describe("Queue priority, higher runs first (default 0)"),
			},
		},
		async (input) => {
			const repo = resolveRepo(ctx.cwd, input.repo);
			const workflow = resolveWorkflow(input.workflow, repo);
			const variables: Record<string, string> = {};
			for (const [key, value] of Object.entries(input.vars ?? {})) variables[key] = String(value);
			const payload = buildDispatchPayload({
				workflowPath: workflow.path,
				repoRoot: repo,
				variables,
				runtime: input.runtime,
				slug: input.slug,
				priority: input.priority,
			});
			const result = await withClient(ctx.clients, (client) => dispatchRun(client, payload));
			return jsonResult({
				run_id: result.run.id,
				status: result.run.status,
				dir: result.dir,
				workflow: workflow.path,
				warnings: result.warnings ?? [],
			});
		},
	);

	register(
		server,
		"af_status",
		{
			title: "Show run status",
			description:
				"With `run`, returns the state of one run: { entry (registry entry with status), run (run.json), steps (completed steps), current_step }. Without `run`, returns { runs } with every run that has not ended (queued, running, paused, blocked or awaiting-human), newest first. Run statuses: queued, running, paused, blocked, awaiting-human (a question waits for an answer), halted, failed, canceled, done, merged (the last five are final). Next: af_events to follow a run, af_artifacts to read its plan or summary, af_list_runs to find older runs.",
			inputSchema: {
				run: runId("Run id (omit to list the active runs)").optional(),
			},
		},
		async (input) => {
			if (input.run) {
				const id = input.run;
				const details = await withClient(ctx.clients, (client) =>
					client.request<RunDetails>("GET", `/v1/runs/${encodeURIComponent(id)}`),
				);
				return jsonResult(details);
			}
			const res = await withClient(ctx.clients, (client) =>
				client.request<{ runs: RegistryEntry[] }>(
					"GET",
					runsQuery({ status: ACTIVE_RUN_STATUSES.join(",") }),
				),
			);
			return jsonResult({ runs: newestFirst(res.runs) });
		},
	);

	register(
		server,
		"af_list_runs",
		{
			title: "List runs",
			description:
				"Lists runs from the af run registry, newest first, as { runs, total } where each run has id, workflow, status, repo, dir, created_at and updated_at; `total` counts the matches before `limit` (default 50). Filters combine: `status` (one status or a list: queued, running, paused, blocked, awaiting-human, halted, failed, canceled, done, merged), `repo` (runs dispatched from this repository root), `since` (an ISO date or a duration such as 30m, 2h, 7d) and `parent` (child runs of a parent run). Next: af_status or af_artifacts with a run id from the list.",
			inputSchema: {
				status: z
					.union([statusEnum, z.array(statusEnum).min(1, { error: "status list is empty" })], {
						error: `status must be a run status or a list of them (${RUN_STATUS_VALUES.join(", ")})`,
					})
					.optional()
					.describe("Run status or list of statuses"),
				repo: nonEmpty(
					"repo",
					"Repository root (absolute, or relative to the server's cwd)",
				).optional(),
				since: nonEmpty("since", "ISO date or a duration such as 30m, 2h, 7d").optional(),
				parent: nonEmpty("parent", "Parent run id").optional(),
				limit: z
					.number({ error: "limit must be an integer from 1 to 1000" })
					.int({ error: "limit must be an integer from 1 to 1000" })
					.min(1, { error: "limit must be an integer from 1 to 1000" })
					.max(1000, { error: "limit must be an integer from 1 to 1000" })
					.optional()
					.describe(`Maximum number of runs returned (default ${DEFAULT_LIST_LIMIT})`),
			},
		},
		async (input) => {
			const status = Array.isArray(input.status) ? input.status.join(",") : input.status;
			const repo = input.repo ? path.resolve(ctx.cwd, input.repo) : undefined;
			const res = await withClient(ctx.clients, (client) =>
				client.request<{ runs: RegistryEntry[] }>(
					"GET",
					runsQuery({ status, repo, since: input.since, parent: input.parent }),
				),
			);
			const runs = newestFirst(res.runs);
			return jsonResult({
				runs: runs.slice(0, input.limit ?? DEFAULT_LIST_LIMIT),
				total: runs.length,
			});
		},
	);

	register(
		server,
		"af_events",
		{
			title: "Read run events",
			description: `Reads run events (contract envelopes with run, seq, type, at, data) after a cursor, across all runs or for one \`run\`, and returns { events, cursor, more, status }. Pass the returned \`cursor\` to the next call to resume without duplicates; \`more\` is true when more events are available at once; \`status\` is the run's status when \`run\` is set. \`wait_seconds\` (0 to ${MAX_WAIT_SECONDS}, default 0) long-polls: the call waits until a new event arrives or the wait ends (keep it below your client's tool timeout, for example 30). \`types\` filters by exact types or prefixes such as run.* (types include run.started, run.completed, run.failed, run.paused, run.canceled, step.started, step.completed, step.failed, needs_input). \`from_now\` skips existing events (ignored with a cursor). Next: loop af_events with the cursor until a run.completed, run.failed or run.paused event, then call af_status.`,
			inputSchema: {
				cursor: nonEmpty("cursor", "Cursor returned by a previous af_events call").optional(),
				run: runId("Only events of this run").optional(),
				types: z
					.array(nonEmpty("types entry", "Event type or prefix (run.*)"), {
						error: "types must be a list of event types or prefixes such as run.*",
					})
					.optional()
					.describe("Event types or prefixes such as run.*"),
				wait_seconds: z
					.number({ error: `wait_seconds must be an integer from 0 to ${MAX_WAIT_SECONDS}` })
					.int({ error: `wait_seconds must be an integer from 0 to ${MAX_WAIT_SECONDS}` })
					.min(0, { error: `wait_seconds must be an integer from 0 to ${MAX_WAIT_SECONDS}` })
					.max(MAX_WAIT_SECONDS, {
						error: `wait_seconds must be an integer from 0 to ${MAX_WAIT_SECONDS}`,
					})
					.optional()
					.describe("Seconds to wait for a first new event (long-poll); 0 returns at once"),
				limit: z
					.number({ error: `limit must be an integer from 1 to ${DEFAULT_EVENT_LIMIT}` })
					.int({ error: `limit must be an integer from 1 to ${DEFAULT_EVENT_LIMIT}` })
					.min(1, { error: `limit must be an integer from 1 to ${DEFAULT_EVENT_LIMIT}` })
					.max(DEFAULT_EVENT_LIMIT, {
						error: `limit must be an integer from 1 to ${DEFAULT_EVENT_LIMIT}`,
					})
					.optional()
					.describe(`Maximum number of events returned (default ${DEFAULT_EVENT_LIMIT})`),
				from_now: z
					.boolean({ error: "from_now must be a boolean" })
					.optional()
					.describe("Skip the events that exist now (ignored with a cursor)"),
			},
		},
		async (input) => {
			const page = await withClient(ctx.clients, (client) =>
				fetchEvents(client, {
					cursor: input.cursor ?? null,
					run: input.run ?? null,
					types: input.types,
					waitSeconds: input.wait_seconds ?? 0,
					limit: input.limit,
					fromNow: input.from_now === true,
				}),
			);
			return jsonResult(page);
		},
	);

	register(
		server,
		"af_artifacts",
		{
			title: "Read run artifacts",
			description:
				"Lists the artifact files of a run: plan versions (plan.md, plan.v2.md, ...), summary (summary.md), decisions (decisions.jsonl) and review files (review-1.md, ...), as { run, dir, artifacts: [{ kind, paths, latest }] } for every kind or only `kind`. With `content: true` and a `kind`, returns { run, kind, path, content } with the text of the latest file of that kind (cut at 20,000 characters). Next: call it with content: true and the kind you need, or af_status for the run's progress.",
			inputSchema: {
				run: runId("Run id"),
				kind: z
					.enum(ARTIFACT_KINDS, { error: `kind must be one of ${ARTIFACT_KINDS.join(", ")}` })
					.optional()
					.describe("Artifact kind (all kinds when omitted)"),
				content: z
					.boolean({ error: "content must be a boolean" })
					.optional()
					.describe("Return the latest file of `kind` instead of the paths (needs kind)"),
			},
		},
		async (input) => {
			if (input.content && !input.kind) {
				throw new ToolInputError(
					"content: true needs a kind",
					`Pass kind (${ARTIFACT_KINDS.join(", ")}) with content: true, or omit content to list the files.`,
				);
			}
			const entry = new RunRegistry(ctx.registryRoot).get(input.run);
			if (!entry) {
				throw new ToolInputError(
					`Run not found: ${input.run}`,
					"Use af_list_runs to find run ids.",
				);
			}
			const kinds = input.kind ? [input.kind] : ARTIFACT_KINDS;
			const lists = kinds.map((kind) => listArtifacts(entry.dir, kind));
			if (input.content && input.kind) {
				const latest = lists[0].latest;
				if (!latest) {
					throw new ToolInputError(
						`No ${input.kind} artifact in run ${entry.id}`,
						"Call af_artifacts without content to see which artifacts exist.",
					);
				}
				return jsonResult({
					run: entry.id,
					kind: input.kind,
					path: latest,
					content: readArtifact(latest),
				});
			}
			return jsonResult({ run: entry.id, dir: entry.dir, artifacts: lists });
		},
	);
}
