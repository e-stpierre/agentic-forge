/** Tests for workflow orchestrator. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StepDefinition, WorkflowDefinition } from "../src/types.js";

// Mock runRuntime at module level
const mockRunRuntime = vi.fn();
vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return {
		...original,
		runRuntime: mockRunRuntime,
	};
});

// Mock loadConfig to return predictable defaults
vi.mock("../src/config.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/config.js")>();
	return {
		...original,
		loadConfig: vi.fn(() => ({
			outputDirectory: "local",
			logging: { enabled: true, level: "Error" },
			defaults: {
				runtime: "claude",
				maxRetry: 3,
				timeoutMinutes: 60,
				trackProgress: true,
				terminalOutput: "base",
			},
			claude: { model: "sonnet" },
			codex: { model: "gpt-5.5", sandbox: "workspace-write" },
			execution: { maxWorkers: 4, pollingIntervalSeconds: 5 },
		})),
	};
});

// Mock git worktree operations
vi.mock("../src/git/worktree.js", () => ({
	copyLocalDirs: vi.fn(),
	createWorktree: vi.fn().mockReturnValue({
		path: "/tmp/wt",
		branch: "agentic/test",
		baseBranch: "main",
	}),
	removeWorktree: vi.fn(),
	pruneOrphaned: vi.fn(),
}));

// Mock PromptStepExecutor
const mockPromptExecute = vi.fn();
vi.mock("../src/steps/prompt-step.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/steps/prompt-step.js")>();
	return {
		...original,
		PromptStepExecutor: class extends original.PromptStepExecutor {
			execute = mockPromptExecute;
		},
	};
});

const { WorkflowOrchestrator, processHumanInput } = await import("../src/orchestrator.js");
const { WORKFLOW_STATUS, createProgress, saveProgress } = await import("../src/progress.js");

// --- Helpers ---

let tempDir: string;

beforeEach(() => {
	vi.clearAllMocks();
	mockPromptExecute.mockResolvedValue({ success: true, outputSummary: "done" });
	tempDir = mkdtempSync(path.join(os.tmpdir(), "orchestrator-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

function makeStep(
	overrides: Partial<StepDefinition> & { name: string; type: StepDefinition["type"] },
): StepDefinition {
	return {
		steps: [],
		thenSteps: [],
		elseSteps: [],
		maxIterations: 5,
		pollingInterval: 30,
		onTimeout: "fail",
		onError: "fail",
		checkpoint: false,
		prompt: null,
		agent: null,
		condition: null,
		completionPromise: null,
		message: null,
		model: null,
		stepTimeoutMinutes: null,
		stepMaxRetry: null,
		dependsOn: null,
		...overrides,
	};
}

function makeWorkflow(steps: StepDefinition[]): WorkflowDefinition {
	return {
		name: "test-workflow",
		version: "1.0",
		description: "Test workflow",
		settings: {
			maxRetry: 3,
			timeoutMinutes: 60,
			trackProgress: true,
			autofix: "off",
			terminalOutput: "base",
			bypassPermissions: false,
			strictMode: false,
			model: null,
			requiredTools: [],
		},
		variables: [],
		steps,
		outputs: [],
	};
}

// --- parseOrchestratorResponse (via private access) ---

describe("parseOrchestratorResponse", () => {
	let orchestrator: InstanceType<typeof WorkflowOrchestrator>;

	beforeEach(() => {
		orchestrator = new WorkflowOrchestrator(tempDir);
	});

	afterEach(() => {
		orchestrator.dispose();
	});

	// Access private method for unit testing
	function callParse(output: string) {
		return (
			orchestrator as unknown as { parseOrchestratorResponse: (o: string) => unknown }
		).parseOrchestratorResponse(output);
	}

	it("should parse a valid JSON response", () => {
		const input = JSON.stringify({
			workflow_status: "in_progress",
			next_action: {
				type: "execute_step",
				step_name: "build",
				context_to_pass: "some context",
				error_context: null,
			},
			reasoning: "Build step is next",
			progress_update: "Starting build",
		});
		const result = callParse(input) as Record<string, unknown>;
		expect(result.workflowStatus).toBe("in_progress");
		expect(result.reasoning).toBe("Build step is next");
		expect(result.progressUpdate).toBe("Starting build");
		const action = result.action as Record<string, unknown>;
		expect(action.type).toBe("execute_step");
		expect(action.stepName).toBe("build");
		expect(action.contextToPass).toBe("some context");
		expect(action.errorContext).toBeNull();
	});

	it("should extract JSON from markdown code block", () => {
		const input = `Here is the decision:
\`\`\`json
{
  "workflow_status": "completed",
  "next_action": { "type": "abort" },
  "reasoning": "All done",
  "progress_update": ""
}
\`\`\``;
		const result = callParse(input) as Record<string, unknown>;
		expect(result.workflowStatus).toBe("completed");
		expect(result.reasoning).toBe("All done");
	});

	it("should extract JSON from plain code block", () => {
		const input = `\`\`\`
{"workflow_status": "failed", "next_action": {"type": "abort"}, "reasoning": "error", "progress_update": ""}
\`\`\``;
		const result = callParse(input) as Record<string, unknown>;
		expect(result.workflowStatus).toBe("failed");
	});

	it("should default missing fields to safe values", () => {
		const input = JSON.stringify({});
		const result = callParse(input) as Record<string, unknown>;
		expect(result.workflowStatus).toBe("failed");
		expect(result.reasoning).toBe("");
		expect(result.progressUpdate).toBe("");
		const action = result.action as Record<string, unknown>;
		expect(action.type).toBe("abort");
		expect(action.stepName).toBeNull();
		expect(action.contextToPass).toBeNull();
		expect(action.errorContext).toBeNull();
	});

	it("should throw on non-object JSON", () => {
		expect(() => callParse('"just a string"')).toThrow("not a JSON object");
	});

	it("should throw on array JSON", () => {
		expect(() => callParse("[1, 2, 3]")).toThrow("not a JSON object");
	});

	it("should throw on invalid JSON", () => {
		expect(() => callParse("not json at all")).toThrow();
	});

	it("should handle non-string field values gracefully", () => {
		const input = JSON.stringify({
			workflow_status: 123,
			next_action: { type: true, step_name: 42 },
			reasoning: null,
			progress_update: [],
		});
		const result = callParse(input) as Record<string, unknown>;
		expect(result.workflowStatus).toBe("failed");
		expect(result.reasoning).toBe("");
		expect(result.progressUpdate).toBe("");
		const action = result.action as Record<string, unknown>;
		expect(action.type).toBe("abort");
		expect(action.stepName).toBeNull();
	});

	it("should handle next_action being a non-object", () => {
		const input = JSON.stringify({
			workflow_status: "in_progress",
			next_action: "not an object",
			reasoning: "test",
			progress_update: "",
		});
		const result = callParse(input) as Record<string, unknown>;
		const action = result.action as Record<string, unknown>;
		expect(action.type).toBe("abort");
	});
});

// --- collectStepNames (via private access) ---

describe("collectStepNames", () => {
	let orchestrator: InstanceType<typeof WorkflowOrchestrator>;

	beforeEach(() => {
		orchestrator = new WorkflowOrchestrator(tempDir);
	});

	afterEach(() => {
		orchestrator.dispose();
	});

	function callCollect(steps: StepDefinition[]) {
		return (
			orchestrator as unknown as { collectStepNames: (s: StepDefinition[]) => string[] }
		).collectStepNames(steps);
	}

	it("should collect names from flat step list", () => {
		const steps = [
			makeStep({ name: "step1", type: "prompt" }),
			makeStep({ name: "step2", type: "prompt" }),
		];
		expect(callCollect(steps)).toEqual(["step1", "step2"]);
	});

	it("should collect names from nested parallel steps", () => {
		const steps = [
			makeStep({
				name: "parallel-parent",
				type: "parallel",
				steps: [
					makeStep({ name: "branch-a", type: "prompt" }),
					makeStep({ name: "branch-b", type: "prompt" }),
				],
			}),
		];
		expect(callCollect(steps)).toEqual(["parallel-parent", "branch-a", "branch-b"]);
	});

	it("should collect names from conditional then/else branches", () => {
		const steps = [
			makeStep({
				name: "cond-step",
				type: "conditional",
				condition: "true",
				thenSteps: [makeStep({ name: "then-step", type: "prompt" })],
				elseSteps: [makeStep({ name: "else-step", type: "prompt" })],
			}),
		];
		expect(callCollect(steps)).toEqual(["cond-step", "then-step", "else-step"]);
	});

	it("should return empty array for empty steps", () => {
		expect(callCollect([])).toEqual([]);
	});
});

// --- findStep (via private access) ---

describe("findStep", () => {
	let orchestrator: InstanceType<typeof WorkflowOrchestrator>;

	beforeEach(() => {
		orchestrator = new WorkflowOrchestrator(tempDir);
	});

	afterEach(() => {
		orchestrator.dispose();
	});

	function callFind(steps: StepDefinition[], name: string | null) {
		return (
			orchestrator as unknown as {
				findStep: (s: StepDefinition[], n: string | null) => StepDefinition | null;
			}
		).findStep(steps, name);
	}

	const steps = [
		makeStep({ name: "step1", type: "prompt" }),
		makeStep({
			name: "parallel-step",
			type: "parallel",
			steps: [
				makeStep({ name: "branch-a", type: "prompt" }),
				makeStep({ name: "branch-b", type: "prompt" }),
			],
		}),
		makeStep({
			name: "cond-step",
			type: "conditional",
			thenSteps: [makeStep({ name: "then-action", type: "prompt" })],
			elseSteps: [makeStep({ name: "else-action", type: "prompt" })],
		}),
	];

	it("should find a top-level step", () => {
		const result = callFind(steps, "step1");
		expect(result).not.toBeNull();
		expect(result?.name).toBe("step1");
	});

	it("should find a nested parallel sub-step", () => {
		const result = callFind(steps, "branch-a");
		expect(result).not.toBeNull();
		expect(result?.name).toBe("branch-a");
	});

	it("should find a step in then branch", () => {
		const result = callFind(steps, "then-action");
		expect(result).not.toBeNull();
		expect(result?.name).toBe("then-action");
	});

	it("should find a step in else branch", () => {
		const result = callFind(steps, "else-action");
		expect(result).not.toBeNull();
		expect(result?.name).toBe("else-action");
	});

	it("should return null for non-existent step", () => {
		expect(callFind(steps, "nonexistent")).toBeNull();
	});

	it("should return null for null name", () => {
		expect(callFind(steps, null)).toBeNull();
	});

	it("should return null for empty steps array", () => {
		expect(callFind([], "anything")).toBeNull();
	});
});

// --- resolveModel (via private access) ---

describe("resolveModel", () => {
	let orchestrator: InstanceType<typeof WorkflowOrchestrator>;

	afterEach(() => {
		orchestrator.dispose();
	});

	it("should return step model when provided", () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const resolve = (
			orchestrator as unknown as {
				resolveModel: (m?: string | null, r?: string) => string;
			}
		).resolveModel;
		expect(resolve.call(orchestrator, "opus")).toBe("opus");
	});

	it("should fall back to default sonnet", () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const resolve = (
			orchestrator as unknown as {
				resolveModel: (m?: string | null, r?: string) => string;
			}
		).resolveModel;
		expect(resolve.call(orchestrator, null)).toBe("sonnet");
		expect(resolve.call(orchestrator, undefined)).toBe("sonnet");
	});
});

// --- workflowToDict (via private access) ---

describe("workflowToDict", () => {
	let orchestrator: InstanceType<typeof WorkflowOrchestrator>;

	afterEach(() => {
		orchestrator.dispose();
	});

	it("should produce a simplified dict with name and step summaries", () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const toDict = (
			orchestrator as unknown as {
				workflowToDict: (w: WorkflowDefinition) => Record<string, unknown>;
			}
		).workflowToDict;
		const workflow = makeWorkflow([
			makeStep({ name: "build", type: "prompt" }),
			makeStep({ name: "test", type: "serial" }),
		]);
		const result = toDict.call(orchestrator, workflow);
		expect(result.name).toBe("test-workflow");
		expect(result.steps).toEqual([
			{ name: "build", type: "prompt" },
			{ name: "test", type: "serial" },
		]);
	});
});

// --- processHumanInput ---

function setupLocalOutput(dir: string): void {
	mkdirSync(path.join(dir, "agentic"), { recursive: true });
	writeFileSync(
		path.join(dir, "agentic", "config.json"),
		JSON.stringify({ outputDirectory: "local" }),
		"utf-8",
	);
}

function localOutputDir(dir: string, workflowId: string): string {
	return path.join(dir, "agentic", "outputs", workflowId);
}

describe("processHumanInput", () => {
	it("should return false when workflow not found", () => {
		setupLocalOutput(tempDir);
		const stdoutWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const result = processHumanInput("nonexistent", "response", tempDir);
		expect(result).toBe(false);
		stdoutWrite.mockRestore();
	});

	it("should return false when workflow is not paused", () => {
		setupLocalOutput(tempDir);
		const stdoutWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const progress = createProgress("wf-running", "test", ["step1"], {});
		progress.status = "running";
		saveProgress(progress, localOutputDir(tempDir, "wf-running"));

		const result = processHumanInput("wf-running", "response", tempDir);
		expect(result).toBe(false);
		stdoutWrite.mockRestore();
	});

	it("should return false when workflow is paused but not waiting for human", () => {
		setupLocalOutput(tempDir);
		const stdoutWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const progress = createProgress("wf-paused", "test", ["step1"], {});
		progress.status = WORKFLOW_STATUS.PAUSED;
		progress.currentStep = null;
		saveProgress(progress, localOutputDir(tempDir, "wf-paused"));

		const result = processHumanInput("wf-paused", "response", tempDir);
		expect(result).toBe(false);
		stdoutWrite.mockRestore();
	});

	it("should accept input when workflow is paused and waiting for human", () => {
		setupLocalOutput(tempDir);
		const stdoutWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const progress = createProgress("wf-waiting", "test", ["step1"], {});
		progress.status = WORKFLOW_STATUS.PAUSED;
		progress.currentStep = {
			name: "step1",
			retryCount: 0,
			startedAt: new Date().toISOString(),
			type: "wait-for-human",
			message: "Please review",
		};
		saveProgress(progress, localOutputDir(tempDir, "wf-waiting"));

		const result = processHumanInput("wf-waiting", "approved", tempDir);
		expect(result).toBe(true);
		stdoutWrite.mockRestore();
	});
});

// --- Orchestrator.run integration ---

type OrchestratorDecision = {
	workflowStatus: string;
	action: {
		type: string;
		stepName?: string | null;
		contextToPass?: string | null;
		errorContext?: string | null;
	};
	reasoning: string;
	progressUpdate: string;
};

function mockDecision(
	orchestrator: InstanceType<typeof WorkflowOrchestrator>,
	decisions: (OrchestratorDecision | null)[],
) {
	let callIdx = 0;
	vi.spyOn(
		orchestrator as unknown as {
			getOrchestratorDecision: () => Promise<OrchestratorDecision | null>;
		},
		"getOrchestratorDecision" as never,
	).mockImplementation(() => Promise.resolve(decisions[callIdx++] ?? null));
}

describe("WorkflowOrchestrator.run", () => {
	let orchestrator: InstanceType<typeof WorkflowOrchestrator>;

	beforeEach(() => {
		setupLocalOutput(tempDir);
	});

	afterEach(() => {
		orchestrator.dispose();
	});

	it("should complete workflow when orchestrator returns completed status", async () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const workflow = makeWorkflow([
			makeStep({ name: "build", type: "prompt", prompt: "build it" }),
		]);

		mockDecision(orchestrator, [
			{
				workflowStatus: "completed",
				action: { type: "abort" },
				reasoning: "All steps done",
				progressUpdate: "Workflow complete",
			},
		]);

		const progress = await orchestrator.run(workflow, {}, null, "base", "test.yaml");
		expect(progress.status).toBe(WORKFLOW_STATUS.COMPLETED);
	});

	it("should mark workflow as failed when orchestrator returns failed status", async () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const workflow = makeWorkflow([
			makeStep({ name: "build", type: "prompt", prompt: "build it" }),
		]);

		mockDecision(orchestrator, [
			{
				workflowStatus: "failed",
				action: { type: "abort" },
				reasoning: "Critical error",
				progressUpdate: "",
			},
		]);

		const progress = await orchestrator.run(workflow, {}, null, "base", "test.yaml");
		expect(progress.status).toBe(WORKFLOW_STATUS.FAILED);
	});

	it("should mark workflow as failed when orchestrator decision fails", async () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const workflow = makeWorkflow([
			makeStep({ name: "build", type: "prompt", prompt: "build it" }),
		]);

		mockDecision(orchestrator, [null]);

		const progress = await orchestrator.run(workflow, {}, null, "base", "test.yaml");
		expect(progress.status).toBe(WORKFLOW_STATUS.FAILED);
	});

	it("should fail when required variable is missing", async () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const workflow = makeWorkflow([makeStep({ name: "build", type: "prompt" })]);
		workflow.variables = [{ name: "target", type: "string", required: true }];

		await expect(orchestrator.run(workflow, {}, null, "base", "test.yaml")).rejects.toThrow(
			"Missing required variable: target",
		);
	});

	it("should use default values for optional variables", async () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const workflow = makeWorkflow([makeStep({ name: "build", type: "prompt", prompt: "go" })]);
		workflow.variables = [{ name: "env", type: "string", required: false, default: "dev" }];

		mockDecision(orchestrator, [
			{
				workflowStatus: "completed",
				action: { type: "abort" },
				reasoning: "Done",
				progressUpdate: "",
			},
		]);

		const progress = await orchestrator.run(workflow, {}, null, "base", "test.yaml");
		expect(progress.variables.env).toBe("dev");
	});

	it("should skip steps before fromStep", async () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const workflow = makeWorkflow([
			makeStep({ name: "step1", type: "prompt", prompt: "first" }),
			makeStep({ name: "step2", type: "prompt", prompt: "second" }),
			makeStep({ name: "step3", type: "prompt", prompt: "third" }),
		]);

		mockDecision(orchestrator, [
			{
				workflowStatus: "completed",
				action: { type: "abort" },
				reasoning: "Done",
				progressUpdate: "",
			},
		]);

		const progress = await orchestrator.run(workflow, {}, "step2", "base", "test.yaml");
		expect(progress.completedSteps).toHaveLength(1);
		expect(progress.completedSteps[0].name).toBe("step1");
		expect(progress.completedSteps[0].status).toBe("skipped");
		expect(progress.pendingSteps).toContain("step2");
		expect(progress.pendingSteps).toContain("step3");
	});

	it("should pause workflow on blocked status", async () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const workflow = makeWorkflow([makeStep({ name: "build", type: "prompt", prompt: "go" })]);

		mockDecision(orchestrator, [
			{
				workflowStatus: "blocked",
				action: { type: "wait_for_human" },
				reasoning: "Needs approval",
				progressUpdate: "",
			},
		]);

		const progress = await orchestrator.run(workflow, {}, null, "base", "test.yaml");
		expect(progress.status).toBe(WORKFLOW_STATUS.PAUSED);
	});

	it("should abort workflow on abort action", async () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const workflow = makeWorkflow([makeStep({ name: "build", type: "prompt", prompt: "go" })]);

		mockDecision(orchestrator, [
			{
				workflowStatus: "in_progress",
				action: { type: "abort" },
				reasoning: "Cannot proceed",
				progressUpdate: "",
			},
		]);

		const progress = await orchestrator.run(workflow, {}, null, "base", "test.yaml");
		expect(progress.status).toBe(WORKFLOW_STATUS.FAILED);
	});

	it("should execute a step and continue the decision loop", async () => {
		orchestrator = new WorkflowOrchestrator(tempDir);
		const workflow = makeWorkflow([
			makeStep({ name: "build", type: "prompt", prompt: "build it" }),
		]);

		mockPromptExecute.mockResolvedValueOnce({ success: true, outputSummary: "built" });

		mockDecision(orchestrator, [
			{
				workflowStatus: "in_progress",
				action: { type: "execute_step", stepName: "build" },
				reasoning: "Execute build step",
				progressUpdate: "Starting build",
			},
			{
				workflowStatus: "completed",
				action: { type: "abort" },
				reasoning: "Build done",
				progressUpdate: "All done",
			},
		]);

		const progress = await orchestrator.run(workflow, {}, null, "base", "test.yaml");
		expect(progress.status).toBe(WORKFLOW_STATUS.COMPLETED);
	});
});
