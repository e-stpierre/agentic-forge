/** Run and resume command handlers with workflow discovery. */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import confirm from "@inquirer/confirm";
import input from "@inquirer/input";

import { getGlobalRoot } from "../paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Error that signals the CLI should exit with a specific code. */
export class CliExitError extends Error {
	constructor(
		message: string,
		public readonly exitCode: number = 1,
	) {
		super(message);
		this.name = "CliExitError";
	}
}

export function getBundledWorkflowsDir(): string {
	return path.join(__dirname, "..", "workflows");
}

export function getUserWorkflowsDir(): string {
	return path.join(getGlobalRoot(), "workflows");
}

export function getProjectWorkflowsDir(): string {
	return path.join(process.cwd(), "agentic", "workflows");
}

export function discoverWorkflow(name: string): [string | null, string] {
	const fileName = name.endsWith(".yaml") ? name : `${name}.yaml`;

	const searchLocations: [string, string][] = [
		[getProjectWorkflowsDir(), "project-local"],
		[getUserWorkflowsDir(), "user-global"],
		[getBundledWorkflowsDir(), "bundled"],
	];

	for (const [directory, locationType] of searchLocations) {
		const workflowPath = path.join(directory, fileName);
		if (existsSync(workflowPath)) {
			return [workflowPath, locationType];
		}
	}

	return [null, "not found"];
}

export function listAvailableWorkflows(): [string, string, string][] {
	const workflows: [string, string, string][] = [];

	const searchLocations: [string, string][] = [
		[getProjectWorkflowsDir(), "project-local"],
		[getUserWorkflowsDir(), "user-global"],
		[getBundledWorkflowsDir(), "bundled"],
	];

	for (const [directory, locationType] of searchLocations) {
		if (existsSync(directory)) {
			const files = readdirSync(directory)
				.filter((f) => f.endsWith(".yaml"))
				.sort();
			for (const file of files) {
				const name = path.basename(file, ".yaml");
				workflows.push([name, path.join(directory, file), locationType]);
			}
		}
	}

	return workflows;
}

export function resolveWorkflowPath(workflowArg: string): [string, string] {
	// Check if it's an absolute path
	if (path.isAbsolute(workflowArg)) {
		return [workflowArg, "absolute"];
	}

	// Check if it exists as a relative path from cwd
	const localPath = path.resolve(process.cwd(), workflowArg);
	if (existsSync(localPath)) {
		return [localPath, "relative"];
	}

	// If the input looks like a bare name (no path separators), try discovery
	if (!workflowArg.includes("/") && !workflowArg.includes("\\")) {
		const [discovered, locationType] = discoverWorkflow(workflowArg);
		if (discovered) {
			return [discovered, locationType];
		}
	}

	// Fallback: return the resolved path (will fail with appropriate error)
	return [path.resolve(workflowArg), "not found"];
}

/**
 * Parse bare key=value strings and --var flag strings into a variables record.
 * Bare args are processed first; --var flags override them for the same key.
 * Throws an Error with a human-readable message on invalid format.
 */
export function parseVars(bareVars?: string[], vars?: string[]): Record<string, string> {
	const variables: Record<string, string> = {};

	function parseOne(v: string): void {
		if (!v.includes("=")) {
			throw new CliExitError(`Error: Invalid variable format: ${v}\nExpected format: key=value`);
		}
		const eqIndex = v.indexOf("=");
		variables[v.slice(0, eqIndex)] = v.slice(eqIndex + 1);
	}

	if (bareVars) for (const v of bareVars) parseOne(v);
	if (vars) for (const v of vars) parseOne(v);

	return variables;
}

