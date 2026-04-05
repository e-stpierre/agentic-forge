/** Tests for git worktree module and parallel step executor. */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConsoleOutput } from "../src/console.js";
import { WorkflowLogger } from "../src/logging/logger.js";
import { createProgress } from "../src/progress.js";
import { TemplateRenderer } from "../src/renderer.js";
import type { BranchStepExecutor, StepContext } from "../src/steps/base.js";
import type { StepDefinition, WorkflowProgress, WorkflowSettings } from "../src/types.js";

// Mock the worktree module for parallel step tests
const mockCreateWorktree = vi.fn();
const mockRemoveWorktree = vi.fn();
const mockRunGit = vi.fn();

vi.mock("../src/git/worktree.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/git/worktree.js")>();
	return {
		...original,
		createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
		removeWorktree: (...args: unknown[]) => mockRemoveWorktree(...args),
		runGit: (...args: unknown[]) => mockRunGit(...args),
	};
});

// Import ParallelStepExecutor after mock setup
const { ParallelStepExecutor } = await import("../src/steps/parallel-step.js");

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

let tempDir: string;
let mockLogger: WorkflowLogger;

beforeEach(() => {
	vi.clearAllMocks();
	tempDir = mkdtempSync(path.join(os.tmpdir(), "worktree-test-"));
	const logDir = path.join(tempDir, "agentic", "outputs", "test-workflow-id");
	mkdirSync(logDir, { recursive: true });
	mockLogger = new WorkflowLogger("test-workflow-id", tempDir);
});

