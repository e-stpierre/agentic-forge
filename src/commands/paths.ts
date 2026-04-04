/** Paths command - display resolved path configuration. */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../config.js";
import { getConfigPaths, getGlobalRoot, getOutputRoot } from "../paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fmtPath(p: string, status: boolean): string {
	return `${p} [${status ? "exists" : "not found"}]`;
}

export function cmdPaths(): void {
	const cwd = process.cwd();
	const globalRoot = getGlobalRoot();
	const configPaths = getConfigPaths(cwd);
	const config = loadConfig(cwd);

	const globalConfigPath = configPaths.global;
	const globalWorkflowsPath = path.join(globalRoot, "workflows");
	const globalOutputsPath = path.join(globalRoot, "outputs");
	const localConfigPath = path.join(cwd, "agentic", "config.json");
	const localWorkflowsPath = path.join(cwd, "agentic", "workflows");
	const bundledWorkflowsPath = path.join(__dirname, "..", "workflows");
	const outputRoot = getOutputRoot(config, cwd);
	const outputSource =
		config.outputDirectory === "local" || config.outputDirectory === "agentic"
			? "local config"
			: "global config";

	process.stdout.write(
		`Global config:     ${fmtPath(globalConfigPath, existsSync(globalConfigPath))}\n`,
	);
	process.stdout.write(
		`Global workflows:  ${fmtPath(globalWorkflowsPath, existsSync(globalWorkflowsPath))}\n`,
	);
	process.stdout.write(
		`Global outputs:    ${fmtPath(globalOutputsPath, existsSync(globalOutputsPath))}\n`,
	);
	process.stdout.write(
		`Local config:      ${fmtPath(localConfigPath, existsSync(localConfigPath))}\n`,
	);
	process.stdout.write(
		`Local workflows:   ${fmtPath(localWorkflowsPath, existsSync(localWorkflowsPath))}\n`,
	);
	process.stdout.write(`Bundled workflows: ${bundledWorkflowsPath}\n`);
	process.stdout.write(`Output directory:  ${outputRoot} (source: ${outputSource})\n`);
}
