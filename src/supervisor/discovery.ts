/**
 * Supervisor discovery file and pidfile in the af global directory.
 *
 * - `supervisor.json`: `{ pid, host, port, token, version, contract_version, started_at }`,
 *   written with mode 0600 (user-only). Clients read it to find and authenticate
 *   to the supervisor.
 * - `supervisor.pid`: the supervisor pid, as text.
 * - `supervisor.lock`: contract lock taken while a supervisor claims the
 *   single-instance slot (short critical section, not held for the lifetime).
 * - `supervisor.log`: stdout and stderr of a detached supervisor.
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getGlobalRoot } from "../paths.js";

export const DISCOVERY_FILE = "supervisor.json";
export const PID_FILE = "supervisor.pid";
export const LOCK_TARGET = "supervisor";
export const LOG_FILE = "supervisor.log";

export interface SupervisorDiscovery {
	pid: number;
	host: string;
	port: number;
	token: string;
	version: string;
	contract_version: number;
	started_at: string;
}

export interface SupervisorFiles {
	root: string;
	discovery: string;
	pidfile: string;
	lockTarget: string;
	log: string;
}

export function getSupervisorFiles(root: string = getGlobalRoot()): SupervisorFiles {
	return {
		root,
		discovery: path.join(root, DISCOVERY_FILE),
		pidfile: path.join(root, PID_FILE),
		lockTarget: path.join(root, LOCK_TARGET),
		log: path.join(root, LOG_FILE),
	};
}

/** Writes a file atomically (temp file + rename) with user-only permissions. */
export function writePrivateFile(file: string, content: string): void {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, content, { encoding: "utf-8", mode: 0o600 });
	renameSync(tmp, file);
}

function isDiscovery(value: unknown): value is SupervisorDiscovery {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.pid === "number" &&
		typeof v.host === "string" &&
		typeof v.port === "number" &&
		typeof v.token === "string" &&
		typeof v.version === "string"
	);
}

/** Reads the discovery file. Returns null when it is missing or malformed. */
export function readDiscovery(root?: string): SupervisorDiscovery | null {
	const file = getSupervisorFiles(root).discovery;
	if (!existsSync(file)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
		return isDiscovery(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Reads the pidfile. Returns null when it is missing or malformed. */
export function readPidfile(root?: string): number | null {
	const file = getSupervisorFiles(root).pidfile;
	if (!existsSync(file)) return null;
	const pid = Number.parseInt(readFileSync(file, "utf-8").trim(), 10);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Removes the discovery file and pidfile, but only when they belong to `pid`. */
export function removeSupervisorFiles(pid: number, root?: string): void {
	const files = getSupervisorFiles(root);
	const discovery = readDiscovery(root);
	if (discovery === null || discovery.pid === pid) rmSync(files.discovery, { force: true });
	const owner = readPidfile(root);
	if (owner === null || owner === pid) rmSync(files.pidfile, { force: true });
}

/** True when a process with this pid exists (EPERM means it exists but is not ours). */
export function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}
