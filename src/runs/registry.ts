/**
 * Supervisor run registry: `<global dir>/runs/index.json`, one entry per run,
 * pointing at the run directory whose `run.json` holds the full state.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RunStatus } from "../contract/index.js";
import { getRunIndexPath } from "../paths.js";
import { withLock } from "../supervisor/lock.js";

export interface RegistryEntry {
	id: string;
	/** Absolute path of the run directory. */
	dir: string;
	/** Repository root the run was dispatched from. */
	repo: string;
	workflow: string;
	/** `overseer` for an overseer run (never executed by the supervisor); absent for workflow runs. */
	type?: "overseer";
	status: RunStatus;
	/** True when the run works in its own worktree (does not hold the checkout). */
	worktree: boolean;
	/** Higher runs first; ties run in dispatch order. */
	priority: number;
	created_at: string;
	updated_at: string;
}

interface IndexFile {
	version: 1;
	runs: RegistryEntry[];
}

export class RunRegistry {
	readonly file: string;

	constructor(root?: string) {
		this.file = getRunIndexPath(root);
	}

	list(): RegistryEntry[] {
		if (!existsSync(this.file)) return [];
		try {
			const data = JSON.parse(readFileSync(this.file, "utf-8")) as IndexFile;
			return Array.isArray(data.runs) ? data.runs : [];
		} catch {
			return [];
		}
	}

	get(id: string): RegistryEntry | null {
		return this.list().find((r) => r.id === id) ?? null;
	}

	/** Inserts or replaces an entry. */
	async upsert(entry: RegistryEntry): Promise<void> {
		await this.mutate((runs) => {
			const idx = runs.findIndex((r) => r.id === entry.id);
			if (idx === -1) runs.push(entry);
			else runs[idx] = entry;
		});
	}

	/** Applies `patch` to an existing entry; returns the updated entry or null. */
	async update(id: string, patch: Partial<RegistryEntry>): Promise<RegistryEntry | null> {
		let updated: RegistryEntry | null = null;
		await this.mutate((runs) => {
			const idx = runs.findIndex((r) => r.id === id);
			if (idx === -1) return;
			runs[idx] = { ...runs[idx], ...patch, updated_at: new Date().toISOString() };
			updated = runs[idx];
		});
		return updated;
	}

	private async mutate(fn: (runs: RegistryEntry[]) => void): Promise<void> {
		mkdirSync(path.dirname(this.file), { recursive: true });
		await withLock(this.file, async () => {
			const runs = this.list();
			fn(runs);
			const data: IndexFile = { version: 1, runs };
			const tmp = `${this.file}.${process.pid}.tmp`;
			writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
			renameSync(tmp, this.file);
		});
	}
}

/** Filters of `af list` and `GET /v1/runs` (the MCP `af_list_runs` filters). */
export interface RunListFilter {
	/** One status or a comma-separated list. */
	status?: string;
	/** Repository root (compared as resolved paths, case-insensitive on Windows). */
	repo?: string;
	/** ISO timestamp or a relative duration (`30m`, `2h`, `7d`): runs created at or after it. */
	since?: string;
	/** Parent run id (`run.json` `parent`). */
	parent?: string;
}

const DURATION = /^(\d+)\s*(m|h|d|w)$/i;
const UNIT_MS: Record<string, number> = {
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
};

/** Parses a `since` filter to epoch ms, or null when unset. Throws on an invalid value. */
export function parseSince(since: string | null | undefined, now = Date.now()): number | null {
	if (since == null || since.trim() === "") return null;
	const duration = DURATION.exec(since.trim());
	if (duration) return now - Number(duration[1]) * UNIT_MS[duration[2].toLowerCase()];
	const at = Date.parse(since);
	if (Number.isNaN(at)) {
		throw new Error(`Invalid since: ${since} (use an ISO date or a duration like 2h, 7d)`);
	}
	return at;
}

function samePath(a: string, b: string): boolean {
	const ra = path.resolve(a);
	const rb = path.resolve(b);
	return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

function readParent(entry: RegistryEntry): string | null {
	try {
		const run = JSON.parse(readFileSync(path.join(entry.dir, "run.json"), "utf-8")) as {
			parent?: string | null;
		};
		return run.parent ?? null;
	} catch {
		return null;
	}
}

/** Applies list filters to registry entries (`since` already parsed to epoch ms). */
export function filterRuns(
	entries: readonly RegistryEntry[],
	filter: Omit<RunListFilter, "since"> & { since?: number | null },
): RegistryEntry[] {
	const statuses = (filter.status ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return entries.filter(
		(r) =>
			(statuses.length === 0 || statuses.includes(r.status)) &&
			(!filter.repo || samePath(r.repo, filter.repo)) &&
			(filter.since == null || Date.parse(r.created_at) >= filter.since) &&
			(!filter.parent || readParent(r) === filter.parent),
	);
}
