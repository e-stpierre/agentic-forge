/**
 * The af MCP server: an `McpServer` named `agentic-forge` whose tools are thin
 * clients of the af supervisor. The transport (stdio for `af mcp`, in-memory
 * in tests) is connected by the caller.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupervisorClient } from "../supervisor/client.js";
import { ClientCache } from "./errors.js";
import { registerBacklogTools } from "./tools-backlog.js";
import { registerControlTools } from "./tools-control.js";
import { type ToolContext, registerRunTools } from "./tools.js";

export const MCP_SERVER_NAME = "agentic-forge";

export interface CreateMcpServerOptions {
	/**
	 * Returns a supervisor client (`af mcp` finds or starts the supervisor).
	 * Called on the first tool call that needs it; the client is cached and
	 * requested again after the supervisor was unreachable.
	 */
	getClient: () => Promise<SupervisorClient>;
	/** af global dir of the run registry read by af_artifacts (defaults to `getGlobalRoot()`). */
	registryRoot?: string;
	/** Default repository and base of relative `repo` inputs (defaults to `process.cwd()`). */
	cwd?: string;
	/** Server version reported to clients. */
	version: string;
}

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
	const server = new McpServer({ name: MCP_SERVER_NAME, version: options.version });
	const ctx: ToolContext = {
		clients: new ClientCache(options.getClient),
		registryRoot: options.registryRoot,
		cwd: options.cwd ?? process.cwd(),
	};
	registerRunTools(server, ctx);
	registerControlTools(server, ctx);
	registerBacklogTools(server, ctx);
	return server;
}
