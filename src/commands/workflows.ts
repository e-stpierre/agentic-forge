/** Workflows command handler. */

import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import {
	type WorkflowLocation,
	getWorkflowSearchLocations,
	listAvailableWorkflows,
} from "./run.js";

const LOCATION_LABELS: Record<WorkflowLocation, string> = {
	"project-local": "Project",
	"user-global": "User",
	"skill-pack": "Skill pack",
	bundled: "Bundled",
};

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

function locationLabel(location: WorkflowLocation, pack: string | undefined): string {
	return pack ? `${LOCATION_LABELS[location]}: ${pack}` : LOCATION_LABELS[location];
}

/**
 * Lists the workflows of every source in search order (project, user, skill
 * packs, bundled), grouped by origin. A name found again in a later source is
 * marked `[shadowed]`: `af run <name>` uses the first one.
 */
export function cmdWorkflows(options: { verbose?: boolean; cwd?: string }): void {
	const cwd = options.cwd ?? process.cwd();
	const locations = getWorkflowSearchLocations(cwd);
	const workflows = listAvailableWorkflows(cwd);

	if (workflows.length === 0) {
		process.stdout.write("No workflows found.\n");
		process.stdout.write("\nSearched locations:\n");
		for (const { dir, location, pack } of locations) {
			process.stdout.write(`  - ${locationLabel(location, pack)}: ${dir}\n`);
		}
		process.stdout.write("\nUse 'agentic-forge init' to copy bundled workflows locally.\n");
		return;
	}

	const verbose = options.verbose ?? false;

	process.stdout.write("Available Workflows (search order: project, user, skill packs, bundled)\n");
	process.stdout.write(`${"=".repeat(50)}\n\n`);

	const winner = new Map<string, string>();
	for (const [name, wfPath] of workflows) {
		if (!winner.has(name)) winner.set(name, wfPath);
	}

	for (const { dir, location, pack } of locations) {
		const inDir = workflows.filter(([, wfPath]) => path.dirname(wfPath) === dir);
		if (inDir.length === 0) continue;

		process.stdout.write(`${locationLabel(location, pack)} (${dir}):\n`);
		for (const [name, wfPath] of inDir) {
			const metadata = getWorkflowMetadata(wfPath);
			const shadowed = winner.get(name) !== wfPath ? " [shadowed]" : "";
			let desc = metadata.description;
			if (desc) {
				if (desc.length > 60 && !verbose) {
					desc = `${desc.slice(0, 57)}...`;
				}
				process.stdout.write(`  ${name.padEnd(25)} ${desc}${shadowed}\n`);
			} else {
				process.stdout.write(`  ${name}${shadowed}\n`);
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
	process.stdout.write("  agentic-forge run claude-demo\n");
	process.stdout.write('  agentic-forge run plan-loop input="Add a login button"\n');
	process.stdout.write('  agentic-forge run ralph-loop task="Fix the failing tests"\n');
}