export async function cmdRun(options: {
	workflow?: string;
	listWorkflows?: boolean;
	vars?: string[];
	bareVars?: string[];
	fromStep?: string;
	interactive?: boolean;
	terminalOutput?: string;
	runtime?: string;
	slug?: string;
}): Promise<void> {
	// Handle --list flag
	if (options.listWorkflows) {
		process.stdout.write("Available workflows:\n\n");
		const workflows = listAvailableWorkflows();

		if (workflows.length === 0) {
			process.stdout.write("No workflows found.\n");
			process.stdout.write("\nSearched locations:\n");
			process.stdout.write(`  - Project: ${getProjectWorkflowsDir()}\n`);
			process.stdout.write(`  - User:    ${getUserWorkflowsDir()}\n`);
			process.stdout.write(`  - Bundled: ${getBundledWorkflowsDir()}\n`);
			return;
		}

		// Group by location
		const byLocation: Record<string, [string, string][]> = {};
		for (const [name, wfPath, location] of workflows) {
			if (!byLocation[location]) {
				byLocation[location] = [];
			}
			byLocation[location].push([name, wfPath]);
		}

		for (const location of ["project-local", "user-global", "bundled"]) {
			if (byLocation[location]) {
				const label = location.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase());
				process.stdout.write(`${label}:\n`);
				for (const [name] of byLocation[location]) {
					process.stdout.write(`  ${name}\n`);
				}
				process.stdout.write("\n");
			}
		}

		process.stdout.write(`Total: ${workflows.length} workflow(s)\n`);
		process.stdout.write("\nUsage: agentic-forge run <workflow> [key=value ...]\n");
		return;
	}

	// Validate workflow argument is provided
	if (!options.workflow) {
		throw new CliExitError(
			"Error: workflow name or path is required\nUse 'agentic-forge run --list' to see available workflows",
		);
	}

	const { WorkflowExecutor } = await import("../executor.js");
	const { WorkflowParser, WorkflowParseError } = await import("../parser.js");
	const [workflowPath, locationType] = resolveWorkflowPath(options.workflow);

	if (!existsSync(workflowPath)) {
		const lines = [`Error: Workflow not found: ${options.workflow}`, "", "Available workflows:"];

		const workflows = listAvailableWorkflows();
		if (workflows.length > 0) {
			for (const [name, , location] of workflows.slice(0, 10)) {
				lines.push(`  ${name} (${location})`);
			}
			if (workflows.length > 10) {
				lines.push(`  ... and ${workflows.length - 10} more`);
			}
		} else {
			lines.push("  (no workflows found)");
		}

		lines.push("", "Use 'agentic-forge run --list' to see all workflows.");
		lines.push("Use 'agentic-forge init' to copy bundled workflows locally.");
		throw new CliExitError(lines.join("\n"));
	}

	// Show which workflow is being used
	if (["project-local", "user-global", "bundled"].includes(locationType)) {
		process.stdout.write(`Using ${locationType} workflow: ${path.basename(workflowPath)}\n`);
	}

	// Parse variables
	const variables = parseVars(options.bareVars, options.vars);

	let workflow: import("../types.js").WorkflowDefinition;
	try {
		const parser = new WorkflowParser();
		workflow = parser.parseFile(workflowPath);
	} catch (e: unknown) {
		if (e instanceof WorkflowParseError) {
			throw new CliExitError(`Error parsing workflow: ${e.message}`);
		}
		throw e;
	}

	// Prompt for missing required variables (interactive mode only)
	const isInteractive = options.interactive !== false && process.stdin.isTTY;

	for (const v of workflow.variables) {
		if (v.name in variables) continue;
		if (!v.required) continue;
		if (v.default !== undefined) continue;

		// Required variable is missing
		if (!isInteractive) {
			const lines = [`Error: Missing required variable: ${v.name}`];
			if (v.description) {
				lines.push(`  Description: ${v.description}`);
			}
			lines.push(`  Usage: agentic-forge run ${options.workflow} ${v.name}="<value>"`);
			throw new CliExitError(lines.join("\n"));
		}

		const label = v.description || v.name;
		if (v.type === "boolean") {
			const answer = await confirm({
				message: `${label}:`,
				default: false,
			});
			variables[v.name] = String(answer);
		} else {
			const answer = await input({
				message: `${label}:`,
			});
			variables[v.name] = answer;
		}
	}

	// Warn about unrecognized variables
	const declaredNames = new Set(workflow.variables.map((v) => v.name));
	const unknownKeys = Object.keys(variables).filter((k) => !declaredNames.has(k));
	if (unknownKeys.length > 0) {
		process.stderr.write("\n");
		for (const key of unknownKeys) {
			process.stderr.write(
				`\x1b[33mWarning: Unknown variable "${key}" (not declared in workflow)\x1b[0m\n`,
			);
		}
	}

	const executor = new WorkflowExecutor(undefined, false, options.runtime);
	try {
		// Resolve terminal_output: CLI override > workflow settings > default "base"
		let terminalOutput = "base";
		if (options.terminalOutput != null) {
			terminalOutput = options.terminalOutput;
		} else if (workflow.settings?.terminalOutput) {
			terminalOutput = workflow.settings.terminalOutput;
		}

		const progress = await executor.run(
			workflow,
			variables,
			options.fromStep ?? null,
			terminalOutput,
			path.resolve(workflowPath),
			null,
			options.slug,
		);
		process.stdout.write(`\nWorkflow ${progress.status}: ${progress.workflowId}\n`);
		if (progress.errors && progress.errors.length > 0) {
			process.stdout.write("\nErrors:\n");
			for (const error of progress.errors) {
				process.stdout.write(
					`  - ${(error as Record<string, string>).step}: ${(error as Record<string, string>).error}\n`,
				);
			}
		}
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new CliExitError(`Error running workflow: ${msg}`);
	}
}
