/**
 * Maps Claude stream messages to normalized `SessionEvent` items. The Agent
 * SDK messages and the `claude -p --output-format stream-json` lines have the
 * same shape, so both Claude drivers share this mapping (transcripts look the
 * same on both).
 */

import type { SessionEvent } from "./session.js";

type Item = Extract<SessionEvent, { type: "item" }>;

/** Text of a `tool_result` content (a string or a list of text blocks). */
export function toolResultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : ""))
		.filter(Boolean)
		.join("\n");
}

/**
 * Items of an `assistant` (text, tool calls) or `user` (tool results)
 * message. Message ids are the assistant message id plus the block index;
 * a tool call and its result share the `tool_use` id.
 */
export function claudeMessageItems(message: Record<string, unknown>): Item[] {
	const inner = message.message as { id?: unknown; content?: unknown } | undefined;
	const content = inner?.content;
	if (!Array.isArray(content)) return [];
	const items: Item[] = [];
	if (message.type === "assistant") {
		const base = typeof inner?.id === "string" ? inner.id : String(message.uuid ?? "message");
		content.forEach((block: Record<string, unknown>, index: number) => {
			if (!block || typeof block !== "object") return;
			if (block.type === "text" && typeof block.text === "string" && block.text) {
				items.push({
					type: "item",
					id: `${base}:${index}`,
					kind: "message",
					status: "completed",
					role: "assistant",
					text: block.text,
				});
			} else if (block.type === "tool_use" && typeof block.id === "string") {
				items.push({
					type: "item",
					id: block.id,
					kind: "tool_call",
					status: "started",
					tool: String(block.name ?? ""),
					input: (block.input ?? {}) as Record<string, unknown>,
				});
			}
		});
	} else if (message.type === "user") {
		for (const block of content as Record<string, unknown>[]) {
			if (!block || typeof block !== "object" || block.type !== "tool_result") continue;
			items.push({
				type: "item",
				id: String(block.tool_use_id ?? ""),
				kind: "tool_result",
				status: "completed",
				text: toolResultText(block.content),
				isError: block.is_error === true,
			});
		}
	}
	return items;
}

/**
 * Normalized events of one `claude -p` stream-json line (`cli` driver):
 * `system/init` starts the session, assistant and user messages give items,
 * `result` ends the turn.
 */
export function claudeStreamEvents(data: Record<string, unknown>): SessionEvent[] {
	if (data.type === "system" && data.subtype === "init" && typeof data.session_id === "string") {
		return [
			{
				type: "session.started",
				sessionId: data.session_id,
				model: typeof data.model === "string" ? data.model : null,
				authSource: typeof data.apiKeySource === "string" ? data.apiKeySource : null,
			},
		];
	}
	if (data.type === "assistant" || data.type === "user") return claudeMessageItems(data);
	if (data.type === "result") {
		return [
			{
				type: "turn.completed",
				result: typeof data.result === "string" ? data.result : "",
				isError: data.is_error === true || data.subtype !== "success",
				messageIds: [],
			},
		];
	}
	return [];
}
