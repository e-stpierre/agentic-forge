/** Tests for run command variable parsing and interactive prompt fallback. */

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliExitError, parseVars } from "../src/commands/run.js";
import { generateWorkflowId } from "../src/progress.js";

// Top-level mock so it's properly hoisted
const mockExecutorRun = vi.fn();
vi.mock("../src/executor.js", () => ({
	WorkflowExecutor: class {
		run = mockExecutorRun;
	},
}));

const mockConfirm = vi.fn();
const mockInput = vi.fn();
vi.mock("@inquirer/confirm", () => ({
	default: (...args: unknown[]) => mockConfirm(...args),
}));
vi.mock("@inquirer/input", () => ({
	default: (...args: unknown[]) => mockInput(...args),
}));

// --- parseVars unit tests ---

describe("parseVars", () => {
	it("parses bare key=value args", () => {
		const result = parseVars(["task=Hello", "create_pr=true"]);
		expect(result).toEqual({ task: "Hello", create_pr: "true" });
	});

	it("parses --var flag strings", () => {
		const result = parseVars(undefined, ["task=Hello", "count=5"]);
		expect(result).toEqual({ task: "Hello", count: "5" });
	});

	it("--var overrides bare arg for same key", () => {
		const result = parseVars(["task=bare-value"], ["task=flag-value"]);
		expect(result).toEqual({ task: "flag-value" });
	});

	it("merges bare args and --var flags without conflict", () => {
		const result = parseVars(["a=1", "b=2"], ["c=3"]);
		expect(result).toEqual({ a: "1", b: "2", c: "3" });
	});

	it("throws CliExitError on bare arg without equals sign", () => {
		expect(() => parseVars(["invalid"])).toThrow(CliExitError);
		expect(() => parseVars(["invalid"])).toThrow("Invalid variable format: invalid");
	});

	it("throws CliExitError on --var without equals sign", () => {
		expect(() => parseVars(undefined, ["noequalssign"])).toThrow(CliExitError);
		expect(() => parseVars(undefined, ["noequalssign"])).toThrow(
			"Invalid variable format: noequalssign",
		);
	});

	it("allows empty value (key=)", () => {
		const result = parseVars(["key="]);
		expect(result).toEqual({ key: "" });
	});

	it("allows value containing equals sign (key=a=b)", () => {
		const result = parseVars(["key=a=b"]);
		expect(result).toEqual({ key: "a=b" });
	});

	it("returns empty object when no args provided", () => {
		expect(parseVars()).toEqual({});
		expect(parseVars([], [])).toEqual({});
	});

	it("handles value with spaces", () => {
		const result = parseVars(["task=Hello world"]);
		expect(result).toEqual({ task: "Hello world" });
	});
});

// --- Helper to write a temp workflow ---

function writeTempWorkflow(tempDir: string, name: string, yaml: string): string {
	const filePath = path.join(tempDir, `${name}.yaml`);
	writeFileSync(filePath, yaml);
	return filePath;
}

// --- generateWorkflowId slug tests ---

describe("generateWorkflowId with slug", () => {
	it("uses slug as the workflow ID when provided", () => {
		const id = generateWorkflowId("my-workflow", "my-slug");
		expect(id).toBe("my-slug");
	});

	it("sanitizes the slug", () => {
		const id = generateWorkflowId("demo", "Hello World!");
		expect(id).toBe("hello-world");
	});

	it("generates ID without slug when not provided", () => {
		const id = generateWorkflowId("my-workflow");
		expect(id).toMatch(/^\d{8}-\d{6}-my-workflow$/);
	});
});

// --- cmdRun non-interactive error path tests ---

describe("cmdRun non-interactive mode", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "run-test-"));
		mockExecutorRun.mockResolvedValue({
			status: "completed",
			workflowId: "test-id",
			workflowName: "test-workflow",
			variables: {},
			errors: [],
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("throws CliExitError when required variable is missing in non-interactive mode", async () => {
		const workflowPath = writeTempWorkflow(
			tempDir,
			"required-var",
			`
name: required-var-workflow
version: "1.0"
description: Workflow with required variable
variables:
  - name: task
    type: string
    required: true
    description: The task to perform
steps:
  - name: test
    type: prompt
    prompt: "{{ variables.task }}"
`,
		);

		const { cmdRun } = await import("../src/commands/run.js");

		const err = await cmdRun({
			workflow: workflowPath,
			interactive: false,
		}).catch((e) => e);

		expect(err).toBeInstanceOf(CliExitError);
		expect(err.message).toContain("Missing required variable: task");
		expect(err.message).toContain("Description: The task to perform");
	});

	it("shows usage hint in error message for missing required variable", async () => {
		const workflowPath = writeTempWorkflow(
			tempDir,
			"hint-test",
			`
name: hint-test-workflow
version: "1.0"
description: Test usage hint
variables:
  - name: my_var
    type: string
    required: true
steps:
  - name: test
    type: prompt
    prompt: "{{ variables.my_var }}"
`,
		);

		const { cmdRun } = await import("../src/commands/run.js");

		const err = await cmdRun({
			workflow: workflowPath,
			interactive: false,
		}).catch((e) => e);

		expect(err).toBeInstanceOf(CliExitError);
		expect(err.message).toContain("my_var");
		expect(err.message).toContain("agentic-forge run");
	});

	it("does not throw when all required variables are provided via bareVars", async () => {
		const workflowPath = writeTempWorkflow(
			tempDir,
			"all-vars-provided",
			`
name: all-vars-provided
version: "1.0"
description: All variables provided test
variables:
  - name: task
    type: string
    required: true
steps:
  - name: test
    type: prompt
    prompt: "{{ variables.task }}"
`,
		);

		const { cmdRun } = await import("../src/commands/run.js");

		await cmdRun({
			workflow: workflowPath,
			bareVars: ["task=hello"],
			interactive: false,
		});
	});

	it("does not error for optional variables when not provided", async () => {
		const workflowPath = writeTempWorkflow(
			tempDir,
			"optional-vars",
			`
name: optional-vars-workflow
version: "1.0"
description: Optional variable test
variables:
  - name: optional_var
    type: string
    required: false
steps:
  - name: test
    type: prompt
    prompt: "Test"
`,
		);

		const { cmdRun } = await import("../src/commands/run.js");

		await cmdRun({
			workflow: workflowPath,
			interactive: false,
		});
	});
});

