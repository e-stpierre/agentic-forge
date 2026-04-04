/** Claude CLI runner for workflow orchestration. */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ConsoleOutput } from "./console.js";

// --- Path constants ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the bundled skills directory for --add-dir. */
export const SKILLS_DIR = path.join(__dirname, "claude");

/** Path to the agentic system prompt file. */
export const AGENTIC_SYSTEM_PROMPT_FILE = path.join(__dirname, "prompts", "agentic-system.md");

// --- Model mapping ---

export const MODEL_MAP: Record<string, string> = {
	sonnet: "sonnet",
	haiku: "haiku",
	opus: "opus",
};

// --- Executable resolution ---

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
		const firstLine = result.trim().split(/\r?\n/)[0];
		if (firstLine) {
			return firstLine;
		}
	} catch {
		// Fall through to error
	}
	throw new FileNotFoundError(`Executable not found in PATH: ${name}`);
}

/** Custom error for missing executables. */
export class FileNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FileNotFoundError";
	}
}

// --- Stream-JSON parsing ---

/** Parse a single line of stream-json output. */
export function parseStreamJsonLine(line: string): Record<string, unknown> | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) {
		return null;
	}
	try {
		return JSON.parse(trimmed) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** Extract model name from an assistant or system message. */
export function extractModelFromMessage(data: Record<string, unknown>): string | null {
	const msgType = data.type;

	if (msgType === "assistant") {
		const message = data.message as Record<string, unknown> | undefined;
		return (message?.model as string) ?? null;
	}

	if (msgType === "system") {
		return (data.model as string) ?? null;
	}

	return null;
}

/** Format model name for display. */
export function formatModelName(model: string | null): string {
	if (!model) {
		return "";
	}

	// Pattern 1: claude-{tier}-{major}-{minor}-{date}
	const pattern1 = /^claude-(sonnet|opus|haiku)-(\d+)-(\d+)-\d{8}$/;
	let match = pattern1.exec(model);
	if (match) {
		const [, tier, major, minor] = match;
		return `${tier}-${major}.${minor}`;
	}

	// Pattern 2: claude-{major}-{minor}-{tier}-{date}
	const pattern2 = /^claude-(\d+)-(\d+)-(sonnet|opus|haiku)-\d{8}$/;
	match = pattern2.exec(model);
	if (match) {
		const [, major, minor, tier] = match;
		return `${tier}-${major}.${minor}`;
	}

	// Pattern 3: claude-{tier}-{date} (no version)
	const pattern3 = /^claude-(sonnet|opus|haiku)-\d{8}$/;
	match = pattern3.exec(model);
	if (match) {
		return match[1];
	}

	return model;
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
		const message = (data.message ?? {}) as Record<string, unknown>;
		const content = (message.content ?? []) as Array<Record<string, unknown>>;

		for (let idx = 0; idx < content.length; idx++) {
			const block = content[idx];
			if (typeof block === "object" && block !== null && block.type === "text") {
				const text = (block.text as string) ?? "";
				if (text) {
					results.push([idx, text]);
				}
			}
		}
	} else if (msgType === "stream_event") {
		const event = (data.event ?? {}) as Record<string, unknown>;
		const eventType = event.type;

		if (eventType === "content_block_delta") {
			const idx = (event.index as number) ?? 0;
			const delta = (event.delta ?? {}) as Record<string, unknown>;
			if (delta.type === "text_delta") {
				const text = (delta.text as string) ?? "";
				if (text) {
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

	const message = (data.message ?? {}) as Record<string, unknown>;
	const content = (message.content ?? []) as Array<Record<string, unknown> | string>;

	const texts: string[] = [];
	for (const block of content) {
		if (typeof block === "object" && block !== null && block.type === "text") {
			const text = (block.text as string) ?? "";
			if (text) {
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

// --- System prompt ---

/** Load the agentic system prompt from file. */
export function getAgenticSystemPrompt(): string | null {
	if (existsSync(AGENTIC_SYSTEM_PROMPT_FILE)) {
		return readFileSync(AGENTIC_SYSTEM_PROMPT_FILE, "utf-8");
	}
	return null;
}

// --- SessionOutput ---

export class SessionOutput {
	sessionId: string | null;
	isSuccess: boolean;
	context: string;
	extra: Record<string, unknown>;
	rawJson: Record<string, unknown> | null;

	constructor(
		sessionId: string | null = null,
		isSuccess = false,
		context = "",
		extra: Record<string, unknown> = {},
		rawJson: Record<string, unknown> | null = null,
	) {
		this.sessionId = sessionId;
		this.isSuccess = isSuccess;
		this.context = context;
		this.extra = extra;
		this.rawJson = rawJson;
	}

	/**
	 * Extract the session output JSON from Claude's stdout.
	 *
	 * Looks for the last JSON block that contains the required base keys
	 * (sessionId, isSuccess, context).
	 */
	static fromStdout(stdout: string): SessionOutput {
		if (!stdout) {
			return new SessionOutput(null, false, "No output received from Claude session");
		}

		// Find all JSON blocks in code blocks
		const jsonPattern = /```(?:json)?\s*(\{[^`]*\})\s*```/gs;
		const codeBlockMatches = [...stdout.matchAll(jsonPattern)].map((m) => m[1]);

		// Also look for bare JSON objects with sessionId
		const bareJsonPattern = /\{[^{}]*"sessionId"[^{}]*\}/gs;
		const bareMatches = [...stdout.matchAll(bareJsonPattern)].map((m) => m[0]);

		const allMatches = [...codeBlockMatches, ...bareMatches];

		// Try to parse each match, starting from the last (most recent)
		for (let i = allMatches.length - 1; i >= 0; i--) {
			try {
				const data = JSON.parse(allMatches[i]) as Record<string, unknown>;
				if ("sessionId" in data && "isSuccess" in data && "context" in data) {
					const extra: Record<string, unknown> = {};
					for (const [k, v] of Object.entries(data)) {
						if (k !== "sessionId" && k !== "isSuccess" && k !== "context") {
							extra[k] = v;
						}
					}
					return new SessionOutput(
						data.sessionId as string | null,
						Boolean(data.isSuccess),
						(data.context as string) ?? "",
						extra,
						data,
					);
				}
			} catch {
				// Invalid JSON, try next match
			}
		}

		return new SessionOutput(null, false, "No valid session output JSON found in Claude response");
	}
}

// --- ClaudeResult ---

export class ClaudeResult {
	returncode: number;
	stdout: string;
	stderr: string;
	prompt: string;
	cwd: string | null;
	model: string | null;
	private _sessionOutput: SessionOutput | null = null;

	constructor(
		returncode: number,
		stdout: string,
		stderr: string,
		prompt: string,
		cwd: string | null,
		model: string | null = null,
	) {
		this.returncode = returncode;
		this.stdout = stdout;
		this.stderr = stderr;
		this.prompt = prompt;
		this.cwd = cwd;
		this.model = model;
	}

	get success(): boolean {
		return this.returncode === 0;
	}

	get sessionOutput(): SessionOutput {
		if (this._sessionOutput === null) {
			this._sessionOutput = SessionOutput.fromStdout(this.stdout);
		}
		return this._sessionOutput;
	}

	toString(): string {
		const status = this.success ? "SUCCESS" : "FAILED";
		const modelStr = this.model ? `, model=${this.model}` : "";
		return `ClaudeResult(${status}${modelStr})`;
	}
}

// --- runClaude options ---

export interface RunClaudeOptions {
	prompt: string;
	cwd?: string | null;
	model?: string;
	timeout?: number | null;
	printOutput?: boolean;
	skipPermissions?: boolean;
	allowedTools?: string[] | null;
	console?: ConsoleOutput | null;
	appendSystemPrompt?: boolean;
	workflowId?: string | null;
}

// --- Main run function ---

/** Run claude with the given prompt. */
export function runClaude(options: RunClaudeOptions): Promise<ClaudeResult> {
	const {
		prompt,
		cwd = null,
		model = "sonnet",
		timeout = 300,
		printOutput = false,
		skipPermissions = false,
		allowedTools = null,
		console: consoleOutput = null,
		appendSystemPrompt = true,
		workflowId = null,
	} = options;

	const claudePath = getExecutable("claude");
	const cmd = [claudePath, "--print"];

	// Add bundled skills directory for skill discovery
	if (existsSync(SKILLS_DIR)) {
		cmd.push("--add-dir", SKILLS_DIR);
	}

	// Use stream-json format when streaming output for real-time parsing
	if (printOutput) {
		cmd.push("--output-format", "stream-json", "--verbose");
	}

	if (model && model in MODEL_MAP) {
		cmd.push("--model", MODEL_MAP[model]);
	}

	if (skipPermissions) {
		cmd.push("--dangerously-skip-permissions");
	}

	if (allowedTools) {
		for (const tool of allowedTools) {
			cmd.push("--allowedTools", tool);
		}
	}

	// Append agentic system prompt for standardized output format
	if (appendSystemPrompt) {
		const systemPrompt = getAgenticSystemPrompt();
		if (systemPrompt) {
			cmd.push("--append-system-prompt", systemPrompt);
		}
	}

	const cwdStr = cwd ?? undefined;

	// Set up environment with OTEL tracing if workflow_id is provided
	const env = workflowId
		? { ...process.env, OTEL_RESOURCE_ATTRIBUTES: `session=${workflowId}` }
		: undefined;

	if (printOutput) {
		return runClaudeStreaming(cmd, prompt, cwdStr, env, timeout, consoleOutput, model, cwd);
	}
	return runClaudeNonStreaming(cmd, prompt, cwdStr, env, timeout, model, cwd);
}

function runClaudeStreaming(
	cmd: string[],
	prompt: string,
	cwdStr: string | undefined,
	env: NodeJS.ProcessEnv | undefined,
	timeout: number | null,
	consoleOutput: ConsoleOutput | null,
	model: string | null,
	cwd: string | null,
): Promise<ClaudeResult> {
	return new Promise((resolve) => {
		const [executable, ...args] = cmd;
		const proc = spawn(executable, args, {
			cwd: cwdStr,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		if (proc.stdin) {
			proc.stdin.write(prompt);
			proc.stdin.end();
		}

		// Show user prompt at start in ALL mode
		if (consoleOutput) {
			consoleOutput.streamText(prompt, "user");
			consoleOutput.streamComplete();
		}

		const collectedText: string[] = [];
		let resultText: string | null = null;
		const accumulatedText: Map<number, string> = new Map();
		let currentModel: string | null = null;
		let hasStreamedContent = false;
		let stderrData = "";

		if (proc.stderr) {
			proc.stderr.on("data", (chunk: Buffer) => {
				stderrData += chunk.toString("utf-8");
			});
			proc.stderr.on("error", () => {
				// Stream error during process execution; stderr data already captured
			});
		}

		let lineBuffer = "";

		if (proc.stdout) {
			proc.stdout.on("data", (chunk: Buffer) => {
				lineBuffer += chunk.toString("utf-8");
				const lines = lineBuffer.split("\n");
				// Keep the last partial line in the buffer
				lineBuffer = lines.pop() ?? "";

				for (const line of lines) {
					const data = parseStreamJsonLine(line);
					if (data === null) continue;

					// Extract model from assistant messages
					const extractedModel = extractModelFromMessage(data);
					if (extractedModel) {
						currentModel = extractedModel;
					}

					const msgType = data.type;

					// When a new assistant message starts, complete the previous one
					if (msgType === "assistant" && hasStreamedContent && consoleOutput) {
						consoleOutput.streamComplete();
						hasStreamedContent = false;
						accumulatedText.clear();
					}

					// Handle user messages (tool results in stream-json)
					const userText = extractUserText(data);
					if (userText && consoleOutput) {
						if (hasStreamedContent) {
							consoleOutput.streamComplete();
							hasStreamedContent = false;
						}
						consoleOutput.streamText(userText, "user");
						consoleOutput.streamComplete();
					}

					// Extract text from assistant messages for streaming
					const isStreamEvent = msgType === "stream_event";

					for (const [idx, text] of extractTextFromMessage(data)) {
						let delta: string;
						if (isStreamEvent) {
							delta = text;
						} else {
							const prevText = accumulatedText.get(idx) ?? "";
							delta = text.startsWith(prevText) ? text.slice(prevText.length) : text;
							accumulatedText.set(idx, text);
						}

						if (delta) {
							if (consoleOutput) {
								consoleOutput.streamText(delta, "assistant", currentModel);
								hasStreamedContent = true;
							} else {
								process.stdout.write(delta);
							}
							collectedText.push(delta);
						}
					}

					// Capture final result
					const result = extractResultText(data);
					if (result !== null) {
						resultText = result;
					}
				}
			});
		}

		if (proc.stdout) {
			proc.stdout.on("error", () => {
				// Stream error during process execution; stdout data already captured
			});
		}

		// Handle timeout
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		if (timeout) {
			timeoutId = setTimeout(() => {
				proc.stdout?.destroy();
				proc.stderr?.destroy();
				proc.kill();
			}, timeout * 1000);
		}

		proc.on("close", (code) => {
			if (timeoutId) clearTimeout(timeoutId);

			// Process any remaining data in the line buffer
			if (lineBuffer.trim()) {
				const data = parseStreamJsonLine(lineBuffer);
				if (data) {
					const result = extractResultText(data);
					if (result !== null) {
						resultText = result;
					}
				}
			}

			if (consoleOutput && hasStreamedContent) {
				consoleOutput.streamComplete();
			}

			const finalOutput = resultText ?? collectedText.join("");

			resolve(new ClaudeResult(code ?? 1, finalOutput, stderrData, prompt, cwd, model));
		});
	});
}

function runClaudeNonStreaming(
	cmd: string[],
	prompt: string,
	cwdStr: string | undefined,
	env: NodeJS.ProcessEnv | undefined,
	timeout: number | null,
	model: string | null,
	cwd: string | null,
): Promise<ClaudeResult> {
	return new Promise((resolve) => {
		const [executable, ...args] = cmd;
		const proc = spawn(executable, args, {
			cwd: cwdStr,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		if (proc.stdin) {
			proc.stdin.write(prompt);
			proc.stdin.end();
		}

		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];

		if (proc.stdout) {
			proc.stdout.on("data", (chunk: Buffer) => {
				stdoutChunks.push(chunk.toString("utf-8"));
			});
			proc.stdout.on("error", () => {});
		}

		if (proc.stderr) {
			proc.stderr.on("data", (chunk: Buffer) => {
				stderrChunks.push(chunk.toString("utf-8"));
			});
			proc.stderr.on("error", () => {});
		}

		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let timedOut = false;

		if (timeout) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				proc.stdout?.destroy();
				proc.stderr?.destroy();
				proc.kill();
			}, timeout * 1000);
		}

		proc.on("close", (code) => {
			if (timeoutId) clearTimeout(timeoutId);

			if (timedOut) {
				resolve(
					new ClaudeResult(1, "", `Command timed out after ${timeout} seconds`, prompt, cwd, model),
				);
				return;
			}

			resolve(
				new ClaudeResult(
					code ?? 1,
					stdoutChunks.join(""),
					stderrChunks.join(""),
					prompt,
					cwd,
					model,
				),
			);
		});
	});
}

/** Check if the claude CLI is available. */
export function checkClaudeAvailable(): boolean {
	try {
		const claudePath = getExecutable("claude");
		const result = execFileSync(claudePath, ["--version"], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 10000,
		});
		return result !== undefined;
	} catch (err) {
		if (err instanceof FileNotFoundError) {
			return false;
		}
		// execFileSync throws on non-zero exit or timeout
		return false;
	}
}
