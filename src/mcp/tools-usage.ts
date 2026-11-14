/**
 * `af_usage`: token usage of runs (`steps/<NN-step>/usage.json`, read from the
 * run directories like af_artifacts) or, with `scope: mcp`, the bytes this MCP
 * session returned per tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RunRegistry } from "../runs/registry.js";
import { USAGE_GROUPS, type UsageRow, buildUsageReport, selectUsageRuns } from "../runs/usage.js";
import { USAGE_MCP_MAX_ROWS } from "./budgets.js";
import { ToolInputError, jsonResult } from "./errors.js";
import { sessionUsageOf } from "./session-usage.js";
import { type ToolContext, nonEmpty, register } from "./tools.js";

/** A report row in compact form (unknown tokens are null). */
function row(r: UsageRow): Record<string, unknown> {
	const u = r.usage;
	return {
		key: r.key,
		calls: r.calls,
		...(r.unknown_calls > 0 ? { unknown_calls: r.unknown_calls } : {}),
		tokens: r.tokens,
		...(u
			? {
					input: u.input_tokens,
					cached: u.cached_input_tokens,
					cache_write: u.cache_creation_tokens,
					output: u.output_tokens,
					...(u.cost_usd !== null ? { cost_usd: u.cost_usd } : {}),
				}
			: {}),
	};
}

export function registerUsageTool(server: McpServer, ctx: ToolContext): void {
	register(
		server,
		"af_usage",
		{
			title: "Token usage",
			description: `Returns token usage: { by, runs, rows, total } with tokens, input, cached, cache_write, output and cost_usd (a runtime estimate; tokens null = not reported). \`run\` covers that run and the runs it dispatched; else all runs since \`since\`. \`by\`: run (default), step, runtime, model, workflow; at most ${USAGE_MCP_MAX_ROWS} rows. \`scope: mcp\` returns the bytes this MCP session returned per tool, with est_tokens (bytes/4).`,
			inputSchema: {
				scope: z
					.enum(["runs", "mcp"], { error: "scope must be runs or mcp" })
					.optional()
					.describe("runs (default) or mcp (this MCP session's tool results)"),
				run: nonEmpty("run", "Run id (its child runs included)").optional(),
				since: nonEmpty("since", "ISO date or duration (30m, 2h, 7d)").optional(),
				by: z
					.enum(USAGE_GROUPS, { error: `by must be one of ${USAGE_GROUPS.join(", ")}` })
					.optional()
					.describe("Grouping of the rows (default run)"),
			},
		},
		async (input) => {
			if (input.scope === "mcp") {
				const tracker = sessionUsageOf(server);
				if (!tracker) throw new ToolInputError("No MCP session accounting", "Use scope: runs.");
				return jsonResult(tracker.view());
			}
			let runs: ReturnType<typeof selectUsageRuns>;
			try {
				runs = selectUsageRuns(new RunRegistry(ctx.registryRoot).list(), {
					run: input.run ?? null,
					since: input.since ?? null,
				});
			} catch (err) {
				throw new ToolInputError(
					(err as Error).message,
					"Pass a run id from af_list_runs, or since as 2h, 7d or an ISO date.",
				);
			}
			const report = buildUsageReport(runs, input.by ?? "run");
			const rows = report.rows.slice(0, USAGE_MCP_MAX_ROWS).map(row);
			return jsonResult({
				by: report.by,
				runs: report.runs,
				rows,
				...(report.rows.length > rows.length
					? {
							truncated: true,
							more_rows: report.rows.length - rows.length,
							next: "Narrow with run or since, or group by a coarser by (runtime, workflow).",
						}
					: {}),
				total: row(report.total),
				...(report.total.usage?.cost_usd != null ? { cost_note: "estimate" } : {}),
			});
		},
	);
}
