import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CompletionResult,
	buildRalphSystemMessage,
	createRalphState,
	deactivateRalphState,
	deleteRalphState,
	detectCompletionPromise,
	getRalphStatePath,
	loadRalphState,
	parseRalphState,
	updateRalphIteration,
} from "../src/ralph-loop.js";

let tempDir: string;

beforeEach(() => {
	tempDir = path.join(tmpdir(), `ralph-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// Ignore cleanup errors on Windows
	}
});

describe("getRalphStatePath", () => {
	it("follows expected format", () => {
		const result = getRalphStatePath("workflow-123", "apply-fixes", tempDir);
		const expected = path.join(
			tempDir,
			"agentic",
			"outputs",
			"workflow-123",
			"ralph-apply-fixes.md",
		);
		expect(result).toBe(expected);
	});

	it("sanitizes special characters in step name", () => {
		const result = getRalphStatePath("workflow", "step/with:special@chars", tempDir);
		const filename = path.basename(result);
		expect(filename).not.toContain("/");
		expect(filename).not.toContain(":");
		expect(filename).not.toContain("@");
	});
});

describe("createRalphState", () => {
	it("creates basic ralph state", () => {
		const state = createRalphState(
			"test-workflow",
			"apply-fixes",
			"Fix the issues",
			10,
			"FIXES_COMPLETE",
			tempDir,
		);

		expect(state.active).toBe(true);
		expect(state.iteration).toBe(1);
		expect(state.maxIterations).toBe(10);
		expect(state.completionPromise).toBe("FIXES_COMPLETE");
		expect(state.prompt).toBe("Fix the issues");
		expect(state.startedAt).toBeTruthy();
	});

	it("saves file to disk", () => {
		createRalphState("save-test", "test-step", "Test prompt", 5, "DONE", tempDir);

		const statePath = getRalphStatePath("save-test", "test-step", tempDir);
		expect(existsSync(statePath)).toBe(true);
		const content = readFileSync(statePath, "utf-8");
		expect(content).toContain("active: true");
		expect(content).toContain("iteration: 1");
	});
});

describe("loadRalphState", () => {
	it("loads existing ralph state", () => {
		createRalphState("load-test", "test-step", "Original prompt", 10, "COMPLETE", tempDir);

		const loaded = loadRalphState("load-test", "test-step", tempDir);

		expect(loaded).not.toBeNull();
		expect(loaded?.active).toBe(true);
		expect(loaded?.iteration).toBe(1);
		expect(loaded?.maxIterations).toBe(10);
		expect(loaded?.completionPromise).toBe("COMPLETE");
		expect(loaded?.prompt).toBe("Original prompt");
	});

	it("returns null for nonexistent state", () => {
		expect(loadRalphState("nonexistent", "step", tempDir)).toBeNull();
	});
});

describe("updateRalphIteration", () => {
	it("increments iteration counter", () => {
		createRalphState("update-test", "test-step", "Test", 10, "DONE", tempDir);

		const state = updateRalphIteration("update-test", "test-step", tempDir);

		expect(state).not.toBeNull();
		expect(state?.iteration).toBe(2);
	});

	it("persists iteration update to file", () => {
		createRalphState("persist-test", "test-step", "Test", 10, "DONE", tempDir);

		updateRalphIteration("persist-test", "test-step", tempDir);
		const loaded = loadRalphState("persist-test", "test-step", tempDir);

		expect(loaded).not.toBeNull();
		expect(loaded?.iteration).toBe(2);
	});

	it("returns null for nonexistent state", () => {
		expect(updateRalphIteration("nonexistent", "step", tempDir)).toBeNull();
	});
});

describe("deactivateRalphState", () => {
	it("deactivates ralph state", () => {
		createRalphState("deactivate-test", "test-step", "Test", 10, "DONE", tempDir);

		deactivateRalphState("deactivate-test", "test-step", tempDir);
		const loaded = loadRalphState("deactivate-test", "test-step", tempDir);

		expect(loaded).not.toBeNull();
		expect(loaded?.active).toBe(false);
	});
});

describe("deleteRalphState", () => {
	it("deletes ralph state file", () => {
		createRalphState("delete-test", "test-step", "Test", 10, "DONE", tempDir);

		const statePath = getRalphStatePath("delete-test", "test-step", tempDir);
		expect(existsSync(statePath)).toBe(true);

		deleteRalphState("delete-test", "test-step", tempDir);
		expect(existsSync(statePath)).toBe(false);
	});

	it("does not throw for nonexistent state", () => {
		expect(() => deleteRalphState("nonexistent", "step", tempDir)).not.toThrow();
	});
});

describe("parseRalphState", () => {
	it("parses valid markdown with frontmatter", () => {
		const content = `---
active: true
iteration: 3
max_iterations: 10
completion_promise: COMPLETE
started_at: "2026-01-11T14:30:00Z"
---

# Ralph Loop Prompt

Fix all the bugs in the codebase.
`;
		const state = parseRalphState(content);

		expect(state).not.toBeNull();
		expect(state?.active).toBe(true);
		expect(state?.iteration).toBe(3);
		expect(state?.maxIterations).toBe(10);
		expect(state?.completionPromise).toBe("COMPLETE");
		expect(state?.prompt).toBe("Fix all the bugs in the codebase.");
	});

	it("returns null for content without frontmatter", () => {
		expect(parseRalphState("Just plain text without frontmatter")).toBeNull();
	});

	it("parses incomplete frontmatter with defaults", () => {
		const content = `---
active: true
---`;
		const state = parseRalphState(content);
		expect(state).not.toBeNull();
		expect(state?.active).toBe(true);
		expect(state?.iteration).toBe(1);
		expect(state?.maxIterations).toBe(5);
	});
});

describe("detectCompletionPromise", () => {
	it("detects completion in JSON code block", () => {
		const output = `
I've completed the task.

\`\`\`json
{
  "ralph_complete": true,
  "promise": "COMPLETED"
}
\`\`\`
`;
		const result = detectCompletionPromise(output, "COMPLETED");
		expect(result.isComplete).toBe(true);
		expect(result.promiseMatched).toBe(true);
		expect(result.promiseValue).toBe("COMPLETED");
	});

	it("detects completion in plain code block", () => {
		const output = `
Done!

\`\`\`
{"ralph_complete": true, "promise": "DONE"}
\`\`\`
`;
		const result = detectCompletionPromise(output, "DONE");
		expect(result.isComplete).toBe(true);
		expect(result.promiseMatched).toBe(true);
	});

	it("detects completion in raw JSON", () => {
		const output = 'The task is done. {"ralph_complete": true, "promise": "FINISHED"}';
		const result = detectCompletionPromise(output, "FINISHED");
		expect(result.isComplete).toBe(true);
		expect(result.promiseMatched).toBe(true);
	});

	it("detects wrong promise value", () => {
		const output = `
\`\`\`json
{"ralph_complete": true, "promise": "WRONG_PROMISE"}
\`\`\`
`;
		const result = detectCompletionPromise(output, "EXPECTED_PROMISE");
		expect(result.isComplete).toBe(true);
		expect(result.promiseMatched).toBe(false);
		expect(result.promiseValue).toBe("WRONG_PROMISE");
	});

	it("detects ralph_complete: false as not complete", () => {
		const output = `
\`\`\`json
{"ralph_complete": false, "promise": "DONE"}
\`\`\`
`;
		const result = detectCompletionPromise(output, "DONE");
		expect(result.isComplete).toBe(false);
		expect(result.promiseMatched).toBe(false);
	});

	it("returns not complete for output without JSON", () => {
		const result = detectCompletionPromise("Just some regular output", "DONE");
		expect(result.isComplete).toBe(false);
		expect(result.promiseMatched).toBe(false);
		expect(result.promiseValue).toBeNull();
	});

	it("matches promise case-insensitively", () => {
		const output = '{"ralph_complete": true, "promise": "completed"}';
		const result = detectCompletionPromise(output, "COMPLETED");
		expect(result.isComplete).toBe(true);
		expect(result.promiseMatched).toBe(true);
	});

	it("handles invalid JSON gracefully", () => {
		const output = `
\`\`\`json
{invalid json here}
\`\`\`
`;
		const result = detectCompletionPromise(output, "DONE");
		expect(result.isComplete).toBe(false);
	});

	it("preserves original output in result", () => {
		const output = "Full output text here";
		const result = detectCompletionPromise(output, "DONE");
		expect(result.output).toBe(output);
	});

	it("detects failure signal in JSON code block", () => {
		const output = `
I cannot complete the task due to permission errors.

\`\`\`json
{
  "ralph_failed": true,
  "reason": "Permission denied: cannot write to file"
}
\`\`\`
`;
		const result = detectCompletionPromise(output, "COMPLETED");
		expect(result.isComplete).toBe(true);
		expect(result.isFailed).toBe(true);
		expect(result.promiseMatched).toBe(false);
		expect(result.failureReason).toBe("Permission denied: cannot write to file");
	});

	it("detects failure signal in raw JSON", () => {
		const output = 'Cannot proceed. {"ralph_failed": true, "reason": "Access denied"}';
		const result = detectCompletionPromise(output, "DONE");
		expect(result.isComplete).toBe(true);
		expect(result.isFailed).toBe(true);
		expect(result.failureReason).toBe("Access denied");
	});

	it("uses default reason for failure without reason field", () => {
		const output = '{"ralph_failed": true}';
		const result = detectCompletionPromise(output, "DONE");
		expect(result.isComplete).toBe(true);
		expect(result.isFailed).toBe(true);
		expect(result.failureReason).toBe("Unknown error");
	});

	it("prefers completion over failure when both present", () => {
		const output = `
\`\`\`json
{"ralph_complete": true, "promise": "DONE"}
\`\`\`
Also has failure:
\`\`\`json
{"ralph_failed": true, "reason": "Some error"}
\`\`\`
`;
		const result = detectCompletionPromise(output, "DONE");
		expect(result.isComplete).toBe(true);
		expect(result.promiseMatched).toBe(true);
		expect(result.isFailed).toBe(false);
	});
});

