/** Shared utility functions for runtime adapters. */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the agentic system prompt file. */
const AGENTIC_SYSTEM_PROMPT_FILE = path.join(__dirname, "..", "prompts", "agentic-system.md");

/**
 * Resolve a Windows .cmd npm wrapper to its underlying Node.js script.
 *
 * npm-installed .cmd files follow the pattern:
 *   "%_prog%" "%dp0%\node_modules\pkg\bin\script.js" %*
 * where %dp0% is the directory containing the .cmd file.
 *
 * Returns the resolved script path, or null if the .cmd doesn't match
 * the expected pattern.
 */
export function resolveCmdScript(cmdPath: string): string | null {
	try {
		const content = readFileSync(cmdPath, "utf-8");
		// Match the JS file reference: "%dp0%\...\something.js"
		const match = /%dp0%\\([^"]+\.js)/.exec(content);
		if (match) {
			const cmdDir = path.dirname(cmdPath);
			const scriptPath = path.join(cmdDir, match[1]);
			if (existsSync(scriptPath)) {
				return scriptPath;
			}
		}
	} catch {
		// Fall through
	}
	return null;
}

/** Custom error for missing executables. */
export class FileNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FileNotFoundError";
	}
}

/**
 * Resolve executable path for cross-platform subprocess calls.
 *
 * Uses `where` on Windows and `which` on Unix to find the full path,
 * allowing shell=false in subprocess calls.
 */
export function getExecutable(name: string): string {
	try {
		const cmd = process.platform === "win32" ? "where" : "which";
		const result = execFileSync(cmd, [name], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		const lines = result
			.trim()
			.split(/\r?\n/)
			.filter((l) => l.length > 0);

		if (lines.length === 0) {
			throw new FileNotFoundError(`Executable not found in PATH: ${name}`);
		}

		// On Windows, `where` may return a POSIX shell shim before the .cmd wrapper.
		// Node's spawn() with shell:false cannot execute extensionless POSIX scripts,
		// so prefer .cmd or .exe entries when available.
		if (process.platform === "win32" && lines.length > 1) {
			const windowsEntry = lines.find((l) => /\.(cmd|exe)$/i.test(l));
			if (windowsEntry) {
				return windowsEntry;
			}
		}

		return lines[0];
	} catch (err) {
		if (err instanceof FileNotFoundError) throw err;
		// Fall through to error
	}
	throw new FileNotFoundError(`Executable not found in PATH: ${name}`);
}

/** Format model name for display. */
export function formatModelName(model: string | null): string {
	if (!model) {
		return "";
	}

	// Tier names, including newer families (fable, mythos).
	const TIER = "sonnet|opus|haiku|fable|mythos";

	// Pattern 1: claude-{tier}-{date} (no version). Checked first so the 8-digit
	// date is not mistaken for a version number by pattern 2.
	const pattern1 = new RegExp(`^claude-(${TIER})-\\d{8}$`);
	let match = pattern1.exec(model);
	if (match) {
		return match[1];
	}

	// Pattern 2: claude-{tier}-{major}[-{minor}][-{date}]
	// Covers both dated IDs (claude-sonnet-4-6-20251201) and the current
	// undated aliases (claude-opus-5, claude-fable-5, claude-opus-4-8).
	const pattern2 = new RegExp(`^claude-(${TIER})-(\\d{1,3})(?:-(\\d{1,3}))?(?:-\\d{8})?$`);
	match = pattern2.exec(model);
	if (match) {
		const [, tier, major, minor] = match;
		return minor ? `${tier}-${major}.${minor}` : `${tier}-${major}`;
	}

	// Pattern 3: claude-{major}-{minor}-{tier}[-{date}] (legacy 3.x ordering)
	const pattern3 = new RegExp(`^claude-(\\d{1,3})-(\\d{1,3})-(${TIER})(?:-\\d{8})?$`);
	match = pattern3.exec(model);
	if (match) {
		const [, major, minor, tier] = match;
		return `${tier}-${major}.${minor}`;
	}

	return model;
}

/** Parse a single line of stream-json output. */
export function parseStreamJsonLine(line: string): Record<string, unknown> | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** Extract model name from an assistant or system message. */
export function extractModelFromMessage(data: Record<string, unknown>): string | null {
	const msgType = data.type;

	if (msgType === "assistant") {
		const message = data.message;
		if (typeof message !== "object" || message === null) return null;
		const model = (message as Record<string, unknown>).model;
		return typeof model === "string" ? model : null;
	}

	if (msgType === "system") {
		const model = data.model;
		return typeof model === "string" ? model : null;
	}

	return null;
}

/**
 * Extract text content from an assistant message.
 *
 * Handles two stream-json formats:
 * 1. Verbose format: {"type": "assistant", "message": {"content": [...]}}
 * 2. Stream event format: {"type": "stream_event", "event": {"type": "content_block_delta", ...}}
 *
 * Returns array of [content_block_index, text] tuples.
 */
export function extractTextFromMessage(data: Record<string, unknown>): Array<[number, string]> {
	const msgType = data.type;
	const results: Array<[number, string]> = [];

	if (msgType === "assistant") {
		const message = data.message;
		if (typeof message !== "object" || message === null) return results;
		const msg = message as Record<string, unknown>;
		const contentRaw = msg.content;
		if (!Array.isArray(contentRaw)) return results;

		for (let idx = 0; idx < contentRaw.length; idx++) {
			const block = contentRaw[idx];
			if (
				typeof block === "object" &&
				block !== null &&
				(block as Record<string, unknown>).type === "text"
			) {
				const text = (block as Record<string, unknown>).text;
				if (typeof text === "string" && text) {
					results.push([idx, text]);
				}
			}
		}
	} else if (msgType === "stream_event") {
		const eventRaw = data.event;
		if (typeof eventRaw !== "object" || eventRaw === null) return results;
		const event = eventRaw as Record<string, unknown>;
		const eventType = event.type;

		if (eventType === "content_block_delta") {
			const idx = typeof event.index === "number" ? event.index : 0;
			const deltaRaw = event.delta;
			if (typeof deltaRaw !== "object" || deltaRaw === null) return results;
			const delta = deltaRaw as Record<string, unknown>;
			if (delta.type === "text_delta") {
				const text = delta.text;
				if (typeof text === "string" && text) {
					results.push([idx, text]);
				}
			}
		}
	}

	return results;
}

/** Extract text content from a user message. */
export function extractUserText(data: Record<string, unknown>): string | null {
	if (data.type !== "user") {
		return null;
	}

	const message = data.message;
	if (typeof message !== "object" || message === null) return null;
	const msg = message as Record<string, unknown>;
	const contentRaw = msg.content;
	if (!Array.isArray(contentRaw)) return null;

	const texts: string[] = [];
	for (const block of contentRaw) {
		if (
			typeof block === "object" &&
			block !== null &&
			(block as Record<string, unknown>).type === "text"
		) {
			const text = (block as Record<string, unknown>).text;
			if (typeof text === "string" && text) {
				texts.push(text);
			}
		} else if (typeof block === "string") {
			texts.push(block);
		}
	}

	return texts.length > 0 ? texts.join("\n") : null;
}

/** Extract the final result text from a result message. */
export function extractResultText(data: Record<string, unknown>): string | null {
	if (data.type !== "result") {
		return null;
	}
	return (data.result as string) ?? null;
}

/** Get the agentic system prompt. */
export function getAgenticSystemPrompt(): string | null {
	if (existsSync(AGENTIC_SYSTEM_PROMPT_FILE)) {
		return readFileSync(AGENTIC_SYSTEM_PROMPT_FILE, "utf-8");
	}
	return null;
}
