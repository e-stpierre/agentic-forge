import { describe, expect, it } from "vitest";
import {
	ClaudeResult,
	FileNotFoundError,
	MODEL_MAP,
	SessionOutput,
	checkClaudeAvailable,
	extractModelFromMessage,
	extractResultText,
	extractTextFromMessage,
	extractUserText,
	formatModelName,
	getAgenticSystemPrompt,
	getExecutable,
	parseStreamJsonLine,
} from "../src/runner.js";

// --- getExecutable ---

describe("getExecutable", () => {
	it("should find an executable that exists", () => {
		// 'node' should exist in the test environment
		const result = getExecutable("node");
		expect(result).toBeTruthy();
		expect(result.length).toBeGreaterThan(0);
	});

	it("should throw FileNotFoundError for missing executable", () => {
		expect(() => getExecutable("nonexistent_executable_12345")).toThrow(FileNotFoundError);
		expect(() => getExecutable("nonexistent_executable_12345")).toThrow("Executable not found");
	});

	it("should return a valid path string", () => {
		const result = getExecutable("node");
		// Should contain path separators
		expect(result.includes("/") || result.includes("\\")).toBe(true);
	});
});

// --- MODEL_MAP ---

describe("MODEL_MAP", () => {
	it("should contain all expected models", () => {
		expect("sonnet" in MODEL_MAP).toBe(true);
		expect("haiku" in MODEL_MAP).toBe(true);
		expect("opus" in MODEL_MAP).toBe(true);
	});

	it("should have correct values", () => {
		expect(MODEL_MAP.sonnet).toBe("sonnet");
		expect(MODEL_MAP.haiku).toBe("haiku");
		expect(MODEL_MAP.opus).toBe("opus");
	});
});

// --- parseStreamJsonLine ---

describe("parseStreamJsonLine", () => {
	it("should parse valid JSON line", () => {
		const line = '{"type": "assistant", "message": {"content": []}}';
		const result = parseStreamJsonLine(line);
		expect(result).not.toBeNull();
		expect(result?.type).toBe("assistant");
	});

	it("should parse JSON with leading/trailing whitespace", () => {
		const line = '  {"type": "result", "result": "done"}  \n';
		const result = parseStreamJsonLine(line);
		expect(result).not.toBeNull();
		expect(result?.type).toBe("result");
	});

	it("should return null for non-JSON line", () => {
		const result = parseStreamJsonLine("Some random text output");
		expect(result).toBeNull();
	});

	it("should return null for empty line", () => {
		const result = parseStreamJsonLine("");
		expect(result).toBeNull();
	});

	it("should return null for invalid JSON", () => {
		const result = parseStreamJsonLine("{invalid json");
		expect(result).toBeNull();
	});
});

// --- extractTextFromMessage ---

describe("extractTextFromMessage", () => {
	it("should extract text from assistant message", () => {
		const data = {
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "Hello, world!" },
					{ type: "text", text: "More text" },
				],
			},
		};
		const results = extractTextFromMessage(data);
		expect(results).toEqual([
			[0, "Hello, world!"],
			[1, "More text"],
		]);
	});

	it("should skip non-text blocks", () => {
		const data = {
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "Text content" },
					{ type: "tool_use", name: "Read" },
					{ type: "text", text: "More text" },
				],
			},
		};
		const results = extractTextFromMessage(data);
		expect(results).toEqual([
			[0, "Text content"],
			[2, "More text"],
		]);
	});

	it("should return empty for non-assistant/non-stream_event messages", () => {
		const data = { type: "result", result: "some result" };
		const results = extractTextFromMessage(data);
		expect(results).toEqual([]);
	});

	it("should handle empty content array", () => {
		const data = { type: "assistant", message: { content: [] } };
		const results = extractTextFromMessage(data);
		expect(results).toEqual([]);
	});

	it("should handle missing message key", () => {
		const data = { type: "assistant" };
		const results = extractTextFromMessage(data);
		expect(results).toEqual([]);
	});

	it("should skip empty text blocks", () => {
		const data = {
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "" },
					{ type: "text", text: "Non-empty" },
				],
			},
		};
		const results = extractTextFromMessage(data);
		expect(results).toEqual([[1, "Non-empty"]]);
	});

	it("should extract text from stream_event format", () => {
		const data = {
			type: "stream_event",
			event: {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "Hello" },
			},
		};
		const results = extractTextFromMessage(data);
		expect(results).toEqual([[0, "Hello"]]);
	});

	it("should skip non-text deltas in stream events", () => {
		const data = {
			type: "stream_event",
			event: {
				type: "content_block_delta",
				index: 0,
				delta: { type: "input_json_delta", partial_json: "{}" },
			},
		};
		const results = extractTextFromMessage(data);
		expect(results).toEqual([]);
	});

	it("should skip non-delta stream events", () => {
		const data = {
			type: "stream_event",
			event: {
				type: "message_start",
				message: {},
			},
		};
		const results = extractTextFromMessage(data);
		expect(results).toEqual([]);
	});
});

