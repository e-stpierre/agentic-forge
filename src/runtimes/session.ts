/**
 * Runtime sessions: a long-lived agent session that takes messages, asks
 * questions and requests permissions without exiting, next to the one-shot
 * `RuntimeAdapter` (`cli` driver).
 *
 * Every session driver maps its vendor stream to the normalized
 * `SessionEvent` model below (shaped like ACP: stable ids, item updates,
 * explicit `idle` and `awaiting-input` states), so the supervisor, the
 * overseer and later the UI never see vendor formats.
 */

import type { RuntimeId } from "./types.js";

/** `runtimes.<id>.driver`: a live session, or the one-shot CLI process. */
export type RuntimeDriver = "session" | "cli";

/** Lifecycle state of a session. */
export type SessionState = "starting" | "running" | "idle" | "awaiting-input" | "closed";

/** One option of a session request (question choices, or allow and deny). */
export interface SessionRequestOption {
	id: string;
	label: string;
	description?: string;
}

/**
 * Something the agent needs from outside the session while it waits alive:
 * a permission for a tool call outside the allowlist, or an answer to a
 * question (`AskUserQuestion`).
 */
export interface SessionRequest {
	/** Stable id, unique per session (the request id in `needs_input`). */
	id: string;
	kind: "permission" | "question";
	question: string;
	options: SessionRequestOption[];
	recommended: string | null;
	context: string;
	/** Tool that asked (`AskUserQuestion` for questions). */
	tool: string;
	input: Record<string, unknown>;
}

/**
 * Answer to a session request. `option` is the chosen option id when the
 * answer matched one; `text` is the raw answer (free text or option label).
 */
export interface SessionDecision {
	option: string | null;
	text: string;
}

/** Normalized session events. Item ids are stable across updates of the same item. */
export type SessionEvent =
	| { type: "session.started"; sessionId: string; model: string | null; authSource: string | null }
	| { type: "state"; state: SessionState }
	| {
			type: "item";
			id: string;
			kind: "message" | "tool_call" | "tool_result";
			status: "started" | "updated" | "completed";
			role?: "assistant" | "user";
			text?: string;
			tool?: string;
			input?: Record<string, unknown>;
			isError?: boolean;
	  }
	| { type: "request"; request: SessionRequest }
	| { type: "request.resolved"; id: string; decision: SessionDecision }
	| { type: "turn.completed"; result: string; isError: boolean; messageIds: string[] }
	| { type: "error"; message: string };

/** Options to start or resume a session. */
export interface SessionStartOptions {
	prompt: string;
	cwd?: string | null;
	model?: string | null;
	/** Directories the agent may read and write besides `cwd` (run dir, worktree). */
	additionalDirectories?: string[];
	/** Text appended to the runtime's default system prompt. */
	appendSystemPrompt?: string | null;
	/** Tool rules that are approved without asking (`Read`, `Bash(git *)`, ...). */
	allowedTools?: string[] | null;
	/** Opt-in blanket bypass of every permission check. */
	bypassPermissions?: boolean;
	/** Local plugin directories loaded into the session (skills, agents, hooks). */
	plugins?: string[];
	env?: NodeJS.ProcessEnv | null;
	/** Session id to resume instead of starting a new conversation. */
	resume?: string | null;
	/** Aborting closes the session and kills its process. */
	signal?: AbortSignal | null;
}

/**
 * A live runtime session. The driver emits `SessionEvent`s to the listener
 * given at construction; requests stay pending until `respond()` is called.
 */
export interface RuntimeSession {
	readonly runtime: RuntimeId;
	/** Runtime session id, known after `session.started`. */
	readonly sessionId: string | null;
	readonly state: SessionState;
	/** Starts the session with its first prompt (or resumes `options.resume`). */
	start(options: SessionStartOptions): void;
	/** Resumes a stored session with a new prompt. */
	resume(sessionId: string, options: SessionStartOptions): void;
	/** Queues a user message for the next turn. Returns its message id. */
	send(text: string): string;
	/** Delivers a user message into the running turn (at tool-call granularity). */
	steer(text: string): string;
	/** Stops the running turn; the session stays open for the next message. */
	interrupt(): Promise<void>;
	/** Resolves a pending request. Unknown ids are ignored. */
	respond(requestId: string, decision: SessionDecision): void;
	/** Ends the session (closes its input, the process exits). */
	close(): void;
	/** Settles when the session has ended, with the error that ended it, if any. */
	readonly done: Promise<Error | null>;
}

export type SessionListener = (event: SessionEvent) => void;

/**
 * What a step running on the session driver needs from the supervisor. All
 * members are optional: without a host, requests are denied and messages
 * are only delivered at step boundaries.
 */
export interface SessionHost {
	/**
	 * Raises a `needs_input` for a session request and resolves with the
	 * answer. The session stays alive while it waits.
	 */
	requestInput?: (request: SessionRequest, sessionId: string | null) => Promise<SessionDecision>;
	/**
	 * Called when a turn ends: returns the pending operator messages to send
	 * as the next turn (empty string when none). Marks them delivered.
	 */
	nextMessages?: () => Promise<string>;
	/**
	 * Registers the live session so `send --mode now` can steer it. Returns
	 * the function that unregisters it.
	 */
	onLive?: (handle: LiveSession) => () => void;
	/** Every normalized session event (live transcripts, ORC-036). */
	onEvent?: SessionListener;
}

/** Handle the supervisor uses to steer a live session step. */
export interface LiveSession {
	readonly sessionId: string | null;
	steer(text: string): void;
	interrupt(): Promise<void>;
}

/** Options and labels of a permission request. */
export const PERMISSION_OPTIONS: SessionRequestOption[] = [
	{ id: "allow", label: "Allow", description: "Run this tool call" },
	{ id: "deny", label: "Deny", description: "Refuse this tool call; the agent continues" },
];

/**
 * Async queue of values with a close signal, used as the streaming input of
 * a session (one value per user message).
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
	private readonly items: T[] = [];
	private wake: (() => void) | null = null;
	private closed = false;

	push(item: T): void {
		if (this.closed) return;
		this.items.push(item);
		this.wake?.();
	}

	close(): void {
		this.closed = true;
		this.wake?.();
	}

	get isClosed(): boolean {
		return this.closed;
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			const next = this.items.shift();
			if (next !== undefined) {
				yield next;
				continue;
			}
			if (this.closed) return;
			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
			this.wake = null;
		}
	}
}
