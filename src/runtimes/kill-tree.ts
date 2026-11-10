/**
 * Process-tree kill helper. Stopping a step must stop every process it
 * started (the runtime CLI, its shells, its tools), never only the parent.
 *
 * - Windows: `taskkill /pid <pid> /T /F` (the whole tree, forced).
 * - POSIX: the child is spawned `detached`, so it leads its own process group;
 *   `kill(-pid, SIGKILL)` reaches the whole group.
 */

import { spawnSync } from "node:child_process";

/** Kills `pid` and all of its descendants. Never throws. */
export function killProcessTree(pid: number | undefined | null): void {
	if (!pid || pid <= 0) return;
	if (process.platform === "win32") {
		try {
			spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
				windowsHide: true,
				stdio: "ignore",
			});
		} catch {
			// Fall through to a plain kill below
		}
		try {
			process.kill(pid);
		} catch {
			// Already gone
		}
		return;
	}
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Already gone
		}
	}
}

/** Spawn options that make `killProcessTree` reach the whole tree. */
export function treeSpawnOptions(): { detached: boolean; windowsHide: true } {
	return { detached: process.platform !== "win32", windowsHide: true };
}
