/** Codex runtime adapter. */

import path from "node:path";

import type {
	RuntimeAdapter,
	RuntimeCommand,
	RuntimeResult,
	RuntimeRunOptions,
	StreamEvent,
} from "./types.js";
import { SessionOutput } from "./types.js";
import { getAgenticSystemPrompt, getExecutable } from "./utils.js";

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
	readonly defaultModel = "gpt-5.5";

	checkAvailable(): boolean {
		try {
			getExecutable(this.executableName);
			return true;
		} catch {
			return false;
		}
	}

	buildCommand(options: RuntimeRunOptions): RuntimeCommand {
		const { model = "gpt-5.5", skipPermissions = false, cwd, outputDir } = options;
		const sandbox = options.sandbox ?? "workspace-write";

		const args: string[] = ["exec", "--sandbox", sandbox];

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

		// Grant explicit write roots for Codex workspace-write runs. The workflow
		// output directory may live outside the target repo when global outputs are enabled.
		const writeDirs = new Set<string>();
		for (const dir of [cwd, outputDir]) {
			if (dir) {
				writeDirs.add(path.resolve(dir));
			}
		}
		for (const dir of writeDirs) {
			args.push("--add-dir", dir);
		}

		// Build environment
		const env: Record<string, string> = {};
		if (options.workflowId) {
			env.OTEL_RESOURCE_ATTRIBUTES = `session=${options.workflowId}`;
		}

		// System prompt is prepended to the user prompt (Codex has no --append-system-prompt flag)
		const systemPrompt = options.appendSystemPrompt ? getAgenticSystemPrompt() : null;
		const prompt = systemPrompt ? `${systemPrompt}\n\n${options.prompt}` : options.prompt;

		// Codex exec takes the prompt as a positional argument, not via stdin
		args.push(prompt);

		return {
			executable: getExecutable(this.executableName),
			args,
			env: Object.keys(env).length > 0 ? env : undefined,
			stdinInput: "",
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
						// Each agent_message is a complete, standalone message.
						// Mark as a new turn so prior streamed content is finalized
						// before this message renders, preventing cumulative redraws.
						return {
							type: "text",
							text,
							isNewTurn: true,
						};
					}
				}
			}
		}

		// Handle turn completion (end of response).
		// text is omitted so process-runner uses the accumulated streamed content
		// instead of overwriting it with an empty string.
		if (eventType === "turn.completed") {
			return {
				type: "result",
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
