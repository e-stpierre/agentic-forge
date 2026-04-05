/** Tests for step executors. */

import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConsoleOutput } from "../src/console.js";
import { WorkflowLogger } from "../src/logging/logger.js";
import { createProgress } from "../src/progress.js";
import { TemplateRenderer } from "../src/renderer.js";
import type { RuntimeAdapter } from "../src/runtimes/index.js";
import type { RuntimeResult, SessionOutput } from "../src/runtimes/index.js";
import {
	type BranchStepExecutor,
	type StepContext,
	StepExecutor,
	buildTemplateContext,
	resolveModel,
} from "../src/steps/base.js";
import { ConditionalStepExecutor } from "../src/steps/conditional-step.js";
import { ParallelStepExecutor } from "../src/steps/parallel-step.js";
import { SerialStepExecutor } from "../src/steps/serial-step.js";
import type { StepDefinition, WorkflowProgress, WorkflowSettings } from "../src/types.js";

// Mock runRuntime at module level
const mockRunRuntime = vi.fn();
vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return {
		...original,
		runRuntime: (...args: unknown[]) => mockRunRuntime(...args),
	};
});

// Now import PromptStepExecutor AFTER mock is set up
const { PromptStepExecutor } = await import("../src/steps/prompt-step.js");

// --- Helpers ---

function createMockStream(): Writable {
	return new Writable({
		write(_chunk, _encoding, cb) {
			cb();
		},
	});
}

function makeStepDef(
	overrides: Partial<StepDefinition> & { name: string; type: StepDefinition["type"] },
): StepDefinition {
	return {
		steps: [],
		mergeStrategy: "wait-all",
		mergeMode: "merge",
		thenSteps: [],
		elseSteps: [],
		maxIterations: 5,
		pollingInterval: 30,
		onTimeout: "fail",
		onError: "fail",
		checkpoint: false,
		...overrides,
	};
}

function defaultSettings(): WorkflowSettings {
	return {
		maxRetry: 3,
		timeoutMinutes: 60,
		trackProgress: true,
		autofix: "off",
		terminalOutput: "base",
		bypassPermissions: false,
		strictMode: false,
		model: null,
		requiredTools: [],
		git: {
			enabled: false,
			worktree: false,
			autoCommit: false,
			autoPr: false,
			branchPrefix: "agentic",
		},
	};
}

// --- Fixtures ---

let tempDir: string;
let mockLogger: WorkflowLogger;

beforeEach(() => {
	vi.clearAllMocks();
	tempDir = mkdtempSync(path.join(os.tmpdir(), "steps-test-"));
	const logDir = path.join(tempDir, "agentic", "outputs", "test-workflow-id");
	mkdirSync(logDir, { recursive: true });
	mockLogger = new WorkflowLogger("test-workflow-id", tempDir);
});

function createMockAdapter(): RuntimeAdapter {
	return {
		id: "claude",
		executableName: "claude",
		defaultModel: "sonnet",
		checkAvailable: () => true,
		buildCommand: () => ({
			executable: "claude",
			args: [],
			stdinInput: "",
		}),
		parseStreamLine: () => null,
		buildFinalResult: (returncode, stdout, stderr, options): RuntimeResult => ({
			returncode,
			stdout,
			stderr,
			prompt: options.prompt,
			cwd: options.cwd ?? null,
			model: options.model ?? null,
			success: returncode === 0,
			sessionOutput: { sessionId: null, isSuccess: false, context: "" },
		}),
	};
}

function createStepContext(overrides?: Partial<StepContext>): StepContext {
	return {
		repoRoot: tempDir,
		config: {
			defaults: {
				model: "sonnet",
				maxRetry: 3,
				timeoutMinutes: 60,
			},
		},
		renderer: new TemplateRenderer(),
		runtimeAdapter: createMockAdapter(),
		workflowSettings: defaultSettings(),
		workflowId: "test-workflow-id",
		variables: { test_var: "test_value" },
		outputs: {},
		...overrides,
	};
}

function createWorkflowProgress(): WorkflowProgress {
	return createProgress("test-workflow-id", "test-workflow", ["step1", "step2"], {});
}

// --- Tests ---

describe("StepContext", () => {
	it("should build template context with workflow_id", () => {
		const context = createStepContext({
			workflowId: "test-workflow-456",
			variables: { task: "feature" },
			outputs: { plan: { summary: "test" } },
		});

		const templateCtx = buildTemplateContext(context);

		expect(templateCtx.workflow_id).toBe("test-workflow-456");
		expect((templateCtx.variables as Record<string, unknown>).task).toBe("feature");
		expect(
			((templateCtx.outputs as Record<string, unknown>).plan as Record<string, unknown>).summary,
		).toBe("test");
		// Variables should also be spread at top level
		expect(templateCtx.task).toBe("feature");
	});
});

