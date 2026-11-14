/**
 * `af_digest`: the state of every active run in one line each, plus what
 * changed since a cursor (new needs_input requests, failures, ended runs).
 * The call an overseer makes after a compaction or in a new session, instead
 * of replaying events.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cursorAfter, fetchEvents } from "../runs/client.js";
import { cutText } from "../runs/event-data.js";
import type { RunDetails } from "../runs/manager.js";
import { pendingInputs } from "../runs/manager.js";
import type { RunEvent } from "../runs/run-store.js";
import type { SupervisorClient } from "../supervisor/client.js";
import {
	DIGEST_CHANGES_MAX_BYTES,
	DIGEST_MAX_CHANGES,
	DIGEST_MAX_RUNS,
	DIGEST_TEXT_CHARS,
} from "./budgets.js";
import { jsonResult, withClient } from "./errors.js";
import { ACTIVE_RUN_STATUSES, type ToolContext, nonEmpty, register } from "./tools.js";

/** Event types a digest reports as changes. */
export const DIGEST_TYPES = [
	"needs_input",
	"step.failed",
	"run.completed",
	"run.failed",
	"run.canceled",
	"run.halted",
] as const;

export interface DigestChange {
	run: string;
	seq: number;
	type: string;
	step?: string;
	/** needs_input request id. */
	id?: string;
	/** Final status of an ended run. */
	status?: string;
	/** The question of a needs_input, the error of a failure (cut). */
	text?: string;
}

export interface Digest {
	/** One line per active run, newest first: `<id> <workflow> <status> [step=<step>] [needs_input=<n>]`. */
	runs: string[];
	/** Active runs not listed (past {@link DIGEST_MAX_RUNS}). */
	more_runs?: number;
	/** Changes since the cursor (none without a cursor). */
	changes: DigestChange[];
	/** More changes are ready: call again with `cursor`. */
	truncated?: true;
	/** Pass it to the next af_digest (or af_events) call. */
	cursor: string | null;
}

interface ActiveEntry {
	id: string;
	workflow: string;
	status: string;
	created_at: string;
}

function digestChange(event: RunEvent): DigestChange {
	const data = event.data ?? {};
	const str = (key: string) =>
		typeof data[key] === "string" && data[key] ? (data[key] as string) : undefined;
	const change: DigestChange = { run: event.run, seq: event.seq, type: event.type };
	const step = str("step");
	if (step) change.step = step;
	if (event.type === "needs_input") {
		const id = str("id");
		if (id) change.id = id;
	}
	if (event.type.startsWith("run.")) {
		const status = str("status");
		if (status) change.status = status;
	}
	const text = event.type === "needs_input" ? str("question") : str("error");
	if (text) change.text = cutText(text.replace(/\s+/g, " ").trim(), DIGEST_TEXT_CHARS);
	return change;
}

function runLine(entry: ActiveEntry, details: RunDetails | null): string {
	const parts = [entry.id, entry.workflow, entry.status];
	if (details?.current_step) parts.push(`step=${details.current_step}`);
	const open = details?.run ? pendingInputs(details.run).length : 0;
	if (open > 0) parts.push(`needs_input=${open}`);
	return parts.join(" ");
}

/** The digest: active runs and the changes after `cursor`. */
export async function buildDigest(
	client: SupervisorClient,
	cursor: string | null,
): Promise<Digest> {
	const { runs } = await client.request<{ runs: ActiveEntry[] }>(
		"GET",
		`/v1/runs?status=${encodeURIComponent(ACTIVE_RUN_STATUSES.join(","))}`,
	);
	const active = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
	const listed = active.slice(0, DIGEST_MAX_RUNS);
	const lines = await Promise.all(
		listed.map(async (entry) => {
			const details = await client
				.request<RunDetails>("GET", `/v1/runs/${encodeURIComponent(entry.id)}`)
				.catch(() => null);
			return runLine(entry, details);
		}),
	);
	const digest: Digest = { runs: lines, changes: [], cursor: null };
	if (active.length > listed.length) digest.more_runs = active.length - listed.length;

	if (!cursor) {
		// No cursor: the current state only, and a cursor from now on
		const page = await fetchEvents(client, { fromNow: true, limit: 1 });
		digest.cursor = page.cursor;
		return digest;
	}
	const page = await fetchEvents(client, {
		cursor,
		types: DIGEST_TYPES,
		limit: DIGEST_MAX_CHANGES,
	});
	let size = 0;
	let cut = -1;
	for (const [index, event] of page.events.entries()) {
		const change = digestChange(event);
		size += JSON.stringify(change).length + 1;
		if (size > DIGEST_CHANGES_MAX_BYTES && digest.changes.length > 0) {
			cut = index - 1;
			break;
		}
		digest.changes.push(change);
	}
	if (cut >= 0) {
		digest.cursor = cursorAfter(page.cursor, page.events, cut);
		digest.truncated = true;
	} else {
		digest.cursor = page.cursor;
		if (page.more) digest.truncated = true;
	}
	return digest;
}

export function registerDigestTool(server: McpServer, ctx: ToolContext): void {
	register(
		server,
		"af_digest",
		{
			title: "Catch up on runs",
			description: `Returns { runs, changes, cursor }: one line per active run (id, workflow, status, current step, open needs_input count; at most ${DIGEST_MAX_RUNS}), and with \`cursor\` the needs_input requests, failed steps and ended runs since it. Call it after a compaction or in a new session instead of replaying events; keep the cursor for the next call. \`truncated\` means more changes: call again with the cursor. Next: af_wait to wait, af_answer for a needs_input.`,
			inputSchema: {
				cursor: nonEmpty(
					"cursor",
					"Cursor of a previous af_digest call (or af_dispatch, af_events)",
				).optional(),
			},
		},
		async (input) => {
			const digest = await withClient(
				ctx.clients,
				(client) => buildDigest(client, input.cursor ?? null),
				{ idempotent: true },
			);
			return jsonResult(digest);
		},
	);
}
