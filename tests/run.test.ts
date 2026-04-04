/** Tests for run command variable parsing and interactive prompt fallback. */

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseVars } from "../src/commands/run.js";

// Top-level mock so it's properly hoisted
const mockExecutorRun = vi.fn();
vi.mock("../src/executor.js", () => ({
	WorkflowExecutor: class {
		run = mockExecutorRun;
	},
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

	it("throws on bare arg without equals sign", () => {
		expect(() => parseVars(["invalid"])).toThrow("Invalid variable format: invalid");
	});

	it("throws on --var without equals sign", () => {
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

// --- cmdRun non-interactive error path tests ---

describe("cmdRun non-interactive mode", () => {
	let tempDir: string;
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "run-test-"));
		mockExecutorRun.mockResolvedValue({
			status: "completed",
			workflowId: "test-id",
			workflowName: "test-workflow",
			variables: {},
			errors: [],
		});

		// Mock process.exit to throw instead of actually exiting
		exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit(${code})`);
		});

		// Capture stderr output
		stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("exits with error when required variable is missing in non-interactive mode", async () => {
		const yamlContent = `
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
`;
		const workflowPath = path.join(tempDir, "required-var-workflow.yaml");
		writeFileSync(workflowPath, yamlContent);

		const { cmdRun } = await import("../src/commands/run.js");

		await expect(
			cmdRun({
				workflow: workflowPath,
				interactive: false,
			}),
		).rejects.toThrow("process.exit(1)");

		const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
		expect(stderrOutput).toContain("Missing required variable: task");
		expect(stderrOutput).toContain("Description: The task to perform");
	});

	it("shows usage hint in error message for missing required variable", async () => {
		const yamlContent = `
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
`;
		const workflowPath = path.join(tempDir, "hint-test-workflow.yaml");
		writeFileSync(workflowPath, yamlContent);

		const { cmdRun } = await import("../src/commands/run.js");

		await expect(
			cmdRun({
				workflow: workflowPath,
				interactive: false,
			}),
		).rejects.toThrow("process.exit(1)");

		const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
		expect(stderrOutput).toContain("my_var");
		expect(stderrOutput).toContain("agentic-forge run");
	});

	it("does not prompt or error when all required variables are provided via bareVars", async () => {
		const yamlContent = `
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
`;
		const workflowPath = path.join(tempDir, "all-vars-provided.yaml");
		writeFileSync(workflowPath, yamlContent);

		const { cmdRun } = await import("../src/commands/run.js");

		// Should not throw — all required vars are provided
		await cmdRun({
			workflow: workflowPath,
			bareVars: ["task=hello"],
			interactive: false,
		});

		// process.exit should not have been called
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it("does not error for optional variables when not provided", async () => {
		const yamlContent = `
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
`;
		const workflowPath = path.join(tempDir, "optional-vars-workflow.yaml");
		writeFileSync(workflowPath, yamlContent);

		const { cmdRun } = await import("../src/commands/run.js");

		// Optional variable missing — should not error or prompt
		await cmdRun({
			workflow: workflowPath,
			interactive: false,
		});

		expect(exitSpy).not.toHaveBeenCalled();
	});
});
