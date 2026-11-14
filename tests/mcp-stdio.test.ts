/**
 * Stdio smoke test for `af mcp`: spawns the built CLI (dist/cli.js) as an MCP
 * server over real stdin/stdout, so any stray stdout write would break the
 * MCP stream. Skipped until `pnpm build` has run (CI builds before testing).
 * The first tool call starts a detached supervisor in the temp home, which
 * afterEach stops.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { GLOBAL_ROOT_ENV } from "../src/paths.js";
import { stopSupervisor } from "../src/supervisor/index.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

const cliPath = path.resolve(__dirname, "..", "dist", "cli.js");
const home = useTempGlobalRoot();
let client: Client | null = null;

const TOOLS = [
	"af_amend",
	"af_answer",
	"af_artifacts",
	"af_ask",
	"af_backlog_add",
	"af_backlog_list",
	"af_backlog_update",
	"af_cancel",
	"af_dispatch",
	"af_events",
	"af_list_runs",
	"af_logs",
	"af_notify",
	"af_pause",
	"af_resume",
	"af_retry_step",
	"af_send",
	"af_status",
	"af_wait",
];

function childEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) env[key] = value;
	}
	env[GLOBAL_ROOT_ENV] = home.root;
	return env;
}

function text(result: CallToolResult): string {
	const first = result.content[0];
	return first?.type === "text" ? first.text : "";
}

// Registered after useTempGlobalRoot, so it runs before the temp home is removed.
afterEach(async () => {
	if (client) {
		await client.close().catch(() => {});
		client = null;
	}
	await stopSupervisor({ root: home.root, force: true }).catch(() => false);
});

describe.skipIf(!existsSync(cliPath))("af mcp over stdio", () => {
	it("lists the nineteen tools and answers tool calls through an on-demand supervisor", async () => {
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [cliPath, "mcp"],
			env: childEnv(),
			cwd: home.root,
			stderr: "pipe",
		});
		client = new Client({ name: "mcp-stdio-test", version: "0.0.0" });
		await client.connect(transport);

		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS);

		const list = (await client.callTool({ name: "af_list_runs", arguments: {} })) as CallToolResult;
		expect(list.isError).toBeFalsy();
		expect(JSON.parse(text(list))).toEqual({ runs: [], total: 0 });

		const invalid = (await client.callTool({
			name: "af_status",
			arguments: { run: "" },
		})) as CallToolResult;
		expect(invalid.isError).toBe(true);
		expect(text(invalid)).toContain("af_list_runs");
	}, 60_000);
});
