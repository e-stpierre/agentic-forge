/**
 * Scheduling rules for queued runs.
 *
 * - at most `maxParallelRuns` runs are running at once (global)
 * - at most `maxParallelTasks` runs per repository
 * - two runs never share one checkout: a run without its own worktree waits
 *   while another run without a worktree is running on the same repository
 */

import type { RegistryEntry } from "./registry.js";

export interface SchedulerLimits {
	maxParallelRuns: number;
	/** Per-repo limit; resolved from each queued run's config snapshot. */
	maxParallelTasks: (entry: RegistryEntry) => number;
}

export const DEFAULT_MAX_PARALLEL_RUNS = 4;
export const DEFAULT_MAX_PARALLEL_TASKS = 2;

function repoKey(repo: string): string {
	return process.platform === "win32" ? repo.toLowerCase() : repo;
}

/** Orders queued runs: higher priority first, then oldest first. */
export function queueOrder(a: RegistryEntry, b: RegistryEntry): number {
	if (a.priority !== b.priority) return b.priority - a.priority;
	return a.created_at.localeCompare(b.created_at);
}

/**
 * Returns the queued runs to start now, in start order. `running` holds the
 * runs currently executing; `queued` the candidates.
 */
export function pickRunnable(
	queued: RegistryEntry[],
	running: RegistryEntry[],
	limits: SchedulerLimits,
): RegistryEntry[] {
	const active = [...running];
	const picked: RegistryEntry[] = [];
	for (const candidate of [...queued].sort(queueOrder)) {
		if (active.length >= limits.maxParallelRuns) break;
		const key = repoKey(candidate.repo);
		const sameRepo = active.filter((r) => repoKey(r.repo) === key);
		if (sameRepo.length >= limits.maxParallelTasks(candidate)) continue;
		if (!candidate.worktree && sameRepo.some((r) => !r.worktree)) continue;
		picked.push(candidate);
		active.push(candidate);
	}
	return picked;
}
