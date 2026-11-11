/**
 * MCP tool results and errors: JSON text results, `isError` results with an
 * actionable next step, and the cached supervisor client with one retry of
 * idempotent calls when the supervisor is unreachable.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CliExitError } from "../commands/run.js";
import {
	type SupervisorClient,
	SupervisorHttpError,
	SupervisorUnavailableError,
} from "../supervisor/client.js";

/** A tool result whose text is the JSON of `value` (readable by any client). */
export function jsonResult(value: unknown): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** An `isError` tool result with a plain text message. */
export function errorResult(text: string): CallToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

/** An invalid tool input found by a handler (not by the schema), with the next step. */
export class ToolInputError extends Error {
	constructor(
		message: string,
		readonly hint: string,
	) {
		super(message);
		this.name = "ToolInputError";
	}
}

const MISSING_VARIABLE = /^Missing required variable: (.+)$/;

function hintFor400(tool: string, message: string): string {
	const missing = MISSING_VARIABLE.exec(message);
	if (missing) {
		return `Pass it in vars (for example vars: { "${missing[1]}": "<value>" }) and call ${tool} again.`;
	}
	return `Fix the arguments and call ${tool} again.`;
}

/**
 * Tools that only read: calling them again is safe. Any other tool may have
 * reached the supervisor before the connection failed.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
	"af_status",
	"af_list_runs",
	"af_events",
	"af_artifacts",
]);

function withPeriod(message: string): string {
	return /[.!?]$/.test(message) ? message : `${message}.`;
}

/** Maps an error thrown by a tool handler to an `isError` result naming the problem and a next step. */
export function toolError(tool: string, err: unknown): CallToolResult {
	if (err instanceof ToolInputError) {
		return errorResult(`${withPeriod(err.message)} ${err.hint}`);
	}
	if (err instanceof SupervisorHttpError) {
		const problem = `${err.message} (HTTP ${err.status}).`;
		switch (err.status) {
			case 400:
				return errorResult(`${problem} ${hintFor400(tool, err.message)}`);
			case 404:
				return errorResult(`${problem} Use af_list_runs to find run ids.`);
			case 409:
				return errorResult(`${problem} Call af_status to see the run's current status.`);
			default:
				return errorResult(
					`${problem} The supervisor failed to handle ${tool}; check its log (af serve --status shows it) and retry.`,
				);
		}
	}
	if (err instanceof SupervisorUnavailableError) {
		const problem = `The af supervisor is not reachable: ${withPeriod(err.message)}`;
		if (READ_ONLY_TOOLS.has(tool)) {
			return errorResult(`${problem} Start it with af serve --detach, then call ${tool} again.`);
		}
		return errorResult(
			`${problem} Start it with af serve --detach. The supervisor may already have handled the request: check with af_status or af_list_runs before calling ${tool} again.`,
		);
	}
	if (err instanceof CliExitError) {
		return errorResult(withPeriod(err.message.replace(/^Error: /, "")));
	}
	const message = err instanceof Error ? err.message : String(err);
	return errorResult(`${tool} failed: ${withPeriod(message)}`);
}

/**
 * Lazily created, cached supervisor client. The first `get()` calls the
 * factory (which may start a supervisor); concurrent calls share it, and a
 * failed creation is not cached.
 */
export class ClientCache {
	private pending: Promise<SupervisorClient> | null = null;

	constructor(private readonly factory: () => Promise<SupervisorClient>) {}

	get(): Promise<SupervisorClient> {
		if (!this.pending) {
			const created = this.factory();
			this.pending = created;
			created.catch(() => {
				if (this.pending === created) this.pending = null;
			});
		}
		return this.pending;
	}

	/** Drops the cached client so the next `get()` finds (or starts) the supervisor again. */
	reset(): void {
		this.pending = null;
	}
}

/** Options of `withClient()`. */
export interface WithClientOptions {
	/**
	 * True when `fn` can be sent twice without side effects (a GET). Only an
	 * idempotent call is retried: a POST that failed may already have been
	 * handled by the supervisor (a timeout or a reset after the body was sent).
	 */
	idempotent?: boolean;
}

/**
 * Runs `fn` with the cached client. When the supervisor is unreachable (for
 * example it restarted on a new port), drops the cache so the next call finds
 * the supervisor again, and retries once when the call is idempotent.
 */
export async function withClient<T>(
	clients: ClientCache,
	fn: (client: SupervisorClient) => Promise<T>,
	options: WithClientOptions = {},
): Promise<T> {
	try {
		return await fn(await clients.get());
	} catch (err) {
		if (!(err instanceof SupervisorUnavailableError)) throw err;
		clients.reset();
		if (!options.idempotent) throw err;
		return fn(await clients.get());
	}
}
