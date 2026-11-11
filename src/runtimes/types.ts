/** Runtime abstraction types for multi-runtime support. */

import type { ConsoleOutput } from "../console.js";
import { type ResultBlock, parseResultBlock } from "../contract/result.js";
import type {
	RuntimeDriver,
	RuntimeSession,
	SessionHost,
	SessionListener,
	SessionStartOptions,
} from "./session.js";

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
	/** Codex sandbox mode (e.g., "workspace-write", "read-only", "danger-full-access"). */
	sandbox?: string | null;
	/**
	 * Base environment for the spawned process. Defaults to `process.env`. The
	 * supervisor passes the allowlisted environment of the dispatching client.
	 */
	env?: NodeJS.ProcessEnv | null;
	/**
	 * Aborting the signal kills the runtime's whole process tree (`pause --now`,
	 * `cancel`). The run resolves as a failure.
	 */
	signal?: AbortSignal | null;
	/**
	 * `session` runs the step on the runtime's session driver when it has one
	 * (`runtimes.<id>.driver`); `cli` (default) spawns the one-shot process.
	 */
	driver?: RuntimeDriver;
	/** Supervisor callbacks for the session driver (requests, messages, steering). */
	sessionHost?: SessionHost | null;
	/** Session driver: resume this session id instead of starting a new one. */
	resumeSessionId?: string | null;
	/** Session driver: local plugin directories to load (`runtimes.<id>.plugins`). */
	plugins?: string[];
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
	type: "text" | "user_text" | "model_info" | "result" | "error" | "session";
	text?: string;
	/** Runtime session id (`session` events, or carried by any event). */
	sessionId?: string;
	model?: string;
	index?: number;
	/** True when this event starts a new assistant turn (triggers streamComplete). */
	isNewTurn?: boolean;
	/** True when text is an incremental delta; false/undefined for cumulative text. */
	isDelta?: boolean;
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
	/**
	 * Default model for this runtime, used when no explicit model is configured.
	 * `null` means "pass no --model flag" and let the CLI pick its own default,
	 * which is the correct behavior for runtimes without version-agnostic aliases.
	 */
	readonly defaultModel: string | null;
	checkAvailable(): boolean;
	buildCommand(options: RuntimeRunOptions): RuntimeCommand;
	parseStreamLine(line: string): StreamEvent | null;
	buildFinalResult(
		returncode: number,
		stdout: string,
		stderr: string,
		options: RuntimeRunOptions,
		sessionId?: string | null,
	): RuntimeResult;
	/** Creates a session driver instance (runtimes with a session driver only). */
	createSession?(listener: SessionListener): RuntimeSession;
	/** Maps step options to session start options (runtimes with a session driver only). */
	sessionOptions?(options: RuntimeRunOptions): SessionStartOptions;
}

/**
 * Session output extracted from a runtime response.
 *
 * `result` is the contract result block printed on the last output line (see
 * docs/harness-contract.md). `isSuccess` and `context` derive from it
 * (`done`/`merged`, `summary`). The session id comes from the runtime stream,
 * not from the block. The legacy `{ sessionId, isSuccess, context }` block is
 * still read when no result block is present.
 */
export class SessionOutput {
	sessionId: string | null;
	isSuccess: boolean;
	context: string;
	extra: Record<string, unknown>;
	rawJson: Record<string, unknown> | null;
	result: ResultBlock | null;

	constructor(
		sessionId: string | null = null,
		isSuccess = false,
		context = "",
		extra: Record<string, unknown> = {},
		rawJson: Record<string, unknown> | null = null,
		result: ResultBlock | null = null,
	) {
		this.sessionId = sessionId;
		this.isSuccess = isSuccess;
		this.context = context;
		this.extra = extra;
		this.rawJson = rawJson;
		this.result = result;
	}

	/**
	 * Extract the session output from stdout: the contract result block first,
	 * then the last legacy JSON block with `sessionId`, `isSuccess`, `context`.
	 */
	static fromStdout(stdout: string, streamSessionId: string | null = null): SessionOutput {
		if (!stdout) {
			return new SessionOutput(streamSessionId, false, "No output received from session");
		}

		const block = parseResultBlock(stdout);
		if (block) {
			const { status, summary, ...extra } = block;
			return new SessionOutput(
				streamSessionId,
				status === "done" || status === "merged",
				summary,
				extra,
				block as unknown as Record<string, unknown>,
				block,
			);
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
						streamSessionId ?? (data.sessionId as string | null),
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

		return new SessionOutput(
			streamSessionId,
			false,
			"No valid session output JSON found in response",
		);
	}
}
