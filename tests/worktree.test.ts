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
import { resolveStepWorktree, resolveWorktreeEnabled } from "../src/worktree-settings.js";

// Mock the worktree module for parallel step tests
const mockCreateWorktree = vi.fn();
const mockRemoveWorktree = vi.fn();
const mockSafetyCommit = vi.fn();

vi.mock("../src/git/worktree.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/git/worktree.js")>();
	return {
		...original,
		createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
		removeWorktree: (...args: unknown[]) => mockRemoveWorktree(...args),
		safetyCommit: (...args: unknown[]) => mockSafetyCommit(...args),
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
		worktree: {
			enabled: false,
			location: "sibling",
			directory: null,
			cleanup: "on-success",
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
	// Default safetyCommit to return clean (no commit needed)
	mockSafetyCommit.mockReturnValue({ committed: false, failed: false });
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
		expect(result.outputSummary).toContain("2 branches");
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	it("should handle branch failures", async () => {
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
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		const result = await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(result.success).toBe(false);
		expect(result.error).toContain("branch-b");
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

	it("should create worktrees when step.worktree is true", async () => {
		const fakeWorktree = {
			path: "/tmp/wt-branch-a",
			branch: "agentic/branch-a",
			baseBranch: "main",
		};
		mockCreateWorktree.mockReturnValue(fakeWorktree);

		const branchExecutor = vi.fn<BranchStepExecutor>().mockResolvedValue({
			success: true,
			outputSummary: "Done",
		});

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" })];

		const step = makeStepDef({
			name: "parallel-step",
			type: "parallel",
			steps: innerSteps,
			worktree: true,
		});

		const context = createStepContext();
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		await executor.execute(step, progress, context, mockLogger, consoleOut);

		expect(mockCreateWorktree).toHaveBeenCalledOnce();
		expect(mockCreateWorktree).toHaveBeenCalledWith(
			expect.objectContaining({
				workflowName: "test-workflow",
				stepName: "branch-a",
			}),
		);
	});

	it("cleanup on-success: removes successful worktrees, preserves failed ones", async () => {
		const wtA = { path: "/tmp/wt-a", branch: "agentic/a", baseBranch: "main" };
		const wtB = { path: "/tmp/wt-b", branch: "agentic/b", baseBranch: "main" };
		mockCreateWorktree.mockReturnValueOnce(wtA).mockReturnValueOnce(wtB);

		const branchExecutor = vi
			.fn<BranchStepExecutor>()
			.mockResolvedValueOnce({ success: true, outputSummary: "Done" })
			.mockResolvedValueOnce({ success: false, error: "Branch B failed" });

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" }),
			makeStepDef({ name: "branch-b", type: "prompt", prompt: "Task B" }),
		];
		const step = makeStepDef({ name: "par", type: "parallel", steps: innerSteps, worktree: true });
		const context = createStepContext({
			workflowSettings: {
				...defaultSettings(),
				worktree: { enabled: true, location: "sibling", directory: null, cleanup: "on-success" },
			},
		});
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		await executor.execute(step, progress, context, mockLogger, consoleOut);

		// branch-a succeeded: should be removed; branch-b failed: should be preserved
		expect(mockRemoveWorktree).toHaveBeenCalledOnce();
		expect(mockRemoveWorktree).toHaveBeenCalledWith(wtA, expect.anything(), false);
		expect(mockSafetyCommit).toHaveBeenCalledOnce();
	});

	it("cleanup on-complete: removes all worktrees regardless of outcome", async () => {
		const wtA = { path: "/tmp/wt-a", branch: "agentic/a", baseBranch: "main" };
		const wtB = { path: "/tmp/wt-b", branch: "agentic/b", baseBranch: "main" };
		mockCreateWorktree.mockReturnValueOnce(wtA).mockReturnValueOnce(wtB);

		const branchExecutor = vi
			.fn<BranchStepExecutor>()
			.mockResolvedValueOnce({ success: true, outputSummary: "Done" })
			.mockResolvedValueOnce({ success: false, error: "Branch B failed" });

		const executor = new ParallelStepExecutor(branchExecutor);
		const innerSteps = [
			makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" }),
			makeStepDef({ name: "branch-b", type: "prompt", prompt: "Task B" }),
		];
		const step = makeStepDef({ name: "par", type: "parallel", steps: innerSteps, worktree: true });
		const context = createStepContext({
			workflowSettings: {
				...defaultSettings(),
				worktree: { enabled: true, location: "sibling", directory: null, cleanup: "on-complete" },
			},
		});
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		await executor.execute(step, progress, context, mockLogger, consoleOut);

		// Both worktrees should be removed
		expect(mockRemoveWorktree).toHaveBeenCalledTimes(2);
		expect(mockSafetyCommit).toHaveBeenCalledTimes(2);
	});

	it("cleanup manual: preserves all worktrees", async () => {
		const wt = { path: "/tmp/wt-a", branch: "agentic/a", baseBranch: "main" };
		mockCreateWorktree.mockReturnValue(wt);

		const branchExecutor = vi
			.fn<BranchStepExecutor>()
			.mockResolvedValue({ success: true, outputSummary: "Done" });

		const executor = new ParallelStepExecutor(branchExecutor);
		const step = makeStepDef({
			name: "par",
			type: "parallel",
			steps: [makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" })],
			worktree: true,
		});
		const context = createStepContext({
			workflowSettings: {
				...defaultSettings(),
				worktree: { enabled: true, location: "sibling", directory: null, cleanup: "manual" },
			},
		});
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		await executor.execute(step, progress, context, mockLogger, consoleOut);

		// Manual: no removal
		expect(mockRemoveWorktree).not.toHaveBeenCalled();
		expect(mockSafetyCommit).not.toHaveBeenCalled();
	});

	it("safety commit failure preserves worktree", async () => {
		const wt = { path: "/tmp/wt-a", branch: "agentic/a", baseBranch: "main" };
		mockCreateWorktree.mockReturnValue(wt);
		mockSafetyCommit.mockReturnValue({ committed: false, failed: true, error: "no identity" });

		const branchExecutor = vi
			.fn<BranchStepExecutor>()
			.mockResolvedValue({ success: true, outputSummary: "Done" });
		const executor = new ParallelStepExecutor(branchExecutor);
		const step = makeStepDef({
			name: "par",
			type: "parallel",
			steps: [makeStepDef({ name: "branch-a", type: "prompt", prompt: "Task A" })],
			worktree: true,
		});
		const context = createStepContext({
			workflowSettings: {
				...defaultSettings(),
				worktree: { enabled: true, location: "sibling", directory: null, cleanup: "on-success" },
			},
		});
		const progress = createWorkflowProgress();
		const consoleOut = new ConsoleOutput(createMockStream());

		await executor.execute(step, progress, context, mockLogger, consoleOut);

		// Safety commit failed: worktree should NOT be removed
		expect(mockSafetyCommit).toHaveBeenCalledOnce();
		expect(mockRemoveWorktree).not.toHaveBeenCalled();
	});
});

// --- resolveWorktreeEnabled / resolveStepWorktree ---

describe("resolveWorktreeEnabled", () => {
	const renderer = new TemplateRenderer();

	it("returns false when enabled is false", () => {
		const settings = {
			enabled: false,
			location: "sibling" as const,
			directory: null,
			cleanup: "on-success" as const,
		};
		expect(resolveWorktreeEnabled(settings, renderer, {})).toBe(false);
	});

	it("returns true when enabled is true", () => {
		const settings = {
			enabled: true,
			location: "sibling" as const,
			directory: null,
			cleanup: "on-success" as const,
		};
		expect(resolveWorktreeEnabled(settings, renderer, {})).toBe(true);
	});

	it("resolves template string from variables", () => {
		const settings = {
			enabled: "{{ variables.use_worktree }}",
			location: "sibling" as const,
			directory: null,
			cleanup: "on-success" as const,
		};
		expect(resolveWorktreeEnabled(settings, renderer, { use_worktree: true })).toBe(true);
		expect(resolveWorktreeEnabled(settings, renderer, { use_worktree: false })).toBe(false);
	});

	it("resolves plain string 'true'", () => {
		const settings = {
			enabled: "true",
			location: "sibling" as const,
			directory: null,
			cleanup: "on-success" as const,
		};
		expect(resolveWorktreeEnabled(settings, renderer, {})).toBe(true);
	});

	it("resolves plain string 'false'", () => {
		const settings = {
			enabled: "false",
			location: "sibling" as const,
			directory: null,
			cleanup: "on-success" as const,
		};
		expect(resolveWorktreeEnabled(settings, renderer, {})).toBe(false);
	});
});

describe("resolveStepWorktree", () => {
	const renderer = new TemplateRenderer();

	it("returns false for null", () => {
		expect(resolveStepWorktree(null, renderer, {})).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(resolveStepWorktree(undefined, renderer, {})).toBe(false);
	});

	it("returns true for boolean true", () => {
		expect(resolveStepWorktree(true, renderer, {})).toBe(true);
	});

	it("returns false for boolean false", () => {
		expect(resolveStepWorktree(false, renderer, {})).toBe(false);
	});

	it("resolves template string from variables", () => {
		expect(resolveStepWorktree("{{ variables.use_wt }}", renderer, { use_wt: true })).toBe(true);
		expect(resolveStepWorktree("{{ variables.use_wt }}", renderer, { use_wt: false })).toBe(false);
	});

	it("resolves plain string 'true'", () => {
		expect(resolveStepWorktree("true", renderer, {})).toBe(true);
	});
});
