/**
 * MCP tools that dispatch and read runs: af_dispatch, af_status,
 * af_list_runs, af_events, af_logs and af_artifacts (the steering tools are in
 * tools-control.ts). Each tool validates its input with a zod schema, then
 * makes one supervisor call (af_artifacts reads the run registry and the run
 * directory directly, like `af artifacts`).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { listAvailableWorkflows, resolveWorkflowPath } from "../commands/run.js";
import { type RunStatus, parseFrontmatter } from "../contract/index.js";
import {
	ARTIFACT_KINDS,
	type ArtifactContent,
	ArtifactReadError,
	listArtifacts,
	readArtifactPage,
} from "../runs/artifacts.js";
import {
	WAIT_MANY_MAX_RUNS,
	dispatchRun,
	fetchEvents,
	fetchLogs,
	waitForRun,
	waitForRuns,
} from "../runs/client.js";
import { buildDispatchPayload } from "../runs/dispatch.js";
import { DEFAULT_EVENT_LIMIT, decodeCursor, encodeCursor } from "../runs/events.js";
import type { RunDetails } from "../runs/manager.js";
import { type RegistryEntry, RunRegistry, RunTree, type TreeEntry } from "../runs/registry.js";
import {
	LOGS_MAX_LIMIT,
	LOGS_MCP_DEFAULT_LIMIT,
	LOGS_MCP_MAX_BYTES,
	LOGS_MCP_MAX_CHARS,
	TRANSCRIPT_TEXT_MAX,
} from "../runs/transcript.js";
import {
	DEFAULT_WAIT_SECONDS,
	LONG_WAIT_SECONDS,
	MAX_WAIT_SECONDS as MAX_RUN_WAIT_SECONDS,
	WAIT_CONDITIONS,
} from "../runs/wait.js";
import {
	ARTIFACT_DEFAULT_CHARS,
	ARTIFACT_MAX_CHARS,
	EVENTS_MCP_DEFAULT_LIMIT,
	EVENTS_MCP_MAX_BYTES,
	RUNS_MCP_DEFAULT_LIMIT,
} from "./budgets.js";
import { type ClientCache, ToolInputError, jsonResult, toolError, withClient } from "./errors.js";
import { slimEntry, slimRunDetails } from "./views.js";

/** Everything a tool handler needs besides its input. */
export interface ToolContext {
	clients: ClientCache;
	/** af global dir of the run registry (defaults to `getGlobalRoot()`). */
	registryRoot?: string;
	/** Base directory of relative `repo` inputs and the default repository. */
	cwd: string;
	/** Environment read by af_ask (`AF_RUN_ID`, `AF_STEP`); defaults to `process.env`. */
	env?: NodeJS.ProcessEnv;
	/** Name the MCP client reported at initialization (`clientInfo.name`). */
	clientName?: () => string | undefined;
}

/** What a tool handler gets from the MCP request besides its input. */
export interface ToolCallExtra {
	/** Aborted when the MCP client cancels the call or the connection closes. */
	signal: AbortSignal;
	/**
	 * Sends a progress notification when the client asked for progress
	 * (a `progressToken`); a no-op otherwise. A client that resets its tool
	 * timeout on progress then lets a long wait run.
	 */
	progress: (progress: number, message?: string) => Promise<void>;
}

/**
 * MCP clients whose tool timeout is known to allow a {@link LONG_WAIT_SECONDS}
 * wait: Claude Code (no short default), and Codex, whose af server entry
 * (`af setup codex`, and the server given to Codex sessions in a run) sets
 * `tool_timeout_sec` to 900.
 */
export const LONG_TOOL_TIMEOUT_CLIENTS: readonly string[] = ["claude-code", "codex-mcp-client"];

/** Default `timeout_seconds` of af_wait and af_dispatch `wait` for the connected client. */
export function defaultWaitSeconds(ctx: ToolContext): number {
	const name = ctx.clientName?.();
	return name && LONG_TOOL_TIMEOUT_CLIENTS.includes(name)
		? LONG_WAIT_SECONDS
		: DEFAULT_WAIT_SECONDS;
}

/** Interval of the progress notifications sent during a long wait. */
const PROGRESS_INTERVAL_MS = 20_000;

