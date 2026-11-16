/**
 * Status, cancel, and list command handlers.
 *
 * Supervisor runs are read from the run registry (`<global dir>/runs/index.json`)
 * and each run's `run.json`. Pre-supervisor runs under `outputs/` are listed
 * read-only and marked as legacy.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { getMainRepoRoot } from "../git/worktree.js";
import { findOutputDir, getGlobalRoot, getWorktreeOutputRoot, slugifyCwdName } from "../paths.js";
import { loadProgress } from "../progress.js";
import {
	type RegistryEntry,
	type RunListFilter,
	RunRegistry,
	filterRuns,
	parseSince,
} from "../runs/registry.js";
import { RunStore } from "../runs/run-store.js";
import type { WorkflowProgress } from "../types.js";
import { CliExitError } from "./run.js";

/**
 * Locates a legacy output directory by searching both local and global locations.
 * Also checks the canonical worktree output root when invoked from inside a worktree.
 */
export function resolveLegacyOutputDir(workflowId: string, cwd = process.cwd()): string | null {
	let repoRoot: string | undefined;
	try {
		const root = getMainRepoRoot(cwd);
		if (root !== cwd) repoRoot = root;
	} catch {
		// Not in a git repo; skip worktree output root lookup
	}
	return findOutputDir(workflowId, cwd, repoRoot);
}

function writeSteps(progress: WorkflowProgress): void {
	if (progress.currentStep) {
		process.stdout.write(`\nCurrent Step: ${progress.currentStep.name}\n`);
		process.stdout.write(`  Retry Count: ${progress.currentStep.retryCount}\n`);
	}
	if (progress.completedSteps.length > 0) {
		process.stdout.write("\nCompleted Steps:\n");
		for (const step of progress.completedSteps) {
			const icon = step.status === "completed" ? "+" : step.status === "interrupted" ? "!" : "x";
			const suffix = step.status === "interrupted" ? " (interrupted)" : "";
			process.stdout.write(`  [${icon}] ${step.name}${suffix}\n`);
		}
	}
	if (progress.pendingSteps.length > 0) {
		process.stdout.write("\nPending Steps:\n");
		for (const stepName of progress.pendingSteps) {
			process.stdout.write(`  [ ] ${stepName}\n`);
		}
	}
	if (progress.errors.length > 0) {
		process.stdout.write("\nErrors:\n");
		for (const error of progress.errors) {
			const err = error as Record<string, string>;
			process.stdout.write(`  - ${err.step}: ${err.error}\n`);
		}
	}
}

export function cmdStatus(workflowId: string): void {
	const entry = new RunRegistry().get(workflowId);
	if (entry) {
		writeRunStatus(entry);
		return;
	}

	const outputDir = resolveLegacyOutputDir(workflowId);
	const progress = outputDir === null ? null : loadProgress(workflowId, outputDir);
	if (progress === null) {
		throw new CliExitError(`Error: Run not found: ${workflowId}`);
	}
	process.stdout.write(`Workflow: ${progress.workflowName} (legacy run, read-only)\n`);
	process.stdout.write(`ID: ${progress.workflowId}\n`);
	process.stdout.write(`Status: ${progress.status}\n`);
	process.stdout.write(`Started: ${progress.startedAt}\n`);
	if (progress.completedAt) {
		process.stdout.write(`Completed: ${progress.completedAt}\n`);
	}
	writeSteps(progress);
}

function writeRunStatus(entry: RegistryEntry): void {
	const store = new RunStore(entry.dir);
	const run = store.exists() ? store.readRun() : null;
	process.stdout.write(`Workflow: ${entry.workflow}\n`);
	process.stdout.write(`ID: ${entry.id}\n`);
	process.stdout.write(`Status: ${run?.status ?? entry.status}\n`);
	process.stdout.write(`Repo: ${entry.repo}\n`);
	process.stdout.write(`Run dir: ${entry.dir}\n`);
	if (run?.worktree) {
		process.stdout.write(`Worktree: ${run.worktree} (branch: ${run.branch ?? "?"})\n`);
	}
	process.stdout.write(`Started: ${run?.started_at ?? entry.created_at}\n`);
	if (run?.ended_at) {
		process.stdout.write(`Ended: ${run.ended_at}\n`);
	}
	const progress = loadProgress(entry.id, entry.dir);
	if (progress) writeSteps(progress);
}

async function supervisorClient() {
	const { ensureSupervisor } = await import("../supervisor/client.js");
	const { getVersion } = await import("./version.js");
	const found = await ensureSupervisor({
		version: getVersion(),
		onWarn: (message) => process.stderr.write(`Warning: ${message}\n`),
	});
	return found.client;
}

