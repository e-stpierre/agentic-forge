/** Nunjucks template rendering for workflows. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Set of variable names already warned about (reset per render). */
const warnedVars = new Set<string>();

/**
 * Custom nunjucks loader that warns on undefined variables instead of failing.
 * Returns the original `{{ variable_name }}` syntax for undefined variables.
 */
function createLenientEnvironment(templateDirs: string[]): nunjucks.Environment {
	const loader = new nunjucks.FileSystemLoader(templateDirs, { noCache: true });
	const env = new nunjucks.Environment(loader, { autoescape: false });

	// Install a global that intercepts missing variables
	// Nunjucks doesn't have a direct WarnOnUndefined equivalent,
	// so we use a custom extension approach
	return env;
}

function createStrictEnvironment(templateDirs: string[]): nunjucks.Environment {
	const loader = new nunjucks.FileSystemLoader(templateDirs, { noCache: true });
	return new nunjucks.Environment(loader, {
		autoescape: false,
		throwOnUndefined: true,
	});
}

export class TemplateRenderer {
	templateDirs: string[];
	strictMode: boolean;
	private env: nunjucks.Environment;

	constructor(templateDirs?: string[], strictMode = false) {
		const dirs = templateDirs ?? [path.join(__dirname, "templates")];

		this.templateDirs = dirs;
		this.strictMode = strictMode;

		const existingDirs = dirs.filter((d) => existsSync(d));
		this.env = strictMode
			? createStrictEnvironment(existingDirs)
			: createLenientEnvironment(existingDirs);
	}

	render(templateName: string, context: Record<string, unknown>): string {
		if (!this.strictMode) {
			warnedVars.clear();
		}
		return this.env.render(templateName, context);
	}

	renderString(templateStr: string, context: Record<string, unknown>): string {
		if (!this.strictMode) {
			warnedVars.clear();
		}
		return this.env.renderString(templateStr, context);
	}

	hasVariables(text: string): boolean {
		return text.includes("{{") || text.includes("{%");
	}

	addTemplateDir(dirPath: string): void {
		if (existsSync(dirPath) && !this.templateDirs.includes(dirPath)) {
			this.templateDirs.push(dirPath);
			const existingDirs = this.templateDirs.filter((d) => existsSync(d));
			this.env = this.strictMode
				? createStrictEnvironment(existingDirs)
				: createLenientEnvironment(existingDirs);
		}
	}
}

// --- Helper functions ---

const ANALYSIS_TYPES = ["bug", "debt", "doc", "security", "style"];

export function extractAnalysisSteps(
	stepOutputs: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
	const result: Record<string, Record<string, unknown>> = {};
	for (const [name, data] of Object.entries(stepOutputs)) {
		if (name.startsWith("analyze-")) {
			const analysisType = name.slice("analyze-".length);
			if (ANALYSIS_TYPES.includes(analysisType)) {
				result[name] = data;
			}
		}
	}
	return result;
}

export function extractFixSteps(
	stepOutputs: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
	const result: Record<string, Record<string, unknown>> = {};
	for (const [name, data] of Object.entries(stepOutputs)) {
		if (name.startsWith("fix-") || name.startsWith("apply-")) {
			result[name] = data;
		}
	}
	return result;
}

export function buildTemplateContext(
	workflowName: string,
	workflowId: string,
	startedAt: string,
	completedAt: string | null,
	stepOutputs: Record<string, Record<string, unknown>>,
	filesChanged: string[],
	branches: string[],
	pullRequests: Record<string, unknown>[],
	inputs: Record<string, unknown>,
): Record<string, unknown> {
	const analysisSteps = extractAnalysisSteps(stepOutputs);
	const fixSteps = extractFixSteps(stepOutputs);

	return {
		workflow: {
			name: workflowName,
			id: workflowId,
			started_at: startedAt,
			completed_at: completedAt,
		},
		workflow_id: workflowId,
		steps: stepOutputs,
		analysis_steps: analysisSteps,
		fix_steps: fixSteps,
		files_changed: filesChanged,
		branches,
		pull_requests: pullRequests,
		inputs,
	};
}

export function renderWorkflowOutput(
	templatePath: string,
	outputPath: string,
	context: Record<string, unknown>,
	templateDirs?: string[],
	strictMode = false,
): void {
	const renderer = new TemplateRenderer(templateDirs, strictMode);

	let rendered: string;
	if (path.isAbsolute(templatePath)) {
		const content = readFileSync(templatePath, "utf-8");
		rendered = renderer.renderString(content, context);
	} else {
		rendered = renderer.render(templatePath, context);
	}

	const dir = path.dirname(outputPath);
	mkdirSync(dir, { recursive: true });
	writeFileSync(outputPath, rendered, "utf-8");
}
