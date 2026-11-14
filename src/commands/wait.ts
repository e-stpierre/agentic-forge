/**
 * `af wait <run>` and `af run --wait`: wait for a run in the supervisor and
 * print the wait result (status, last result block, open requests) as one
 * compact JSON line, the shell fallback of the af_wait MCP tool.
 */

import { exitCodeForRun } from "../contract/result.js";
import type { SupervisorClient } from "../supervisor/client.js";
import { CliExitError } from "./run.js";

/** Exit code when the wait ran out before the condition held (as GNU `timeout`). */
export const WAIT_TIMEOUT_EXIT = 124;

export interface WaitOptions {
	/** `terminal` (default) or `attention`. */
	until?: string;
	/** Seconds; unset waits until the condition holds. */
	timeout?: string;
	/** Cursor of a previous wait result. */
	cursor?: string;
}

function parseOptions(options: WaitOptions) {
	const until = options.until ?? "terminal";
	if (until !== "terminal" && until !== "attention") {
		throw new CliExitError("Error: --until must be terminal or attention");
	}
	let timeoutSeconds = Number.POSITIVE_INFINITY;
	if (options.timeout !== undefined) {
		timeoutSeconds = Number(options.timeout);
		if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) {
			throw new CliExitError("Error: --timeout must be a number of seconds");
		}
	}
	let cursor: number | null = null;
	if (options.cursor !== undefined) {
		cursor = Number(options.cursor);
		if (!Number.isInteger(cursor) || cursor < 0) {
			throw new CliExitError("Error: --cursor must be the cursor of a previous wait result");
		}
	}
	return { until: until as "terminal" | "attention", timeoutSeconds, cursor };
}

/**
 * Waits for a run, prints the result as one JSON line on stdout and ends
 * with the run's exit code: 0 done or merged, 10 awaiting-human, 20 halted,
 * 30 blocked, 1 failed or canceled, 124 when the wait ran out.
 */
export async function waitAndReport(
	client: SupervisorClient,
	runId: string,
	options: WaitOptions,
	out: (text: string) => void = (text) => process.stdout.write(text),
): Promise<void> {
	const parsed = parseOptions(options);
	const { waitForRun } = await import("../runs/client.js");
	const controller = new AbortController();
	const onSigint = () => controller.abort();
	process.on("SIGINT", onSigint);
	let result: Awaited<ReturnType<typeof waitForRun>>;
	try {
		result = await waitForRun(client, runId, { ...parsed, signal: controller.signal });
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	} finally {
		process.off("SIGINT", onSigint);
	}
	out(`${JSON.stringify(result)}\n`);
	if (result.state === "waiting") {
		throw new CliExitError(
			`Run ${runId} is still ${result.status}: wait again with --cursor ${result.cursor}`,
			WAIT_TIMEOUT_EXIT,
		);
	}
	const code = exitCodeForRun(result.status);
	if (code !== 0) {
		throw new CliExitError(`Run ${runId} is ${result.status} (${result.reason})`, code);
	}
}

export async function cmdWait(runId: string, options: WaitOptions): Promise<void> {
	parseOptions(options);
	const { ensureSupervisor } = await import("../supervisor/client.js");
	const { getVersion } = await import("./version.js");
	const found = await ensureSupervisor({
		version: getVersion(),
		onWarn: (message) => process.stderr.write(`Warning: ${message}\n`),
	});
	await waitAndReport(found.client, runId, options);
}
