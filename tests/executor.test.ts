/** Tests for workflow executor. */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowParser } from "../src/parser.js";
import { WORKFLOW_STATUS } from "../src/progress.js";
import { resolveModel } from "../src/steps/base.js";

// Mock PromptStepExecutor.execute at module level
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

// Mock runRuntime (executor uses runRuntime via PromptStepExecutor)
vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return {
		...original,
		runRuntime: vi.fn().mockResolvedValue({
			success: true,
			stdout: "ok",
			stderr: "",
			returncode: 0,
			sessionOutput: { sessionId: null, isSuccess: true, context: "done" },
		}),
	};
});

// Mock git worktree operations
const mockCreateWorktree = vi.fn();
const mockRemoveWorktree = vi.fn();
const mockSafetyCommit = vi.fn();
vi.mock("../src/git/worktree.js", () => ({
	copyLocalDirs: vi.fn(),
	createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
	findExistingWorktree: vi.fn().mockReturnValue(null),
	removeWorktree: (...args: unknown[]) => mockRemoveWorktree(...args),
	safetyCommit: (...args: unknown[]) => mockSafetyCommit(...args),
	pruneOrphaned: vi.fn(),
}));

// Mock getWorktreeOutputRoot so worktree-enabled tests don't write to global %APPDATA%
const mockGetWorktreeOutputRoot = vi.fn();
vi.mock("../src/paths.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/paths.js")>();
	return {
		...original,
		getWorktreeOutputRoot: (...args: unknown[]) => mockGetWorktreeOutputRoot(...args),
	};
});

const { WorkflowExecutor } = await import("../src/executor.js");

// --- Helpers ---

let tempDir: string;

beforeEach(() => {
	vi.clearAllMocks();
	mockPromptExecute.mockResolvedValue({ success: true, outputSummary: "done" });
	mockSafetyCommit.mockReturnValue({ committed: false, failed: false });
	tempDir = mkdtempSync(path.join(os.tmpdir(), "executor-test-"));
	// Redirect worktree output root to temp dir so tests don't pollute global %APPDATA%
	mockGetWorktreeOutputRoot.mockReturnValue(path.join(tempDir, "agentic", "outputs"));
	// Create local config so output goes to tempDir/agentic/outputs/ (predictable for tests)
	mkdirSync(path.join(tempDir, "agentic"), { recursive: true });
	writeFileSync(
		path.join(tempDir, "agentic", "config.json"),
		JSON.stringify({ outputDirectory: "local" }),
		"utf-8",
	);
});

const sampleWorkflowYaml = `
name: test-workflow
version: "1.0"
description: Test workflow
steps:
  - name: test-step
    type: prompt
    prompt: "Hello"
`;

// --- TestWorkflowExecutor ---

