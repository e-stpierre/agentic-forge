/** Tests for workflow executor. */

import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowParser } from "../src/parser.js";
import { WORKFLOW_STATUS } from "../src/progress.js";

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

// Mock runClaude
vi.mock("../src/runner.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/runner.js")>();
	return {
		...original,
		runClaude: vi.fn().mockResolvedValue({
			success: true,
			stdout: "ok",
			stderr: "",
			returncode: 0,
		}),
	};
});

const { WorkflowExecutor } = await import("../src/executor.js");

// --- Helpers ---

let tempDir: string;

beforeEach(() => {
	vi.clearAllMocks();
	mockPromptExecute.mockResolvedValue({ success: true, outputSummary: "done" });
	tempDir = mkdtempSync(path.join(os.tmpdir(), "executor-test-"));
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
