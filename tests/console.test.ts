import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	Color,
	ConsoleOutput,
	OutputLevel,
	colorize,
	extractJson,
	extractSummary,
	supportsColor,
} from "../src/console.js";

/** Create a ConsoleOutput that writes to a capturable stream. */
function createTestConsole(level: "base" | "all" = "base") {
	const stream = new PassThrough({ encoding: "utf-8" });
	let output = "";
	stream.on("data", (chunk: string) => {
		output += chunk;
	});
	const console = new ConsoleOutput(level, stream);
	return {
		console,
		getOutput: () => output,
	};
}

describe("OutputLevel", () => {
	it("has correct values", () => {
		expect(OutputLevel.BASE).toBe("base");
		expect(OutputLevel.ALL).toBe("all");
	});
});

describe("Color", () => {
	it("has ANSI escape code values", () => {
		expect(Color.RESET).toBe("\x1b[0m");
		expect(Color.BOLD).toBe("\x1b[1m");
		expect(Color.RED.startsWith("\x1b[")).toBe(true);
	});

	it("has all expected colors", () => {
		const colorNames = [
			"RESET",
			"BOLD",
			"DIM",
			"RED",
			"GREEN",
			"YELLOW",
			"BLUE",
			"MAGENTA",
			"CYAN",
			"WHITE",
			"BRIGHT_RED",
			"BRIGHT_GREEN",
			"BRIGHT_YELLOW",
			"BRIGHT_BLUE",
			"BRIGHT_CYAN",
		];
		expect(Object.keys(Color).length).toBe(colorNames.length);
	});
});

describe("colorize", () => {
	it("returns plain text when no color support", () => {
		// In test environment, stdout is not a TTY so colors are stripped
		const result = colorize("test", Color.RED);
		expect(result).toBe("test");
	});
});

