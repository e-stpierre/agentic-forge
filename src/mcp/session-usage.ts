/**
 * MCP session accounting: the bytes of every tool result returned in one MCP
 * session (one `af mcp` process or one `createMcpServer()`), per tool. It is
 * the only view af has of the overseer's tool-result load: everything a tool
 * returns stays in the client context and is re-sent on every later turn.
 * Tokens are an estimate (bytes / 4). Written to
 * `<af global dir>/mcp-sessions/<session>.json` after every call.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getGlobalRoot } from "../paths.js";

/** Bytes per token of the estimate (labeled as an estimate wherever it is shown). */
export const BYTES_PER_TOKEN_ESTIMATE = 4;

/** Directory of the session files under the af global dir. */
export const MCP_SESSIONS_DIR = "mcp-sessions";

export interface ToolUsage {
	tool: string;
	calls: number;
	errors: number;
	bytes: number;
	max_bytes: number;
	est_tokens: number;
}

export interface McpSessionUsageView {
	session: string;
	client: string | null;
	started_at: string;
	calls: number;
	bytes: number;
	/** bytes / 4: an estimate, not a tokenizer count. */
	est_tokens: number;
	tools: ToolUsage[];
	path: string | null;
}

const estimate = (bytes: number) => Math.ceil(bytes / BYTES_PER_TOKEN_ESTIMATE);

/** Bytes of the text a tool result puts in the client context. */
export function resultBytes(result: CallToolResult): number {
	let bytes = 0;
	for (const item of result.content ?? []) {
		bytes += Buffer.byteLength(item.type === "text" ? item.text : JSON.stringify(item), "utf-8");
	}
	if (result.structuredContent)
		bytes += Buffer.byteLength(JSON.stringify(result.structuredContent));
	return bytes;
}

export class McpSessionUsage {
	readonly session =
		`mcp-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
	readonly startedAt = new Date().toISOString();
	private readonly tools = new Map<string, ToolUsage>();
	private readonly file: string | null;

	constructor(
		root: string | null,
		private readonly clientName: () => string | undefined = () => undefined,
	) {
		this.file = root ? path.join(root, MCP_SESSIONS_DIR, `${this.session}.json`) : null;
	}

	/** Counts one tool result and writes the session file (never throws). */
	record(tool: string, result: CallToolResult): void {
		const bytes = resultBytes(result);
		let usage = this.tools.get(tool);
		if (!usage) {
			usage = { tool, calls: 0, errors: 0, bytes: 0, max_bytes: 0, est_tokens: 0 };
			this.tools.set(tool, usage);
		}
		usage.calls += 1;
		if (result.isError) usage.errors += 1;
		usage.bytes += bytes;
		usage.max_bytes = Math.max(usage.max_bytes, bytes);
		usage.est_tokens = estimate(usage.bytes);
		if (!this.file) return;
		try {
			mkdirSync(path.dirname(this.file), { recursive: true });
			writeFileSync(this.file, `${JSON.stringify(this.view(), null, 2)}\n`, "utf-8");
		} catch {
			// Accounting must not fail a tool call
		}
	}

	/** The session totals, tools by bytes returned (largest first). */
	view(): McpSessionUsageView {
		const tools = [...this.tools.values()].sort((a, b) => b.bytes - a.bytes);
		const bytes = tools.reduce((n, t) => n + t.bytes, 0);
		return {
			session: this.session,
			client: this.clientName() ?? null,
			started_at: this.startedAt,
			calls: tools.reduce((n, t) => n + t.calls, 0),
			bytes,
			est_tokens: estimate(bytes),
			tools: tools.map((t) => ({ ...t })),
			path: this.file,
		};
	}
}

const trackers = new WeakMap<McpServer, McpSessionUsage>();

/** Attaches the session tracker of a server (`createMcpServer()`). */
export function trackSessionUsage(server: McpServer, tracker: McpSessionUsage): void {
	trackers.set(server, tracker);
}

/** The session tracker of a server, if one is attached. */
export function sessionUsageOf(server: McpServer): McpSessionUsage | undefined {
	return trackers.get(server);
}

/** Session files go to the af global dir of the registry (`getGlobalRoot()` by default). */
export function sessionUsageRoot(registryRoot: string | undefined): string | null {
	try {
		return registryRoot ?? getGlobalRoot();
	} catch {
		return null;
	}
}
