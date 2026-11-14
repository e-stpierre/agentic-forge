/**
 * The `[mcp_servers.agentic-forge]` table of the Codex `config.toml`, edited
 * as text so the rest of the file (comments, order, other servers) stays as
 * the user wrote it. Reading covers this table and its env subtable
 * (`[mcp_servers.agentic-forge.env]`); writing changes only the `command`,
 * `args` and `tool_timeout_sec` keys of the table and keeps every other line.
 */

import { AF_MCP_SERVER } from "../runtimes/af-mcp.js";
import type { McpServerEntry } from "./clients.js";

/** A Codex MCP server table: the entry plus Codex-only keys. */
export interface CodexMcpTable extends McpServerEntry {
	tool_timeout_sec?: number;
}

const NAME = AF_MCP_SERVER.replace(/[-]/g, "\\-");
const OWN_HEADER = new RegExp(
	`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:"${NAME}"|'${NAME}'|${NAME})\\s*(?:\\.[^\\]]*)?\\]\\s*(?:#.*)?$`,
);
const OWN_MAIN_HEADER = new RegExp(
	`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:"${NAME}"|'${NAME}'|${NAME})\\s*\\]\\s*(?:#.*)?$`,
);
const ANY_HEADER = /^\s*\[/;

/** TOML basic string (JSON escapes are valid TOML escapes). */
export function tomlString(value: string): string {
	return JSON.stringify(value);
}

/** Line range `[start, end)` of the af server table and its subtables, or null. */
function findTable(lines: string[]): { start: number; end: number } | null {
	const start = lines.findIndex((line) => OWN_HEADER.test(line));
	if (start < 0) return null;
	let end = start + 1;
	while (end < lines.length && !(ANY_HEADER.test(lines[end]) && !OWN_HEADER.test(lines[end]))) {
		end++;
	}
	// Leave the blank lines and comments that lead into the next table outside the range.
	while (end > start + 1 && /^\s*(#.*)?$/.test(lines[end - 1])) end--;
	return { start, end };
}

/** Parses a TOML value written as a basic or literal string, a number or an array of strings. */
function parseValue(raw: string): unknown {
	const text = raw.replace(/\s+#[^"']*$/, "").trim();
	const json = text.replace(/'([^']*)'/g, (_, inner: string) => JSON.stringify(inner));
	try {
		return JSON.parse(json.replace(/,\s*\]$/, "]"));
	} catch {
		return undefined;
	}
}

/** The af server table of a `config.toml` text, or null when it has none. */
export function readCodexMcp(text: string): CodexMcpTable | null {
	const lines = text.split(/\r?\n/);
	const range = findTable(lines);
	if (!range) return null;
	const values: Record<string, unknown> = {};
	let env: Record<string, string> | undefined;
	let inEnv = false;
	let inMain = OWN_MAIN_HEADER.test(lines[range.start]);
	for (const line of lines.slice(range.start + 1, range.end)) {
		if (ANY_HEADER.test(line)) {
			inEnv = /\.\s*env\s*\]/.test(line);
			inMain = OWN_MAIN_HEADER.test(line);
			if (inEnv) env = env ?? {};
			continue;
		}
		const match = /^\s*([A-Za-z0-9_"'-]+)\s*=\s*(.+)$/.exec(line);
		if (!match) continue;
		const key = match[1].replace(/["']/g, "");
		const value = parseValue(match[2]);
		if (inEnv && env && typeof value === "string") env[key] = value;
		else if (inMain) values[key] = value;
	}
	if (typeof values.command !== "string") return null;
	const args = Array.isArray(values.args)
		? values.args.filter((a): a is string => typeof a === "string")
		: [];
	return {
		command: values.command,
		args,
		...(env ? { env } : {}),
		...(typeof values.tool_timeout_sec === "number"
			? { tool_timeout_sec: values.tool_timeout_sec }
			: {}),
	};
}

/** The af server table as TOML lines. */
export function formatCodexMcp(table: CodexMcpTable): string[] {
	const lines = [
		`[mcp_servers.${AF_MCP_SERVER}]`,
		`command = ${tomlString(table.command)}`,
		`args = [${table.args.map(tomlString).join(", ")}]`,
	];
	if (table.tool_timeout_sec !== undefined) {
		lines.push(`tool_timeout_sec = ${table.tool_timeout_sec}`);
	}
	if (table.env && Object.keys(table.env).length > 0) {
		lines.push("", `[mcp_servers.${AF_MCP_SERVER}.env]`);
		for (const [key, value] of Object.entries(table.env)) {
			lines.push(`${key} = ${tomlString(value)}`);
		}
	}
	return lines;
}

/** The keys `writeCodexMcp()` sets in an existing table, in insertion order. */
const OWNED_KEYS = ["command", "args", "tool_timeout_sec"] as const;
type OwnedKey = (typeof OWNED_KEYS)[number];
const OWNED_LINE = /^(\s*)["']?(command|args|tool_timeout_sec)["']?\s*=\s*(.*)$/;

/** The TOML line of one owned key, or null when `table` leaves it unset. */
function ownedLine(table: CodexMcpTable, key: OwnedKey, indent = ""): string | null {
	if (key === "command") return `${indent}command = ${tomlString(table.command)}`;
	if (key === "args") return `${indent}args = [${table.args.map(tomlString).join(", ")}]`;
	return table.tool_timeout_sec === undefined
		? null
		: `${indent}tool_timeout_sec = ${table.tool_timeout_sec}`;
}

/** Index after the last line of a value that starts on `lines[index]` (multi-line arrays). */
function valueEnd(lines: string[], index: number, value: string): number {
	if (!value.trimStart().startsWith("[") || value.includes("]")) return index + 1;
	let end = index + 1;
	while (end < lines.length && !lines[end].includes("]")) end++;
	return Math.min(end + 1, lines.length);
}

/**
 * Sets `command`, `args` and `tool_timeout_sec` (when given) in the body of an
 * existing `[mcp_servers.agentic-forge]` table, from `header`, and keeps every
 * other line: other keys, inline tables, subtables and comments.
 */
function editTable(lines: string[], header: number, table: CodexMcpTable): void {
	let end = header + 1;
	while (end < lines.length && !ANY_HEADER.test(lines[end])) end++;
	const seen = new Set<OwnedKey>();
	let i = header + 1;
	while (i < end) {
		const match = OWNED_LINE.exec(lines[i]);
		if (!match) {
			i++;
			continue;
		}
		const key = match[2] as OwnedKey;
		const next = valueEnd(lines, i, match[3]);
		const replacement = ownedLine(table, key, match[1]);
		if (!seen.has(key) && replacement === null) {
			// A key `table` leaves unset keeps the user's value as written.
			seen.add(key);
			i = next;
			continue;
		}
		// A repeated key (invalid TOML) is dropped.
		const added = seen.has(key) || replacement === null ? [] : [replacement];
		seen.add(key);
		lines.splice(i, next - i, ...added);
		end += added.length - (next - i);
		i += added.length;
	}
	const missing = OWNED_KEYS.filter((key) => !seen.has(key))
		.map((key) => ownedLine(table, key))
		.filter((line): line is string => line !== null);
	lines.splice(header + 1, 0, ...missing);
}

/**
 * `text` with the af server table set to `table`. An existing table is edited
 * in place (only `command`, `args` and `tool_timeout_sec` change, see
 * `editTable()`); a missing one is appended with `formatCodexMcp()`.
 */
export function writeCodexMcp(text: string, table: CodexMcpTable): string {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.length > 0 ? text.split(/\r?\n/) : [];
	const header = lines.findIndex((line) => OWN_MAIN_HEADER.test(line));
	if (header >= 0) {
		editTable(lines, header, table);
	} else {
		const block = formatCodexMcp(table);
		while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
		if (lines.length > 0) lines.push("");
		lines.push(...block);
	}
	while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
	return `${lines.join(eol)}${eol}`;
}