describe("ConsoleOutput", () => {
	it("defaults to BASE level", () => {
		const { console: c } = createTestConsole();
		expect(c.level).toBe(OutputLevel.BASE);
	});

	it("accepts custom level", () => {
		const { console: c } = createTestConsole("all");
		expect(c.level).toBe(OutputLevel.ALL);
	});

	it("writes to custom stream", () => {
		const { console: c, getOutput } = createTestConsole();
		c.info("test message");
		expect(getOutput()).toContain("test message");
	});

	it("prints workflow start message", () => {
		const { console: c, getOutput } = createTestConsole();
		c.workflowStart("test-workflow", "workflow-123");
		const output = getOutput();
		expect(output).toContain("test-workflow");
		expect(output).toContain("workflow-123");
	});

	it("prints workflow complete success", () => {
		const { console: c, getOutput } = createTestConsole();
		c.workflowComplete("test-workflow", "completed");
		expect(getOutput()).toContain("COMPLETED");
	});

	it("prints workflow complete failure", () => {
		const { console: c, getOutput } = createTestConsole();
		c.workflowComplete("test-workflow", "failed");
		expect(getOutput()).toContain("FAILED");
	});

	it("prints step start message", () => {
		const { console: c, getOutput } = createTestConsole();
		c.stepStart("analyze-bugs", "prompt");
		const output = getOutput();
		expect(output).toContain("analyze-bugs");
		expect(output).toContain("prompt");
	});

	it("prints step complete message", () => {
		const { console: c, getOutput } = createTestConsole();
		c.stepComplete("test-step", "Task completed");
		const output = getOutput();
		expect(output).toContain("test-step");
		expect(output).toContain("OK");
		expect(output).toContain("Task completed");
	});

	it("prints step complete without summary", () => {
		const { console: c, getOutput } = createTestConsole();
		c.stepComplete("test-step");
		const output = getOutput();
		expect(output).toContain("test-step");
		expect(output).toContain("OK");
	});

	it("truncates long step summary", () => {
		const { console: c, getOutput } = createTestConsole();
		const longSummary = Array.from({ length: 10 }, (_, i) => `Line ${i}: ${"x".repeat(300)}`).join(
			"\n",
		);
		c.stepComplete("test-step", longSummary);
		const output = getOutput();
		expect(output).toContain("...");
		expect(output).toContain("more lines");
	});

	it("prints step failed message", () => {
		const { console: c, getOutput } = createTestConsole();
		c.stepFailed("test-step", "Something went wrong");
		const output = getOutput();
		expect(output).toContain("test-step");
		expect(output).toContain("FAIL");
		expect(output).toContain("Something went wrong");
	});

	it("prints step retry message", () => {
		const { console: c, getOutput } = createTestConsole();
		c.stepRetry("test-step", 2, 3, "Timeout");
		const output = getOutput();
		expect(output).toContain("RETRY");
		expect(output).toContain("2/3");
		expect(output).toContain("Timeout");
	});

	it("prints ralph iteration start in BASE mode", () => {
		const { console: c, getOutput } = createTestConsole("base");
		c.ralphIterationStart("apply-fixes", 3, 10);
		const output = getOutput();
		expect(output).toContain("3/10");
		expect(output).toContain("apply-fixes");
		expect(output).toContain("iteration");
	});

	it("prints ralph iteration start in ALL mode", () => {
		const { console: c, getOutput } = createTestConsole("all");
		c.ralphIterationStart("apply-fixes", 3, 10);
		const output = getOutput();
		expect(output).toContain("3/10");
		expect(output).toContain("apply-fixes");
		expect(output).toContain("iteration");
	});

	it("skips ralph iteration summary in BASE mode", () => {
		const { console: c, getOutput } = createTestConsole("base");
		c.ralphIteration("apply-fixes", 3, 10, "Fixed 2 issues");
		expect(getOutput()).toBe("");
	});

	it("prints ralph iteration summary in ALL mode", () => {
		const { console: c, getOutput } = createTestConsole("all");
		c.ralphIteration("apply-fixes", 3, 10, "Fixed 2 issues");
		expect(getOutput()).toContain("Fixed 2 issues");
	});

	it("prints ralph complete message", () => {
		const { console: c, getOutput } = createTestConsole();
		c.ralphComplete("apply-fixes", 5, 10);
		const output = getOutput();
		expect(output).toContain("OK");
		expect(output).toContain("apply-fixes");
		expect(output).toContain("5/10");
	});

	it("prints ralph max iterations message", () => {
		const { console: c, getOutput } = createTestConsole();
		c.ralphMaxIterations("apply-fixes", 10);
		const output = getOutput();
		expect(output).toContain("WARN");
		expect(output).toContain("max iterations");
		expect(output).toContain("10");
	});

	it("prints info message", () => {
		const { console: c, getOutput } = createTestConsole();
		c.info("Information message");
		const output = getOutput();
		expect(output).toContain("INFO");
		expect(output).toContain("Information message");
	});

	it("prints warning message", () => {
		const { console: c, getOutput } = createTestConsole();
		c.warning("Warning message");
		const output = getOutput();
		expect(output).toContain("WARN");
		expect(output).toContain("Warning message");
	});

	it("prints error message", () => {
		const { console: c, getOutput } = createTestConsole();
		c.error("Error message");
		const output = getOutput();
		expect(output).toContain("ERROR");
		expect(output).toContain("Error message");
	});

	it("streams assistant text in ALL mode", () => {
		const { console: c, getOutput } = createTestConsole("all");
		c.streamText("Hello\nWorld", "assistant");
		const output = getOutput();
		expect(output).toContain("Hello");
		expect(output).toContain("World");
	});

	it("streams user text in ALL mode", () => {
		const { console: c, getOutput } = createTestConsole("all");
		c.streamText("User prompt here", "user");
		const output = getOutput();
		expect(output).toContain("[user]");
		expect(output).toContain("User prompt here");
	});

	it("shows text in BASE mode with prefix", () => {
		const { console: c, getOutput } = createTestConsole("base");
		c.streamText("First line\nSecond line\nThird line");
		const output = getOutput();
		expect(output).toContain("Third line");
		expect(output).toContain("...");
		c.streamComplete();
	});

	it("skips empty text in ALL mode", () => {
		const { console: c, getOutput } = createTestConsole("all");
		c.streamText("", "assistant");
		c.streamText("   ", "assistant");
		expect(getOutput()).toBe("");
	});

	it("preserves multiline output in ALL mode", () => {
		const { console: c, getOutput } = createTestConsole("all");
		c.streamText("Line 1\nLine 2\nLine 3", "assistant");
		const output = getOutput();
		expect(output).toContain("Line 1");
		expect(output).toContain("Line 2");
		expect(output).toContain("Line 3");
	});

	it("accumulates text in BASE mode", () => {
		const { console: c, getOutput } = createTestConsole("base");
		c.streamText("Hello ");
		c.streamText("world");
		expect(c._baseAccumulatedText).toContain("Hello world");
		const output = getOutput();
		expect(output).toContain("Hello");
		expect(output).toContain("world");
		c.streamComplete();
	});

	it("resets accumulated text on stream_complete", () => {
		const { console: c } = createTestConsole("base");
		c.streamText("First stream message");
		expect(c._baseAccumulatedText).toContain("First stream message");
		c.streamComplete();
		expect(c._baseAccumulatedText).toBe("");

		c.streamText("Second stream message");
		expect(c._baseAccumulatedText).toContain("Second stream message");
		expect(c._baseAccumulatedText).not.toContain("First stream message");
		c.streamComplete();
	});

	it("skips user prompts in BASE mode", () => {
		const { console: c, getOutput } = createTestConsole("base");
		c.streamText("This is the user prompt", "user");
		c.streamText("This is the assistant response", "assistant");
		expect(c._baseAccumulatedText).not.toContain("user prompt");
		expect(c._baseAccumulatedText).toContain("assistant response");
		const output = getOutput();
		expect(output).not.toContain("user prompt");
		expect(output).toContain("assistant response");
		c.streamComplete();
	});

	it("registers parallel branches", () => {
		const { console: c } = createTestConsole("base");
		c.registerParallelBranches(["branch-a", "branch-b", "branch-c"]);
		expect(c._parallelHandler).toBeDefined();
	});

	it("handles parallel branch streaming in BASE mode", () => {
		const { console: c } = createTestConsole("base");
		c.registerParallelBranches(["branch-a", "branch-b"]);
		c.enterParallelMode();

		c.setParallelBranch("branch-a");
		c.streamText("Message from branch A", "assistant");

		c.exitParallelMode();
	});
});

