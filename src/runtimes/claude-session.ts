/**
 * Claude session driver on the Claude Agent SDK (streaming input).
 *
 * The SDK runs the unmodified Claude Code binary with its own login, so a
 * plan sign-in draws from the Claude plan exactly like `claude -p`. This
 * driver never reads, stores or passes Claude credentials; the environment
 * is the dispatch environment, unchanged.
 *
 * Permissions: rules in `allowedTools` are approved by the SDK itself. Every
 * other call reaches `canUseTool`, which raises a permission request and
 * waits alive for the answer. `AskUserQuestion` raises one question request
 * per question and returns the answers as the tool result.
 */

import { randomUUID } from "node:crypto";

import type {
	CanUseTool,
	Options,
	PermissionResult,
	Query,
	SDKMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import {
	AsyncQueue,
	PERMISSION_OPTIONS,
	type RuntimeSession,
	type SessionDecision,
	type SessionListener,
	type SessionRequest,
	type SessionStartOptions,
	type SessionState,
} from "./session.js";

/** Version of `@anthropic-ai/claude-agent-sdk` this driver is tested with (pinned in package.json). */
export const CLAUDE_AGENT_SDK_VERSION = "0.3.322";

export type QueryFunction = (params: {
	prompt: AsyncIterable<SDKUserMessage>;
	options?: Options;
}) => Query;

let sdkQuery: Promise<QueryFunction> | null = null;

/** Loads the SDK lazily (once), so the `cli` driver never imports it. */
function loadSdkQuery(): Promise<QueryFunction> {
	sdkQuery ??= import("@anthropic-ai/claude-agent-sdk").then((sdk) => sdk.query as QueryFunction);
	return sdkQuery;
}

const QUESTION_TOOL = "AskUserQuestion";
const OPTION_IDS = "abcdefghij";

interface Question {
	question: string;
	header?: string;
	multiSelect?: boolean;
	options?: { label: string; description?: string }[];
}

export class ClaudeSession implements RuntimeSession {
	readonly runtime = "claude" as const;
	sessionId: string | null = null;
	state: SessionState = "starting";
	readonly done: Promise<Error | null>;

	private readonly input = new AsyncQueue<SDKUserMessage>();
	private readonly listener: SessionListener;
	private readonly loadQuery: () => Promise<QueryFunction>;
	private readonly pending = new Map<string, (decision: SessionDecision) => void>();
	/** Message ids sent and not yet answered by a `result` message. */
	private readonly outstanding: string[] = [];
	private query: Query | null = null;
	private started = false;
	private announced = false;
	private settle: (error: Error | null) => void = () => {};

	constructor(listener: SessionListener, loadQuery: () => Promise<QueryFunction> = loadSdkQuery) {
		this.listener = listener;
		this.loadQuery = loadQuery;
		this.done = new Promise((resolve) => {
			this.settle = resolve;
		});
	}

	start(options: SessionStartOptions): void {
		if (this.started) throw new Error("Session already started");
		this.started = true;
		this.send(options.prompt);
		void this.run(options);
	}

	resume(sessionId: string, options: SessionStartOptions): void {
		this.start({ ...options, resume: sessionId });
	}

	send(text: string): string {
		return this.push(text, undefined);
	}

	steer(text: string): string {
		return this.push(text, "now");
	}

	async interrupt(): Promise<void> {
		await this.query?.interrupt();
	}

	respond(requestId: string, decision: SessionDecision): void {
		const resolve = this.pending.get(requestId);
		if (!resolve) return;
		this.pending.delete(requestId);
		this.emit({ type: "request.resolved", id: requestId, decision });
		if (this.pending.size === 0 && this.state === "awaiting-input") this.setState("running");
		resolve(decision);
	}

	close(): void {
		this.input.close();
	}

	private push(text: string, priority: "now" | undefined): string {
		const uuid = randomUUID();
		this.outstanding.push(uuid);
		this.input.push({
			type: "user",
			uuid,
			session_id: this.sessionId ?? "",
			message: { role: "user", content: text },
			parent_tool_use_id: null,
			...(priority ? { priority } : {}),
		} as SDKUserMessage);
		if (this.state === "idle") this.setState("running");
		return uuid;
	}

	private async run(options: SessionStartOptions): Promise<void> {
		const abort = new AbortController();
		const onAbort = () => {
			abort.abort();
			this.input.close();
		};
		if (options.signal?.aborted) onAbort();
		options.signal?.addEventListener("abort", onAbort, { once: true });
		let failure: Error | null = null;
		try {
			const query = await this.loadQuery();
			this.query = query({ prompt: this.input, options: this.sdkOptions(options, abort) });
			this.setState("running");
			for await (const message of this.query) this.handle(message);
		} catch (err) {
			failure = err instanceof Error ? err : new Error(String(err));
			if (!abort.signal.aborted) this.emit({ type: "error", message: failure.message });
		} finally {
			options.signal?.removeEventListener("abort", onAbort);
			this.input.close();
			for (const id of [...this.pending.keys()]) {
				this.respond(id, { option: "deny", text: "Session ended" });
			}
			this.setState("closed");
			this.settle(failure);
		}
	}

	private sdkOptions(options: SessionStartOptions, abort: AbortController): Options {
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(options.env ?? process.env)) {
			if (typeof value === "string") env[key] = value;
		}
		const sdk: Options = {
			abortController: abort,
			env,
			// Same skills as `claude -p`: every discovered skill and the user's settings
			skills: "all",
			canUseTool: this.canUseTool,
			permissionMode: options.bypassPermissions ? "bypassPermissions" : "default",
		};
		if (options.bypassPermissions) sdk.allowDangerouslySkipPermissions = true;
		if (options.cwd) sdk.cwd = options.cwd;
		if (options.model) sdk.model = options.model;
		if (options.additionalDirectories?.length) {
			sdk.additionalDirectories = options.additionalDirectories;
		}
		if (options.allowedTools?.length) sdk.allowedTools = options.allowedTools;
		if (options.appendSystemPrompt) {
			sdk.systemPrompt = {
				type: "preset",
				preset: "claude_code",
				append: options.appendSystemPrompt,
			};
		}
		if (options.plugins?.length) {
			sdk.plugins = options.plugins.map((p) => ({ type: "local", path: p }));
		}
		if (options.resume) sdk.resume = options.resume;
		return sdk;
	}

	private readonly canUseTool: CanUseTool = async (toolName, input, extra) => {
		if (toolName === QUESTION_TOOL) return this.askQuestions(input, extra.signal);
		const summary = extra.title ?? describeToolCall(toolName, input);
		const decision = await this.request(
			{
				kind: "permission",
				question: `Allow ${toolName}? ${summary}`.trim(),
				options: PERMISSION_OPTIONS,
				recommended: null,
				context: extra.decisionReason ?? "",
				tool: toolName,
				input,
			},
			extra.signal,
		);
		if (isAllow(decision)) return { behavior: "allow", updatedInput: input };
		const reason = decision.option === "deny" || !decision.text ? "" : `: ${decision.text}`;
		return { behavior: "deny", message: `Denied by the operator${reason}` };
	};

	private async askQuestions(
		input: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<PermissionResult> {
		const questions = Array.isArray(input.questions) ? (input.questions as Question[]) : [];
		const answers: Record<string, string> = {};
		for (const q of questions) {
			const options = (q.options ?? []).slice(0, OPTION_IDS.length).map((o, i) => ({
				id: OPTION_IDS[i],
				label: o.label,
				...(o.description ? { description: o.description } : {}),
			}));
			const decision = await this.request(
				{
					kind: "question",
					question: q.question,
					options,
					recommended: null,
					context: [q.header, q.multiSelect ? "Several options may be chosen" : ""]
						.filter(Boolean)
						.join(". "),
					tool: QUESTION_TOOL,
					input,
				},
				signal,
			);
			const chosen = options.find((o) => o.id === decision.option);
			answers[q.question] = chosen ? chosen.label : decision.text;
		}
		return { behavior: "allow", updatedInput: { ...input, answers } };
	}

	private request(
		fields: Omit<SessionRequest, "id">,
		signal: AbortSignal,
	): Promise<SessionDecision> {
		// Unique across sessions: parallel steps each raise requests in one run
		const id = `${fields.kind === "question" ? "ask" : "perm"}-${randomUUID().slice(0, 8)}`;
		const request: SessionRequest = { id, ...fields };
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			signal.addEventListener(
				"abort",
				() => this.respond(id, { option: "deny", text: "Tool call aborted" }),
				{ once: true },
			);
			this.setState("awaiting-input");
			this.emit({ type: "request", request });
		});
	}

	private handle(message: SDKMessage): void {
		const sessionId = (message as { session_id?: unknown }).session_id;
		if (typeof sessionId === "string" && sessionId) this.sessionId = sessionId;
		switch (message.type) {
			case "system":
				if (message.subtype === "init" && !this.announced) {
					this.announced = true;
					this.emit({
						type: "session.started",
						sessionId: message.session_id,
						model: message.model ?? null,
						authSource: message.apiKeySource ?? null,
					});
				}
				return;
			case "assistant": {
				const content = message.message?.content ?? [];
				content.forEach((block, index) => {
					if (block.type === "text" && block.text) {
						this.emit({
							type: "item",
							id: `${message.message.id ?? message.uuid}:${index}`,
							kind: "message",
							status: "completed",
							role: "assistant",
							text: block.text,
						});
					} else if (block.type === "tool_use") {
						this.emit({
							type: "item",
							id: block.id,
							kind: "tool_call",
							status: "started",
							tool: block.name,
							input: (block.input ?? {}) as Record<string, unknown>,
						});
					}
				});
				return;
			}
			case "user": {
				const content = message.message?.content;
				if (!Array.isArray(content)) return;
				for (const block of content) {
					if (typeof block !== "object" || block === null || block.type !== "tool_result") continue;
					this.emit({
						type: "item",
						id: block.tool_use_id,
						kind: "tool_result",
						status: "completed",
						text: toolResultText(block.content),
						isError: block.is_error === true,
					});
				}
				return;
			}
			case "result": {
				const ids =
					message.user_message_uuids ??
					(message.user_message_uuid ? [message.user_message_uuid] : []);
				if (ids.length > 0) {
					for (const id of ids) {
						const i = this.outstanding.indexOf(id);
						if (i !== -1) this.outstanding.splice(i, 1);
					}
				} else {
					// Older CLIs do not echo message ids: one result answers the oldest message
					this.outstanding.shift();
				}
				const result =
					"result" in message && typeof message.result === "string" ? message.result : "";
				this.emit({
					type: "turn.completed",
					result,
					isError: message.is_error || message.subtype !== "success",
					messageIds: ids,
				});
				if (this.outstanding.length === 0 && this.pending.size === 0) this.setState("idle");
				return;
			}
			default:
				return;
		}
	}

	private setState(state: SessionState): void {
		if (this.state === state || this.state === "closed") return;
		this.state = state;
		this.emit({ type: "state", state });
	}

	private emit(event: Parameters<SessionListener>[0]): void {
		try {
			this.listener(event);
		} catch {
			// A listener error must not break the session
		}
	}
}

function isAllow(decision: SessionDecision): boolean {
	if (decision.option === "allow") return true;
	if (decision.option === "deny") return false;
	return /^(allow|allowed|yes|y|approve|approved|ok)$/i.test(decision.text.trim());
}

/** One-line description of a tool call for a permission question. */
export function describeToolCall(tool: string, input: Record<string, unknown>): string {
	const key = ["command", "file_path", "path", "url", "pattern", "query"].find(
		(k) => typeof input[k] === "string",
	);
	const value = key ? String(input[key]) : JSON.stringify(input);
	return value.length > 200 ? `${value.slice(0, 200)}...` : value;
}

function toolResultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : ""))
		.filter(Boolean)
		.join("\n");
}
