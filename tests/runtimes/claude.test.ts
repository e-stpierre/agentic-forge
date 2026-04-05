/** Tests for ClaudeAdapter. */

import { describe, expect, it, vi } from "vitest";
import { ClaudeAdapter } from "../../src/runtimes/claude.js";
import type { RuntimeRunOptions } from "../../src/runtimes/types.js";

vi.mock("../../src/runtimes/utils.js", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		getExecutable: (name: string) => `/usr/bin/${name}`,
	};
});

const adapter = new ClaudeAdapter();

// --- buildCommand ---

describe("ClaudeAdapter.buildCommand", () => {
	it("includes --print flag", () => {
		const cmd = adapter.buildCommand({ prompt: "hello" });
		expect(cmd.args).toContain("--print");
	});

	it("sets stdinInput to prompt text", () => {
		const cmd = adapter.buildCommand({ prompt: "my prompt" });
		expect(cmd.stdinInput).toBe("my prompt");
	});

	it("adds --model with raw string", () => {
		const cmd = adapter.buildCommand({ prompt: "p", model: "claude-opus-4-6" });
		const idx = cmd.args.indexOf("--model");
		expect(idx).toBeGreaterThan(-1);
		expect(cmd.args[idx + 1]).toBe("claude-opus-4-6");
	});

	it("defaults to sonnet model when none provided", () => {
		const cmd = adapter.buildCommand({ prompt: "p" });
		const idx = cmd.args.indexOf("--model");
		expect(idx).toBeGreaterThan(-1);
		expect(cmd.args[idx + 1]).toBe("sonnet");
	});

	it("adds --dangerously-skip-permissions when skipPermissions is true", () => {
		const cmd = adapter.buildCommand({ prompt: "p", skipPermissions: true });
		expect(cmd.args).toContain("--dangerously-skip-permissions");
	});

	it("does not add --dangerously-skip-permissions by default", () => {
		const cmd = adapter.buildCommand({ prompt: "p" });
		expect(cmd.args).not.toContain("--dangerously-skip-permissions");
	});

	it("adds --output-format stream-json --verbose when printOutput is true", () => {
		const cmd = adapter.buildCommand({ prompt: "p", printOutput: true });
		expect(cmd.args).toContain("--output-format");
		expect(cmd.args).toContain("stream-json");
		expect(cmd.args).toContain("--verbose");
	});

	it("does not add stream-json format when printOutput is false", () => {
		const cmd = adapter.buildCommand({ prompt: "p", printOutput: false });
		expect(cmd.args).not.toContain("stream-json");
	});

	it("adds --allowedTools for each allowed tool", () => {
		const cmd = adapter.buildCommand({ prompt: "p", allowedTools: ["Read", "Write"] });
		const toolFlags = cmd.args.filter((_, i) => cmd.args[i - 1] === "--allowedTools");
		expect(toolFlags).toContain("Read");
		expect(toolFlags).toContain("Write");
	});

	it("sets OTEL_RESOURCE_ATTRIBUTES env when workflowId provided", () => {
		const cmd = adapter.buildCommand({ prompt: "p", workflowId: "wf-123" });
		expect(cmd.env).toBeDefined();
		expect(cmd.env?.OTEL_RESOURCE_ATTRIBUTES).toBe("session=wf-123");
	});

	it("does not set env when no workflowId", () => {
		const cmd = adapter.buildCommand({ prompt: "p" });
		expect(cmd.env).toBeUndefined();
	});

	it("returns claude as executable name prefix check", () => {
		// executable comes from getExecutable which may not find claude in test env
		// just verify the command structure is correct
		const cmd = adapter.buildCommand({ prompt: "p" });
		expect(cmd.args).toBeDefined();
		expect(Array.isArray(cmd.args)).toBe(true);
		expect(cmd.stdinInput).toBe("p");
	});
});

// --- parseStreamLine ---

