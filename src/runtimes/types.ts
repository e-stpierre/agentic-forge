/** Runtime abstraction types for multi-runtime support. */

import type { ConsoleOutput } from "../console.js";

/** Supported runtime identifiers. */
export type RuntimeId = "claude" | "codex";

/** Options passed to runtime execution. */
export interface RuntimeRunOptions {
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
	outputDir?: string | null;
}

/** Result from runtime execution. */
export interface RuntimeResult {
	returncode: number;
	stdout: string;
	stderr: string;
	prompt: string;
	cwd: string | null;
	model: string | null;
	success: boolean;
	sessionOutput: SessionOutput;
}

/** Parsed streaming event, normalized across runtimes. */
export interface StreamEvent {
	type: "text" | "user_text" | "model_info" | "result" | "error";
	text?: string;
	model?: string;
	index?: number;
}

/** Command descriptor returned by adapter.buildCommand(). */
export interface RuntimeCommand {
	executable: string;
	args: string[];
	env?: Record<string, string>; // extra env vars (merged with process.env)
	stdinInput: string; // prompt text piped to stdin
}

/**
 * Runtime adapter interface.
 *
 * Adapters own command construction and output parsing.
 * Process spawning/streaming is handled by the shared process runner.
 */
export interface RuntimeAdapter {
	readonly id: RuntimeId;
	readonly executableName: string;
	checkAvailable(): boolean;
	buildCommand(options: RuntimeRunOptions): RuntimeCommand;
	parseStreamLine(line: string): StreamEvent | null;
	buildFinalResult(
		returncode: number,
		stdout: string,
		stderr: string,
		options: RuntimeRunOptions,
	): RuntimeResult;
}

/** Session output extracted from runtime response. */
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
	 * Extract the session output JSON from stdout.
	 *
	 * Looks for the last JSON block that contains the required base keys
	 * (sessionId, isSuccess, context).
	 */
	static fromStdout(stdout: string): SessionOutput {
		if (!stdout) {
			return new SessionOutput(null, false, "No output received from session");
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

		return new SessionOutput(null, false, "No valid session output JSON found in response");
	}
}
