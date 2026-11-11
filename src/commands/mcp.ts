/**
 * `af mcp`: a stdio MCP server that dispatches and reads runs through the af
 * supervisor. stdout carries MCP frames only, so console output goes to
 * stderr. The supervisor is found or started on the first tool call.
 */

/** Sends `console.log`, `console.info` and `console.debug` to stderr (stdout is the MCP stream). */
export function redirectConsoleToStderr(): void {
	const toStderr = (...args: unknown[]) => console.error(...args);
	console.log = toStderr;
	console.info = toStderr;
	console.debug = toStderr;
}

/** Serves MCP over stdin/stdout until the client closes the stream. */
export async function cmdMcp(): Promise<void> {
	redirectConsoleToStderr();
	const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
	const { createMcpServer } = await import("../mcp/index.js");
	const { getVersion } = await import("./version.js");
	const version = getVersion();

	const server = createMcpServer({
		version,
		getClient: async () => {
			const { ensureSupervisor } = await import("../supervisor/client.js");
			const found = await ensureSupervisor({
				version,
				onWarn: (message) => process.stderr.write(`Warning: ${message}\n`),
			});
			return found.client;
		},
	});

	const transport = new StdioServerTransport();
	const closed = new Promise<void>((resolve) => {
		server.server.onclose = () => resolve();
	});
	// The stdio transport does not close when stdin ends; close the server then.
	process.stdin.once("end", () => {
		void server.close();
	});
	await server.connect(transport);
	await closed;
}
