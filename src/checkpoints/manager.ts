/** Checkpoint management for workflow sessions. */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

// --- Path helper ---

export function getCheckpointPath(workflowId: string, outputDir: string): string {
	return path.join(outputDir, "checkpoint.md");
}

// --- Create checkpoint ---

export function createCheckpoint(
	workflowId: string,
	step: string,
	context: string,
	progress: string,
	outputDir: string,
	notes = "",
	issues = "",
): string {
	const checkpointPath = getCheckpointPath(workflowId, outputDir);
	const dir = path.dirname(checkpointPath);
	mkdirSync(dir, { recursive: true });

	const existing = readCheckpoints(workflowId, outputDir);
	const checkpointNum = existing.length + 1;
	const checkpointId = `chk-${String(checkpointNum).padStart(3, "0")}`;

	const timestamp = new Date().toISOString();

	const frontmatter: Record<string, unknown> = {
		checkpoint_id: checkpointId,
		step,
		created: timestamp,
		workflow_id: workflowId,
		status: "in_progress",
	};

	const entryLines: string[] = [
		"---",
		yaml.dump(frontmatter, { flowLevel: -1 }).trim(),
		"---",
		"",
		"## Context",
		"",
		context,
		"",
		"## Progress",
		"",
		progress,
		"",
	];

	if (notes) {
		entryLines.push("## Notes for Next Session", "", notes, "");
	}

	if (issues) {
		entryLines.push("## Issues Discovered", "", issues, "");
	}

	entryLines.push("---\n");
	const entry = entryLines.join("\n");

	appendFileSync(checkpointPath, entry, "utf-8");

	return checkpointId;
}

// --- Read checkpoints ---

export function readCheckpoints(workflowId: string, outputDir: string): Record<string, unknown>[] {
	const checkpointPath = getCheckpointPath(workflowId, outputDir);

	if (!existsSync(checkpointPath)) {
		return [];
	}

	const content = readFileSync(checkpointPath, "utf-8");
	const checkpoints: Record<string, unknown>[] = [];

	const parts = content.split("---");

	let i = 1;
	while (i < parts.length - 1) {
		const frontmatterStr = parts[i].trim();

		if (!frontmatterStr) {
			i += 1;
			continue;
		}

		const body = i + 1 < parts.length ? parts[i + 1].trim() : "";

		try {
			const frontmatter = yaml.load(frontmatterStr) as Record<string, unknown> | null;
			if (frontmatter && "checkpoint_id" in frontmatter) {
				frontmatter.content = body;
				checkpoints.push(frontmatter);
			}
		} catch {
			// Invalid YAML, skip
		}

		i += 2;
	}

	return checkpoints;
}

// --- Get latest checkpoint ---

export function getLatestCheckpoint(
	workflowId: string,
	outputDir: string,
): Record<string, unknown> | null {
	const checkpoints = readCheckpoints(workflowId, outputDir);
	return checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
}
