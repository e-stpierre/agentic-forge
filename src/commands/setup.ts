/**
 * `af setup claude|codex [--mode plugin|mcp] [--dry-run] [--json]`: registers
 * the af MCP server and installs the af skills in a coding agent client (see
 * `src/setup/setup.ts`).
 */

import { getClientDirs } from "../setup/clients.js";
import {
	type ClaudeSetupMode,
	SetupError,
	type SetupOptions,
	formatSetupReport,
	runSetup,
} from "../setup/setup.js";
import { CliExitError } from "./run.js";

export interface SetupCommandOptions {
	client?: string;
	mode?: string;
	dryRun?: boolean;
	json?: boolean;
}

export async function cmdSetup(
	options: SetupCommandOptions,
	deps: Partial<Omit<SetupOptions, "client" | "mode" | "dryRun">> & {
		out?: (text: string) => void;
	} = {},
): Promise<void> {
	const out = deps.out ?? ((text: string) => process.stdout.write(text));
	const client = options.client;
	if (client !== "claude" && client !== "codex") {
		throw new CliExitError("Error: af setup needs a client: claude or codex");
	}
	if (options.mode !== undefined && options.mode !== "plugin" && options.mode !== "mcp") {
		throw new CliExitError("Error: --mode must be plugin or mcp");
	}
	if (options.mode !== undefined && client !== "claude") {
		throw new CliExitError("Error: --mode applies to af setup claude only");
	}
	try {
		const report = runSetup({
			...deps,
			client,
			mode: options.mode as ClaudeSetupMode | undefined,
			dryRun: options.dryRun,
			dirs: deps.dirs ?? getClientDirs(),
		});
		out(options.json ? `${JSON.stringify(report)}\n` : `${formatSetupReport(report)}\n`);
	} catch (err) {
		if (err instanceof SetupError) throw new CliExitError(`Error: ${err.message}`);
		throw err;
	}
}
