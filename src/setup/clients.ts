/**
 * Where Claude Code and Codex keep their configuration, and readers for the
 * parts `af setup` writes and `af doctor` checks: the af MCP server
 * registration and the `af-overseer` plugin install. Readers never throw:
 * a missing or unreadable file reads as "not registered".
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getClaudeConfigDir, getGlobalRoot } from "../paths.js";
import { AF_MCP_SERVER } from "../runtimes/af-mcp.js";
import { getInstalledPluginsPath } from "../skill-packs.js";

/** Name of the af marketplace `af setup claude` registers in Claude Code. */
export const AF_MARKETPLACE = "agentic-forge";
/** Name of the bundled overseer plugin. */
export const OVERSEER_PLUGIN = "af-overseer";
/** Install key of the overseer plugin in Claude Code. */
export const OVERSEER_PLUGIN_KEY = `${OVERSEER_PLUGIN}@${AF_MARKETPLACE}`;

/** Config locations of both clients (tests point them at temp dirs). */
export interface ClientDirs {
	/** Claude Code config dir (`CLAUDE_CONFIG_DIR`, else `~/.claude`). */
	claudeDir: string;
	/**
	 * Claude Code user config file holding user-scope MCP servers:
	 * `$CLAUDE_CONFIG_DIR/.claude.json` when the variable is set, else `~/.claude.json`.
	 */
	claudeUserConfig: string;
	/** Codex home (`CODEX_HOME`, else `~/.codex`). */
	codexHome: string;
	/** af global dir (the generated marketplace lives there). */
	afRoot: string;
}

export function getClientDirs(
	env: NodeJS.ProcessEnv = process.env,
	overrides: Partial<ClientDirs> = {},
): ClientDirs {
	const claudeDir = overrides.claudeDir ?? getClaudeConfigDir();
	const claudeUserConfig =
		overrides.claudeUserConfig ??
		(overrides.claudeDir || env.CLAUDE_CONFIG_DIR
			? path.join(claudeDir, ".claude.json")
			: path.join(homedir(), ".claude.json"));
	const codexHome =
		overrides.codexHome ??
		(env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(homedir(), ".codex"));
	return { claudeDir, claudeUserConfig, codexHome, afRoot: overrides.afRoot ?? getGlobalRoot() };
}

/** An MCP server entry as clients store it. */
export interface McpServerEntry {
	command: string;
	args: string[];
	env?: Record<string, string>;
}

export function readJson(file: string): Record<string, unknown> | null {
	if (!existsSync(file)) return null;
	try {
		const data = JSON.parse(readFileSync(file, "utf-8")) as unknown;
		return data && typeof data === "object" && !Array.isArray(data)
			? (data as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asServer(value: unknown): McpServerEntry | null {
	const obj = asRecord(value);
	if (!obj || typeof obj.command !== "string") return null;
	const args = Array.isArray(obj.args) ? obj.args.filter((a) => typeof a === "string") : [];
	const env = asRecord(obj.env) as Record<string, string> | null;
	return { command: obj.command, args, ...(env ? { env } : {}) };
}

/** User-scope `agentic-forge` MCP server of Claude Code, or null. */
export function readClaudeUserMcp(dirs: ClientDirs): McpServerEntry | null {
	const servers = asRecord(readJson(dirs.claudeUserConfig)?.mcpServers);
	return asServer(servers?.[AF_MCP_SERVER]);
}

/** Path of Claude Code's known marketplace list. */
export function knownMarketplacesPath(dirs: ClientDirs): string {
	return path.join(dirs.claudeDir, "plugins", "known_marketplaces.json");
}

/** Directory the `agentic-forge` marketplace is registered from, or null. */
export function readAfMarketplace(dirs: ClientDirs): string | null {
	const entry = asRecord(readJson(knownMarketplacesPath(dirs))?.[AF_MARKETPLACE]);
	const source = asRecord(entry?.source);
	const where = source?.path ?? entry?.installLocation;
	return typeof where === "string" ? where : null;
}

export interface OverseerPluginInstall {
	installPath: string;
	version: string | null;
	/** Disabled in the user `settings.json` (`enabledPlugins`). */
	disabled: boolean;
}

/** User-scope install of `af-overseer@agentic-forge`, or null. */
export function readOverseerPluginInstall(dirs: ClientDirs): OverseerPluginInstall | null {
	const plugins = asRecord(readJson(getInstalledPluginsPath(dirs.claudeDir))?.plugins);
	const entries = plugins?.[OVERSEER_PLUGIN_KEY];
	if (!Array.isArray(entries)) return null;
	const user = entries
		.map(asRecord)
		.find((e) => e && e.scope === "user" && typeof e.installPath === "string");
	if (!user) return null;
	const enabled = asRecord(readJson(path.join(dirs.claudeDir, "settings.json"))?.enabledPlugins);
	return {
		installPath: user.installPath as string,
		version: typeof user.version === "string" ? user.version : null,
		disabled: enabled?.[OVERSEER_PLUGIN_KEY] === false,
	};
}

/** The af MCP server of an installed plugin (its `.mcp.json`), or null. */
export function readPluginMcp(pluginDir: string): McpServerEntry | null {
	const servers = asRecord(readJson(path.join(pluginDir, ".mcp.json"))?.mcpServers);
	return asServer(servers?.[AF_MCP_SERVER]);
}

/** Path of the Codex config file. */
export function codexConfigPath(dirs: ClientDirs): string {
	return path.join(dirs.codexHome, "config.toml");
}

/** The af CLI script an MCP entry starts (`<cli.js>` before `mcp`), or null. */
export function entryScript(entry: McpServerEntry): string | null {
	const index = entry.args.lastIndexOf("mcp");
	const script = index > 0 ? entry.args[index - 1] : null;
	return script && /\.m?js$/i.test(script) ? script : null;
}
