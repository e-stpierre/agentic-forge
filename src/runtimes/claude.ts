/** Claude runtime adapter. */

import { existsSync } from "node:fs";
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
import {
	extractModelFromMessage,
	extractResultText,
	extractTextFromMessage,
	extractUserText,
	getAgenticSystemPrompt,
	getExecutable,
	parseStreamJsonLine,
} from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the bundled skills directory for --add-dir. */
const SKILLS_DIR = path.join(__dirname, "..", "claude");

/** Claude CLI adapter. */
export class ClaudeAdapter implements RuntimeAdapter {
	readonly id = "claude" as const;
	readonly executableName = "claude";
	readonly defaultModel = "sonnet";

	checkAvailable(): boolean {
		try {
			getExecutable(this.executableName);
			return true;
		} catch {
			return false;
		}
	}

	buildCommand(options: RuntimeRunOptions): RuntimeCommand {
		const {
			model = "sonnet",
			skipPermissions = false,
			appendSystemPrompt = true,
			outputDir,
		} = options;

		const args: string[] = ["--print"];

		// Add bundled skills directory for skill discovery
		if (existsSync(SKILLS_DIR)) {
			args.push("--add-dir", SKILLS_DIR);
		}

		// Add output directory so Claude can write workflow outputs there
		if (outputDir && existsSync(outputDir)) {
			args.push("--add-dir", outputDir);
		}

		// Use stream-json format when streaming output for real-time parsing
		if (options.printOutput) {
			args.push("--output-format", "stream-json", "--verbose");
		}

		// Models are passed as raw strings
		if (model) {
			args.push("--model", model);
		}

		if (skipPermissions) {
			args.push("--dangerously-skip-permissions");
		}

		if (options.allowedTools) {
			for (const tool of options.allowedTools) {
				args.push("--allowedTools", tool);
			}
		}

		// Append agentic system prompt for standardized output format
		if (appendSystemPrompt) {
			const systemPrompt = getAgenticSystemPrompt();
			if (systemPrompt) {
				args.push("--append-system-prompt", systemPrompt);
			}
		}

		// Build environment
		const env: Record<string, string> = {};
		if (options.workflowId) {
			env.OTEL_RESOURCE_ATTRIBUTES = `session=${options.workflowId}`;
		}

		return {
			executable: getExecutable(this.executableName),
			args,
			env: Object.keys(env).length > 0 ? env : undefined,
			stdinInput: options.prompt,
		};
	}

	parseStreamLine(line: string): StreamEvent | null {
		const data = parseStreamJsonLine(line);
		if (!data) {
			return null;
		}

		const msgType = data.type;

		// Handle user messages
		const userText = extractUserText(data);
		if (userText) {
			return {
				type: "user_text",
				text: userText,
			};
		}

		// Extract text from assistant or stream_event messages.
		// Check text BEFORE model_info so assistant messages with both
		// model and content don't lose their text to an early return.
		const textParts = extractTextFromMessage(data);
		if (textParts.length > 0) {
			const extractedModel = extractModelFromMessage(data);
			const isDelta = msgType === "stream_event";
			const [idx, text] = textParts[0];
			return {
				type: "text",
				text,
				index: idx,
				model: extractedModel ?? undefined,
				isNewTurn: msgType === "assistant",
				isDelta,
			};
		}

		// Extract model info (for messages without text content, e.g. system)
		const extractedModel = extractModelFromMessage(data);
		if (extractedModel) {
			return {
				type: "model_info",
				model: extractedModel,
			};
		}

		// Capture final result
		const resultText = extractResultText(data);
		if (resultText !== null) {
			return {
				type: "result",
				text: resultText,
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
