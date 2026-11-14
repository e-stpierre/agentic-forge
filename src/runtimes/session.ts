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

import { randomUUID } from "node:crypto";

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
	| {
			type: "session.started";
			sessionId: string;
			model: string | null;
			authSource: string | null;
			/** Set by the step runner (the driver does not know it). */
			runtime?: RuntimeId;
			driver?: RuntimeDriver;
	  }
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
	/** A file change reported by the runtime (Codex `file_change`); Claude edits are tool calls. */
	| { type: "diff"; id: string; path: string; change: "add" | "update" | "delete"; patch?: string }
	| { type: "request"; request: SessionRequest }
	| { type: "request.resolved"; id: string; decision: SessionDecision }
	| { type: "turn.completed"; result: string; isError: boolean; messageIds: string[] }
	/** A choice the driver made that the step log should show (native skill or inlined). */
	| { type: "notice"; text: string }
	| { type: "error"; message: string };

/**
 * A skill step on a runtime that may load the skill natively (Codex
 * `skills/list` and `skill` inputs). The session's `prompt` is the inlined
 * fallback (empty when the skill was not found on disk).
 */
export interface SessionSkill {
	/** Skill id as written in the workflow (`<plugin>:<skill>` or `<skill>`). */
	id: string;
	/** Text after the skill mention: arguments, then operator messages. */
	text: string;
	/** Why there is no inlined fallback (the skill was not found on disk). */
	fallbackError?: string;
}

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
	/** Codex sandbox mode (`workspace-write` by default). */
	sandbox?: string | null;
	/** Skill step: try the runtime's native skill before the inlined prompt. */
	skill?: SessionSkill | null;
	/** Local image files sent with the first message (runtimes that take images). */
	images?: string[];
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
	/**
	 * Subscribes to the step's open `af_ask` questions: `listener` is called
	 * with true when the step has one (its agent may block in the tool call),
	 * false when none is left, and once at once with the current state. The
	 * step timeout does not run while one is open. Returns the unsubscribe
	 * function.
	 */
	onAsks?: (listener: (open: boolean) => void) => () => void;
	/**
	 * Every normalized event of the step (the live transcript). The `cli`
	 * driver calls it too, with the events mapped from its stream lines.
	 */
	onEvent?: SessionListener;
}

/** Handle the supervisor uses to steer a live session step. */
export interface LiveSession {
	readonly sessionId: string | null;
	/** Delivers a message into the running session. False when the session no longer takes input. */
	steer(text: string): boolean;
	interrupt(): Promise<void>;
}

/** Transcript item of a user message (step prompt, operator message). */
export function userMessageItem(text: string): SessionEvent {
	return {
		type: "item",
		id: `user-${randomUUID().slice(0, 8)}`,
		kind: "message",
		status: "completed",
		role: "user",
		text,
	};
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