/** Runs `task`, sending a progress notification every 20 s while it runs. */
export async function withProgress<T>(extra: ToolCallExtra, task: () => Promise<T>): Promise<T> {
	let ticks = 0;
	const timer = setInterval(() => {
		ticks += 1;
		extra.progress(ticks, "waiting").catch(() => {});
	}, PROGRESS_INTERVAL_MS);
	try {
		return await task();
	} finally {
		clearInterval(timer);
	}
}

/** `withClient()` options of the read tools: a GET is retried once when the supervisor is unreachable. */
const READ = { idempotent: true } as const;

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

/** The parts of the SDK's request handler extra that `register()` reads. */
interface SdkExtra {
	signal?: AbortSignal;
	_meta?: { progressToken?: string | number };
	sendNotification?: (notification: {
		method: "notifications/progress";
		params: { progressToken: string | number; progress: number; message?: string };
	}) => Promise<void>;
}

/** Registers a tool whose handler errors become `isError` results with a next step. */
export function register<Shape extends z.ZodRawShape>(
	server: McpServer,
	name: string,
	config: { title: string; description: string; inputSchema: Shape },
	handler: (input: z.infer<z.ZodObject<Shape>>, extra: ToolCallExtra) => Promise<CallToolResult>,
): void {
	server.registerTool(name, config, (async (
		input: z.infer<z.ZodObject<Shape>>,
		extra: SdkExtra | undefined,
	) => {
		const token = extra?._meta?.progressToken;
		const progress = async (value: number, message?: string) => {
			if (token === undefined || !extra?.sendNotification) return;
			await extra.sendNotification({
				method: "notifications/progress",
				params: { progressToken: token, progress: value, ...(message ? { message } : {}) },
			});
		};
		try {
			return await handler(input, {
				signal: extra?.signal ?? new AbortController().signal,
				progress,
			});
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
		`Workflow not found: ${workflow} (searched ${path.join(repo, "agentic", "workflows")}, the user-global, the skill pack and the bundled workflows)`,
		names.length > 0
			? `Pass one of these names: ${shown}${more}; or a path to a workflow YAML file (absolute, or relative to repo).`
			: "Pass a path to a workflow YAML file (absolute, or relative to repo).",
	);
}

/** Depth first from the shallowest listed runs, children oldest first. */
function treeOrder(runs: TreeEntry[]): TreeEntry[] {
	const ids = new Set(runs.map((r) => r.id));
	const tree = new RunTree(runs);
	const out: TreeEntry[] = [];
	const byId = new Map(runs.map((r) => [r.id, r]));
	const roots = runs
		.filter((r) => !r.parent || !ids.has(r.parent))
		.sort((a, b) => a.created_at.localeCompare(b.created_at));
	for (const root of roots) {
		for (const node of tree.walk(root.id)) {
			const entry = byId.get(node.entry.id);
			if (entry) out.push(entry);
		}
	}
	return out;
}

/** The af run whose step this MCP server serves (`AF_RUN_ID`), else the overseer run, else undefined. */
export function callingRun(ctx: ToolContext): string | undefined {
	const env = ctx.env ?? process.env;
	return env.AF_RUN_ID || env.AF_OVERSEER_RUN || undefined;
}

/** `timeout_seconds` of af_wait and af_dispatch. */
export function waitSeconds() {
	const error = `timeout_seconds must be a number from 0 to ${MAX_RUN_WAIT_SECONDS}`;
	return z
		.number({ error })
		.min(0, { error })
		.max(MAX_RUN_WAIT_SECONDS, { error })
		.optional()
		.describe(
			`Seconds to wait (default ${LONG_WAIT_SECONDS} on Claude Code and Codex, ${DEFAULT_WAIT_SECONDS} on other clients, whose tool timeout is often 60 s)`,
		);
}

/**
 * An af_events cursor at the end of every run's events except `run`, which
 * starts before its first event: following it misses none of the new run's
 * events and replays no history. Null when the supervisor cannot be read.
 */
async function runStartCursor(ctx: ToolContext, run: string): Promise<string | null> {
	try {
		const page = await withClient(
			ctx.clients,
			(client) => fetchEvents(client, { fromNow: true, limit: 1 }),
			READ,
		);
		const positions = decodeCursor(page.cursor);
		delete positions[run];
		return encodeCursor(positions);
	} catch {
		return null;
	}
}

function newestFirst<T extends RegistryEntry>(runs: T[]): T[] {
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
			description: `Queues a workflow run in the af supervisor (it runs in the background). Returns { run_id, status, dir, workflow, parent, warnings, cursor }; \`cursor\` is an af_events cursor placed before the run's first event. \`workflow\` is a workflow name or YAML path; \`repo\` defaults to the server's cwd. From inside a run the new run is its child. \`item\` (with \`parent\`, the overseer run) implements a backlog item. \`wait: true\` also waits as af_wait and adds its result as \`wait\`. Next: af_wait for the result.`,
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
				ignore_requires: z
					.boolean({ error: "ignore_requires must be a boolean" })
					.optional()
					.describe(
						"Run despite an unmet requires agentic-forge version (never the contract); adds a warning",
					),
				parent: runId(
					"Parent run id, such as your overseer run (af_list_runs parent lists its children)",
				).optional(),
				item: nonEmpty(
					"item",
					"Backlog item of the parent overseer run (for example T02): refused unless af_backlog_list lists it as runnable; the item becomes running",
				).optional(),
				wait: z
					.boolean({ error: "wait must be a boolean" })
					.optional()
					.describe("Also wait for the run to end (as af_wait) before returning"),
				timeout_seconds: waitSeconds(),
			},
		},
		async (input, extra) => {
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
				ignoreRequires: input.ignore_requires,
				parent: input.parent ?? callingRun(ctx),
				item: input.item,
			});
			const result = await withClient(ctx.clients, (client) => dispatchRun(client, payload));
			const dispatched = {
				run_id: result.run.id,
				status: result.run.status,
				dir: result.dir,
				workflow: workflow.path,
				parent: result.run.parent ?? null,
				warnings: result.warnings ?? [],
				cursor: await runStartCursor(ctx, result.run.id),
			};
			if (!input.wait) return jsonResult(dispatched);
			const waited = await withProgress(extra, () =>
				withClient(
					ctx.clients,
					(client) =>
						waitForRun(client, result.run.id, {
							timeoutSeconds: input.timeout_seconds ?? defaultWaitSeconds(ctx),
							signal: extra.signal,
						}),
					READ,
				),
			);
			return jsonResult({ ...dispatched, wait: waited });
		},
	);

	register(
		server,
		"af_status",
		{
			title: "Show run status",
			description: `With \`run\`, returns one run: id, workflow, status, branch, worktree, pr, current_step, open needs_input requests and per step its name, status, result_status, a short summary and an error flag; \`verbose: true\` returns the full run.json, step records and run tree. Without \`run\`, returns { runs, total }: the runs that have not ended, newest first (at most ${RUNS_MCP_DEFAULT_LIMIT}). Final statuses: halted, failed, canceled, done, merged. Next: af_wait to wait, af_artifacts for the plan or summary.`,
			inputSchema: {
				run: runId("Run id (omit to list the active runs)").optional(),
				verbose: z
					.boolean({ error: "verbose must be a boolean" })
					.optional()
					.describe("Full run.json, step records and run tree (large)"),
			},
		},
		async (input) => {
			if (input.run) {
				const id = input.run;
				const details = await withClient(
					ctx.clients,
					(client) => client.request<RunDetails>("GET", `/v1/runs/${encodeURIComponent(id)}`),
					READ,
				);
				return jsonResult(input.verbose ? details : slimRunDetails(details));
			}
			const res = await withClient(
				ctx.clients,
				(client) =>
					client.request<{ runs: TreeEntry[] }>(
						"GET",
						runsQuery({ status: ACTIVE_RUN_STATUSES.join(",") }),
					),
				READ,
			);
			const runs = newestFirst(res.runs);
			return jsonResult({
				runs: runs.slice(0, RUNS_MCP_DEFAULT_LIMIT).map(slimEntry),
				total: runs.length,
			});
		},
	);

	register(
		server,
		"af_list_runs",
		{
			title: "List runs",
			description: `Lists runs as { runs, total }: id, workflow, status, repo, dir, parent, depth, created_at, updated_at; newest first, or depth first with \`tree\`. \`total\` counts the matches before \`limit\` (default ${RUNS_MCP_DEFAULT_LIMIT}). Filters combine: \`status\` (one or a list), \`repo\`, \`since\` (ISO date or 30m, 2h, 7d), \`parent\` (direct children) and \`tree\` (a run and every run below it). Next: af_status with a run id.`,
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
				tree: nonEmpty("tree", "Run id: that run and every run below it, depth first").optional(),
				limit: z
					.number({ error: "limit must be an integer from 1 to 1000" })
					.int({ error: "limit must be an integer from 1 to 1000" })
					.min(1, { error: "limit must be an integer from 1 to 1000" })
					.max(1000, { error: "limit must be an integer from 1 to 1000" })
					.optional()
					.describe(`Maximum number of runs returned (default ${RUNS_MCP_DEFAULT_LIMIT})`),
			},
		},
		async (input) => {
			const status = Array.isArray(input.status) ? input.status.join(",") : input.status;
			const repo = input.repo ? path.resolve(ctx.cwd, input.repo) : undefined;
			const res = await withClient(
				ctx.clients,
				(client) =>
					client.request<{ runs: TreeEntry[] }>(
						"GET",
						runsQuery({
							status,
							repo,
							since: input.since,
							parent: input.parent,
							tree: input.tree,
						}),
					),
				READ,
			);
			const runs = input.tree ? treeOrder(res.runs) : newestFirst(res.runs);
			return jsonResult({
				runs: runs.slice(0, input.limit ?? RUNS_MCP_DEFAULT_LIMIT).map(slimEntry),
				total: runs.length,
			});
		},
	);

	register(
		server,
		"af_events",
		{
			title: "Read run events",
			description:
				"Reads run events (run, seq, type, at, data) after `cursor`, across runs or for one `run`, as { events, cursor, more, status }. Without a cursor it starts from now (`from_start: true` replays history); start from the cursor af_dispatch returned. Pass the returned cursor to the next call; `more` means more events are ready. Filter with `types` (needs_input, run.*, step.failed) and long-poll with the longest `wait_seconds` your client allows. To wait, use af_wait; to catch up after a compaction, af_digest.",
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
					.describe(
						`Maximum number of events returned (default ${EVENTS_MCP_DEFAULT_LIMIT}, within about ${EVENTS_MCP_MAX_BYTES / 1000} KB; an explicit limit lifts the size cap)`,
					),
				from_start: z
					.boolean({ error: "from_start must be a boolean" })
					.optional()
					.describe("Without a cursor: replay the existing events instead of starting from now"),
			},
		},
		async (input) => {
			const page = await withClient(
				ctx.clients,
				(client) =>
					fetchEvents(client, {
						cursor: input.cursor ?? null,
						run: input.run ?? null,
						types: input.types,
						waitSeconds: input.wait_seconds ?? 0,
						limit: input.limit ?? EVENTS_MCP_DEFAULT_LIMIT,
						maxBytes: input.limit === undefined ? EVENTS_MCP_MAX_BYTES : 0,
						fromNow: !input.cursor && input.from_start !== true,
					}),
				READ,
			);
			return jsonResult(page);
		},
	);

	register(
		server,
		"af_wait",
		{
			title: "Wait for runs",
			description: `Waits until a run ends (\`until: terminal\`, default), needs attention (\`attention\`: also a needs_input, a failed step or a pause) or ends a step (\`boundary\`), for at most \`timeout_seconds\` (default ${LONG_WAIT_SECONDS} on Claude Code and Codex, which keeps each wake-up inside the 5 minute prompt cache, else ${DEFAULT_WAIT_SECONDS}). With \`run\`: { run, status, state, cursor, reason, step, result, result_path, needs_input, error }. With \`runs\`: { state, cursor, woke, waiting, ended }. state is ended, attention or waiting; call again with the cursor. Next: af_answer for a needs_input.`,
			inputSchema: {
				run: runId("Run id (from af_dispatch or af_list_runs)").optional(),
				runs: z
					.array(runId("Run id"), { error: "runs must be a list of run ids" })
					.min(1, { error: "runs must list at least one run id" })
					.max(WAIT_MANY_MAX_RUNS, {
						error: `runs must list at most ${WAIT_MANY_MAX_RUNS} run ids`,
					})
					.optional()
					.describe("Several run ids: returns when one of them meets the condition"),
				until: z
					.enum(WAIT_CONDITIONS, { error: `until must be one of ${WAIT_CONDITIONS.join(", ")}` })
					.optional()
					.describe("terminal (default), attention or boundary"),
				timeout_seconds: waitSeconds(),
				cursor: z
					.union([z.number().int().min(0), z.string().min(1)], {
						error: "cursor must be the cursor of a previous af_wait result",
					})
					.optional()
					.describe("Cursor of a previous af_wait result (events up to it are not reported again)"),
			},
		},
		async (input, extra) => {
			if ((input.run === undefined) === (input.runs === undefined)) {
				throw new ToolInputError(
					"Pass either run or runs",
					"Use run for one run id, runs for a list.",
				);
			}
			const runs = input.runs;
			const cursor = input.cursor;
			if (runs ? typeof cursor === "number" : typeof cursor === "string") {
				throw new ToolInputError(
					"cursor does not match: run takes the number cursor of a single-run result, runs the string cursor of a multi-run result",
					"Pass the cursor of the previous af_wait call made with the same run or runs.",
				);
			}
			const timeoutSeconds = input.timeout_seconds ?? defaultWaitSeconds(ctx);
			const result = await withProgress(extra, () =>
				withClient(
					ctx.clients,
					(client): Promise<unknown> =>
						runs
							? waitForRuns(client, runs, {
									until: input.until,
									cursor: (cursor as string | undefined) ?? null,
									timeoutSeconds,
									signal: extra.signal,
								})
							: waitForRun(client, input.run as string, {
									until: input.until,
									cursor: (cursor as number | undefined) ?? null,
									timeoutSeconds,
									signal: extra.signal,
								}),
					READ,
				),
			);
			return jsonResult(result);
		},
	);

	register(
		server,
		"af_logs",
		{
			title: "Read a run's live transcript",
			description: `Reads a run's live transcript (all steps, or one \`step\`): messages, tool calls, diffs, permission requests. Without a cursor returns the last ${LOGS_MCP_DEFAULT_LIMIT} entries, with \`cursor\` the newer ones, as { entries, cursor, more, truncated, active, status }. Texts are cut to ${LOGS_MCP_MAX_CHARS} characters and the page to about ${LOGS_MCP_MAX_BYTES / 1000} KB unless you pass max_chars. Use it to debug a step, not to follow a run (af_wait does).`,
			inputSchema: {
				run: runId("Run id"),
				step: nonEmpty("step", "Only this step's transcript").optional(),
				cursor: nonEmpty("cursor", "Cursor returned by a previous af_logs call").optional(),
				limit: z
					.number({ error: `limit must be an integer from 1 to ${LOGS_MAX_LIMIT}` })
					.int({ error: `limit must be an integer from 1 to ${LOGS_MAX_LIMIT}` })
					.min(1, { error: `limit must be an integer from 1 to ${LOGS_MAX_LIMIT}` })
					.max(LOGS_MAX_LIMIT, { error: `limit must be an integer from 1 to ${LOGS_MAX_LIMIT}` })
					.optional()
					.describe(`Maximum number of entries (default ${LOGS_MCP_DEFAULT_LIMIT})`),
				max_chars: z
					.number({ error: `max_chars must be an integer from 1 to ${TRANSCRIPT_TEXT_MAX}` })
					.int({ error: `max_chars must be an integer from 1 to ${TRANSCRIPT_TEXT_MAX}` })
					.min(1, { error: `max_chars must be an integer from 1 to ${TRANSCRIPT_TEXT_MAX}` })
					.max(TRANSCRIPT_TEXT_MAX, {
						error: `max_chars must be an integer from 1 to ${TRANSCRIPT_TEXT_MAX}`,
					})
					.optional()
					.describe(
						`Cut each entry's text to this length (default ${LOGS_MCP_MAX_CHARS}; lifts the page size budget)`,
					),
				wait_seconds: z
					.number({ error: `wait_seconds must be an integer from 0 to ${MAX_WAIT_SECONDS}` })
					.int({ error: `wait_seconds must be an integer from 0 to ${MAX_WAIT_SECONDS}` })
					.min(0, { error: `wait_seconds must be an integer from 0 to ${MAX_WAIT_SECONDS}` })
					.max(MAX_WAIT_SECONDS, {
						error: `wait_seconds must be an integer from 0 to ${MAX_WAIT_SECONDS}`,
					})
					.optional()
					.describe("Seconds to wait for a new entry while the step is active; 0 returns at once"),
			},
		},
		async (input) => {
			const page = await withClient(
				ctx.clients,
				(client) =>
					fetchLogs(client, {
						run: input.run,
						step: input.step ?? null,
						cursor: input.cursor ?? null,
						limit: input.limit ?? LOGS_MCP_DEFAULT_LIMIT,
						maxChars: input.max_chars ?? LOGS_MCP_MAX_CHARS,
						maxBytes: input.max_chars === undefined ? LOGS_MCP_MAX_BYTES : 0,
						waitSeconds: input.wait_seconds ?? 0,
					}),
				READ,
			);
			return jsonResult(page);
		},
	);

	register(
		server,
		"af_artifacts",
		{
			title: "Read run artifacts",
			description: `Lists a run's artifact files (plan versions, summary.md, decisions.jsonl, review-N.md) as { run, dir, artifacts: [{ kind, paths, latest }] }. With \`content: true\` and a \`kind\`, returns the latest file's text: up to \`max_chars\` (default ${ARTIFACT_DEFAULT_CHARS}) from \`offset\`, or one markdown \`section\`; a cut text has truncated: true and next_offset. \`frontmatter_only: true\` returns the summary's frontmatter (status, risk, counts). Read the frontmatter first, then the section you need.`,
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
				max_chars: z
					.number({ error: `max_chars must be an integer from 1 to ${ARTIFACT_MAX_CHARS}` })
					.int({ error: `max_chars must be an integer from 1 to ${ARTIFACT_MAX_CHARS}` })
					.min(1, { error: `max_chars must be an integer from 1 to ${ARTIFACT_MAX_CHARS}` })
					.max(ARTIFACT_MAX_CHARS, {
						error: `max_chars must be an integer from 1 to ${ARTIFACT_MAX_CHARS}`,
					})
					.optional()
					.describe(`Characters of content returned (default ${ARTIFACT_DEFAULT_CHARS})`),
				offset: z
					.number({ error: "offset must be a non-negative integer" })
					.int({ error: "offset must be a non-negative integer" })
					.min(0, { error: "offset must be a non-negative integer" })
					.optional()
					.describe("First character returned (next_offset of a cut result)"),
				section: nonEmpty(
					"section",
					"Markdown heading: return only its section (for example Milestones)",
				).optional(),
				frontmatter_only: z
					.boolean({ error: "frontmatter_only must be a boolean" })
					.optional()
					.describe("kind summary: return only the parsed YAML frontmatter"),
			},
		},
		async (input) => {
			const reading =
				input.content ||
				input.frontmatter_only ||
				input.section !== undefined ||
				input.offset !== undefined ||
				input.max_chars !== undefined;
			if (reading && !input.kind) {
				throw new ToolInputError(
					"content: true needs a kind",
					`Pass kind (${ARTIFACT_KINDS.join(", ")}) with content: true, or omit content to list the files.`,
				);
			}
			if (input.frontmatter_only && input.kind !== "summary") {
				throw new ToolInputError(
					"frontmatter_only needs kind: summary",
					"Pass kind: summary, or use content: true with section for other kinds.",
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
			if (reading && input.kind) {
				const latest = lists[0].latest;
				if (!latest) {
					throw new ToolInputError(
						`No ${input.kind} artifact in run ${entry.id}`,
						"Call af_artifacts without content to see which artifacts exist.",
					);
				}
				if (input.frontmatter_only) {
					return jsonResult({
						run: entry.id,
						kind: input.kind,
						path: latest,
						frontmatter: parseFrontmatter(readFileSync(latest, "utf-8")),
					});
				}
				let page: ArtifactContent;
				try {
					page = readArtifactPage(latest, {
						maxChars: input.max_chars ?? ARTIFACT_DEFAULT_CHARS,
						offset: input.offset,
						section: input.section,
					});
				} catch (err) {
					if (!(err instanceof ArtifactReadError)) throw err;
					const shown = err.headings.slice(0, 30).join("; ");
					throw new ToolInputError(
						err.message,
						err.headings.length > 0
							? `Pass one of these headings as section: ${shown}.`
							: "The file has no markdown headings: omit section.",
					);
				}
				return jsonResult({ run: entry.id, kind: input.kind, path: latest, ...page });
			}
			return jsonResult({ run: entry.id, dir: entry.dir, artifacts: lists });
		},
	);
}
