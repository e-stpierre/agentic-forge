/** Status, cancel, and list command handlers. */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { WORKFLOW_STATUS, loadProgress, saveProgress } from "../progress.js";

export function cmdStatus(workflowId: string): void {
	const progress = loadProgress(workflowId);
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
	const progress = loadProgress(workflowId);
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
	saveProgress(progress);

	process.stdout.write(`Workflow canceled: ${workflowId}\n`);
}

export function cmdList(statusFilter?: string): void {
	const outputsDir = path.join(process.cwd(), "agentic", "outputs");
	if (!existsSync(outputsDir)) {
		process.stdout.write("No workflows found.\n");
		return;
	}

	const workflows: Record<string, unknown>[] = [];
	const entries = readdirSync(outputsDir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isDirectory()) {
			const progressFile = path.join(outputsDir, entry.name, "progress.json");
			if (existsSync(progressFile)) {
				const data = JSON.parse(readFileSync(progressFile, "utf-8")) as Record<string, unknown>;
				if (statusFilter == null || data.status === statusFilter) {
					workflows.push(data);
				}
			}
		}
	}

	if (workflows.length === 0) {
		const suffix = statusFilter ? ` (status=${statusFilter})` : "";
		process.stdout.write(`No workflows found.${suffix}\n`);
		return;
	}

	process.stdout.write(
		`${"ID".padEnd(12)} ${"Name".padEnd(25)} ${"Status".padEnd(12)} ${"Started".padEnd(20)}\n`,
	);
	process.stdout.write(`${"-".repeat(70)}\n`);
	for (const wf of workflows) {
		const id = String(wf.workflow_id ?? "").padEnd(12);
		const name = String(wf.workflow_name ?? "")
			.slice(0, 25)
			.padEnd(25);
		const status = String(wf.status ?? "").padEnd(12);
		const started = wf.started_at ? String(wf.started_at).slice(0, 19).padEnd(20) : "".padEnd(20);
		process.stdout.write(`${id} ${name} ${status} ${started}\n`);
	}
}
