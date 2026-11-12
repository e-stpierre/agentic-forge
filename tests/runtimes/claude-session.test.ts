/**
 * Claude session driver (ORC-035) on the fake SDK transport: result blocks,
 * SDK options, permission and question requests, next-turn messages,
 * steering, interrupt and abort. No real Claude session is started.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig, getRuntimeDriver, getRuntimePlugins } from "../../src/config.js";
import { ConsoleOutput } from "../../src/console.js";
import { describeToolCall } from "../../src/runtimes/claude-session.js";
import { ClaudeAdapter, CodexAdapter } from "../../src/runtimes/index.js";
import { runRuntime } from "../../src/runtimes/process-runner.js";
import type {
	LiveSession,
	SessionDecision,
	SessionEvent,
	SessionHost,
	SessionRequest,
} from "../../src/runtimes/session.js";
import { SessionOutput } from "../../src/runtimes/types.js";
import { driverOptions } from "../../src/steps/base.js";
import { fakeSdk, resultBlock, userText } from "../helpers/fake-sdk.js";

vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
	const { fakeSdk: fake } = await import("../helpers/fake-sdk.js");
	return { query: fake.query };
});

const adapter = new ClaudeAdapter();

function run(prompt: string, host: SessionHost = {}, extra: Record<string, unknown> = {}) {
	return runRuntime(adapter, {
		prompt,
		driver: "session",
		sessionHost: host,
		appendSystemPrompt: false,
		...extra,
	});
}

afterEach(() => {
	fakeSdk.reset();
});

describe("Claude session driver", () => {
	it("produces the same result block as the cli driver", async () => {
		const output = `Implemented it\n${resultBlock("done", "Built M1", { max_risk: "low" })}`;
		fakeSdk.on("BUILD", async (s, first) => {
			s.init();
			s.text("Implemented it");
			s.result(output, [first]);
			await s.nextUser();
		});
		const result = await run("BUILD");
		expect(result.returncode).toBe(0);
		expect(result.sessionOutput.sessionId).toBe("fake-session-1");
		const cli = SessionOutput.fromStdout(output, "fake-session-1");
		expect(result.sessionOutput.result).toEqual(cli.result);
		expect(result.sessionOutput.result?.summary).toBe("Built M1");
		expect(result.sessionOutput.isSuccess).toBe(true);
	});

	it("maps step options to SDK options and never sets credentials", async () => {
		await run(
			"OPTS",
			{},
			{
				model: "opus",
				allowedTools: ["Read", "Bash(git *)"],
				plugins: ["/plugins/esp"],
				resumeSessionId: "abc-session",
				env: { PATH: "/bin" },
				workflowId: "wf-1",
				appendSystemPrompt: true,
			},
		);
		const options = fakeSdk.sessions[0].options;
		expect(options.model).toBe("opus");
		expect(options.allowedTools).toEqual(["Read", "Bash(git *)"]);
		expect(options.plugins).toEqual([{ type: "local", path: "/plugins/esp" }]);
		expect(options.resume).toBe("abc-session");
		expect(options.permissionMode).toBe("default");
		expect(options.allowDangerouslySkipPermissions).toBeUndefined();
		expect(options.skills).toBe("all");
		expect(options.env?.PATH).toBe("/bin");
		expect(options.env?.OTEL_RESOURCE_ATTRIBUTES).toBe("session=wf-1");
		expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
		expect(options.env?.ANTHROPIC_BASE_URL).toBeUndefined();
		expect(options.systemPrompt).toMatchObject({ type: "preset", preset: "claude_code" });
	});

	it("bypasses permissions only when asked", async () => {
		await run("BYPASS", {}, { skipPermissions: true });
		expect(fakeSdk.sessions[0].options.permissionMode).toBe("bypassPermissions");
		expect(fakeSdk.sessions[0].options.allowDangerouslySkipPermissions).toBe(true);
	});

	it("auto-approves allowlisted tools and asks for the others", async () => {
		const decisions: Record<string, string> = {};
		fakeSdk.on("TOOLS", async (s, first) => {
			s.init();
			decisions.read = (await s.tool("Read", { file_path: "a.ts" })).behavior;
			decisions.write = (await s.tool("Write", { file_path: "b.ts" })).behavior;
			decisions.bash = (await s.tool("Bash", { command: "rm -rf build" })).behavior;
			s.result(resultBlock(), [first]);
			await s.nextUser();
		});
		const requests: SessionRequest[] = [];
		const result = await run(
			"TOOLS",
			{
				requestInput: async (request) => {
					requests.push(request);
					return request.tool === "Write"
						? { option: "allow", text: "allow" }
						: { option: "deny", text: "deny" };
				},
			},
			{ allowedTools: ["Read"] },
		);
		expect(result.returncode).toBe(0);
		expect(decisions).toEqual({ read: "allow", write: "allow", bash: "deny" });
		expect(requests.map((r) => [r.kind, r.tool])).toEqual([
			["permission", "Write"],
			["permission", "Bash"],
		]);
		expect(requests[1].question).toBe("Allow Bash? rm -rf build");
		expect(requests[1].options.map((o) => o.id)).toEqual(["allow", "deny"]);
	});

	it("denies with the operator's reason and without a host", async () => {
		const messages: string[] = [];
		fakeSdk.on("DENY", async (s, first) => {
			s.init();
			const d = await s.tool("Bash", { command: "curl x" });
			if (d.behavior === "deny") messages.push(d.message);
			s.result(resultBlock(), [first]);
			await s.nextUser();
		});
		await run("DENY", { requestInput: async () => ({ option: null, text: "use the cache" }) });
		await run("DENY");
		expect(messages).toEqual([
			"Denied by the operator: use the cache",
			"Denied by the operator: No operator is connected",
		]);
	});

	it("turns AskUserQuestion into question requests and returns the answers", async () => {
		let updated: Record<string, unknown> | undefined;
		fakeSdk.on("ASK", async (s, first) => {
			s.init();
			const d = await s.tool("AskUserQuestion", {
				questions: [
					{
						question: "Which store?",
						header: "Store",
						multiSelect: false,
						options: [
							{ label: "Redis", description: "Fast" },
							{ label: "Postgres", description: "Durable" },
						],
					},
					{
						question: "Which name?",
						header: "Name",
						options: [{ label: "x" }, { label: "y" }],
					},
				],
			});
			if (d.behavior === "allow") updated = d.updatedInput;
			s.result(resultBlock(), [first]);
			await s.nextUser();
		});
		const requests: SessionRequest[] = [];
		await run("ASK", {
			requestInput: async (request): Promise<SessionDecision> => {
				requests.push(request);
				return requests.length === 1 ? { option: "b", text: "b" } : { option: null, text: "zed" };
			},
		});
		expect(requests[0]).toMatchObject({
			kind: "question",
			question: "Which store?",
			tool: "AskUserQuestion",
			options: [
				{ id: "a", label: "Redis", description: "Fast" },
				{ id: "b", label: "Postgres", description: "Durable" },
			],
		});
		expect(requests[1].question).toBe("Which name?");
		expect(updated?.answers).toEqual({ "Which store?": "Postgres", "Which name?": "zed" });
	});

	it("sends pending operator messages as the next turn", async () => {
		const host: SessionHost = {
			nextMessages: vi
				.fn<() => Promise<string>>()
				.mockResolvedValueOnce("## Operator Messages\n\nAlso add tests\n")
				.mockResolvedValue(""),
		};
		const result = await run("TURNS", host);
		const session = fakeSdk.sessions[0];
		expect(session.received.map(userText)).toEqual([
			"TURNS",
			"## Operator Messages\n\nAlso add tests\n",
		]);
		expect(host.nextMessages).toHaveBeenCalledTimes(2);
		expect(result.returncode).toBe(0);
	});

	it("steers a running turn through the live handle", async () => {
		let live: LiveSession | null = null;
		let unregistered = false;
		fakeSdk.on("STEER", async (s, first) => {
			s.init();
			live?.steer("Use the other API");
			const steer = await s.nextUser();
			s.result("", [first]);
			s.result(`Steered\n${resultBlock("done", "steered")}`, [steer]);
			await s.nextUser();
		});
		const result = await run("STEER", {
			onLive: (handle) => {
				live = handle;
				return () => {
					unregistered = true;
				};
			},
		});
		const session = fakeSdk.sessions[0];
		expect(session.received[1].priority).toBe("now");
		expect(userText(session.received[1])).toBe("Use the other API");
		expect(result.sessionOutput.result?.summary).toBe("steered");
		expect(unregistered).toBe(true);
	});

	it("interrupts the running turn and is stopped by the abort signal", async () => {
		const controller = new AbortController();
		let live: LiveSession | null = null;
		fakeSdk.on("HANG", async (s) => {
			s.init();
			await live?.interrupt();
			controller.abort();
			await new Promise(() => {});
		});
		const result = await run(
			"HANG",
			{
				onLive: (handle) => {
					live = handle;
					return () => {};
				},
			},
			{ signal: controller.signal },
		);
		expect(fakeSdk.sessions[0].interrupts).toBe(1);
		expect(result.returncode).toBe(-1);
		expect(result.stderr).toBe("Step interrupted");
	});

	it("stops the step timeout while a request waits for its answer", async () => {
		fakeSdk.on("SLOW", async (s, first) => {
			s.init();
			await s.tool("Bash", { command: "x" });
			s.result(resultBlock(), [first]);
			await s.nextUser();
		});
		const answered = await run(
			"SLOW",
			{
				requestInput: () =>
					new Promise((resolve) => setTimeout(() => resolve({ option: "allow", text: "" }), 150)),
			},
			{ timeout: 0.05 },
		);
		expect(answered.returncode).toBe(0);
		fakeSdk.on("HANGS", async (s) => {
			s.init();
			await new Promise(() => {});
		});
		const hung = await run("HANGS", {}, { timeout: 0.05 });
		expect(hung.returncode).toBe(-1);
		expect(hung.stderr).toBe("Step timed out after 0.05 seconds");
	});

	it("fails a session that ends without a result", async () => {
		fakeSdk.on("EMPTY", async (s) => {
			s.init();
		});
		const result = await run("EMPTY");
		expect(result.returncode).toBe(1);
		expect(result.stderr).toBe("Session ended without a result");
	});

	it("emits normalized events", async () => {
		const events: SessionEvent[] = [];
		fakeSdk.on("EVENTS", async (s, first) => {
			s.init();
			await s.tool("Read", { file_path: "x" });
			s.text("Hi");
			s.result(resultBlock(), [first]);
			await s.nextUser();
		});
		await run("EVENTS", { onEvent: (e) => events.push(e) }, { allowedTools: ["Read"] });
		const types = events.map((e) => (e.type === "item" ? `item:${e.kind}` : e.type));
		expect(types).toEqual([
			"item:message",
			"state",
			"session.started",
			"item:tool_call",
			"item:tool_result",
			"item:message",
			"turn.completed",
			"state",
			"state",
		]);
		expect(events.at(-1)).toEqual({ type: "state", state: "closed" });
		expect(events[0]).toMatchObject({ role: "user", text: "EVENTS" });
		expect(events[2]).toMatchObject({
			authSource: "none",
			sessionId: "fake-session-1",
			runtime: "claude",
			driver: "session",
		});
	});

	it("streams assistant text to the console", async () => {
		const console = new ConsoleOutput();
		const spy = vi.spyOn(console, "streamText").mockImplementation(() => {});
		vi.spyOn(console, "streamComplete").mockImplementation(() => {});
		await run("STREAM", {}, { console, printOutput: true });
		expect(spy).toHaveBeenCalledWith("STREAM", "user");
		expect(spy).toHaveBeenCalledWith("Working", "assistant", "sonnet");
	});

	it("describes tool calls in one line", () => {
		expect(describeToolCall("Bash", { command: "ls" })).toBe("ls");
		expect(describeToolCall("Write", { file_path: "a.ts", content: "x" })).toBe("a.ts");
		expect(describeToolCall("X", { a: 1 })).toBe('{"a":1}');
	});
});

describe("driver selection", () => {
	it("defaults Claude to the session driver and Codex to cli", () => {
		const config = getDefaultConfig();
		expect(getRuntimeDriver(config, "claude")).toBe("session");
		expect(getRuntimeDriver(config, "codex")).toBe("cli");
		expect(getRuntimeDriver({}, "claude")).toBe("session");
		expect(getRuntimeDriver({ runtimes: { claude: { driver: "cli" } } }, "claude")).toBe("cli");
		expect(getRuntimeDriver({ runtimes: { claude: { driver: "bogus" } } }, "claude")).toBe(
			"session",
		);
		expect(
			getRuntimePlugins({ runtimes: { claude: { plugins: ["/p", 3, ""] } } }, "claude"),
		).toEqual(["/p"]);
	});

	it("uses the session host for session steps only", async () => {
		const operatorMessages = vi.fn(async () => "msg");
		const base = {
			repoRoot: ".",
			renderer: {} as never,
			workflowSettings: null,
			workflowId: "wf",
			variables: {},
			outputs: {},
			operatorMessages,
		};
		const claude = driverOptions(
			{ ...base, config: getDefaultConfig(), runtimeAdapter: adapter },
			"s",
		);
		expect(claude.driver).toBe("session");
		expect(await claude.sessionHost?.nextMessages?.()).toBe("msg");
		expect(operatorMessages).toHaveBeenCalledWith("s");
		const cli = driverOptions(
			{ ...base, config: { runtimes: { claude: { driver: "cli" } } }, runtimeAdapter: adapter },
			"s",
		);
		expect(cli).toEqual({ driver: "cli" });
		const codex = driverOptions(
			{
				...base,
				config: { runtimes: { codex: { driver: "session" } } },
				runtimeAdapter: new CodexAdapter(),
			},
			"s",
		);
		expect(codex).toEqual({ driver: "cli" });
	});
});