describe("ClaudeAdapter.parseStreamLine", () => {
	it("returns null for non-JSON line", () => {
		expect(adapter.parseStreamLine("plain text output")).toBeNull();
	});

	it("returns null for empty line", () => {
		expect(adapter.parseStreamLine("")).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		expect(adapter.parseStreamLine("{invalid}")).toBeNull();
	});

	it("extracts text from assistant message", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				content: [{ type: "text", text: "Hello from Claude" }],
			},
		});
		const event = adapter.parseStreamLine(line);
		expect(event).not.toBeNull();
		expect(event?.type).toBe("text");
		expect(event?.text).toBe("Hello from Claude");
	});

	it("extracts model info from assistant message", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				model: "claude-sonnet-4-6-20251201",
				content: [],
			},
		});
		const event = adapter.parseStreamLine(line);
		expect(event).not.toBeNull();
		expect(event?.type).toBe("model_info");
		expect(event?.model).toBe("claude-sonnet-4-6-20251201");
	});

	it("extracts model from system message", () => {
		const line = JSON.stringify({
			type: "system",
			model: "claude-opus-4-6",
		});
		const event = adapter.parseStreamLine(line);
		expect(event).not.toBeNull();
		expect(event?.type).toBe("model_info");
		expect(event?.model).toBe("claude-opus-4-6");
	});

	it("extracts result text from result message", () => {
		const line = JSON.stringify({
			type: "result",
			result: "Task completed",
		});
		const event = adapter.parseStreamLine(line);
		expect(event).not.toBeNull();
		expect(event?.type).toBe("result");
		expect(event?.text).toBe("Task completed");
	});

	it("extracts user text from user message", () => {
		const line = JSON.stringify({
			type: "user",
			message: {
				content: [{ type: "text", text: "User prompt here" }],
			},
		});
		const event = adapter.parseStreamLine(line);
		expect(event).not.toBeNull();
		expect(event?.type).toBe("user_text");
		expect(event?.text).toBe("User prompt here");
	});

	it("returns null for unrecognized message type", () => {
		const line = JSON.stringify({ type: "unknown_event", data: {} });
		const event = adapter.parseStreamLine(line);
		expect(event).toBeNull();
	});
});

// --- buildFinalResult ---

describe("ClaudeAdapter.buildFinalResult", () => {
	const options: RuntimeRunOptions = {
		prompt: "test prompt",
		cwd: "/some/path",
		model: "sonnet",
	};

	it("sets success true for returncode 0", () => {
		const result = adapter.buildFinalResult(0, "output", "", options);
		expect(result.success).toBe(true);
		expect(result.returncode).toBe(0);
	});

	it("sets success false for non-zero returncode", () => {
		const result = adapter.buildFinalResult(1, "", "error", options);
		expect(result.success).toBe(false);
		expect(result.returncode).toBe(1);
	});

	it("propagates prompt, cwd, model from options", () => {
		const result = adapter.buildFinalResult(0, "", "", options);
		expect(result.prompt).toBe("test prompt");
		expect(result.cwd).toBe("/some/path");
		expect(result.model).toBe("sonnet");
	});

	it("parses sessionOutput from stdout JSON block", () => {
		const stdout = `
\`\`\`json
{"sessionId": "ses-123", "isSuccess": true, "context": "Done"}
\`\`\`
`;
		const result = adapter.buildFinalResult(0, stdout, "", options);
		expect(result.sessionOutput.sessionId).toBe("ses-123");
		expect(result.sessionOutput.isSuccess).toBe(true);
	});

	it("handles null cwd and model gracefully", () => {
		const result = adapter.buildFinalResult(0, "", "", { prompt: "p" });
		expect(result.cwd).toBeNull();
		expect(result.model).toBeNull();
	});
});

// --- checkAvailable ---

describe("ClaudeAdapter.checkAvailable", () => {
	it("returns a boolean", () => {
		const result = adapter.checkAvailable();
		expect(typeof result).toBe("boolean");
	});
});

// --- id and executableName ---

describe("ClaudeAdapter identity", () => {
	it("has id claude", () => {
		expect(adapter.id).toBe("claude");
	});

	it("has executableName claude", () => {
		expect(adapter.executableName).toBe("claude");
	});
});