describe("WorkflowExecutor", () => {
	it("initializes correctly", () => {
		const executor = new WorkflowExecutor(tempDir);

		expect(executor.repoRoot).toBe(tempDir);
		expect(executor.config).toBeTruthy();
		expect(executor.renderer).toBeTruthy();
	});

	it("initializes all step executors", () => {
		const executor = new WorkflowExecutor(tempDir);

		expect(executor.executors.prompt).toBeTruthy();
		expect(executor.executors.parallel).toBeTruthy();
		expect(executor.executors.serial).toBeTruthy();
		expect(executor.executors.conditional).toBeTruthy();
		expect(executor.executors["ralph-loop"]).toBeTruthy();
	});

	it("uses cwd when no root specified", () => {
		const originalCwd = process.cwd();
		try {
			process.chdir(tempDir);
			const executor = new WorkflowExecutor();
			expect(executor.repoRoot).toBe(tempDir);
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("accepts runtimeOverride as third constructor parameter", () => {
		const executor = new WorkflowExecutor(tempDir, false, "codex");
		expect(executor.runtimeOverride).toBe("codex");
	});

	it("defaults runtimeOverride to null when not provided", () => {
		const executor = new WorkflowExecutor(tempDir);
		expect(executor.runtimeOverride).toBeNull();
	});
});

// --- TestWorkflowExecutorRun ---

describe("WorkflowExecutor.run", () => {
	it("runs a minimal workflow", async () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(sampleWorkflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow);

		expect(progress.workflowName).toBe("test-workflow");
		expect(progress.status).toBe(WORKFLOW_STATUS.COMPLETED);
	});

	it("keeps settings.model in the workflow runtime namespace under --runtime override", async () => {
		const workflowYaml = `
name: runtime-override-test
version: "1.0"
description: Claude workflow invoked with --runtime codex
settings:
  runtime: claude
  model: haiku
steps:
  - name: test
    type: prompt
    prompt: "Hello"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		// Isolate the global config so a user-level codex.model does not answer for
		// the fallback this test is asserting on.
		const savedAppdata = process.env.APPDATA;
		const savedXdgConfig = process.env.XDG_CONFIG_HOME;
		process.env.APPDATA = tempDir;
		process.env.XDG_CONFIG_HOME = tempDir;
		try {
			const executor = new WorkflowExecutor(tempDir, false, "codex");
			await executor.run(workflow);

			// The step runs on codex, but settings.model ("haiku") belongs to the
			// claude namespace and must not be forwarded to it.
			const context = mockPromptExecute.mock.calls[0][2] as {
				workflowRuntimeId: string;
				runtimeAdapter: { id: string };
			};
			expect(context.runtimeAdapter.id).toBe("codex");
			expect(context.workflowRuntimeId).toBe("claude");
			expect(resolveModel(context as never, null)).toBeNull();
		} finally {
			process.env.APPDATA = savedAppdata;
			process.env.XDG_CONFIG_HOME = savedXdgConfig;
		}
	});

	it("creates progress file", async () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(sampleWorkflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow);

		const progressDir = path.join(tempDir, "agentic", "outputs", progress.workflowId);
		expect(existsSync(progressDir)).toBe(true);
		expect(existsSync(path.join(progressDir, "progress.json"))).toBe(true);
	});

	it("runs with custom variables", async () => {
		const workflowYaml = `
name: variable-test
version: "1.0"
description: Test with variables
variables:
  - name: custom_var
    type: string
    default: default_value
steps:
  - name: test
    type: prompt
    prompt: "{{ variables.custom_var }}"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow, { custom_var: "custom_value" });

		expect(progress.variables.custom_var).toBe("custom_value");
	});

	it("uses default variable values", async () => {
		const workflowYaml = `
name: default-var-test
version: "1.0"
description: Test with default variables
variables:
  - name: my_var
    type: string
    default: the_default
steps:
  - name: test
    type: prompt
    prompt: "Test"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow);

		expect(progress.variables.my_var).toBe("the_default");
	});

	it("raises for missing required variable", async () => {
		const workflowYaml = `
name: required-var-test
version: "1.0"
description: Test with required variable
variables:
  - name: required_var
    type: string
    required: true
steps:
  - name: test
    type: prompt
    prompt: "Test"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);

		await expect(executor.run(workflow)).rejects.toThrow("Missing required variable");
	});

	it("runs from a specific step", async () => {
		const workflowYaml = `
name: multi-step
version: "1.0"
description: Multi-step workflow
steps:
  - name: step1
    type: prompt
    prompt: "Step 1"
  - name: step2
    type: prompt
    prompt: "Step 2"
  - name: step3
    type: prompt
    prompt: "Step 3"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow, undefined, "step2");

		expect(progress.status).toBe(WORKFLOW_STATUS.COMPLETED);
		// step1 skipped, step2 and step3 executed
		expect(mockPromptExecute).toHaveBeenCalledTimes(2);
	});

	it("sets terminal output level correctly", async () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(sampleWorkflowYaml);

		const executor = new WorkflowExecutor(tempDir);

		const progress1 = await executor.run(workflow, undefined, null, "base");
		expect(progress1).toBeTruthy();

		mockPromptExecute.mockClear();

		const progress2 = await executor.run(workflow, undefined, null, "all");
		expect(progress2).toBeTruthy();
	});
});

// --- TestWorkflowExecutorStepDispatch ---

describe("WorkflowExecutor step dispatch", () => {
	it("dispatches prompt step to correct executor", async () => {
		const workflowYaml = `
name: prompt-dispatch
version: "1.0"
description: Test prompt dispatch
steps:
  - name: test-prompt
    type: prompt
    prompt: "Test"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		await executor.run(workflow);

		expect(mockPromptExecute).toHaveBeenCalled();
	});
});

// --- TestWorkflowExecutorOutputs ---

describe("WorkflowExecutor outputs", () => {
	it("renders outputs on completion", async () => {
		// Create template directory
		const templatesDir = path.join(tempDir, "agentic", "templates");
		mkdirSync(templatesDir, { recursive: true });

		const workflowYaml = `
name: output-test
version: "1.0"
description: Test output rendering
steps: []
outputs:
  - name: test-output
    template: test-output.md.j2
    path: output.md
    when: always
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow);

		expect(progress).toBeTruthy();
		expect(progress.status).toBe(WORKFLOW_STATUS.COMPLETED);
	});
});

// --- TestWorkflowExecutorErrorHandling ---

describe("WorkflowExecutor error handling", () => {
	it("marks workflow as failed on step failure", async () => {
		mockPromptExecute.mockRejectedValue(new Error("Step execution failed"));

		const workflowYaml = `
name: failing-workflow
version: "1.0"
description: Test failure handling
steps:
  - name: failing-step
    type: prompt
    prompt: "This will fail"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow);

		expect(progress.status).toBe(WORKFLOW_STATUS.FAILED);
		expect(progress.errors.length).toBeGreaterThan(0);
	});

	it("stops execution on step failure", async () => {
		let callCount = 0;
		mockPromptExecute.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				throw new Error("First step failed");
			}
			return { success: true, outputSummary: "done" };
		});

		const workflowYaml = `
name: multi-step-fail
version: "1.0"
description: Test failure stops execution
steps:
  - name: step1
    type: prompt
    prompt: "Step 1"
  - name: step2
    type: prompt
    prompt: "Step 2"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow);

		expect(callCount).toBe(1);
		expect(progress.status).toBe(WORKFLOW_STATUS.FAILED);
	});
});

// --- Worktree lifecycle ---

describe("WorkflowExecutor worktree lifecycle", () => {
	const fakeWorktree = {
		path: "/tmp/wt-workflow",
		branch: "agentic/test-workflow-abc123",
		baseBranch: "main",
	};

	beforeEach(() => {
		mockCreateWorktree.mockReturnValue(fakeWorktree);
	});

	it("creates worktree when settings.worktree.enabled is true", async () => {
		const workflowYaml = `
