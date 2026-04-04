/** Resume command handler. */

import { existsSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "../config.js";
import { getOutputDir } from "../paths.js";
import { WORKFLOW_STATUS, loadProgress, prepareForResume, saveProgress } from "../progress.js";
import { discoverWorkflow } from "./run.js";

export async function cmdResume(options: {
	workflowId: string;
	terminalOutput?: string;
}): Promise<void> {
	const { WorkflowExecutor } = await import("../executor.js");
	const { WorkflowParser, WorkflowParseError } = await import("../parser.js");

	const config = loadConfig(process.cwd());
	const outputDir = getOutputDir(options.workflowId, config, process.cwd());
	const progress = loadProgress(options.workflowId, outputDir);
	if (progress === null) {
		process.stderr.write(`Error: Workflow not found: ${options.workflowId}\n`);
		process.exit(1);
	}

	// Only reject completed workflows
	if (progress.status === WORKFLOW_STATUS.COMPLETED) {
		process.stderr.write(
			`Error: Cannot resume a completed workflow (status: '${progress.status}')\n`,
		);
		process.exit(1);
	}

	// Resolve workflow YAML file
	let workflowPath: string | null = null;

	// Try stored workflow_file first
	if (progress.workflowFile) {
		if (existsSync(progress.workflowFile)) {
			workflowPath = progress.workflowFile;
		}
	}

	// Fall back to discovery by workflow name
	if (workflowPath === null) {
		const [discovered] = discoverWorkflow(progress.workflowName);
		if (discovered !== null) {
			workflowPath = discovered;
		}
	}

	if (workflowPath === null) {
		process.stderr.write(
			`Error: Cannot find workflow file for '${progress.workflowName}'.\nProvide the workflow YAML at one of the standard locations or re-run with 'agentic-forge run <path>'.\n`,
		);
		process.exit(1);
	}

	// Parse workflow
	let workflow: import("../types.js").WorkflowDefinition;
	try {
		const parser = new WorkflowParser();
		workflow = parser.parseFile(workflowPath);
	} catch (e: unknown) {
		if (e instanceof WorkflowParseError) {
			process.stderr.write(`Error parsing workflow: ${e.message}\n`);
			process.exit(1);
		}
		throw e;
	}

	// Normalize state for resume
	prepareForResume(progress);
	saveProgress(progress, outputDir);

	// Execute with resume
	const executor = new WorkflowExecutor();
	try {
		let terminalOutput = "base";
		if (options.terminalOutput != null) {
			terminalOutput = options.terminalOutput;
		} else if (workflow.settings?.terminalOutput) {
			terminalOutput = workflow.settings.terminalOutput;
		}

		const result = await executor.run(
			workflow,
			progress.variables as Record<string, unknown> | undefined,
			null,
			terminalOutput,
			path.resolve(workflowPath),
			progress,
		);
		process.stdout.write(`\nWorkflow ${result.status}: ${result.workflowId}\n`);
		if (result.errors && result.errors.length > 0) {
			process.stdout.write("\nErrors:\n");
			for (const error of result.errors) {
				process.stdout.write(
					`  - ${(error as Record<string, string>).step}: ${(error as Record<string, string>).error}\n`,
				);
			}
		}
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		process.stderr.write(`Error running workflow: ${msg}\n`);
		process.exit(1);
	}
}