describe("extractSummary", () => {
	it("extracts summary with explicit marker", () => {
		const output = `
Some header text.

## Summary

This is the summary content.
It has multiple lines.

## Next Section
`;
		const summary = extractSummary(output);
		expect(summary).toContain("summary content");
		expect(summary).not.toContain("Next Section");
	});

	it("extracts summary with various markers", () => {
		const cases = [
			["## Summary\nSummary text", "Summary text"],
			["### Summary\nSmaller summary", "Smaller summary"],
			["Summary:\nInline summary", "Inline summary"],
			["Result:\nResult text", "Result text"],
			["Completed:\nCompletion text", "Completion text"],
			["Done:\nDone text", "Done text"],
		] as const;

		for (const [output, expected] of cases) {
			const summary = extractSummary(output);
			expect(summary).toContain(expected);
		}
	});

	it("uses last lines when no marker present", () => {
		const output = `
First line of output.
Second line.
Third line.
Fourth line.
Fifth line.
Sixth line.
Seventh line.
`;
		const summary = extractSummary(output);
		expect(summary).toContain("line");
	});

	it("returns empty for empty input", () => {
		expect(extractSummary("")).toBe("");
		expect(extractSummary("   ")).toBe("");
	});

	it("respects max_lines parameter", () => {
		const output = `
## Summary

Line 1
Line 2
Line 3
Line 4
Line 5
Line 6
Line 7
`;
		const summary = extractSummary(output, 3);
		const lines = summary.split("\n").filter((l) => l.trim());
		expect(lines.length).toBeLessThanOrEqual(3);
	});

	it("respects max_chars parameter", () => {
		const longLine = "x".repeat(1000);
		const output = `## Summary\n${longLine}`;
		const summary = extractSummary(output, 5, 100);
		expect(summary.length).toBeLessThanOrEqual(100);
	});

	it("stops at next header", () => {
		const output = `
## Summary

Summary line 1.
Summary line 2.

## Next Section

This should not be included.
`;
		const summary = extractSummary(output);
		expect(summary).toContain("Summary line");
		expect(summary).not.toContain("should not be included");
	});
});

describe("extractJson", () => {
	it("extracts basic JSON from output", () => {
		const output = `
Some text before.

\`\`\`json
{"success": true, "summary": "Task completed"}
\`\`\`

Some text after.
`;
		const result = extractJson(output);
		expect(result).not.toBeNull();
		expect(result?.success).toBe(true);
		expect(result?.summary).toBe("Task completed");
	});

	it("extracts nested JSON objects", () => {
		const output = `
\`\`\`json
{
  "success": true,
  "checks": {
    "tests": {"passed": true},
    "lint": {"passed": true}
  }
}
\`\`\`
`;
		const result = extractJson(output);
		expect(result).not.toBeNull();
		expect(result?.success).toBe(true);
		expect((result?.checks as Record<string, Record<string, boolean>>).tests.passed).toBe(true);
	});

	it("extracts JSON with arrays", () => {
		const output = `
\`\`\`json
{
  "issues": [
    {"severity": "major", "message": "Issue 1"},
    {"severity": "minor", "message": "Issue 2"}
  ]
}
\`\`\`
`;
		const result = extractJson(output);
		expect(result).not.toBeNull();
		expect((result?.issues as unknown[]).length).toBe(2);
	});

	it("uses last JSON block when multiple present", () => {
		const output = `
\`\`\`json
{"version": 1, "status": "started"}
\`\`\`

\`\`\`json
{"version": 2, "status": "completed"}
\`\`\`
`;
		const result = extractJson(output);
		expect(result).not.toBeNull();
		expect(result?.version).toBe(2);
		expect(result?.status).toBe("completed");
	});

	it("returns null for empty input", () => {
		expect(extractJson("")).toBeNull();
		expect(extractJson("   ")).toBeNull();
	});

	it("returns null when no JSON block exists", () => {
		expect(extractJson("Some text without JSON.\nMore text.")).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		const output = `
\`\`\`json
{invalid json: not valid}
\`\`\`
`;
		expect(extractJson(output)).toBeNull();
	});
});