describe("buildRalphSystemMessage", () => {
	it("formats system message correctly", () => {
		const message = buildRalphSystemMessage(3, 10, "COMPLETE");
		expect(message).toContain("Iteration 3/10");
		expect(message).toContain("COMPLETE");
		expect(message).toContain("ralph_complete");
		expect(message).toContain("7 iterations remaining");
	});

	it("handles first iteration", () => {
		const message = buildRalphSystemMessage(1, 5, "DONE");
		expect(message).toContain("Iteration 1/5");
		expect(message).toContain("4 iterations remaining");
	});

	it("handles last iteration", () => {
		const message = buildRalphSystemMessage(10, 10, "FINISHED");
		expect(message).toContain("Iteration 10/10");
		expect(message).toContain("0 iterations remaining");
	});

	it("includes failure signal instructions", () => {
		const message = buildRalphSystemMessage(1, 5, "DONE");
		expect(message).toContain("ralph_failed");
		expect(message).toContain("Failure Signal");
		expect(message.toLowerCase()).toContain("permission errors");
	});
});

describe("CompletionResult", () => {
	it("supports default values", () => {
		const result: CompletionResult = {
			isComplete: false,
			promiseMatched: false,
			promiseValue: null,
			output: "test output",
			isFailed: false,
			failureReason: null,
		};

		expect(result.isComplete).toBe(false);
		expect(result.promiseMatched).toBe(false);
		expect(result.promiseValue).toBeNull();
		expect(result.output).toBe("test output");
	});

	it("supports success state", () => {
		const result: CompletionResult = {
			isComplete: true,
			promiseMatched: true,
			promiseValue: "DONE",
			output: "completed",
			isFailed: false,
			failureReason: null,
		};

		expect(result.isComplete).toBe(true);
		expect(result.promiseMatched).toBe(true);
		expect(result.promiseValue).toBe("DONE");
		expect(result.isFailed).toBe(false);
		expect(result.failureReason).toBeNull();
	});

	it("supports failure state", () => {
		const result: CompletionResult = {
			isComplete: true,
			promiseMatched: false,
			promiseValue: null,
			output: "failed output",
			isFailed: true,
			failureReason: "Permission denied",
		};

		expect(result.isComplete).toBe(true);
		expect(result.isFailed).toBe(true);
		expect(result.failureReason).toBe("Permission denied");
		expect(result.promiseMatched).toBe(false);
	});
});
