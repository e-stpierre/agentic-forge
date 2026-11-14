/**
 * The af MCP server as other agents start it: the overseer's `--mcp-config`
 * and the per-thread config of every Codex session the supervisor starts
 * (so a Codex step can dispatch, wait for and ask through af runs).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Name of the af MCP server in client configs (tools are `mcp__agentic-forge__af_*`). */
export const AF_MCP_SERVER = "agentic-forge";

/**
 * Tool timeout given to the af server in Codex sessions (seconds). Codex
 * defaults to 60 s; af_wait and af_ask keep each call under 60 s by default,
 * and this lets an agent pass a longer wait.
 */
export const CODEX_AF_TOOL_TIMEOUT_SEC = 900;

/**
 * How to run this af CLI from another process: node with the CLI script, so
 * it works without `af` on PATH and without a Windows `.cmd` shim.
 */
export function afInvocation(): { command: string; args: string[] } {
	return { command: process.execPath, args: [path.resolve(__dirname, "..", "cli.js")] };
}

/**
 * Environment names the af MCP server of a step gets. Codex starts MCP
 * servers with a small default environment, so these are passed explicitly:
 * the run and step (af_ask, the default af_dispatch parent) and what the
 * server needs to find the supervisor. Secrets are never copied: a child run
 * inherits the rest of its parent's environment in the supervisor.
 */
const AF_MCP_ENV = [
	"AF_RUN_ID",
	"AF_STEP",
	"AGENTIC_FORGE_HOME",
	"PATH",
	"PATHEXT",
	"HOME",
	"USERPROFILE",
	"APPDATA",
	"LOCALAPPDATA",
	"SYSTEMROOT",
	"TEMP",
	"TMP",
	"TMPDIR",
	"XDG_CONFIG_HOME",
	"XDG_RUNTIME_DIR",
];

export function afMcpEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	const wanted = new Set(AF_MCP_ENV);
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (value !== undefined && wanted.has(name.toUpperCase())) out[name] = value;
	}
	return out;
}

/**
 * Codex thread `config` entry that adds the af MCP server to a step's
 * session, or null outside a run (no `AF_RUN_ID`). The af tools are the
 * harness's own, so they are approved without asking.
 */
export function codexAfMcpConfig(
	env: NodeJS.ProcessEnv | null | undefined,
	invocation = afInvocation(),
): Record<string, unknown> | null {
	if (!env?.AF_RUN_ID) return null;
	const portable = (p: string) => p.replace(/\\/g, "/");
	return {
		[`mcp_servers.${AF_MCP_SERVER}`]: {
			command: portable(invocation.command),
			args: [...invocation.args.map(portable), "mcp"],
			env: afMcpEnv(env),
			tool_timeout_sec: CODEX_AF_TOOL_TIMEOUT_SEC,
			default_tools_approval_mode: "approve",
		},
	};
}
