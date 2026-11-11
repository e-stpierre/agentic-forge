/**
 * `af events` (the event stream across runs, with cursors and long-poll
 * follow), `af logs` (live step transcripts) and `af artifacts` (plan,
 * summary, decisions and review files).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ARTIFACT_KINDS, isArtifactKind, listArtifacts, readArtifact } from "../runs/artifacts.js";
import { decodeCursor, parseTypeFilter } from "../runs/events.js";
import { RunRegistry } from "../runs/registry.js";
import type { RunEvent } from "../runs/run-store.js";
import { CliExitError } from "./run.js";
import { resolveLegacyOutputDir } from "./status.js";

export interface EventsOptions {
	run?: string;
	types?: string;
	follow?: boolean;
	cursor?: string;
	/** Reads the cursor from this file at start and writes it back after every page. */
	cursorFile?: string;
	/** Skip the events that exist now (no effect with a cursor). */
	new?: boolean;
	/** Print events as JSON lines (contract envelopes). */
	json?: boolean;
	/** Long-poll length per request in seconds (default 30). */
	wait?: string;
}

function readCursorFile(file: string): string | null {
	if (!existsSync(file)) return null;
	const value = readFileSync(file, "utf-8").trim();
	return value.length > 0 ? value : null;
}

function writeCursorFile(file: string, cursor: string): void {
	mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, `${cursor}\n`, "utf-8");
	renameSync(tmp, file);
}