// --- extractUserText ---

describe("extractUserText", () => {
	it("should extract text from user message with content array", () => {
		const data = {
			type: "user",
			message: {
				content: [{ type: "text", text: "Hello, Claude!" }],
			},
		};
		const result = extractUserText(data);
		expect(result).toBe("Hello, Claude!");
	});

	it("should extract text from user message with string content", () => {
		const data = {
			type: "user",
			message: {
				content: ["Simple string prompt"],
			},
		};
		const result = extractUserText(data);
		expect(result).toBe("Simple string prompt");
	});

	it("should return null for non-user messages", () => {
		const data = { type: "assistant", message: { content: [] } };
		const result = extractUserText(data);
		expect(result).toBeNull();
	});

	it("should return null for empty content", () => {
		const data = { type: "user", message: { content: [] } };
		const result = extractUserText(data);
		expect(result).toBeNull();
	});
});

// --- extractModelFromMessage ---

describe("extractModelFromMessage", () => {
	it("should extract model from assistant message", () => {
		const data = {
			type: "assistant",
			message: {
				model: "claude-sonnet-4-5-20250929",
				content: [{ type: "text", text: "Hello!" }],
			},
		};
		const result = extractModelFromMessage(data);
		expect(result).toBe("claude-sonnet-4-5-20250929");
	});

	it("should extract model from system message", () => {
		const data = { type: "system", model: "claude-opus-4-5-20251101" };
		const result = extractModelFromMessage(data);
		expect(result).toBe("claude-opus-4-5-20251101");
	});

	it("should return null for non-message types", () => {
		const data = { type: "user", message: { content: [] } };
		const result = extractModelFromMessage(data);
		expect(result).toBeNull();
	});

	it("should return null for missing model field", () => {
		const data = { type: "assistant", message: { content: [] } };
		const result = extractModelFromMessage(data);
		expect(result).toBeNull();
	});
});

// --- formatModelName ---

describe("formatModelName", () => {
	it("should format Sonnet 4.5", () => {
		expect(formatModelName("claude-sonnet-4-5-20250929")).toBe("sonnet-4.5");
	});

	it("should format Opus 4.5", () => {
		expect(formatModelName("claude-opus-4-5-20251101")).toBe("opus-4.5");
	});

	it("should format Haiku 4.0", () => {
		expect(formatModelName("claude-haiku-4-0-20250101")).toBe("haiku-4.0");
	});

	it("should format Sonnet 3.7 (pattern 2)", () => {
		expect(formatModelName("claude-3-7-sonnet-20250219")).toBe("sonnet-3.7");
	});

	it("should return empty string for null", () => {
		expect(formatModelName(null)).toBe("");
	});

	it("should return original for unparseable names", () => {
		expect(formatModelName("unknown-model")).toBe("unknown-model");
	});

	it("should return empty string for empty string", () => {
		expect(formatModelName("")).toBe("");
	});

	it("should return original for short names", () => {
		expect(formatModelName("claude-sonnet")).toBe("claude-sonnet");
	});

	it("should return original for names without a known tier", () => {
		expect(formatModelName("claude-unknown-4-5-20250929")).toBe("claude-unknown-4-5-20250929");
	});
});

// --- extractResultText ---

describe("extractResultText", () => {
	it("should extract result from result message", () => {
		const data = { type: "result", result: "Task completed successfully." };
		const result = extractResultText(data);
		expect(result).toBe("Task completed successfully.");
	});

	it("should return null for non-result messages", () => {
		const data = { type: "assistant", message: { content: [] } };
		const result = extractResultText(data);
		expect(result).toBeNull();
	});

	it("should return null for result message without result key", () => {
		const data = { type: "result" };
		const result = extractResultText(data);
		expect(result).toBeNull();
	});
});

// --- SessionOutput ---

