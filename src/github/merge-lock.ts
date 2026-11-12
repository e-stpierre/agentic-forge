/**
 * Per-repository merge lock: every `merge` step of a repository, from any
 * worktree and any run, takes the same lock file, so merges never race.
 *
 * The lock follows the contract lock protocol (exclusive create, a lock older
 * than 30 s is stale) and the esp-merge `AF_MERGE_LOCK` format: the file holds
 * `{ pid, host, at, token, ... }`, and the holder refreshes its mtime every
 * 10 s. A holder that dies (a supervisor crash) stops refreshing, so its lock
 * goes stale and the next merge takes it over. Refresh and release only touch
 * a lock that still carries the holder's token.
 */

import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
	writeSync,
} from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

import { runGit } from "../git/worktree.js";
import { getGlobalRoot } from "../paths.js";
import { LOCK_STALE_MS } from "../supervisor/lock.js";

export const MERGE_LOCK_HEARTBEAT_MS = 10_000;

/**
 * The git common dir of a checkout (`git rev-parse --git-common-dir`), shared
 * by the main checkout and all its worktrees. Absolute and case-normalized on
 * Windows.
 */
export function gitCommonDir(cwd: string): string {
	const result = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd, false);
	let dir = result.returncode === 0 ? result.stdout.trim() : "";
	if (!dir) {
		const fallback = runGit(["rev-parse", "--git-common-dir"], cwd, false);
		if (fallback.returncode !== 0) {
			throw new Error(`Not a git repository: ${cwd}`);
		}
		dir = path.resolve(cwd, fallback.stdout.trim());
	}
	try {
		dir = realpathSync.native(dir);
	} catch {
		// Keep the path git printed
	}
	dir = path.normalize(dir);
	return process.platform === "win32" ? dir.toLowerCase() : dir;
}

/** Lock file of the repository that holds `cwd`: `<global dir>/locks/merge-<hash>.lock`. */
export function mergeLockPath(cwd: string, root: string = getGlobalRoot()): string {
	const key = createHash("sha256").update(gitCommonDir(cwd)).digest("hex").slice(0, 16);
	return path.join(root, "locks", `merge-${key}.lock`);
}

export interface MergeLock {
	path: string;
	token: string;
	release(): void;
}

export interface AcquireOptions {
	/** Give up after this many milliseconds and return null. */
	timeoutMs: number;
	signal?: AbortSignal | null;
	staleMs?: number;
	heartbeatMs?: number;
	/** Polling delay while the lock is busy (default 2 s). */
	pollMs?: number;
	/** Extra fields written in the lock file (run, step, repo). */
	holder?: Record<string, unknown>;
	/** Called once when the lock is busy (to log who holds it). */
	onBusy?: (holder: Record<string, unknown> | null) => void;
}

/** Reads the lock file content, or null. */
export function readMergeLock(lockPath: string): Record<string, unknown> | null {
	try {
		return JSON.parse(readFileSync(lockPath, "utf-8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function tryCreate(lockPath: string, content: string, staleMs: number): boolean {
	for (;;) {
		try {
			const fd = openSync(lockPath, "wx");
			try {
				writeSync(fd, content);
			} finally {
				closeSync(fd);
			}
			return true;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== "EEXIST" && code !== "EPERM") throw err;
			try {
				if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
					rmSync(lockPath, { force: true });
					continue;
				}
			} catch {
				continue;
			}
			return false;
		}
	}
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}

/**
 * Takes the merge lock, waiting while another holder has it. Returns null on
 * timeout or abort. The returned lock refreshes itself until released.
 */
export async function acquireMergeLock(
	lockPath: string,
	options: AcquireOptions,
): Promise<MergeLock | null> {
	const staleMs = options.staleMs ?? LOCK_STALE_MS;
	const heartbeatMs = options.heartbeatMs ?? MERGE_LOCK_HEARTBEAT_MS;
	const pollMs = options.pollMs ?? 2_000;
	const token = randomUUID();
	const deadline = Date.now() + options.timeoutMs;
	mkdirSync(path.dirname(lockPath), { recursive: true });
	let busyReported = false;
	for (;;) {
		const content = JSON.stringify({
			pid: process.pid,
			host: hostname(),
			at: new Date().toISOString(),
			...(options.holder ?? {}),
			token,
		});
		if (tryCreate(lockPath, content, staleMs)) break;
		if (!busyReported) {
			busyReported = true;
			options.onBusy?.(readMergeLock(lockPath));
		}
		if (options.signal?.aborted || Date.now() >= deadline) return null;
		await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())), options.signal);
		if (options.signal?.aborted) return null;
	}
	const owned = () => readMergeLock(lockPath)?.token === token;
	const timer = setInterval(() => {
		if (!owned()) return;
		try {
			const now = new Date();
			utimesSync(lockPath, now, now);
		} catch {
			// The lock file is gone: nothing to refresh
		}
	}, heartbeatMs);
	timer.unref();
	return {
		path: lockPath,
		token,
		release() {
			clearInterval(timer);
			if (owned()) rmSync(lockPath, { force: true });
		},
	};
}
