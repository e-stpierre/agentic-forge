/** Workflows command handler. */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { getBundledWorkflowsDir, getProjectWorkflowsDir, getUserWorkflowsDir } from "./run.js";

interface WorkflowMetadata {
	name: string;
	description: string;
	variables: {
		name: string;
		type?: string;
		required?: boolean;
		default?: unknown;
		description?: string;
	}[];
}

function getWorkflowMetadata(filePath: string): WorkflowMetadata {
	try {
		const content = yaml.load(readFileSync(filePath, "utf-8")) as Record<string, unknown> | null;
		if (!content || typeof content !== "object") {
			return { name: path.basename(filePath, ".yaml"), description: "", variables: [] };
		}
		return {
			name: (content.name as string) ?? path.basename(filePath, ".yaml"),
			description: (content.description as string) ?? "",
			variables: (content.variables as WorkflowMetadata["variables"]) ?? [],
		};
	} catch {
		return { name: path.basename(filePath, ".yaml"), description: "", variables: [] };
	}
}

function listAllWorkflows(): [string, string, string, WorkflowMetadata][] {
	const workflows: [string, string, string, WorkflowMetadata][] = [];

	const searchLocations: [string, string][] = [
		[getProjectWorkflowsDir(), "project"],
		[getUserWorkflowsDir(), "user"],
		[getBundledWorkflowsDir(), "bundled"],
	];

	for (const [directory, locationType] of searchLocations) {
		if (existsSync(directory)) {
			const files = readdirSync(directory)
				.filter((f) => f.endsWith(".yaml"))
				.sort();
			for (const file of files) {
				const fullPath = path.join(directory, file);
				const metadata = getWorkflowMetadata(fullPath);
				workflows.push([path.basename(file, ".yaml"), fullPath, locationType, metadata]);
			}
		}
	}

	return workflows;
}

export function cmdWorkflows(options: { verbose?: boolean }): void {
	const workflows = listAllWorkflows();

	if (workflows.length === 0) {
		process.stdout.write("No workflows found.\n");
		process.stdout.write("\nSearched locations:\n");
		process.stdout.write(`  - Project: ${getProjectWorkflowsDir()}\n`);
		process.stdout.write(`  - User:    ${getUserWorkflowsDir()}\n`);
		process.stdout.write(`  - Bundled: ${getBundledWorkflowsDir()}\n`);
		process.stdout.write("\nUse 'agentic-forge init' to copy bundled workflows locally.\n");
		return;
	}

	const verbose = options.verbose ?? false;

	// Group by location
	const byLocation: Record<string, [string, string, WorkflowMetadata][]> = {};
	for (const [name, wfPath, location, metadata] of workflows) {
		if (!byLocation[location]) {
			byLocation[location] = [];
		}
		byLocation[location].push([name, wfPath, metadata]);
	}

	process.stdout.write("Available Workflows\n");
	process.stdout.write(`${"=".repeat(50)}\n\n`);

	const locationOrder = ["project", "user", "bundled"];
	const locationLabels: Record<string, string> = {
		project: "Project",
		user: "User",
		bundled: "Bundled",
	};

	for (const location of locationOrder) {
		if (!byLocation[location]) {
			continue;
		}

		process.stdout.write(`${locationLabels[location]}:\n`);
		for (const [name, , metadata] of byLocation[location]) {
			let desc = metadata.description;
			if (desc) {
				if (desc.length > 60 && !verbose) {
					desc = `${desc.slice(0, 57)}...`;
				}
				process.stdout.write(`  ${name.padEnd(25)} ${desc}\n`);
			} else {
				process.stdout.write(`  ${name}\n`);
			}

			if (verbose && metadata.variables.length > 0) {
				process.stdout.write("    Variables:\n");
				for (const v of metadata.variables) {
					const req = v.required ? "required" : "optional";
					const def = v.default !== undefined ? `, default: ${v.default}` : "";
					const typ = v.type ? ` (${v.type})` : "";
					process.stdout.write(`      ${v.name}${typ} [${req}${def}]\n`);
					if (v.description) {
						process.stdout.write(`        ${v.description}\n`);
					}
				}
			}
		}
		process.stdout.write("\n");
	}

	process.stdout.write(`Total: ${workflows.length} workflow(s)\n\n`);
	process.stdout.write("Usage:\n");
	process.stdout.write("  agentic-forge run <workflow> key=value [key=value ...]\n");
	process.stdout.write("  agentic-forge run <workflow> --var key=value\n\n");
	process.stdout.write("Examples:\n");
	process.stdout.write('  agentic-forge run one-shot task="Add login button"\n');
	process.stdout.write("  agentic-forge run analyze-single analysis_type=bug\n");
	process.stdout.write('  agentic-forge run plan-build-review task="Refactor auth"\n');
}