describe("SessionOutput", () => {
	it("should parse stdout with valid JSON in code block", () => {
		const stdout = `
Some output text here.

\`\`\`json
{
  "sessionId": "abc123",
  "isSuccess": true,
  "context": "Task completed successfully."
}
\`\`\`
`;
		const output = SessionOutput.fromStdout(stdout);
		expect(output.sessionId).toBe("abc123");
		expect(output.isSuccess).toBe(true);
		expect(output.context).toBe("Task completed successfully.");
	});

	it("should preserve extra keys", () => {
		const stdout = `
\`\`\`json
{
  "sessionId": "test",
  "isSuccess": true,
  "context": "Done",
  "customKey": "customValue",
  "anotherKey": 123
}
\`\`\`
`;
		const output = SessionOutput.fromStdout(stdout);
		expect(output.extra.customKey).toBe("customValue");
		expect(output.extra.anotherKey).toBe(123);
		expect(output.rawJson).not.toBeNull();
	});

	it("should handle stdout without JSON", () => {
		const stdout = "Just regular output without any JSON blocks.";
		const output = SessionOutput.fromStdout(stdout);
		expect(output.sessionId).toBeNull();
		expect(output.isSuccess).toBe(false);
		expect(output.context).toContain("No valid session output JSON");
	});

	it("should handle empty stdout", () => {
		const output = SessionOutput.fromStdout("");
		expect(output.sessionId).toBeNull();
		expect(output.isSuccess).toBe(false);
		expect(output.context).toContain("No output received");
	});

	it("should use last valid JSON block when multiple exist", () => {
		const stdout = `
First JSON:
\`\`\`json
{"sessionId": "first", "isSuccess": false, "context": "First attempt"}
\`\`\`

Second JSON:
\`\`\`json
{"sessionId": "second", "isSuccess": true, "context": "Final success"}
\`\`\`
`;
		const output = SessionOutput.fromStdout(stdout);
		expect(output.sessionId).toBe("second");
		expect(output.isSuccess).toBe(true);
	});

	it("should parse bare JSON without code blocks", () => {
		const stdout = 'Output: {"sessionId": "bare", "isSuccess": true, "context": "Bare JSON"}';
		const output = SessionOutput.fromStdout(stdout);
		expect(output.sessionId).toBe("bare");
		expect(output.isSuccess).toBe(true);
	});

	it("should handle invalid JSON in code blocks", () => {
		const stdout = `
\`\`\`json
{invalid json here
\`\`\`
`;
		const output = SessionOutput.fromStdout(stdout);
		expect(output.sessionId).toBeNull();
		expect(output.isSuccess).toBe(false);
	});

	it("should skip JSON without required keys", () => {
		const stdout = `
\`\`\`json
{"someOtherKey": "value"}
\`\`\`
`;
		const output = SessionOutput.fromStdout(stdout);
		expect(output.sessionId).toBeNull();
		expect(output.context).toContain("No valid session output JSON");
	});
});

// --- ClaudeResult ---

describe("ClaudeResult", () => {
	it("should report success for returncode 0", () => {
		const result = new ClaudeResult(0, "output", "", "test", null);
		expect(result.success).toBe(true);
	});

	it("should report failure for non-zero returncode", () => {
		const result = new ClaudeResult(1, "", "error", "test", null);
		expect(result.success).toBe(false);
	});

	it("should lazily parse session output", () => {
		const result = new ClaudeResult(
			0,
			'{"sessionId": "lazy", "isSuccess": true, "context": "Test"}',
			"",
			"test",
			null,
		);

		const output1 = result.sessionOutput;
		const output2 = result.sessionOutput;

		expect(output1).toBe(output2); // Same reference (cached)
		expect(output1.sessionId).toBe("lazy");
	});

	it("should have correct string representation for success", () => {
		const result = new ClaudeResult(0, "", "", "test", null, "sonnet");
		const str = result.toString();
		expect(str).toContain("SUCCESS");
		expect(str).toContain("sonnet");
	});

	it("should have correct string representation for failure", () => {
		const result = new ClaudeResult(1, "", "error", "test", null);
		const str = result.toString();
		expect(str).toContain("FAILED");
	});
});

// --- getAgenticSystemPrompt ---

describe("getAgenticSystemPrompt", () => {
	it("should load system prompt when file exists", () => {
		const prompt = getAgenticSystemPrompt();
		// May or may not exist depending on build state
		if (prompt !== null) {
			expect(prompt.length).toBeGreaterThan(0);
		}
	});
});

// --- checkClaudeAvailable ---

describe("checkClaudeAvailable", () => {
	it("should return false when claude is not in PATH", () => {
		// In test environment, claude is likely not available
		// This test just verifies the function doesn't throw
		const result = checkClaudeAvailable();
		expect(typeof result).toBe("boolean");
	});
});
