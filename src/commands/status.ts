/** Status, cancel, and list command handlers. */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "../config.js";
import { findOutputDir, getGlobalRoot, getOutputRoot, slugifyCwdName } from "../paths.js";
import { WORKFLOW_STATUS, loadProgress, saveProgress } from "../progress.js";

/**
 * Locates the output directory for a workflow by searching both local and global locations.
 * If the progress.json contains a stored outputDir, that is used directly.
 */
function resolveWorkflowOutputDir(workflowId: string): string | null {
	return findOutputDir(workflowId, process.cwd());
}

export function cmdStatus(workflowId: string): void {
	const outputDir = resolveWorkflowOutputDir(workflowId);
	if (outputDir === null) {
		process.stderr.write(`Error: Workflow not found: ${workflowId}\n`);
		process.exit(1);
	}
	const progress = loadProgress(workflowId, outputDir);
	if (progress === null) {
		process.stderr.write(`Error: Workflow not found: ${workflowId}\n`);
		process.exit(1);
	}

	process.stdout.write(`Workflow: ${progress.workflowName}\n`);
	process.stdout.write(`ID: ${progress.workflowId}\n`);
	process.stdout.write(`Status: ${progress.status}\n`);
	process.stdout.write(`Started: ${progress.startedAt}\n`);
	if (progress.completedAt) {
		process.stdout.write(`Completed: ${progress.completedAt}\n`);
	}

	if (progress.currentStep) {
		process.stdout.write(`\nCurrent Step: ${progress.currentStep.name}\n`);
		process.stdout.write(`  Retry Count: ${progress.currentStep.retryCount}\n`);
	}

	if (progress.completedSteps && progress.completedSteps.length > 0) {
		process.stdout.write("\nCompleted Steps:\n");
		for (const step of progress.completedSteps) {
			const icon = step.status === "completed" ? "+" : "x";
			process.stdout.write(`  [${icon}] ${step.name}\n`);
		}
	}

	if (progress.pendingSteps && progress.pendingSteps.length > 0) {
		process.stdout.write("\nPending Steps:\n");
		for (const stepName of progress.pendingSteps) {
			process.stdout.write(`  [ ] ${stepName}\n`);
		}
	}

	if (progress.errors && progress.errors.length > 0) {
		process.stdout.write("\nErrors:\n");
		for (const error of progress.errors) {
			const err = error as Record<string, string>;
			process.stdout.write(`  - ${err.step}: ${err.error}\n`);
		}
	}
}

export function cmdCancel(workflowId: string): void {
	const outputDir = resolveWorkflowOutputDir(workflowId);
	if (outputDir === null) {
		process.stderr.write(`Error: Workflow not found: ${workflowId}\n`);
		process.exit(1);
	}
	const progress = loadProgress(workflowId, outputDir);
	if (progress === null) {
		process.stderr.write(`Error: Workflow not found: ${workflowId}\n`);
		process.exit(1);
	}

	if (progress.status !== WORKFLOW_STATUS.RUNNING && progress.status !== WORKFLOW_STATUS.PAUSED) {
		process.stderr.write(`Error: Cannot cancel workflow in '${progress.status}' status\n`);
		process.exit(1);
	}

	progress.status = WORKFLOW_STATUS.CANCELED;
	progress.completedAt = new Date().toISOString();
	saveProgress(progress, outputDir);

	process.stdout.write(`Workflow canceled: ${workflowId}\n`);
}

interface WorkflowEntry {
	data: Record<string, unknown>;
	location: "local" | "global";
}

function scanOutputsDir(
	outputsDir: string,
	location: "local" | "global",
	statusFilter?: string,
): WorkflowEntry[] {
	const entries: WorkflowEntry[] = [];
	if (!existsSync(outputsDir)) {
		return entries;
	}
	const dirs = readdirSync(outputsDir, { withFileTypes: true });
	for (const entry of dirs) {
		if (entry.isDirectory()) {
			const progressFile = path.join(outputsDir, entry.name, "progress.json");
			if (existsSync(progressFile)) {
				try {
					const data = JSON.parse(readFileSync(progressFile, "utf-8")) as Record<string, unknown>;
					if (statusFilter == null || data.status === statusFilter) {
						entries.push({ data, location });
					}
				} catch {
					// Skip corrupted progress files
				}
			}
		}
	}
	return entries;
}

export function cmdList(statusFilter?: string): void {
	const cwd = process.cwd();
	const config = loadConfig(cwd);
	const localOutputsDir = path.join(cwd, "agentic", "outputs");
	const globalOutputsDir = path.join(getGlobalRoot(), "outputs", slugifyCwdName(cwd));

	const localEntries = scanOutputsDir(localOutputsDir, "local", statusFilter);
	const globalEntries = scanOutputsDir(globalOutputsDir, "global", statusFilter);

	// Deduplicate: if same workflow_id appears in both, prefer local (already first)
	const seenIds = new Set<string>();
	const allEntries: WorkflowEntry[] = [];
	for (const entry of [...localEntries, ...globalEntries]) {
		const id = String(entry.data.workflow_id ?? "");
		if (!seenIds.has(id)) {
			seenIds.add(id);
			allEntries.push(entry);
		}
	}

	if (allEntries.length === 0) {
		const suffix = statusFilter ? ` (status=${statusFilter})` : "";
		process.stdout.write(`No workflows found.${suffix}\n`);
		return;
	}

	// Group by location for display
	const byLocation: Record<string, WorkflowEntry[]> = { local: [], global: [] };
	for (const entry of allEntries) {
		byLocation[entry.location].push(entry);
	}

	const header = `${"ID".padEnd(32)} ${"Name".padEnd(25)} ${"Status".padEnd(12)} ${"Started".padEnd(20)}\n`;
	const divider = `${"-".repeat(90)}\n`;

	let hasOutput = false;

	if (byLocation.local.length > 0) {
		process.stdout.write("Local runs:\n");
		process.stdout.write(header);
		process.stdout.write(divider);
		for (const { data: wf } of byLocation.local) {
			writeWorkflowRow(wf);
		}
		hasOutput = true;
	}

	if (byLocation.global.length > 0) {
		if (hasOutput) process.stdout.write("\n");
		process.stdout.write("Global runs:\n");
		process.stdout.write(header);
		process.stdout.write(divider);
		for (const { data: wf } of byLocation.global) {
			writeWorkflowRow(wf);
		}
	}
}

function writeWorkflowRow(wf: Record<string, unknown>): void {
	const id = String(wf.workflow_id ?? "").padEnd(32);
	const name = String(wf.workflow_name ?? "")
		.slice(0, 25)
		.padEnd(25);
	const status = String(wf.status ?? "").padEnd(12);
	const started = wf.started_at ? String(wf.started_at).slice(0, 19).padEnd(20) : "".padEnd(20);
	process.stdout.write(`${id} ${name} ${status} ${started}\n`);
}
