/**
 * Thin supervisor client used by the CLI (and later the MCP server).
 *
 * Finds the supervisor through the discovery file, authenticates with the
 * per-user token, starts the supervisor on demand, and applies the version
 * handshake: a client with a different version restarts an idle supervisor
 * and only warns when runs are active.
 */

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLOBAL_ROOT_ENV, getGlobalRoot } from "../paths.js";
import {
	type SupervisorDiscovery,
	getSupervisorFiles,
	isPidAlive,
	readDiscovery,
} from "./discovery.js";

export interface PingInfo {
	version: string;
	pid: number;
	contract_version: number;
	started_at: string;
	active_runs: number;
}

export class SupervisorHttpError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "SupervisorHttpError";
	}
}

export class SupervisorUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SupervisorUnavailableError";
	}
}

export class SupervisorClient {
	constructor(public readonly discovery: SupervisorDiscovery) {}

	get baseUrl(): string {
		return `http://${this.discovery.host}:${this.discovery.port}`;
	}

	async request<T = unknown>(
		method: "GET" | "POST",
		route: string,
		body?: unknown,
		timeoutMs = 5_000,
		signal?: AbortSignal,
	): Promise<T> {
		let response: Response;
		const timeout = AbortSignal.timeout(timeoutMs);
		try {
			response = await fetch(`${this.baseUrl}${route}`, {
				method,
				headers: {
					authorization: `Bearer ${this.discovery.token}`,
					"content-type": "application/json",
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
			});
		} catch (err) {
			// Canceled by the caller: not a supervisor problem
			if (signal?.aborted) throw signal.reason ?? err;
			throw new SupervisorUnavailableError(
				`Supervisor at ${this.baseUrl} is not reachable: ${(err as Error).message}`,
			);
		}
		const text = await response.text();
		let parsed: unknown = undefined;
		if (text.length > 0) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = text;
			}
		}
		if (!response.ok) {
			const message =
				typeof parsed === "object" && parsed !== null && "error" in parsed
					? String((parsed as { error: unknown }).error)
					: `HTTP ${response.status}`;
			throw new SupervisorHttpError(response.status, message);
		}
		return parsed as T;
	}

	ping(timeoutMs?: number): Promise<PingInfo> {
		return this.request<PingInfo>("GET", "/v1/ping", undefined, timeoutMs);
	}

	shutdown(force = false): Promise<unknown> {
		return this.request("POST", "/v1/shutdown", { force });
	}
}

export interface FoundSupervisor {
	client: SupervisorClient;
	info: PingInfo;
}

/** Returns the running supervisor, or null when none answers. */
export async function findSupervisor(
	root?: string,
	timeoutMs = 2_000,
): Promise<FoundSupervisor | null> {
	const discovery = readDiscovery(root);
	if (discovery === null) return null;
	const client = new SupervisorClient(discovery);
	try {
		const info = await client.ping(timeoutMs);
		return { client, info };
	} catch {
		return null;
	}
}

/** Path of the built CLI entry point (dist/cli.js next to dist/supervisor/). */
export function getCliPath(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
}

export interface SpawnOptions {
	root?: string;
	cliPath?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * Spawns a detached supervisor (`af serve --foreground` in a hidden, detached
 * process with no console). Output goes to `supervisor.log` in the global dir.
 * Returns the child pid.
 */
export function spawnDetachedSupervisor(options: SpawnOptions = {}): number | undefined {
	const root = options.root ?? getGlobalRoot();
	mkdirSync(root, { recursive: true });
	const files = getSupervisorFiles(root);
	const logFd = openSync(files.log, "a");
	try {
		const child = spawn(
			process.execPath,
			[options.cliPath ?? getCliPath(), "serve", "--foreground"],
			{
				detached: true,
				windowsHide: true,
				stdio: ["ignore", logFd, logFd],
				env: { ...(options.env ?? process.env), [GLOBAL_ROOT_ENV]: root },
			},
		);
		child.unref();
		return child.pid;
	} finally {
		closeSync(logFd);
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until a supervisor answers, or throws after `timeoutMs`. */
export async function waitForSupervisor(
	root?: string,
	timeoutMs = 15_000,
): Promise<FoundSupervisor> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = await findSupervisor(root, 1_000);
		if (found) return found;
		if (Date.now() > deadline) {
			throw new SupervisorUnavailableError(
				`Supervisor did not start within ${timeoutMs} ms (see ${getSupervisorFiles(root).log})`,
			);
		}
		await sleep(100);
	}
}

export interface StopOptions {
	root?: string;
	force?: boolean;
	timeoutMs?: number;
}

/**
 * Stops the running supervisor. Uses the named `/v1/shutdown` request on every
 * platform; on POSIX, falls back to SIGTERM when the request fails.
 * Returns false when no supervisor was running.
 */
export async function stopSupervisor(options: StopOptions = {}): Promise<boolean> {
	const discovery = readDiscovery(options.root);
	if (discovery === null || !isPidAlive(discovery.pid)) return false;
	const client = new SupervisorClient(discovery);
	try {
		await client.shutdown(options.force ?? false);
	} catch (err) {
		if (err instanceof SupervisorHttpError) throw err;
		if (process.platform === "win32") throw err;
		process.kill(discovery.pid, "SIGTERM");
	}
	const deadline = Date.now() + (options.timeoutMs ?? 10_000);
	// An in-process supervisor (tests) never exits, so only its files are awaited.
	const awaitExit = discovery.pid !== process.pid;
	while (
		(awaitExit && isPidAlive(discovery.pid)) ||
		readDiscovery(options.root)?.pid === discovery.pid
	) {
		if (Date.now() > deadline) {
			throw new SupervisorUnavailableError(
				`Supervisor (pid ${discovery.pid}) did not stop within ${options.timeoutMs ?? 10_000} ms`,
			);
		}
		await sleep(50);
	}
	return true;
}

export interface EnsureOptions {
	root?: string;
	/** Client version used for the handshake. */
	version: string;
	/** Starts a supervisor; defaults to a detached `af serve`. */
	start?: (root: string) => void | Promise<void>;
	/** Called with a warning when versions differ but runs are active. */
	onWarn?: (message: string) => void;
	timeoutMs?: number;
}

/**
 * Returns a running supervisor, starting one on demand. On a version mismatch,
 * restarts the supervisor when no run is active, otherwise warns and keeps it.
 */
export async function ensureSupervisor(options: EnsureOptions): Promise<FoundSupervisor> {
	const root = options.root ?? getGlobalRoot();
	const start =
		options.start ??
		((r: string) => {
			spawnDetachedSupervisor({ root: r });
		});
	const found = await findSupervisor(root);
	if (found) {
		if (found.info.version === options.version) return found;
		if (found.info.active_runs > 0) {
			options.onWarn?.(
				`Supervisor version ${found.info.version} differs from client version ${options.version}; keeping it because ${found.info.active_runs} run(s) are active. Restart it with 'af serve --restart' once they finish.`,
			);
			return found;
		}
		await stopSupervisor({ root });
	}
	await start(root);
	return waitForSupervisor(root, options.timeoutMs);
}
