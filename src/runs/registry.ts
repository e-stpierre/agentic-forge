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
