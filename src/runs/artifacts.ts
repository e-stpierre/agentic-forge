/**
 * Run artifacts by kind (`af artifacts`, the MCP `af_artifacts` tool): the
 * plan versions, the summary, the decision log and the review files of a run
 * directory.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { latestPlan } from "../contract/plan.js";
import { DECISIONS_FILE } from "./run-store.js";

export const ARTIFACT_KINDS = ["plan", "summary", "decisions", "review"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface ArtifactList {
	kind: ArtifactKind;
	/** Existing files, oldest version first. */
	paths: string[];
	/** The current one (latest plan or review, the summary or decision log), or null. */
	latest: string | null;
}

export function isArtifactKind(value: unknown): value is ArtifactKind {
	return typeof value === "string" && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

function versioned(dir: string, pattern: RegExp, first?: string): string[] {
	if (!existsSync(dir)) return [];
	const found: Array<{ n: number; file: string }> = [];
	for (const name of readdirSync(dir)) {
		if (first && name === first) found.push({ n: 1, file: name });
		const match = pattern.exec(name);
		if (match) found.push({ n: Number(match[1]), file: name });
	}
	return found.sort((a, b) => a.n - b.n).map((f) => path.join(dir, f.file));
}

/** Lists the files of one artifact kind in a run directory. */
export function listArtifacts(runDir: string, kind: ArtifactKind): ArtifactList {
	let paths: string[];
	let latest: string | null;
	switch (kind) {
		case "plan":
			paths = versioned(runDir, /^plan\.v(\d+)\.md$/, "plan.md");
			latest = latestPlan(runDir).path ?? null;
			break;
		case "review":
			paths = versioned(runDir, /^review-(\d+)\.md$/);
			latest = paths.at(-1) ?? null;
			break;
		case "summary": {
			const file = path.join(runDir, "summary.md");
			paths = existsSync(file) ? [file] : [];
			latest = paths[0] ?? null;
			break;
		}
		case "decisions": {
			const file = path.join(runDir, DECISIONS_FILE);
			paths = existsSync(file) ? [file] : [];
			latest = paths[0] ?? null;
			break;
		}
	}
	return { kind, paths, latest };
}

/** Reads a file, truncated to `maxChars` with a marker. */
export function readArtifact(file: string, maxChars = 20_000): string {
	const content = readFileSync(file, "utf-8");
	if (content.length <= maxChars) return content;
	return `${content.slice(0, maxChars)}\n\n[truncated: ${content.length - maxChars} more characters in ${file}]\n`;
}
