/**
 * Scheduling rules for queued runs.
 *
 * - at most `maxParallelRuns` runs are running at once (global)
 * - at most `maxParallelTasks` runs per repository
 * - two runs never share one checkout: a run without its own worktree waits
 *   while another run without a worktree is running on the same repository
 * - a child run is never held back by its own running ancestors: they lend
 *   it their slot and their checkout (a parent step that dispatched a child
 *   usually waits for it, so waiting behind it would deadlock)
 */

import type { RegistryEntry } from "./registry.js";

export interface SchedulerLimits {
	maxParallelRuns: number;
	/** Per-repo limit; resolved from each queued run's config snapshot. */
	maxParallelTasks: (entry: RegistryEntry) => number;
	/** Ancestor run ids of a run (its run tree), nearest first. */
	ancestors?: (entry: RegistryEntry) => readonly string[];
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
		const lent = new Set(limits.ancestors?.(candidate) ?? []);
		const others = active.filter((r) => !lent.has(r.id));
		if (others.length >= limits.maxParallelRuns) continue;
		const key = repoKey(candidate.repo);
		const sameRepo = others.filter((r) => repoKey(r.repo) === key);
		if (sameRepo.length >= limits.maxParallelTasks(candidate)) continue;
		if (!candidate.worktree && sameRepo.some((r) => !r.worktree)) continue;
		picked.push(candidate);
		active.push(candidate);
	}
	return picked;
}
