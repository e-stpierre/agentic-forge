/** Ralph Wiggum loop state management and completion detection. */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

// --- Types ---

export interface RalphLoopState {
	active: boolean;
	iteration: number;
	maxIterations: number;
	completionPromise: string;
	startedAt: string;
	prompt: string;
}

export interface CompletionResult {
	isComplete: boolean;
	promiseMatched: boolean;
	promiseValue: string | null;
	output: string;
	isFailed: boolean;
	failureReason: string | null;
}

// --- State path ---

export function getRalphStatePath(workflowId: string, stepName: string, outputDir: string): string {
	const safeName = stepName.replace(/[^\w-]/g, "_");
	return path.join(outputDir, `ralph-${safeName}.md`);
}

// --- State management ---

export function createRalphState(
	workflowId: string,
	stepName: string,
	prompt: string,
	maxIterations: number,
	completionPromise: string,
	outputDir: string,
): RalphLoopState {
	const state: RalphLoopState = {
		active: true,
		iteration: 1,
		maxIterations,
		completionPromise,
		startedAt: new Date().toISOString(),
		prompt,
	};

	saveRalphState(workflowId, stepName, state, outputDir);
	return state;
}

export function loadRalphState(
	workflowId: string,
	stepName: string,
	outputDir: string,
): RalphLoopState | null {
	const statePath = getRalphStatePath(workflowId, stepName, outputDir);
	if (!existsSync(statePath)) return null;

	const content = readFileSync(statePath, "utf-8");
	return parseRalphState(content);
}

export function updateRalphIteration(
	workflowId: string,
	stepName: string,
	outputDir: string,
): RalphLoopState | null {
	const state = loadRalphState(workflowId, stepName, outputDir);
	if (!state) return null;

	state.iteration += 1;
	saveRalphState(workflowId, stepName, state, outputDir);
	return state;
}

export function deactivateRalphState(
	workflowId: string,
	stepName: string,
	outputDir: string,
): void {
	const state = loadRalphState(workflowId, stepName, outputDir);
	if (state) {
		state.active = false;
		saveRalphState(workflowId, stepName, state, outputDir);
	}
}

export function deleteRalphState(workflowId: string, stepName: string, outputDir: string): void {
	const statePath = getRalphStatePath(workflowId, stepName, outputDir);
	if (existsSync(statePath)) {
		unlinkSync(statePath);
	}
}

// --- Internal helpers ---

function saveRalphState(
	workflowId: string,
	stepName: string,
	state: RalphLoopState,
	outputDir: string,
): void {
	const statePath = getRalphStatePath(workflowId, stepName, outputDir);
	const dir = path.dirname(statePath);
	mkdirSync(dir, { recursive: true });

	const frontmatter = {
		active: state.active,
		iteration: state.iteration,
		max_iterations: state.maxIterations,
		completion_promise: state.completionPromise,
		started_at: state.startedAt,
	};

	const yamlStr = yaml.dump(frontmatter, { flowLevel: -1 }).trim();
	const content = `---
${yamlStr}
---

# Ralph Loop Prompt

${state.prompt}
`;

	writeFileSync(statePath, content, "utf-8");
}

export function parseRalphState(content: string): RalphLoopState | null {
	if (!content.startsWith("---")) return null;

	const parts = content.split("---");
	if (parts.length < 3) return null;

	let frontmatter: Record<string, unknown>;
	try {
		frontmatter = yaml.load(parts[1]) as Record<string, unknown>;
	} catch {
		return null;
	}

	const promptSection = parts.slice(2).join("---").trim();
	let prompt: string;
	if (promptSection.includes("# Ralph Loop Prompt")) {
		prompt = promptSection.split("# Ralph Loop Prompt")[1].trim();
	} else {
		prompt = promptSection;
	}

	return {
		active: (frontmatter.active as boolean) ?? false,
		iteration: (frontmatter.iteration as number) ?? 1,
		maxIterations: (frontmatter.max_iterations as number) ?? 5,
		completionPromise: (frontmatter.completion_promise as string) ?? "COMPLETE",
		startedAt: (frontmatter.started_at as string) ?? "",
		prompt,
	};
}

// --- Completion detection ---

export function detectCompletionPromise(output: string, expectedPromise: string): CompletionResult {
	const jsonPatterns = [
		/```json\s*\n?(.*?)\n?```/gis,
		/```\s*\n?(\{.*?\})\n?```/gis,
		/(\{[^{}]*"ralph_complete"[^{}]*\})/gi,
		/(\{[^{}]*"ralph_failed"[^{}]*\})/gi,
	];

	for (const pattern of jsonPatterns) {
		pattern.lastIndex = 0;
		const matches = [...output.matchAll(pattern)];
		for (const match of matches) {
			try {
				const data = JSON.parse(match[1].trim());
				if (typeof data !== "object" || data === null) continue;

				// Check for completion signal
				if (data.ralph_complete) {
					const promiseValue = String(data.promise ?? "");
					const promiseMatched =
						promiseValue.trim().toUpperCase() === expectedPromise.trim().toUpperCase();
					return {
						isComplete: true,
						promiseMatched,
						promiseValue,
						output,
						isFailed: false,
						failureReason: null,
					};
				}

				// Check for failure signal
				if (data.ralph_failed) {
					const failureReason = String(data.reason ?? "Unknown error");
					return {
						isComplete: true,
						promiseMatched: false,
						promiseValue: null,
						output,
						isFailed: true,
						failureReason,
					};
				}
			} catch {
				// Invalid JSON, skip
			}
		}
	}

	return {
		isComplete: false,
		promiseMatched: false,
		promiseValue: null,
		output,
		isFailed: false,
		failureReason: null,
	};
}

// --- System message builder ---

export function buildRalphSystemMessage(
	iteration: number,
	maxIterations: number,
	completionPromise: string,
): string {
	return `## Ralph Wiggum Loop - Iteration ${iteration}/${maxIterations}

You are in a Ralph Wiggum iterative loop. Each iteration starts a fresh session.

**Completion Signal:**
When your task is FULLY complete, output a JSON block:
\`\`\`json
{
  "ralph_complete": true,
  "promise": "${completionPromise}"
}
\`\`\`

**Failure Signal:**
Only output this after exhausting ALL alternatives (see retry rules below):
\`\`\`json
{
  "ralph_failed": true,
  "reason": "<brief description of the blocking error and all approaches attempted>"
}
\`\`\`

**Tool Retry Rules:**
If a tool call is denied or fails, you MUST try alternative approaches before giving up. Attempt at least 3 different strategies. For example, if editing a file fails:
1. Try the Write tool to overwrite the file with updated content
2. Try Bash with a shell command (e.g., echo/printf with redirection)
3. Try Bash with sed or cat with heredoc to rewrite the file
Only output the failure JSON after ALL alternatives have been attempted and failed.

**IMPORTANT:**
- Only output the completion JSON when the task is genuinely finished
- Do not output false promises to exit early
- NEVER output the failure JSON after a single tool denial - always try alternative tools first
- If the task is incomplete but can still progress, continue working - you have ${maxIterations - iteration} iterations remaining

---

`;
}
