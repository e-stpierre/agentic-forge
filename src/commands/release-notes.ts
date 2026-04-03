/** Release notes command handler. */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function cmdReleaseNotes(options: {
	specificVersion?: string;
	latest?: boolean;
}): void {
	let changelogPath: string | null = null;

	// Try to find CHANGELOG.md relative to the package
	const candidate = path.join(__dirname, "..", "..", "CHANGELOG.md");
	if (existsSync(candidate)) {
		changelogPath = candidate;
	}

	// Fallback: try current directory
	if (changelogPath === null) {
		const cwdCandidate = path.join(process.cwd(), "CHANGELOG.md");
		if (existsSync(cwdCandidate)) {
			changelogPath = cwdCandidate;
		}
	}

	if (changelogPath === null) {
		process.stdout.write("CHANGELOG.md not found\n");
		return;
	}

	const content = readFileSync(changelogPath, "utf-8");

	if (options.specificVersion) {
		const section = extractVersionSection(content, options.specificVersion);
		if (section) {
			process.stdout.write(`${section.trim()}\n`);
		} else {
			process.stdout.write(`Version ${options.specificVersion} not found in CHANGELOG.md\n`);
		}
		return;
	}

	if (options.latest) {
		const section = extractLatestVersion(content);
		if (section) {
			process.stdout.write(`${section.trim()}\n`);
		} else {
			process.stdout.write("No version information found in CHANGELOG.md\n");
		}
		return;
	}

	process.stdout.write(content);
}

function extractVersionSection(content: string, version: string): string | null {
	const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^## \\[${escaped}\\].*$`, "m");
	const match = pattern.exec(content);

	if (!match) {
		return null;
	}

	const start = match.index;
	const nextPattern = /^## \[[\d.]+\]/m;
	const nextMatch = nextPattern.exec(content.slice(match.index + match[0].length));
	const end = nextMatch ? match.index + match[0].length + nextMatch.index : content.length;

	return content.slice(start, end);
}

function extractLatestVersion(content: string): string | null {
	const pattern = /^## \[([\d.]+)\].*$/m;
	const match = pattern.exec(content);

	if (!match) {
		return null;
	}

	return extractVersionSection(content, match[1]);
}
