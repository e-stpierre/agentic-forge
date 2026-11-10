/**
 * Contract lock protocol (harness contract v1, "Append Protocol").
 *
 * A writer creates `<target>.lock` with exclusive create, does its work, then
 * removes the lock. A lock older than 30 seconds is stale and may be removed.
 * This interoperates with the esp-skills `lock.mjs` helper: same file name,
 * same exclusive-create semantics, same stale timeout, pid written as content.
 */

import { closeSync, openSync, rmSync, statSync, writeSync } from "node:fs";

export const LOCK_STALE_MS = 30_000;

export interface LockOptions {
	/** Give up after this many milliseconds (default 15 s). */
	timeoutMs?: number;
	/** A lock older than this is removed (default 30 s, the contract value). */
	staleMs?: number;
}

export class LockTimeoutError extends Error {
	constructor(
		public readonly lockPath: string,
		timeoutMs: number,
	) {
		super(`Timed out after ${timeoutMs} ms waiting for lock ${lockPath}`);
		this.name = "LockTimeoutError";
	}
}

export function lockPathFor(target: string): string {
	return `${target}.lock`;
}

/**
 * Tries to create the lock once. Returns true when acquired. Removes a stale
 * lock and retries immediately.
 */
function tryAcquire(lockPath: string, staleMs: number): boolean {
	for (;;) {
		try {
			const fd = openSync(lockPath, "wx");
			try {
				writeSync(fd, String(process.pid));
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
				// The lock disappeared between open and stat: retry immediately.
				continue;
			}
			return false;
		}
	}
}

/**
 * Runs `fn` while holding the contract lock for `target` (`<target>.lock`).
 * `fn` may be async; the lock is held until its promise settles.
 */
export async function withLock<T>(
	target: string,
	fn: () => T | Promise<T>,
	options: LockOptions = {},
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? 15_000;
	const staleMs = options.staleMs ?? LOCK_STALE_MS;
	const lockPath = lockPathFor(target);
	const deadline = Date.now() + timeoutMs;
	let delay = 2;
	while (!tryAcquire(lockPath, staleMs)) {
		if (Date.now() > deadline) throw new LockTimeoutError(lockPath, timeoutMs);
		await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * delay)));
		delay = Math.min(delay * 2, 50);
	}
	try {
		return await fn();
	} finally {
		rmSync(lockPath, { force: true });
	}
}