describe("resolveModel", () => {
	it("should prioritize step model", () => {
		const context = createStepContext({
			workflowSettings: { ...defaultSettings(), model: "haiku" },
		});
		expect(resolveModel(context, "opus")).toBe("opus");
	});

	it("should use workflow model when step has none", () => {
		const context = createStepContext({
			workflowSettings: { ...defaultSettings(), model: "haiku" },
		});
		expect(resolveModel(context, null)).toBe("haiku");
	});

	it("should fall back to config default", () => {
		const context = createStepContext({
			config: { defaults: { model: "opus" } },
			workflowSettings: defaultSettings(),
		});
		expect(resolveModel(context, null)).toBe("opus");
	});

	it("should fall back to adapter default when nothing is configured", () => {
		const context = createStepContext({
			config: { defaults: {} },
			workflowSettings: defaultSettings(),
		});
		expect(resolveModel(context, null)).toBe("sonnet");
	});
});

describe("StepExecutor base", () => {
	it("should be an abstract class that subclasses extend", () => {
		// Verify that PromptStepExecutor extends StepExecutor
		const executor = new PromptStepExecutor();
		expect(executor).toBeInstanceOf(StepExecutor);
	});
});

describe("PromptStepExecutor", () => {
	it("should be instantiable", () => {
		const executor = new PromptStepExecutor();
		expect(executor).toBeDefined();
	});

	it("should execute a basic prompt", async () => {
		mockRunRuntime.mockResolvedValue({
			success: true,
			stdout: "Output",
			stderr: "",
			sessionOutput: {
				isSuccess: true,
				context: "Done",
				sessionId: "test-session",
			},
		});

		const step = makeStepDef({
			name: "test-prompt",
			type: "prompt",
			prompt: "Test prompt content",
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const executor = new PromptStepExecutor();
		await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(mockRunRuntime).toHaveBeenCalledOnce();
		const callArgs = mockRunRuntime.mock.calls[0][1];
		expect(callArgs.prompt).toContain("Test prompt content");
	});

	it("should execute a prompt with variable interpolation", async () => {
		mockRunRuntime.mockResolvedValue({
			success: true,
			stdout: "Output",
			stderr: "",
			sessionOutput: {
				isSuccess: true,
				context: "Done",
				sessionId: null,
			},
		});

		const step = makeStepDef({
			name: "test-prompt",
			type: "prompt",
			prompt: "Value is {{ variables.test_var }}",
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const executor = new PromptStepExecutor();
		await executor.execute(step, progress, context, mockLogger, consoleOut);

		const callArgs = mockRunRuntime.mock.calls[0][1];
		expect(callArgs.prompt).toContain("test_value");
	});
});

describe("ConditionalStepExecutor", () => {
	it("should be instantiable", () => {
		const branchExecutor: BranchStepExecutor = vi.fn();
		const executor = new ConditionalStepExecutor(branchExecutor);
		expect(executor).toBeDefined();
	});

	it("should evaluate true condition", () => {
		const branchExecutor: BranchStepExecutor = vi.fn();
		const executor = new ConditionalStepExecutor(branchExecutor);
		const context = { variables: { enabled: true } };
		expect(executor.evaluateCondition("variables.enabled", context)).toBe(true);
	});

	it("should evaluate false condition", () => {
		const branchExecutor: BranchStepExecutor = vi.fn();
		const executor = new ConditionalStepExecutor(branchExecutor);
		const context = { variables: { enabled: false } };
		expect(executor.evaluateCondition("variables.enabled", context)).toBe(false);
	});

	it("should evaluate string comparison", () => {
		const branchExecutor: BranchStepExecutor = vi.fn();
		const executor = new ConditionalStepExecutor(branchExecutor);
		const context = { variables: { status: "active" } };
		expect(executor.evaluateCondition("variables.status == 'active'", context)).toBe(true);
	});

	it("should evaluate inequality comparison", () => {
		const branchExecutor: BranchStepExecutor = vi.fn();
		const executor = new ConditionalStepExecutor(branchExecutor);
		const context = { variables: { status: "active" } };
		expect(executor.evaluateCondition("variables.status != 'inactive'", context)).toBe(true);
	});

	it("should evaluate literal true/false", () => {
		const branchExecutor: BranchStepExecutor = vi.fn();
		const executor = new ConditionalStepExecutor(branchExecutor);
		expect(executor.evaluateCondition("true", {})).toBe(true);
		expect(executor.evaluateCondition("false", {})).toBe(false);
		expect(executor.evaluateCondition("1", {})).toBe(true);
		expect(executor.evaluateCondition("0", {})).toBe(false);
	});
});

describe("SerialStepExecutor", () => {
	it("should be instantiable", () => {
		const branchExecutor: BranchStepExecutor = vi.fn();
		const executor = new SerialStepExecutor(branchExecutor);
		expect(executor).toBeDefined();
	});

	it("should execute serial steps in order", async () => {
		const branchExecutor = vi.fn<BranchStepExecutor>().mockResolvedValue({
			success: true,
			outputSummary: "Done",
		});

		const executor = new SerialStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "inner1", type: "prompt", prompt: "Step 1" }),
			makeStepDef({ name: "inner2", type: "prompt", prompt: "Step 2" }),
		];

		const step = makeStepDef({
			name: "serial-step",
			type: "serial",
			steps: innerSteps,
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(branchExecutor).toHaveBeenCalledTimes(2);
	});

	it("should stop on first failure", async () => {
		const branchExecutor = vi
			.fn<BranchStepExecutor>()
			.mockResolvedValueOnce({ success: true, outputSummary: "Done" })
			.mockResolvedValueOnce({ success: false, error: "Failed" });

		const executor = new SerialStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "inner1", type: "prompt", prompt: "Step 1" }),
			makeStepDef({ name: "inner2", type: "prompt", prompt: "Step 2" }),
			makeStepDef({ name: "inner3", type: "prompt", prompt: "Step 3" }),
		];

		const step = makeStepDef({
			name: "serial-step",
			type: "serial",
			steps: innerSteps,
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(false);
		expect(branchExecutor).toHaveBeenCalledTimes(2);
	});

	it("should handle empty steps", async () => {
		const branchExecutor: BranchStepExecutor = vi.fn();
		const executor = new SerialStepExecutor(branchExecutor);

		const step = makeStepDef({
			name: "serial-step",
			type: "serial",
			steps: [],
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(true);
		expect(result.outputSummary).toContain("No sub-steps");
	});
});

describe("StepExecutor retry", () => {
	it("should retry on failure then succeed", async () => {
		mockRunRuntime
			.mockResolvedValueOnce({
				success: false,
				returncode: 1,
				stdout: "",
				stderr: "Error",
				sessionOutput: { isSuccess: false, context: "Failed" },
			})
			.mockResolvedValueOnce({
				success: true,
				stdout: "Output",
				stderr: "",
				sessionOutput: { isSuccess: true, context: "Done", sessionId: null },
			});

		const step = makeStepDef({
			name: "test-prompt",
			type: "prompt",
			prompt: "Test",
			stepMaxRetry: 2,
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const executor = new PromptStepExecutor();
		await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(mockRunRuntime).toHaveBeenCalledTimes(2);
	});
});

describe("ParallelStepExecutor", () => {
	it("should execute all branches exactly once with queue-based concurrency", async () => {
		const executedBranches: string[] = [];
		const branchExecutor = vi.fn<BranchStepExecutor>(async (step) => {
			executedBranches.push(step.name);
			return { success: true, outputSummary: `Done ${step.name}` };
		});

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "branch-a", type: "prompt", prompt: "A" }),
			makeStepDef({ name: "branch-b", type: "prompt", prompt: "B" }),
			makeStepDef({ name: "branch-c", type: "prompt", prompt: "C" }),
			makeStepDef({ name: "branch-d", type: "prompt", prompt: "D" }),
			makeStepDef({ name: "branch-e", type: "prompt", prompt: "E" }),
		];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
			mergeStrategy: "wait-all",
		});

		const context = createStepContext({
			config: { defaults: {}, execution: { maxWorkers: 2 } },
		});
		const progress = createProgress("test-wf", "test-workflow", ["parallel-step"], {});
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(true);
		// Every branch must execute exactly once
		expect(executedBranches.sort()).toEqual([
			"branch-a",
			"branch-b",
			"branch-c",
			"branch-d",
			"branch-e",
		]);
		expect(branchExecutor).toHaveBeenCalledTimes(5);
	});

	it("should call updateStepCompleted for non-wait-all merge strategy", async () => {
		const branchExecutor = vi.fn<BranchStepExecutor>(async () => {
			return { success: true, outputSummary: "Done" };
		});

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [makeStepDef({ name: "branch-a", type: "prompt", prompt: "A" })];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
			mergeStrategy: "first-success" as StepDefinition["mergeStrategy"],
		});

		const context = createStepContext();
		const progress = createProgress("test-wf", "test-workflow", ["parallel-step"], {});
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(true);
		// currentStep should be cleared by updateStepCompleted
		expect(progress.currentStep).toBeNull();
		// Step should appear in completedSteps
		expect(progress.completedSteps.some((s) => s.name === "parallel-step")).toBe(true);
	});

	it("should handle empty steps", async () => {
		const branchExecutor: BranchStepExecutor = vi.fn();
		const executor = new ParallelStepExecutor(branchExecutor);

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: [],
		});

		const context = createStepContext();
		const progress = createProgress("test-wf", "test-workflow", ["parallel-step"], {});
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(true);
		expect(result.outputSummary).toContain("No sub-steps");
	});

	it("should track failed branches in wait-all strategy", async () => {
		const branchExecutor = vi.fn<BranchStepExecutor>(async (step) => {
			if (step.name === "branch-b") {
				return { success: false, error: "Branch B failed" };
			}
			return { success: true, outputSummary: "Done" };
		});

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "branch-a", type: "prompt", prompt: "A" }),
			makeStepDef({ name: "branch-b", type: "prompt", prompt: "B" }),
		];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
			mergeStrategy: "wait-all",
		});

		const context = createStepContext();
		const progress = createProgress("test-wf", "test-workflow", ["parallel-step"], {});
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(false);
		expect(result.error).toContain("branch-b");
	});
});