export async function cmdEvents(options: EventsOptions): Promise<void> {
	if (options.run && !new RunRegistry().get(options.run)) {
		throw new CliExitError(`Error: Run not found: ${options.run}`);
	}
	const cursor = options.cursor ?? (options.cursorFile ? readCursorFile(options.cursorFile) : null);
	try {
		decodeCursor(cursor);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
	const wait = options.wait === undefined ? 30 : Number(options.wait);
	if (!Number.isFinite(wait) || wait <= 0) {
		throw new CliExitError(
			`Error: --wait must be a positive number of seconds, got '${options.wait}'`,
		);
	}

	const { ensureSupervisor } = await import("../supervisor/client.js");
	const { getVersion } = await import("./version.js");
	const { followEvents, formatEvent } = await import("../runs/client.js");
	const found = await ensureSupervisor({
		version: getVersion(),
		onWarn: (message) => process.stderr.write(`Warning: ${message}\n`),
	});

	const controller = new AbortController();
	const onSigint = () => controller.abort();
	process.once("SIGINT", onSigint);
	const print = (event: RunEvent) => {
		if (options.json) {
			process.stdout.write(`${JSON.stringify(event)}\n`);
		} else {
			const run = options.run ? "" : `${event.run} `;
			process.stdout.write(`${run}${formatEvent(event)}\n`);
		}
	};
	try {
		const last = await followEvents(found.client, {
			cursor,
			run: options.run ?? null,
			types: parseTypeFilter(options.types),
			fromNow: options.new === true,
			follow: options.follow === true,
			waitSeconds: wait,
			onEvent: print,
			onCursor: (next) => {
				if (options.cursorFile) writeCursorFile(options.cursorFile, next);
			},
			signal: controller.signal,
		});
		// The cursor goes to stderr so stdout stays a clean event stream
		if (last && !options.cursorFile) process.stderr.write(`Cursor: ${last}\n`);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	} finally {
		process.removeListener("SIGINT", onSigint);
	}
}

export interface ArtifactsOptions {
	runId: string;
	kind?: string;
	/** Print the content of the latest file of the kind instead of paths. */
	content?: boolean;
	json?: boolean;
}

/** Prints the artifact paths of a run (all kinds, or one), or the latest file's content. */
export function cmdArtifacts(options: ArtifactsOptions): void {
	const entry = new RunRegistry().get(options.runId);
	if (!entry) {
		if (resolveLegacyOutputDir(options.runId)) {
			throw new CliExitError(
				`Error: ${options.runId} is a legacy run (pre-supervisor) and has no contract artifacts.`,
			);
		}
		throw new CliExitError(`Error: Run not found: ${options.runId}`);
	}
	if (options.kind !== undefined && !isArtifactKind(options.kind)) {
		throw new CliExitError(
			`Error: Unknown artifact kind '${options.kind}' (expected ${ARTIFACT_KINDS.join(", ")})`,
		);
	}
	const kinds = options.kind ? [options.kind as (typeof ARTIFACT_KINDS)[number]] : ARTIFACT_KINDS;
	const lists = kinds.map((kind) => listArtifacts(entry.dir, kind));

	if (options.content) {
		if (!options.kind) throw new CliExitError("Error: --content needs --kind");
		const latest = lists[0].latest;
		if (!latest) throw new CliExitError(`Error: No ${options.kind} artifact in ${options.runId}`);
		process.stdout.write(readArtifact(latest));
		return;
	}
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ run: entry.id, dir: entry.dir, artifacts: lists }, null, 2)}\n`,
		);
		return;
	}
	process.stdout.write(`Run dir: ${entry.dir}\n`);
	for (const list of lists) {
		if (list.paths.length === 0) {
			process.stdout.write(`${list.kind}: (none)\n`);
			continue;
		}
		process.stdout.write(`${list.kind}:\n`);
		for (const file of list.paths) {
			process.stdout.write(
				`  ${file}${file === list.latest && list.paths.length > 1 ? " (latest)" : ""}\n`,
			);
		}
	}
}

export interface LogsOptions {
	runId: string;
	step?: string;
	follow?: boolean;
	cursor?: string;
	/** Entries of the first page (the tail) and of each later page. */
	limit?: string;
	/** Print entries as JSON lines. */
	json?: boolean;
	/** Long-poll length per request in seconds (default 30). */
	wait?: string;
}

/**
 * `af logs <run>`: the live transcript of a run (all steps, or `--step`).
 * Prints the tail, and with `--follow` streams new entries until the step
 * (or the run) ends. The cursor goes to stderr.
 */
export async function cmdLogs(options: LogsOptions): Promise<void> {
	if (!new RunRegistry().get(options.runId)) {
		if (resolveLegacyOutputDir(options.runId)) {
			throw new CliExitError(
				`Error: ${options.runId} is a legacy run (pre-supervisor) and has no transcript.`,
			);
		}
		throw new CliExitError(`Error: Run not found: ${options.runId}`);
	}
	const { LOGS_DEFAULT_LIMIT, LOGS_MAX_LIMIT } = await import("../runs/transcript.js");
	const limit = options.limit === undefined ? LOGS_DEFAULT_LIMIT : Number(options.limit);
	if (!Number.isInteger(limit) || limit < 1 || limit > LOGS_MAX_LIMIT) {
		throw new CliExitError(
			`Error: --limit must be an integer from 1 to ${LOGS_MAX_LIMIT}, got '${options.limit}'`,
		);
	}
	const wait = options.wait === undefined ? 30 : Number(options.wait);
	if (!Number.isFinite(wait) || wait <= 0) {
		throw new CliExitError(
			`Error: --wait must be a positive number of seconds, got '${options.wait}'`,
		);
	}

	const { ensureSupervisor } = await import("../supervisor/client.js");
	const { getVersion } = await import("./version.js");
	const { followLogs, formatTranscriptEntry } = await import("../runs/client.js");
	const found = await ensureSupervisor({
		version: getVersion(),
		onWarn: (message) => process.stderr.write(`Warning: ${message}\n`),
	});
	const controller = new AbortController();
	const onSigint = () => controller.abort();
	process.once("SIGINT", onSigint);
	try {
		const { cursor } = await followLogs(found.client, {
			run: options.runId,
			step: options.step ?? null,
			cursor: options.cursor ?? null,
			limit,
			follow: options.follow === true,
			waitSeconds: wait,
			signal: controller.signal,
			onEntry: (entry) => {
				process.stdout.write(
					options.json
						? `${JSON.stringify(entry)}\n`
						: `${formatTranscriptEntry(entry, !options.step)}\n`,
				);
			},
		});
		if (cursor) process.stderr.write(`Cursor: ${cursor}\n`);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	} finally {
		process.removeListener("SIGINT", onSigint);
	}
}