function createStepContext(overrides?: Partial<StepContext>): StepContext {
	return {
		repoRoot: tempDir,
		config: { claude: { model: "sonnet" }, defaults: { maxRetry: 3, timeoutMinutes: 60 } },
		renderer: new TemplateRenderer(),
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

// --- Worktree name helper tests ---

describe("worktree name sanitization", () => {
	// Test the sanitization logic indirectly through createWorktree mock behavior
	// The actual sanitization is internal, so we test the exported functions

	it("should export createWorktree function", async () => {
		const mod = await import("../src/git/worktree.js");
		expect(mod.createWorktree).toBeDefined();
	});

	it("should export removeWorktree function", async () => {
		const mod = await import("../src/git/worktree.js");
		expect(mod.removeWorktree).toBeDefined();
	});

	it("should export listWorktrees function", async () => {
		const mod = await import("../src/git/worktree.js");
		expect(mod.listWorktrees).toBeDefined();
	});

	it("should export listAgenticWorktrees function", async () => {
		const mod = await import("../src/git/worktree.js");
		expect(mod.listAgenticWorktrees).toBeDefined();
	});

	it("should export pruneOrphaned function", async () => {
		const mod = await import("../src/git/worktree.js");
		expect(mod.pruneOrphaned).toBeDefined();
	});

	it("should export branch operation functions", async () => {
		const mod = await import("../src/git/worktree.js");
		expect(mod.createBranch).toBeDefined();
		expect(mod.checkoutBranch).toBeDefined();
		expect(mod.commitChanges).toBeDefined();
		expect(mod.pushBranch).toBeDefined();
	});
});

// --- ParallelStepExecutor tests ---

describe("ParallelStepExecutor", () => {
	it("should be instantiable", () => {
		const branchExecutor: BranchStepExecutor = vi.fn();
		const executor = new ParallelStepExecutor(branchExecutor);
		expect(executor).toBeDefined();
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
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(true);
		expect(result.outputSummary).toContain("No sub-steps");
		expect(branchExecutor).not.toHaveBeenCalled();
	});

	it("should execute branches in parallel without worktrees", async () => {
		const branchExecutor = vi.fn<BranchStepExecutor>().mockResolvedValue({
			success: true,
			outputSummary: "Done",
		});

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" }),
			makeStepDef({ name: "branch-b", type: "prompt", prompt: "Task B" }),
		];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(true);
		expect(branchExecutor).toHaveBeenCalledTimes(2);
		expect(result.outputSummary).toContain("2/2");
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	it("should execute branches with worktree isolation", async () => {
		const branchExecutor = vi.fn<BranchStepExecutor>().mockResolvedValue({
			success: true,
			outputSummary: "Done",
		});

		mockCreateWorktree.mockReturnValue({
			path: "/tmp/worktree-a",
			branch: "agentic/test-branch-a",
			baseBranch: "main",
		});

		mockRunGit.mockReturnValue({ stdout: "", stderr: "", returncode: 0 });

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" }),
			makeStepDef({ name: "branch-b", type: "prompt", prompt: "Task B" }),
		];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
			git: { worktree: true, autoPr: false, branchPrefix: "agentic" },
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(true);
		expect(mockCreateWorktree).toHaveBeenCalledTimes(2);
		// Merge mode is "merge" by default, so branches get merged and cleaned up
		expect(mockRunGit).toHaveBeenCalled();
		expect(mockRemoveWorktree).toHaveBeenCalled();
	});

	it("should handle branch failures with wait-all strategy", async () => {
		const branchExecutor = vi
			.fn<BranchStepExecutor>()
			.mockResolvedValueOnce({ success: true, outputSummary: "Done" })
			.mockResolvedValueOnce({ success: false, error: "Branch B failed" });

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" }),
			makeStepDef({ name: "branch-b", type: "prompt", prompt: "Task B" }),
		];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
			mergeStrategy: "wait-all",
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(false);
		expect(result.error).toContain("branch-b");
	});

	it("should tolerate failures in independent merge mode", async () => {
		const branchExecutor = vi
			.fn<BranchStepExecutor>()
			.mockResolvedValueOnce({ success: true, outputSummary: "Done" })
			.mockResolvedValueOnce({ success: false, error: "Failed" });

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" }),
			makeStepDef({ name: "branch-b", type: "prompt", prompt: "Task B" }),
		];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
			mergeStrategy: "wait-all",
			mergeMode: "independent",
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		// Independent mode tolerates failures in wait-all
		expect(result.success).toBe(true);
		expect(result.outputSummary).toContain("1/2");
		expect(result.outputSummary).toContain("failed");
	});

	it("should handle branch exceptions gracefully", async () => {
		const branchExecutor = vi
			.fn<BranchStepExecutor>()
			.mockResolvedValueOnce({ success: true, outputSummary: "Done" })
			.mockRejectedValueOnce(new Error("Unexpected error"));

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" }),
			makeStepDef({ name: "branch-b", type: "prompt", prompt: "Task B" }),
		];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		// Exception in branch-b should be caught and handled
		expect(result.success).toBe(false);
		expect(result.error).toContain("branch-b");
	});

	it("should pass cwdOverride to branch context when using worktrees", async () => {
		let capturedContext: StepContext | null = null;
		const branchExecutor = vi
			.fn<BranchStepExecutor>()
			.mockImplementation(async (_step, _progress, ctx) => {
				capturedContext = ctx;
				return { success: true, outputSummary: "Done" };
			});

		mockCreateWorktree.mockReturnValue({
			path: "/tmp/test-worktree",
			branch: "agentic/test-branch",
			baseBranch: "main",
		});
		mockRunGit.mockReturnValue({ stdout: "", stderr: "", returncode: 0 });

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" })];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
			git: { worktree: true, autoPr: false, branchPrefix: "agentic" },
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(capturedContext).not.toBeNull();
		expect((capturedContext as StepContext).cwdOverride).toBe("/tmp/test-worktree");
	});

	it("should clone variables for each branch context", async () => {
		const capturedContexts: StepContext[] = [];
		const branchExecutor = vi
			.fn<BranchStepExecutor>()
			.mockImplementation(async (_step, _progress, ctx) => {
				capturedContexts.push(ctx);
				// Mutate variables in this branch
				ctx.variables.modified = true;
				return { success: true, outputSummary: "Done" };
			});

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" }),
			makeStepDef({ name: "branch-b", type: "prompt", prompt: "Task B" }),
		];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		await executor.execute(step, progress, context, mockLogger, consoleOut);

		// Original context should not be mutated
		expect(context.variables.modified).toBeUndefined();
		// Each branch should get its own variables copy
		expect(capturedContexts).toHaveLength(2);
	});
});
