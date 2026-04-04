/** Init and configure command handlers. */

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getDefaultConfig, loadConfig } from "../config.js";
import { getBundledWorkflowsDir } from "./run.js";

export function cmdInit(options: { force?: boolean; listOnly?: boolean }): void {
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
		process.stdout.write("\nUse 'agentic-forge init' to copy these to agentic/workflows/\n");
		return;
	}

	// Copy workflows to local directory
	const targetDir = path.join(process.cwd(), "agentic", "workflows");
	mkdirSync(targetDir, { recursive: true });

	const copied: string[] = [];
	const skipped: string[] = [];
	for (const wf of bundledWorkflows) {
		const targetPath = path.join(targetDir, wf);
		if (existsSync(targetPath) && !options.force) {
			skipped.push(wf);
		} else {
			copyFileSync(path.join(bundledDir, wf), targetPath);
			copied.push(wf);
		}
	}

	if (copied.length > 0) {
		process.stdout.write(`Copied ${copied.length} workflow(s) to ${targetDir}/\n`);
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

	// Create config.json next to workflows
	initConfig(path.join(process.cwd(), "agentic"), options.force ?? false);

	if (copied.length > 0) {
		process.stdout.write("\nYou can now run workflows with:\n");
		process.stdout.write("  agentic-forge run agentic/workflows/<workflow>.yaml\n");
	}
}

function initConfig(agenticDir: string, force: boolean): void {
	const configPath = path.join(agenticDir, "config.json");
	if (existsSync(configPath) && !force) {
		process.stdout.write(`\nConfig already exists: ${configPath}\n`);
		return;
	}

	mkdirSync(agenticDir, { recursive: true });
	const config = getDefaultConfig();
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
