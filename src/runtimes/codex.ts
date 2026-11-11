/** Codex runtime adapter. */

import path from "node:path";

import type { SessionEvent } from "./session.js";
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

function toCodexConfigPath(dir: string): string {
	// Callers pass already-resolved absolute paths. Do not call path.resolve here:
	// on POSIX hosts it would rewrite Windows drive-letter inputs (e.g. "C:\\Users\\...")
	// into cwd-relative paths, breaking the writable_roots value for cross-platform tests.
	return dir.replace(/\\/g, "/");
}

export function buildWritableRootsConfig(dirs: string[]): string {
	return `sandbox_workspace_write.writable_roots=${JSON.stringify(dirs.map(toCodexConfigPath))}`;
}

/** Codex CLI adapter. */
export class CodexAdapter implements RuntimeAdapter {
	readonly id = "codex" as const;
	readonly executableName = "codex";
	// Codex CLI has no version-agnostic aliases (unlike Claude's "opus"/"sonnet"),
	// so every value is a pinned SKU that goes stale. Default to omitting --model
	// and let the Codex CLI use its own configured default.
	readonly defaultModel = null;

	checkAvailable(): boolean {
		try {
			getExecutable(this.executableName);
			return true;
		} catch {
			return false;
		}
	}

	buildCommand(options: RuntimeRunOptions): RuntimeCommand {
		const { model, skipPermissions = false, cwd, outputDir } = options;
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
		if (writeDirs.size > 0 && sandbox === "workspace-write") {
			args.push("-c", buildWritableRootsConfig([...writeDirs]));
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

	/** Transcript events of a `codex exec --json` line (see `codexStreamEvents`). */
	parseTranscriptLine(line: string): SessionEvent[] {
		const data = parseCodexJsonLine(line);
		return data ? codexStreamEvents(data) : [];
	}

	parseStreamLine(line: string): StreamEvent | null {
		const data = parseCodexJsonLine(line);
		if (!data) {
			return null;
		}

		const eventType = data.type;

		// The thread id is the session id used by `codex exec resume`
		if (eventType === "thread.started" && typeof data.thread_id === "string") {
			return { type: "session", sessionId: data.thread_id };
		}

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
		sessionId: string | null = null,
	): RuntimeResult {
		const sessionOutput = SessionOutput.fromStdout(stdout, sessionId);
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

const FILE_CHANGES = new Set(["add", "update", "delete"]);

/**
 * Normalized events of one `codex exec --json` line: `thread.started` starts
 * the session, `agent_message` items are messages, command and MCP tool items
 * are tool calls (`item.started`) and results (`item.completed`), and
 * `file_change` items give one diff per changed file.
 */
export function codexStreamEvents(data: Record<string, unknown>): SessionEvent[] {
	const type = data.type;
	if (type === "thread.started" && typeof data.thread_id === "string") {
		return [{ type: "session.started", sessionId: data.thread_id, model: null, authSource: null }];
	}
	if (type === "turn.completed") {
		return [{ type: "turn.completed", result: "", isError: false, messageIds: [] }];
	}
	if (type === "turn.failed" || type === "error") {
		const error = data.error as { message?: unknown } | undefined;
		const message = error?.message ?? data.message ?? "Unknown error";
		return [{ type: "error", message: String(message) }];
	}
	if (type !== "item.started" && type !== "item.completed") return [];
	const item = data.item as Record<string, unknown> | undefined;
	if (!item || typeof item !== "object") return [];
	const id = String(item.id ?? "");
	const done = type === "item.completed";
	switch (item.type) {
		case "agent_message":
			if (!done || typeof item.text !== "string") return [];
			return [
				{
					type: "item",
					id,
					kind: "message",
					status: "completed",
					role: "assistant",
					text: item.text,
				},
			];
		case "command_execution":
		case "mcp_tool_call": {
			const tool = item.type === "command_execution" ? "shell" : String(item.tool ?? "mcp");
			const input =
				item.type === "command_execution"
					? { command: item.command }
					: { server: item.server, ...((item.arguments as Record<string, unknown>) ?? {}) };
			if (!done) return [{ type: "item", id, kind: "tool_call", status: "started", tool, input }];
			const output = item.aggregated_output ?? item.result ?? "";
			const failed =
				item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0);
			return [
				{
					type: "item",
					id,
					kind: "tool_result",
					status: "completed",
					tool,
					text: typeof output === "string" ? output : JSON.stringify(output),
					isError: failed,
				},
			];
		}
		case "file_change": {
			if (!done || !Array.isArray(item.changes)) return [];
			return (item.changes as Record<string, unknown>[]).map((change, index) => ({
				type: "diff" as const,
				id: `${id}:${index}`,
				path: String(change.path ?? ""),
				change: FILE_CHANGES.has(String(change.kind))
					? (String(change.kind) as "add" | "update" | "delete")
					: "update",
			}));
		}
		default:
			return [];
	}
}
