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

export interface ArtifactReadOptions {
	/** Characters returned (default all). */
	maxChars?: number;
	/** First character returned, inside the section when one is named (default 0). */
	offset?: number;
	/** Markdown heading: only its section (up to the next heading of the same or a higher level). */
	section?: string;
}

export interface ArtifactContent {
	content: string;
	/** Offset of `content` in the file (or the section). */
	offset: number;
	/** Characters of the file (or the section). */
	total_chars: number;
	/** True when characters follow `content`. */
	truncated: boolean;
	/** Offset of the next page, when truncated. */
	next_offset?: number;
	/** The heading matched by `section`. */
	section?: string;
}

/** An artifact read failed for a reason the caller can fix (unknown section). */
export class ArtifactReadError extends Error {
	constructor(
		message: string,
		readonly headings: string[],
	) {
		super(message);
		this.name = "ArtifactReadError";
	}
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/;

/** Markdown headings of `text` with their level and line index, outside fenced code blocks. */
export function markdownHeadings(text: string): { level: number; title: string; line: number }[] {
	const out: { level: number; title: string; line: number }[] = [];
	let fenced = false;
	text.split(/\r?\n/).forEach((line, i) => {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		if (fenced) return;
		const match = HEADING.exec(line);
		if (match) out.push({ level: match[1].length, title: match[2].trim(), line: i });
	});
	return out;
}

/** The section of `text` under the heading `name` (exact title first, then a title containing it; case-insensitive). */
export function markdownSection(text: string, name: string): { title: string; text: string } | null {
	const headings = markdownHeadings(text);
	const wanted = name.replace(/^#+\s*/, "").trim().toLowerCase();
	const found =
		headings.find((h) => h.title.toLowerCase() === wanted) ??
		headings.find((h) => h.title.toLowerCase().includes(wanted));
	if (!found) return null;
	const end = headings.find((h) => h.line > found.line && h.level <= found.level);
	const lines = text.split(/\r?\n/);
	return {
		title: found.title,
		text: lines.slice(found.line, end ? end.line : lines.length).join("\n"),
	};
}

/** Reads a page of an artifact file, or of one of its markdown sections. */
export function readArtifactPage(file: string, options: ArtifactReadOptions = {}): ArtifactContent {
	let text = readFileSync(file, "utf-8");
	let title: string | undefined;
	if (options.section) {
		const section = markdownSection(text, options.section);
		if (!section) {
			throw new ArtifactReadError(
				`No section "${options.section}" in ${file}`,
				markdownHeadings(text).map((h) => h.title),
			);
		}
		text = section.text;
		title = section.title;
	}
	const offset = Math.min(Math.max(options.offset ?? 0, 0), text.length);
	const max = options.maxChars && options.maxChars > 0 ? options.maxChars : text.length;
	const content = text.slice(offset, offset + max);
	const end = offset + content.length;
	const truncated = end < text.length;
	return {
		content,
		offset,
		total_chars: text.length,
		truncated,
		...(truncated ? { next_offset: end } : {}),
		...(title !== undefined ? { section: title } : {}),
	};
}
