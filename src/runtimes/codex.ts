/** Codex runtime adapter. */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
	RuntimeAdapter,
	RuntimeCommand,
	RuntimeResult,
	RuntimeRunOptions,
	StreamEvent,
} from "./types.js";
import { SessionOutput } from "./types.js";
import { getExecutable } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the agentic system prompt file. */
const AGENTIC_SYSTEM_PROMPT_FILE = path.join(__dirname, "..", "prompts", "agentic-system.md");

/** Get the agentic system prompt. */
function getAgenticSystemPrompt(): string | null {
	if (existsSync(AGENTIC_SYSTEM_PROMPT_FILE)) {
		return readFileSync(AGENTIC_SYSTEM_PROMPT_FILE, "utf-8");
	}
	return null;
}

/** Parse a single JSONL line from Codex output. */
function parseCodexJsonLine(line: string): Record<string, unknown> | null {
	const trimmed = line.trim();
	if (!trimmed || !trimmed.startsWith("{")) {
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

/** Codex CLI adapter. */
export class CodexAdapter implements RuntimeAdapter {
	readonly id = "codex" as const;
	readonly executableName = "codex";

	checkAvailable(): boolean {
		try {
			getExecutable(this.executableName);
			return true;
		} catch {
			return false;
		}
	}

	buildCommand(options: RuntimeRunOptions, sandbox = "workspace-write"): RuntimeCommand {
		const { model = "gpt-4o", skipPermissions = false, cwd, outputDir } = options;

		const args: string[] = ["--full-auto", "--sandbox", sandbox, "exec"];

		if (options.printOutput) {
			args.push("--json");
		}

		if (cwd) {
			args.push("--cd", cwd);
		}

		if (skipPermissions) {
			args.push("--dangerously-bypass-approvals-and-sandbox");
		}

		if (model) {
			args.push("--model", model);
		}

		// Add output directory write access
		if (outputDir) {
			args.push("--add-dir", outputDir);
		}

		// Build environment
		const env: Record<string, string> = {};
		if (options.workflowId) {
			env.OTEL_RESOURCE_ATTRIBUTES = `session=${options.workflowId}`;
		}

		// System prompt is prepended to the user prompt (Codex has no --append-system-prompt flag)
		const systemPrompt = options.appendSystemPrompt ? getAgenticSystemPrompt() : null;
		const stdinInput = systemPrompt ? `${systemPrompt}\n\n${options.prompt}` : options.prompt;

		return {
			executable: getExecutable(this.executableName),
			args,
			env: Object.keys(env).length > 0 ? env : undefined,
			stdinInput,
		};
	}

	parseStreamLine(line: string): StreamEvent | null {
		const data = parseCodexJsonLine(line);
		if (!data) {
			return null;
		}

		const eventType = data.type;

		// Handle item completion with agent message
		if (eventType === "item.completed") {
			const item = data.item;
			if (typeof item === "object" && item !== null) {
				const itemObj = item as Record<string, unknown>;
				if (itemObj.type === "agent_message") {
					const text = itemObj.text;
					if (typeof text === "string") {
						return {
							type: "text",
							text,
						};
					}
				}
			}
		}

		// Handle turn completion (end of response)
		if (eventType === "turn.completed") {
			return {
				type: "result",
				text: "",
			};
		}

		// Handle errors
		if (eventType === "error") {
			const text = data.message ?? "Unknown error";
			return {
				type: "error",
				text: typeof text === "string" ? text : String(text),
			};
		}

		return null;
	}

	buildFinalResult(
		returncode: number,
		stdout: string,
		stderr: string,
		options: RuntimeRunOptions,
	): RuntimeResult {
		const sessionOutput = SessionOutput.fromStdout(stdout);
		return {
			returncode,
			stdout,
			stderr,
			prompt: options.prompt,
			cwd: options.cwd ?? null,
			model: options.model ?? null,
			success: returncode === 0,
			sessionOutput,
		};
	}
}