name: worktree-test
version: "1.0"
description: Test worktree creation
settings:
  worktree:
    enabled: true
    cleanup: on-complete
steps:
  - name: step1
    type: prompt
    prompt: "Test"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		await executor.run(workflow);

		expect(mockCreateWorktree).toHaveBeenCalledOnce();
		expect(mockCreateWorktree).toHaveBeenCalledWith(
			expect.objectContaining({
				workflowName: "worktree-test",
				stepName: "workflow",
				repoRoot: tempDir,
			}),
		);
	});

	it("removes worktree on success with on-success cleanup", async () => {
		const workflowYaml = `
name: cleanup-test
version: "1.0"
description: Test cleanup on success
settings:
  worktree:
    enabled: true
    cleanup: on-success
steps:
  - name: step1
    type: prompt
    prompt: "Test"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow);

		expect(progress.status).toBe(WORKFLOW_STATUS.COMPLETED);
		expect(mockSafetyCommit).toHaveBeenCalledOnce();
		expect(mockRemoveWorktree).toHaveBeenCalledOnce();
	});

	it("preserves worktree on failure with on-success cleanup", async () => {
		mockPromptExecute.mockRejectedValue(new Error("Step failed"));

		const workflowYaml = `
name: preserve-test
version: "1.0"
description: Test worktree preserved on failure
settings:
  worktree:
    enabled: true
    cleanup: on-success
steps:
  - name: step1
    type: prompt
    prompt: "Test"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow);

		expect(progress.status).toBe(WORKFLOW_STATUS.FAILED);
		// on-success + workflow failed => preserve worktree
		expect(mockRemoveWorktree).not.toHaveBeenCalled();
	});

	it("always removes worktree with on-complete cleanup even on failure", async () => {
		mockPromptExecute.mockRejectedValue(new Error("Step failed"));

		const workflowYaml = `
name: on-complete-test
version: "1.0"
description: Test on-complete cleanup
settings:
  worktree:
    enabled: true
    cleanup: on-complete
steps:
  - name: step1
    type: prompt
    prompt: "Test"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		await executor.run(workflow);

		expect(mockSafetyCommit).toHaveBeenCalledOnce();
		expect(mockRemoveWorktree).toHaveBeenCalledOnce();
	});

	it("resolves worktree.enabled from template variables", async () => {
		const workflowYaml = `
name: template-enabled-test
version: "1.0"
description: Test template-driven worktree
variables:
  - name: use_worktree
    type: boolean
    default: false
settings:
  worktree:
    enabled: "{{ variables.use_worktree }}"
    cleanup: on-complete
steps:
  - name: step1
    type: prompt
    prompt: "Test"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		// With use_worktree=true: worktree should be created
		const executor = new WorkflowExecutor(tempDir);
		await executor.run(workflow, { use_worktree: true });
		expect(mockCreateWorktree).toHaveBeenCalledOnce();
		vi.clearAllMocks();
		mockPromptExecute.mockResolvedValue({ success: true, outputSummary: "done" });
		mockSafetyCommit.mockReturnValue({ committed: false, failed: false });
		mockCreateWorktree.mockReturnValue(fakeWorktree);

		// With use_worktree=false: no worktree created
		await executor.run(workflow, { use_worktree: false });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	it("does not create worktree when settings.worktree.enabled is false", async () => {
		const workflowYaml = `
name: no-worktree-test
version: "1.0"
description: No worktree
settings:
  worktree:
    enabled: false
steps:
  - name: step1
    type: prompt
    prompt: "Test"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		await executor.run(workflow);

		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	it("throws when parallel step with worktree:true is inside workflow worktree", async () => {
		const workflowYaml = `
name: nested-worktree-test
version: "1.0"
description: Nested worktree validation
settings:
  worktree:
    enabled: true
    cleanup: manual
steps:
  - name: par
    type: parallel
    worktree: true
    steps:
      - name: branch-a
        type: prompt
        prompt: "Branch A"
`;
		const parser = new WorkflowParser();
		const workflow = parser.parseString(workflowYaml);

		const executor = new WorkflowExecutor(tempDir);
		const progress = await executor.run(workflow);

		// Nested worktree throws -> step fails -> workflow fails
		expect(progress.status).toBe(WORKFLOW_STATUS.FAILED);
		const err = progress.errors[0] as Record<string, unknown>;
		expect(String(err.error ?? err)).toContain("parallel worktree is not supported");
	});
});
