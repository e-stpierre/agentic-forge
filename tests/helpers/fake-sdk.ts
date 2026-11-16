/**
 * Test helper: a fake Claude Agent SDK transport, so session driver tests
 * never start a real Claude session.
 *
 * Usage (the mock must be declared in the test file so vitest hoists it):
 *
 *   vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
 *     const { fakeSdk } = await import("./helpers/fake-sdk.js");
 *     return { query: fakeSdk.query };
 *   });
 *
 * Every `query()` call creates a `FakeSdkSession` (`fakeSdk.sessions`) and
 * runs a script on it. The default script answers every user message with
 * one turn whose result is a `done` result block. `fakeSdk.on(match, script)`
 * picks another script for sessions whose first prompt contains `match`.
 */

import type {
	Options,
	PermissionResult,
	SDKMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { AsyncQueue } from "../../src/runtimes/session.js";

export type FakeScript = (session: FakeSdkSession, first: SDKUserMessage) => Promise<void>;

export function resultBlock(status = "done", summary = "done", extra = {}): string {
	return JSON.stringify({ contract_version: 1, status, summary, ...extra });
}

/** Text of a user message. */
export function userText(message: SDKUserMessage | null): string {
	const content = message?.message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((c) => ("text" in c ? String(c.text) : "")).join("");
}

export class FakeSdkSession {
	readonly options: Options;
	readonly sessionId: string;
	/** Every user message read from the input, in order. */
	readonly received: SDKUserMessage[] = [];
	interrupts = 0;
	ended = false;
	readonly output = new AsyncQueue<SDKMessage>();
	private readonly input: AsyncIterator<SDKUserMessage>;
	private toolSeq = 0;
	private waiters: (() => void)[] = [];

	constructor(prompt: AsyncIterable<SDKUserMessage>, options: Options, sessionId: string) {
		this.input = prompt[Symbol.asyncIterator]();
		this.options = options;
		this.sessionId = options.resume ?? sessionId;
	}

	/** Next user message, or null once the input is closed. */
	async nextUser(): Promise<SDKUserMessage | null> {
		const next = await this.input.next();
		if (next.done) return null;
		this.received.push(next.value);
		for (const w of this.waiters.splice(0)) w();
		return next.value;
	}

	/** Resolves when `count` user messages have been read. */
	async waitForMessages(count: number): Promise<void> {
		while (this.received.length < count) {
			await new Promise<void>((r) => this.waiters.push(r));
		}
	}

	emit(message: Record<string, unknown>): void {
		this.output.push({ session_id: this.sessionId, uuid: "u", ...message } as SDKMessage);
	}

	init(): void {
		this.emit({
			type: "system",
			subtype: "init",
			apiKeySource: "none",
			model: this.options.model ?? "claude-sonnet",
			claude_code_version: "2.1.322",
			cwd: this.options.cwd ?? "",
			tools: [],
			mcp_servers: [],
			permissionMode: this.options.permissionMode ?? "default",
			slash_commands: [],
			output_style: "default",
			skills: [],
			plugins: [],
		});
	}

	text(text: string): void {
		this.emit({
			type: "assistant",
			parent_tool_use_id: null,
			message: { id: `msg-${Math.random()}`, content: [{ type: "text", text }] },
		});
	}

	/**
	 * A tool call: approved by `allowedTools`, else by `canUseTool`. Emits the
	 * tool_use and its tool_result; returns the permission result.
	 */
	async tool(name: string, input: Record<string, unknown>): Promise<PermissionResult> {
		this.toolSeq += 1;
		const id = `toolu_${this.toolSeq}`;
		this.emit({
			type: "assistant",
			parent_tool_use_id: null,
			message: { id: `msg-tool-${id}`, content: [{ type: "tool_use", id, name, input }] },
		});
		// Let the driver read the messages so far (the CLI streams them before it asks)
		await new Promise((r) => setTimeout(r, 0));
		let decision: PermissionResult;
		if (this.options.allowedTools?.includes(name)) {
			decision = { behavior: "allow", updatedInput: input };
		} else if (this.options.canUseTool) {
			decision = await this.options.canUseTool(name, input, {
				signal: new AbortController().signal,
				toolUseID: id,
			} as Parameters<NonNullable<Options["canUseTool"]>>[2]);
		} else {
			decision = { behavior: "deny", message: "no canUseTool" };
		}
		this.emit({
			type: "user",
			parent_tool_use_id: null,
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: id,
						content: decision.behavior === "allow" ? "ok" : decision.message,
						is_error: decision.behavior !== "allow",
					},
				],
			},
		});
		return decision;
	}

	/** Ends a turn answering the given user messages. */
	result(text: string, answered: (SDKUserMessage | null)[] = []): void {
		const ids = answered.map((m) => m?.uuid).filter((u): u is string => typeof u === "string");
		this.emit({
			type: "result",
			subtype: "success",
			is_error: false,
			result: text,
			num_turns: 1,
			user_message_uuids: ids,
		});
	}

	end(): void {
		this.ended = true;
		this.output.close();
	}
}

/** Default script: one `done` turn per user message, until the input closes. */
export const echoScript: FakeScript = async (s, first) => {
	s.init();
	let message: SDKUserMessage | null = first;
	while (message) {
		s.text("Working");
		s.result(`Work log\n${resultBlock()}`, [message]);
		message = await s.nextUser();
	}
};

class FakeSdk {
	sessions: FakeSdkSession[] = [];
	private scripts: [string, FakeScript][] = [];
	private waiters: { match: string; resolve: (s: FakeSdkSession) => void }[] = [];
	private seq = 0;

	reset(): void {
		this.sessions = [];
		this.scripts = [];
		this.waiters = [];
		this.seq = 0;
	}

	/** Script for sessions whose first prompt contains `match` (last registration wins). */
	on(match: string, script: FakeScript): void {
		this.scripts.unshift([match, script]);
	}

	/** Resolves with the first session whose first prompt contains `match`. */
	waitFor(match: string): Promise<FakeSdkSession> {
		const found = this.sessions.find((s) => userText(s.received[0] ?? null).includes(match));
		if (found) return Promise.resolve(found);
		return new Promise((resolve) => this.waiters.push({ match, resolve }));
	}

	query = (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => {
		this.seq += 1;
		const session = new FakeSdkSession(
			params.prompt,
			params.options ?? {},
			`fake-session-${this.seq}`,
		);
		this.sessions.push(session);
		const run = async () => {
			const first = await session.nextUser();
			if (!first) return;
			const text = userText(first);
			for (const w of this.waiters.filter((x) => text.includes(x.match))) w.resolve(session);
			this.waiters = this.waiters.filter((x) => !text.includes(x.match));
			const script = this.scripts.find(([m]) => text.includes(m))?.[1] ?? echoScript;
			await script(session, first);
		};
		params.options?.abortController?.signal.addEventListener("abort", () => session.end());
		void run().finally(() => session.end());
		const iterator = session.output[Symbol.asyncIterator]();
		const query = {
			next: () => iterator.next(),
			return: async () => {
				session.end();
				return { done: true as const, value: undefined };
			},
			throw: async (err: unknown) => {
				session.end();
				throw err;
			},
			[Symbol.asyncIterator]() {
				return query;
			},
			interrupt: async () => {
				session.interrupts += 1;
				return undefined;
			},
			close: () => session.end(),
		};
		return query;
	};
}

export const fakeSdk = new FakeSdk();
