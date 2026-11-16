/** Run and resume command handlers with workflow discovery. */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import confirm from "@inquirer/confirm";
import input from "@inquirer/input";

import { loadConfig } from "../config.js";
import { exitCodeForRun } from "../contract/index.js";
import { getGlobalRoot } from "../paths.js";
import { buildDispatchPayload } from "../runs/dispatch.js";
import { findSkillPacks } from "../skill-packs.js";

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

/** Project workflows of the repository at `cwd` (`<cwd>/agentic/workflows`). */
export function getProjectWorkflowsDir(cwd = process.cwd()): string {
	return path.join(cwd, "agentic", "workflows");
}

/** Where a discovered workflow comes from, in search order. */
export type WorkflowLocation = "project-local" | "user-global" | "skill-pack" | "bundled";

export interface WorkflowSearchLocation {
	dir: string;
	location: WorkflowLocation;
	/** Skill pack name, for `skill-pack` locations. */
	pack?: string;
}

/**
 * Workflow search order for the repository at `cwd`: project
 * (`<cwd>/agentic/workflows`) > user-global > skill packs (`af-workflows/`,
 * see `findSkillPacks()`) > bundled demos.
 */
export function getWorkflowSearchLocations(
	cwd = process.cwd(),
	config?: Record<string, unknown>,
): WorkflowSearchLocation[] {
	let resolved = config;
	if (!resolved) {
		try {
			resolved = loadConfig(cwd);
		} catch {
			// A malformed config must not hide the other workflow sources.
			resolved = {};
		}
	}
	return [
		{ dir: getProjectWorkflowsDir(cwd), location: "project-local" },
		{ dir: getUserWorkflowsDir(), location: "user-global" },
		...findSkillPacks(resolved, cwd).map(
			(pack): WorkflowSearchLocation => ({
				dir: pack.workflowsDir,
				location: "skill-pack",
				pack: pack.name,
			}),
		),
		{ dir: getBundledWorkflowsDir(), location: "bundled" },
	];
}

/** Finds a workflow by name, in `getWorkflowSearchLocations()` order. */
export function discoverWorkflow(name: string, cwd = process.cwd()): [string | null, string] {
	const fileName = name.endsWith(".yaml") ? name : `${name}.yaml`;

	for (const { dir, location } of getWorkflowSearchLocations(cwd)) {
		const workflowPath = path.join(dir, fileName);
		if (existsSync(workflowPath)) {
			return [workflowPath, location];
		}
	}

	return [null, "not found"];
}

/**
 * Every workflow file in `getWorkflowSearchLocations()` order, as
 * `[name, path, location, pack]` (`pack` is set for skill pack workflows).
 * A name found in several locations is listed in each; the first one wins.
 */
export function listAvailableWorkflows(
	cwd = process.cwd(),
): [string, string, WorkflowLocation, string | undefined][] {
	const workflows: [string, string, WorkflowLocation, string | undefined][] = [];

	for (const { dir, location, pack } of getWorkflowSearchLocations(cwd)) {
		if (existsSync(dir)) {
			const files = readdirSync(dir)
				.filter((f) => f.endsWith(".yaml"))
				.sort();
			for (const file of files) {
				const name = path.basename(file, ".yaml");
				workflows.push([name, path.join(dir, file), location, pack]);
			}
		}
	}

	return workflows;
}

/** Resolves a workflow argument (absolute path, path relative to `cwd`, or name) to a file. */
export function resolveWorkflowPath(workflowArg: string, cwd = process.cwd()): [string, string] {
	// Check if it's an absolute path
	if (path.isAbsolute(workflowArg)) {
		return [workflowArg, "absolute"];
	}

	// Check if it exists as a relative path from cwd
	const localPath = path.resolve(cwd, workflowArg);
	if (existsSync(localPath)) {
		return [localPath, "relative"];
	}

	// If the input looks like a bare name (no path separators), try discovery
	if (!workflowArg.includes("/") && !workflowArg.includes("\\")) {
		const [discovered, locationType] = discoverWorkflow(workflowArg, cwd);
		if (discovered) {
			return [discovered, locationType];
		}
	}

	// Fallback: return the resolved path (will fail with appropriate error)
	return [path.resolve(cwd, workflowArg), "not found"];
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
	/** Attach to the run until it ends (Ctrl+C detaches). */
	foreground?: boolean;
	/** Run despite an unmet `requires` agentic-forge version (never the contract). */
	ignoreRequires?: boolean;
}): Promise<void> {
	// Handle --list flag
	if (options.listWorkflows) {
		const { cmdWorkflows } = await import("./workflows.js");
		cmdWorkflows({});
		return;
	}

	// Validate workflow argument is provided
	if (!options.workflow) {
		throw new CliExitError(
			"Error: workflow name or path is required\nUse 'agentic-forge run --list' to see available workflows",
		);
	}

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
	if (["project-local", "user-global", "skill-pack", "bundled"].includes(locationType)) {
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

	// Resolve terminal_output: CLI override > workflow settings > default "base"
	let terminalOutput = "base";
	if (options.terminalOutput != null) {
		terminalOutput = options.terminalOutput;
	} else if (workflow.settings?.terminalOutput) {
		terminalOutput = workflow.settings.terminalOutput;
	}

	// The client resolves every input; the supervisor never reads its own cwd.
	const payload = buildDispatchPayload({
		workflowPath,
		repoRoot: process.cwd(),
		variables,
		runtime: options.runtime,
		fromStep: options.fromStep,
		slug: options.slug,
		terminalOutput,
		ignoreRequires: options.ignoreRequires,
	});

	const { ensureSupervisor } = await import("../supervisor/client.js");
	const { dispatchRun, followRun, formatEvent } = await import("../runs/client.js");
	const { getVersion } = await import("./version.js");

	let result: import("../runs/manager.js").DispatchResult;
	let client: import("../supervisor/client.js").SupervisorClient;
	try {
		const found = await ensureSupervisor({
			version: getVersion(),
			onWarn: (message) => process.stderr.write(`Warning: ${message}\n`),
		});
		client = found.client;
		result = await dispatchRun(client, payload);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new CliExitError(`Error running workflow: ${msg}`);
	}
	for (const warning of result.warnings ?? []) {
		process.stderr.write(`\x1b[33mWarning: ${warning}\x1b[0m\n`);
	}
	process.stdout.write(`Run queued: ${result.run.id}\n`);
	process.stdout.write(`Run dir:    ${result.dir}\n`);

	if (!options.foreground) {
		process.stdout.write(
			`\nFollow it with 'agentic-forge status ${result.run.id}' or rerun with --foreground.\n`,
		);
		return;
	}

	// Attach: stream the run's events until it ends. Ctrl+C detaches only.
	const controller = new AbortController();
	const onSigint = () => controller.abort();
	process.on("SIGINT", onSigint);
	let finalStatus: string;
	try {
		finalStatus = await followRun(client, result.run.id, {
			signal: controller.signal,
			onEvent: (event) => process.stdout.write(`${formatEvent(event)}\n`),
		});
	} finally {
		process.off("SIGINT", onSigint);
	}
	if (finalStatus === "detached") {
		process.stdout.write(
			`\nDetached. The run continues in the supervisor: agentic-forge status ${result.run.id}\n`,
		);
		return;
	}
	process.stdout.write(`\nWorkflow ${finalStatus}: ${result.run.id}\n`);
	const exitCode = exitCodeForRun(finalStatus);
	if (exitCode !== 0) {
		throw new CliExitError(`Run ${result.run.id} ended with status '${finalStatus}'`, exitCode);
	}
}