export async function cmdCancel(workflowId: string): Promise<void> {
	const entry = new RunRegistry().get(workflowId);
	if (!entry) {
		if (resolveLegacyOutputDir(workflowId)) {
			throw new CliExitError(
				`Error: ${workflowId} is a legacy run (pre-supervisor) and is read-only. Finish or discard it manually.`,
			);
		}
		throw new CliExitError(`Error: Run not found: ${workflowId}`);
	}
	const client = await supervisorClient();
	try {
		const res = await client.request<{ status: string }>(
			"POST",
			`/v1/runs/${encodeURIComponent(workflowId)}/cancel`,
		);
		process.stdout.write(
			res.status === "canceling"
				? `Cancel requested: ${workflowId} stops its current step now\n`
				: `Run canceled: ${workflowId}\n`,
		);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
}

interface LegacyEntry {
	data: Record<string, unknown>;
}

function scanOutputsDir(outputsDir: string, statusFilter?: string): LegacyEntry[] {
	const entries: LegacyEntry[] = [];
	if (!existsSync(outputsDir)) {
		return entries;
	}
	for (const entry of readdirSync(outputsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const progressFile = path.join(outputsDir, entry.name, "progress.json");
		if (!existsSync(progressFile)) continue;
		try {
			const data = JSON.parse(readFileSync(progressFile, "utf-8")) as Record<string, unknown>;
			if (statusFilter == null || data.status === statusFilter) {
				entries.push({ data });
			}
		} catch {
			// Skip corrupted progress files
		}
	}
	return entries;
}

function legacyEntries(cwd: string, statusFilter?: string): LegacyEntry[] {
	const dirs = [
		path.join(cwd, "agentic", "outputs"),
		path.join(getGlobalRoot(), "outputs", slugifyCwdName(cwd)),
	];
	try {
		const mainRoot = getMainRepoRoot(cwd);
		if (mainRoot !== cwd) dirs.push(getWorktreeOutputRoot(mainRoot));
	} catch {
		// Not in a git repo
	}
	const seen = new Set<string>();
	const out: LegacyEntry[] = [];
	for (const dir of [...new Set(dirs)]) {
		for (const entry of scanOutputsDir(dir, statusFilter)) {
			const id = String(entry.data.workflow_id ?? "");
			if (seen.has(id)) continue;
			seen.add(id);
			out.push(entry);
		}
	}
	return out;
}

function row(id: string, name: string, status: string, started: string): string {
	return `${id.padEnd(40)} ${name.slice(0, 25).padEnd(25)} ${status.padEnd(14)} ${started.slice(0, 19)}\n`;
}

export interface ListOptions extends RunListFilter {
	/** Print the registry entries as JSON (legacy runs are not included). */
	json?: boolean;
}

/**
 * Lists supervisor runs from the registry, newest first, with the
 * `af_list_runs` filters. Legacy runs are listed when only `status` filters.
 */
export function cmdList(options: ListOptions | string = {}): void {
	const opts: ListOptions = typeof options === "string" ? { status: options } : options;
	const statusFilter = opts.status;
	const cwd = process.cwd();
	let since: number | null;
	try {
		since = parseSince(opts.since);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
	const runs = filterRuns(new RunRegistry().list(), { ...opts, since }).sort((a, b) =>
		b.created_at.localeCompare(a.created_at),
	);
	if (opts.json) {
		process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
		return;
	}
	const legacy =
		opts.repo || opts.since || opts.parent || statusFilter?.includes(",")
			? []
			: legacyEntries(cwd, statusFilter);

	if (runs.length === 0 && legacy.length === 0) {
		const filters = (["status", "repo", "since", "parent"] as const)
			.filter((k) => opts[k])
			.map((k) => `${k}=${opts[k]}`);
		const suffix = filters.length > 0 ? ` (${filters.join(", ")})` : "";
		process.stdout.write(`No runs found.${suffix}\n`);
		return;
	}

	const header = row("ID", "Workflow", "Status", "Started");
	const divider = `${"-".repeat(100)}\n`;
	if (runs.length > 0) {
		process.stdout.write("Runs:\n");
		process.stdout.write(header);
		process.stdout.write(divider);
		for (const r of runs) {
			process.stdout.write(row(r.id, r.workflow, r.status, r.created_at));
		}
	}
	if (legacy.length > 0) {
		if (runs.length > 0) process.stdout.write("\n");
		process.stdout.write("Legacy runs (read-only, pre-supervisor outputs/):\n");
		process.stdout.write(header);
		process.stdout.write(divider);
		for (const { data } of legacy) {
			process.stdout.write(
				row(
					String(data.workflow_id ?? ""),
					String(data.workflow_name ?? ""),
					String(data.status ?? ""),
					String(data.started_at ?? ""),
				),
			);
		}
	}
}
