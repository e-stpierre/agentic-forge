/** Tests for CodexAdapter. */

import { describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "../../src/runtimes/codex.js";
import type { RuntimeRunOptions } from "../../src/runtimes/types.js";

vi.mock("../../src/runtimes/utils.js", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		getExecutable: (name: string) => `/usr/bin/${name}`,
	};
});

const adapter = new CodexAdapter();

// --- buildCommand ---

describe("CodexAdapter.buildCommand", () => {
	it("always includes exec subcommand as first arg", () => {
		const cmd = adapter.buildCommand({ prompt: "hello" });
		expect(cmd.args[0]).toBe("exec");
	});

	it("includes --sandbox flag with default workspace-write", () => {
		const cmd = adapter.buildCommand({ prompt: "hello" });
		const idx = cmd.args.indexOf("--sandbox");
		expect(idx).toBeGreaterThan(-1);
		expect(cmd.args[idx + 1]).toBe("workspace-write");
	});

	it("accepts custom sandbox value", () => {
		const cmd = adapter.buildCommand({ prompt: "hello", sandbox: "read-only" });
		const idx = cmd.args.indexOf("--sandbox");
		expect(cmd.args[idx + 1]).toBe("read-only");
	});

	it("adds --json flag when printOutput is true", () => {
		const cmd = adapter.buildCommand({ prompt: "hello", printOutput: true });
		expect(cmd.args).toContain("--json");
	});

	it("does not add --json flag when printOutput is false", () => {
		const cmd = adapter.buildCommand({ prompt: "hello", printOutput: false });
		expect(cmd.args).not.toContain("--json");
	});

	it("adds --cd when cwd is provided", () => {
		const cmd = adapter.buildCommand({ prompt: "hello", cwd: "/my/dir" });
		const idx = cmd.args.indexOf("--cd");
		expect(idx).toBeGreaterThan(-1);
		expect(cmd.args[idx + 1]).toBe("/my/dir");
	});

	it("does not add --cd when cwd is not provided", () => {
		const cmd = adapter.buildCommand({ prompt: "hello" });
		expect(cmd.args).not.toContain("--cd");
	});

	it("adds --dangerously-bypass-approvals-and-sandbox when skipPermissions is true", () => {
		const cmd = adapter.buildCommand({ prompt: "hello", skipPermissions: true });
		expect(cmd.args).toContain("--dangerously-bypass-approvals-and-sandbox");
	});

	it("does not add bypass flag by default", () => {
		const cmd = adapter.buildCommand({ prompt: "hello" });
		expect(cmd.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
	});

	it("adds --model with raw model string", () => {
		const cmd = adapter.buildCommand({ prompt: "hello", model: "gpt-4o" });
		const idx = cmd.args.indexOf("--model");
		expect(idx).toBeGreaterThan(-1);
		expect(cmd.args[idx + 1]).toBe("gpt-4o");
	});

	it("defaults to gpt-5.5 model", () => {
		const cmd = adapter.buildCommand({ prompt: "hello" });
		const idx = cmd.args.indexOf("--model");
		expect(idx).toBeGreaterThan(-1);
		expect(cmd.args[idx + 1]).toBe("gpt-5.5");
	});

	it("adds --add-dir when outputDir is provided", () => {
		const cmd = adapter.buildCommand({ prompt: "hello", outputDir: "/out/dir" });
		const idx = cmd.args.indexOf("--add-dir");
		expect(idx).toBeGreaterThan(-1);
		expect(cmd.args[idx + 1]).toBe("/out/dir");
	});

	it("passes prompt as positional arg and leaves stdinInput empty", () => {
		const cmd = adapter.buildCommand({ prompt: "my prompt" });
		expect(cmd.args[cmd.args.length - 1]).toBe("my prompt");
		expect(cmd.stdinInput).toBe("");
	});

	it("sets OTEL_RESOURCE_ATTRIBUTES env when workflowId provided", () => {
		const cmd = adapter.buildCommand({ prompt: "p", workflowId: "wf-456" });
		expect(cmd.env?.OTEL_RESOURCE_ATTRIBUTES).toBe("session=wf-456");
	});

	it("does not set env when no workflowId", () => {
		const cmd = adapter.buildCommand({ prompt: "p" });
		expect(cmd.env).toBeUndefined();
	});

	it("does not add skills directory (Codex limitation)", () => {
		const cmd = adapter.buildCommand({ prompt: "p" });
		// Skills dir contains 'claude' in path; ensure no Claude skills are added
		// Just verify no unexpected --add-dir flags are added when no outputDir
		const addDirFlags = cmd.args.filter((_, i) => cmd.args[i - 1] === "--add-dir");
		expect(addDirFlags).toHaveLength(0);
	});
});

// --- parseStreamLine ---

describe("CodexAdapter.parseStreamLine", () => {
	it("returns null for non-JSON line", () => {
		expect(adapter.parseStreamLine("plain text")).toBeNull();
	});

	it("returns null for empty line", () => {
		expect(adapter.parseStreamLine("")).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		expect(adapter.parseStreamLine("{bad json")).toBeNull();
	});

	it("parses item.completed with agent_message as text event", () => {
		const line = JSON.stringify({
			type: "item.completed",
			item: { type: "agent_message", text: "Here is the result" },
		});
		const event = adapter.parseStreamLine(line);
		expect(event).not.toBeNull();
		expect(event?.type).toBe("text");
		expect(event?.text).toBe("Here is the result");
	});

	it("parses turn.completed as result event with no text", () => {
		const line = JSON.stringify({ type: "turn.completed" });
		const event = adapter.parseStreamLine(line);
		expect(event).not.toBeNull();
		expect(event?.type).toBe("result");
		// text must be undefined so process-runner falls back to accumulated streamed content
		expect(event?.text).toBeUndefined();
	});

	it("parses error event", () => {
		const line = JSON.stringify({ type: "error", message: "Something went wrong" });
		const event = adapter.parseStreamLine(line);
		expect(event).not.toBeNull();
		expect(event?.type).toBe("error");
		expect(event?.text).toBe("Something went wrong");
	});

	it("returns null for item.completed with non-agent_message item", () => {
		const line = JSON.stringify({
			type: "item.completed",
			item: { type: "tool_call", name: "Read" },
		});
		const event = adapter.parseStreamLine(line);
		expect(event).toBeNull();
	});

	it("returns null for unrecognized event type", () => {
		const line = JSON.stringify({ type: "some.other.event", data: "x" });
		const event = adapter.parseStreamLine(line);
		expect(event).toBeNull();
	});
});

// --- buildFinalResult ---

describe("CodexAdapter.buildFinalResult", () => {
	const options: RuntimeRunOptions = {
		prompt: "test prompt",
		cwd: "/some/path",
		model: "gpt-4o",
	};

	it("sets success true for returncode 0", () => {
		const result = adapter.buildFinalResult(0, "output", "", options);
		expect(result.success).toBe(true);
		expect(result.returncode).toBe(0);
	});

	it("sets success false for non-zero returncode", () => {
		const result = adapter.buildFinalResult(1, "", "error", options);
		expect(result.success).toBe(false);
	});

	it("propagates prompt, cwd, model", () => {
		const result = adapter.buildFinalResult(0, "", "", options);
		expect(result.prompt).toBe("test prompt");
		expect(result.cwd).toBe("/some/path");
		expect(result.model).toBe("gpt-4o");
	});

	it("parses sessionOutput from stdout", () => {
		const stdout = `
\`\`\`json
{"sessionId": "codex-123", "isSuccess": true, "context": "Codex done"}
\`\`\`
`;
		const result = adapter.buildFinalResult(0, stdout, "", options);
		expect(result.sessionOutput.sessionId).toBe("codex-123");
		expect(result.sessionOutput.isSuccess).toBe(true);
	});
});

// --- checkAvailable ---

describe("CodexAdapter.checkAvailable", () => {
	it("returns a boolean", () => {
		const result = adapter.checkAvailable();
		expect(typeof result).toBe("boolean");
	});
});

// --- id and executableName ---

describe("CodexAdapter identity", () => {
	it("has id codex", () => {
		expect(adapter.id).toBe("codex");
	});

	it("has executableName codex", () => {
		expect(adapter.executableName).toBe("codex");
	});
});
