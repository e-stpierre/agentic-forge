/** Init and configure command handlers. */

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getDefaultConfig, loadConfig } from "../config.js";
import { getGlobalRoot } from "../paths.js";
import { getBundledWorkflowsDir } from "./run.js";

export interface InitOptions {
	force?: boolean;
	listOnly?: boolean;
	local?: boolean;
	global?: boolean;
	configOnly?: boolean;
	workflowsOnly?: boolean;
	workflow?: string;
}

export function cmdInit(options: InitOptions): void {
	const bundledDir = getBundledWorkflowsDir();
	if (!existsSync(bundledDir)) {
		process.stderr.write("Error: Bundled workflows directory not found.\n");
		process.exit(1);
	}

	const bundledWorkflows = readdirSync(bundledDir)
		.filter((f) => f.endsWith(".yaml"))
		.sort();

	if (bundledWorkflows.length === 0) {
		process.stderr.write("No bundled workflows found.\n");
		process.exit(1);
	}

	// List only mode
	if (options.listOnly) {
		process.stdout.write("Available bundled workflows:\n\n");
		for (const wf of bundledWorkflows) {
			process.stdout.write(`  ${wf}\n`);
		}
		process.stdout.write("\nUse 'agentic-forge init' to copy these to the global directory\n");
		process.stdout.write(
			"Use 'agentic-forge init --local' to copy to the project-local directory\n",
		);
		return;
	}

	// Determine target scope: --local flag selects project-local; default is global
	const isLocal = options.local === true;
	let targetDir: string;

	if (isLocal) {
		targetDir = path.join(process.cwd(), "agentic");
	} else {
		targetDir = getGlobalRoot();
	}

	// Ensure target directory structure
	mkdirSync(path.join(targetDir, "workflows"), { recursive: true });
	mkdirSync(path.join(targetDir, "outputs"), { recursive: true });

	const locationLabel = isLocal ? `local: ${targetDir}` : `global: ${targetDir}`;

	// Copy workflows (unless --config-only)
	if (!options.configOnly) {
		let workflowsToCopy = bundledWorkflows;

		// Filter to a named workflow if --workflow <name> is provided
		if (options.workflow) {
			const named = options.workflow.endsWith(".yaml")
				? options.workflow
				: `${options.workflow}.yaml`;
			workflowsToCopy = bundledWorkflows.filter((f) => f === named);
			if (workflowsToCopy.length === 0) {
				process.stderr.write(
					`Error: Workflow '${options.workflow}' not found in bundled workflows.\n`,
				);
				process.stderr.write(
					"Use 'agentic-forge init --list' to see available bundled workflows.\n",
				);
				process.exit(1);
			}
		}

		const workflowsTargetDir = path.join(targetDir, "workflows");
		mkdirSync(workflowsTargetDir, { recursive: true });

		const copied: string[] = [];
		const skipped: string[] = [];
		for (const wf of workflowsToCopy) {
			const targetPath = path.join(workflowsTargetDir, wf);
			if (existsSync(targetPath) && !options.force) {
				skipped.push(wf);
			} else {
				copyFileSync(path.join(bundledDir, wf), targetPath);
				copied.push(wf);
			}
		}

		if (copied.length > 0) {
			process.stdout.write(`Copied ${copied.length} workflow(s) to ${workflowsTargetDir}/\n`);
			for (const name of copied) {
				process.stdout.write(`  + ${name}\n`);
			}
		}

		if (skipped.length > 0) {
			process.stdout.write(`\nSkipped ${skipped.length} existing workflow(s):\n`);
			for (const name of skipped) {
				process.stdout.write(`  - ${name}\n`);
			}
			process.stdout.write("\nUse --force to overwrite existing files.\n");
		}
	}

	// Create config.json (unless --workflows-only)
	if (!options.workflowsOnly) {
		initConfig(targetDir, options.force ?? false, isLocal);
	}

	process.stdout.write(`\nInitialized ${locationLabel}\n`);
	process.stdout.write("You can now run workflows with:\n");
	process.stdout.write("  agentic-forge run <workflow-name>\n");
}

function initConfig(agenticDir: string, force: boolean, isLocal: boolean): void {
	const configPath = path.join(agenticDir, "config.json");
	if (existsSync(configPath) && !force) {
		process.stdout.write(`\nConfig already exists: ${configPath}\n`);
		return;
	}

	mkdirSync(agenticDir, { recursive: true });
	const config = getDefaultConfig();
	if (isLocal) {
		config.outputDirectory = "local";
	}
	writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
	process.stdout.write(`\nCreated config: ${configPath}\n`);
}

export function cmdConfigure(): void {
	const config = loadConfig();
	process.stdout.write("Agentic Workflows Configuration\n");
	process.stdout.write(`${"=".repeat(40)}\n`);
	process.stdout.write("\nCurrent settings:\n");
	process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
	process.stdout.write("\nUse 'agentic-forge config set <key> <value>' to modify settings.\n");
	process.stdout.write("Example: agentic-forge config set defaults.maxRetry 5\n");
}