// --- cmdRun interactive prompt tests ---

describe("cmdRun interactive mode", () => {
	let tempDir: string;
	const originalIsTTY = process.stdin.isTTY;

	beforeEach(() => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "run-test-interactive-"));
		mockExecutorRun.mockResolvedValue({
			status: "completed",
			workflowId: "test-id",
			workflowName: "test-workflow",
			variables: {},
			errors: [],
		});
		mockConfirm.mockReset();
		mockInput.mockReset();
		// Simulate TTY for interactive tests
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
	});

	afterEach(() => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalIsTTY,
			configurable: true,
		});
		vi.restoreAllMocks();
	});

	it("prompts for missing required string variable with input()", async () => {
		mockInput.mockResolvedValue("user-provided-value");

		const workflowPath = writeTempWorkflow(
			tempDir,
			"interactive-string",
			`
name: interactive-string
version: "1.0"
description: Interactive string test
variables:
  - name: task
    type: string
    required: true
    description: The task to perform
steps:
  - name: test
    type: prompt
    prompt: "{{ variables.task }}"
`,
		);

		const { cmdRun } = await import("../src/commands/run.js");

		await cmdRun({
			workflow: workflowPath,
			interactive: true,
		});

		expect(mockInput).toHaveBeenCalledWith({ message: "The task to perform:" });
		expect(mockExecutorRun).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ task: "user-provided-value" }),
			null,
			"base",
			expect.any(String),
			null,
			undefined,
		);
	});

	it("prompts for missing required boolean variable with confirm()", async () => {
		mockConfirm.mockResolvedValue(true);

		const workflowPath = writeTempWorkflow(
			tempDir,
			"interactive-bool",
			`
name: interactive-bool
version: "1.0"
description: Interactive boolean test
variables:
  - name: create_pr
    type: boolean
    required: true
    description: Create a pull request?
steps:
  - name: test
    type: prompt
    prompt: "{{ variables.create_pr }}"
`,
		);

		const { cmdRun } = await import("../src/commands/run.js");

		await cmdRun({
			workflow: workflowPath,
			interactive: true,
		});

		expect(mockConfirm).toHaveBeenCalledWith({
			message: "Create a pull request?:",
			default: false,
		});
		expect(mockExecutorRun).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ create_pr: "true" }),
			null,
			"base",
			expect.any(String),
			null,
			undefined,
		);
	});

	it("uses variable name as label when description is absent", async () => {
		mockInput.mockResolvedValue("val");

		const workflowPath = writeTempWorkflow(
			tempDir,
			"interactive-no-desc",
			`
name: interactive-no-desc
version: "1.0"
description: No description test
variables:
  - name: my_var
    type: string
    required: true
steps:
  - name: test
    type: prompt
    prompt: "{{ variables.my_var }}"
`,
		);

		const { cmdRun } = await import("../src/commands/run.js");

		await cmdRun({
			workflow: workflowPath,
			interactive: true,
		});

		expect(mockInput).toHaveBeenCalledWith({ message: "my_var:" });
	});

	it("does not prompt for variables already provided", async () => {
		const workflowPath = writeTempWorkflow(
			tempDir,
			"interactive-provided",
			`
name: interactive-provided
version: "1.0"
description: Provided variable test
variables:
  - name: task
    type: string
    required: true
steps:
  - name: test
    type: prompt
    prompt: "{{ variables.task }}"
`,
		);

		const { cmdRun } = await import("../src/commands/run.js");

		await cmdRun({
			workflow: workflowPath,
			bareVars: ["task=already-set"],
			interactive: true,
		});

		expect(mockInput).not.toHaveBeenCalled();
		expect(mockConfirm).not.toHaveBeenCalled();
	});

	it("does not prompt for required variables with defaults", async () => {
		const workflowPath = writeTempWorkflow(
			tempDir,
			"interactive-default",
			`
name: interactive-default
version: "1.0"
description: Default value test
variables:
  - name: task
    type: string
    required: true
    default: fallback-value
steps:
  - name: test
    type: prompt
    prompt: "{{ variables.task }}"
`,
		);

		const { cmdRun } = await import("../src/commands/run.js");

		await cmdRun({
			workflow: workflowPath,
			interactive: true,
		});

		expect(mockInput).not.toHaveBeenCalled();
		expect(mockConfirm).not.toHaveBeenCalled();
	});
});
