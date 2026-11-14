/**
 * Codex session driver (`codex app-server`) on the fake app-server: result
 * blocks, thread options, approvals and user input requests, the allowlist,
 * next-turn messages, steering, interrupt, abort, resume, native skills and
 * the inline fallback. No real Codex session is started.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig, getRuntimeDriver } from "../../src/config.js";
import {
	CODEX_PROTOCOL_VERSION,
	CodexSession,
	codexAppServer,
	codexItemEvents,
	commandAllowed,
	editsAllowed,
	findCodexSkill,
	spawnAppServer,
} from "../../src/runtimes/codex-session.js";
import { CodexAdapter } from "../../src/runtimes/index.js";
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
import { fakeCodex, inputText, resultBlock } from "../helpers/fake-app-server.js";

const adapter = new CodexAdapter();

function run(prompt: string, host: SessionHost = {}, extra: Record<string, unknown> = {}) {
	return runRuntime(adapter, {
		prompt,
		driver: "session",
		sessionHost: host,
		appendSystemPrompt: false,
		...extra,
	});
}

/** A host that answers every request with `answer` and records them. */
function answering(answer: SessionDecision, requests: SessionRequest[], events?: SessionEvent[]) {
	return {
		requestInput: async (request: SessionRequest) => {
			requests.push(request);
			return answer;
		},
		onEvent: events ? (e: SessionEvent) => events.push(e) : undefined,
	} satisfies SessionHost;
}

beforeEach(() => {
	codexAppServer.spawn = fakeCodex.spawn;
});

afterEach(() => {
	fakeCodex.reset();
	codexAppServer.spawn = spawnAppServer;
});

describe("Codex session driver", () => {
	it("produces the same result block as the cli driver", async () => {
		const output = `Implemented it\n${resultBlock("done", "Built M1", { max_risk: "low" })}`;
		fakeCodex.on("BUILD", async (turn) => {
			turn.message("Looking around");
			turn.message(output);
			turn.complete();
		});
		const result = await run("BUILD");
		expect(result.returncode).toBe(0);
		expect(result.sessionOutput.sessionId).toBe("thread-1");
		const cli = SessionOutput.fromStdout(output, "thread-1");
		expect(result.sessionOutput.result).toEqual(cli.result);
		expect(result.sessionOutput.result?.summary).toBe("Built M1");
		// The app-server exits when the session closes
		expect(fakeCodex.servers[0].closed).toBe(true);
	});

	it("starts the thread with the sandbox, write roots, model and developer instructions", async () => {
		const result = await runRuntime(adapter, {
			prompt: "HELLO",
			driver: "session",
			cwd: "/work/repo",
			outputDir: "/runs/r1",
			model: "gpt-5-codex",
			workflowId: "wf-1",
			env: { PATH: "/bin" },
		});
		expect(result.returncode).toBe(0);
		const server = fakeCodex.servers[0];
		const [init] = server.sent("initialize");
		expect(init.params).toMatchObject({
			clientInfo: { name: "agentic-forge", version: CODEX_PROTOCOL_VERSION },
			capabilities: { experimentalApi: true },
		});
		expect(server.sent("initialized")).toHaveLength(1);
		expect(server.threadMethod).toBe("thread/start");
		expect(server.threadParams).toMatchObject({
			cwd: "/work/repo",
			model: "gpt-5-codex",
			sandbox: "workspace-write",
			approvalPolicy: "on-request",
			experimentalRawEvents: false,
		});
		const roots = (server.threadParams?.config as Record<string, string[]>)[
			"sandbox_workspace_write.writable_roots"
		];
		expect(roots).toHaveLength(2);
		expect(String(server.threadParams?.developerInstructions)).toContain("result block");
		expect(server.options.env.OTEL_RESOURCE_ATTRIBUTES).toBe("session=wf-1");
		expect(server.options.env.PATH).toBe("/bin");
		// The system prompt is not prepended to the prompt (unlike `codex exec`)
		expect(server.turns[0].text).toBe("HELLO");
	});

	it("bypass runs with full access and no approvals", async () => {
		await run("HELLO", {}, { skipPermissions: true, sandbox: "read-only" });
		expect(fakeCodex.servers[0].threadParams).toMatchObject({
			sandbox: "danger-full-access",
			approvalPolicy: "never",
			config: null,
		});
	});

	it("maps items to normalized transcript events", async () => {
		fakeCodex.on("WORK", async (turn) => {
			await turn.command("ls", { output: "a.txt" });
			turn.message(resultBlock());
			turn.complete();
		});
		const events: SessionEvent[] = [];
		await run("WORK", { onEvent: (e) => events.push(e) });
		expect(events[0]).toMatchObject({ type: "item", kind: "message", role: "user", text: "WORK" });
		expect(events.find((e) => e.type === "session.started")).toMatchObject({
			sessionId: "thread-1",
			model: "gpt-fake",
			runtime: "codex",
			driver: "session",
		});
		const call = events.find((e) => e.type === "item" && e.kind === "tool_call");
		const res = events.find((e) => e.type === "item" && e.kind === "tool_result");
		expect(call).toMatchObject({ tool: "shell", input: { command: "ls" } });
		expect(res).toMatchObject({ id: (call as { id: string }).id, text: "a.txt", isError: false });
		expect(events.some((e) => e.type === "turn.completed" && !e.isError)).toBe(true);
	});

	it("turns a command approval into a permission request and accepts or declines it", async () => {
		const decisions: unknown[] = [];
		fakeCodex.on("PUBLISH", async (turn) => {
			decisions.push(await turn.command("npm publish", { approval: true }));
			turn.message(resultBlock());
			turn.complete();
		});
		const requests: SessionRequest[] = [];
		await run("PUBLISH", answering({ option: "allow", text: "allow" }, requests));
		expect(requests[0]).toMatchObject({
			kind: "permission",
			question: "Allow shell? npm publish",
			options: [{ id: "allow" }, { id: "deny" }],
			context: "needs to run outside the sandbox",
			tool: "shell",
			input: { command: "npm publish" },
		});
		expect(requests[0].id).toMatch(/^perm-[0-9a-f]{8}$/);
		await run("PUBLISH", answering({ option: "deny", text: "deny" }, []));
		expect(decisions).toEqual(["accept", "decline"]);
	});

	it("accepts approvals the allowlist covers without asking", async () => {
		const decisions: unknown[] = [];
		fakeCodex.on("GIT", async (turn) => {
			decisions.push(await turn.command("git push origin main", { approval: true }));
			decisions.push(await turn.fileChange("/elsewhere/a.txt"));
			turn.message(resultBlock());
			turn.complete();
		});
		const requests: SessionRequest[] = [];
		await run("GIT", answering({ option: "deny", text: "deny" }, requests), {
			allowedTools: ["Bash(git *)", "Edit"],
		});
		expect(decisions).toEqual(["accept", "accept"]);
		expect(requests).toEqual([]);
	});

	it("asks for a file change approval outside the allowlist", async () => {
		const decisions: unknown[] = [];
		fakeCodex.on("PATCH", async (turn) => {
			decisions.push(await turn.fileChange("/elsewhere/a.txt"));
			turn.message(resultBlock());
			turn.complete();
		});
		const requests: SessionRequest[] = [];
		const events: SessionEvent[] = [];
		await run("PATCH", answering({ option: null, text: "yes" }, requests, events));
		expect(requests[0]).toMatchObject({ kind: "permission", tool: "apply_patch" });
		expect(decisions).toEqual(["accept"]);
		expect(events.find((e) => e.type === "diff")).toMatchObject({
			path: "/elsewhere/a.txt",
			change: "add",
			patch: "+line",
		});
	});

	it("turns requestUserInput into question requests and returns the answers", async () => {
		let answers: unknown;
		fakeCodex.on("ASK", async (turn) => {
			answers = await turn.ask([
				{
					id: "store",
					header: "Store",
					question: "Which token store?",
					isOther: true,
					isSecret: false,
					options: [
						{ label: "Redis cache", description: "fast" },
						{ label: "Database table", description: "durable" },
					],
				},
				{
					id: "name",
					header: "Name",
					question: "Table name?",
					isOther: true,
					isSecret: false,
					options: null,
				},
			]);
			turn.message(resultBlock());
			turn.complete();
		});
		const requests: SessionRequest[] = [];
		const host: SessionHost = {
			requestInput: async (request) => {
				requests.push(request);
				return request.options.length > 0
					? { option: "b", text: "b" }
					: { option: null, text: "tokens" };
			},
		};
		await run("ASK", host);
		expect(requests[0]).toMatchObject({
			kind: "question",
			question: "Which token store?",
			options: [
				{ id: "a", label: "Redis cache", description: "fast" },
				{ id: "b", label: "Database table", description: "durable" },
			],
			tool: "request_user_input",
			context: "Store. A free-text answer is accepted",
		});
		expect(requests[0].id).toMatch(/^ask-/);
		expect(answers).toEqual({
			store: { answers: ["Database table"] },
			name: { answers: ["tokens"] },
		});
	});

	it("keeps answers to secret questions out of request.resolved", async () => {
		let answers: unknown;
		fakeCodex.on("TOKEN", async (turn) => {
			answers = await turn.ask([
				{
					id: "token",
					header: "Token",
					question: "API token?",
					isOther: true,
					isSecret: true,
					options: null,
				},
			]);
			turn.message(resultBlock());
			turn.complete();
		});
		const events: SessionEvent[] = [];
		await run("TOKEN", answering({ option: null, text: "s3cr3t" }, [], events));
		expect(answers).toEqual({ token: { answers: ["s3cr3t"] } });
		const resolved = events.find((e) => e.type === "request.resolved");
		expect(resolved).toMatchObject({ decision: { text: "[secret]" } });
		expect(JSON.stringify(events)).not.toContain("s3cr3t");
	});

	it("denies requests when no operator is connected", async () => {
		const decisions: unknown[] = [];
		fakeCodex.on("PUBLISH", async (turn) => {
			decisions.push(await turn.command("npm publish", { approval: true }));
			turn.message(resultBlock());
			turn.complete();
		});
		await run("PUBLISH");
		expect(decisions).toEqual(["decline"]);
	});

	it("sends pending operator messages as the next turn of the same thread", async () => {
		fakeCodex.on("BUILD", async (turn) => {
			turn.message(resultBlock("done", "first"));
			turn.complete();
		});
		fakeCodex.on("Also cover", async (turn) => {
			turn.message(resultBlock("done", "second"));
			turn.complete();
		});
		let sent = false;
		const result = await run("BUILD", {
			nextMessages: async () => {
				if (sent) return "";
				sent = true;
				return "Also cover the edge case";
			},
		});
		const server = fakeCodex.servers[0];
		expect(server.turns.map((t) => t.text)).toEqual(["BUILD", "Also cover the edge case"]);
		expect(server.sent("thread/start")).toHaveLength(1);
		expect(result.sessionOutput.result?.summary).toBe("second");
	});

	it("steers the running turn with turn/steer", async () => {
		fakeCodex.on("BUILD", async (turn) => {
			await turn.waitForSteers(1);
			turn.message(resultBlock("done", "steered"));
			turn.complete();
		});
		let live: LiveSession | null = null;
		const pending = run("BUILD", {
			onLive: (handle) => {
				live = handle;
				return () => {
					live = null;
				};
			},
		});
		const turn = await fakeCodex.waitFor("BUILD");
		await new Promise((r) => setTimeout(r, 10));
		expect((live as LiveSession | null)?.steer("Use the v2 API")).toBe(true);
		const result = await pending;
		expect(turn.steers[0]).toMatchObject({ threadId: "thread-1", expectedTurnId: turn.id });
		expect(inputText(turn.steers[0].input)).toBe("Use the v2 API");
		expect(fakeCodex.servers[0].turns).toHaveLength(1);
		expect(result.sessionOutput.result?.summary).toBe("steered");
	});

	it("sends a steer that missed the turn as the next turn", async () => {
		const events: SessionEvent[] = [];
		const session = new CodexSession((e) => events.push(e), fakeCodex.spawn);
		session.start({ prompt: "FIRST" });
		await new Promise((r) => setTimeout(r, 20));
		// The first turn is done: no active turn, so the steer starts a turn
		session.steer("late message");
		await new Promise((r) => setTimeout(r, 20));
		expect(fakeCodex.servers[0].turns.map((t) => t.text)).toEqual(["FIRST", "late message"]);
		session.close();
		expect(await session.done).toBeNull();
	});

	it("runs a steer rejected after its turn completed as the next turn", async () => {
		fakeCodex.holdSteers = true;
		fakeCodex.on("BUILD", async (turn) => {
			await turn.server.waitForHeldSteers(1);
			turn.message(resultBlock("done", "first"));
			turn.complete();
			// The steer answer comes after turn/completed: the turn is gone
			setTimeout(() => turn.server.releaseSteers(), 10);
		});
		fakeCodex.on("late steer", async (turn) => {
			turn.message(resultBlock("done", "second"));
			turn.complete();
		});
		let live: LiveSession | null = null;
		const pending = run("BUILD", {
			onLive: (handle) => {
				live = handle;
				return () => {
					live = null;
				};
			},
			nextMessages: async () => "",
		});
		await fakeCodex.waitFor("BUILD");
		await new Promise((r) => setTimeout(r, 10));
		expect((live as LiveSession | null)?.steer("late steer")).toBe(true);
		const result = await pending;
		expect(fakeCodex.servers[0].turns.map((t) => t.text)).toEqual(["BUILD", "late steer"]);
		expect(result.returncode).toBe(0);
		expect(result.sessionOutput.result?.summary).toBe("second");
	});

	it("keeps the session open for a turn started while the host was asked for messages", async () => {
		fakeCodex.on("BUILD", async (turn) => {
			turn.message(resultBlock("done", "first"));
			turn.complete();
		});
		fakeCodex.on("missed", async (turn) => {
			turn.message(resultBlock("done", "second"));
			turn.complete();
		});
		let live: LiveSession | null = null;
		let calls = 0;
		const result = await run("BUILD", {
			onLive: (handle) => {
				live = handle;
				return () => {
					live = null;
				};
			},
			nextMessages: async () => {
				calls += 1;
				// A steer that arrives while the turn is over starts a new turn
				if (calls === 1) (live as LiveSession | null)?.steer("missed the turn");
				return "";
			},
		});
		expect(fakeCodex.servers[0].turns.map((t) => t.text)).toEqual(["BUILD", "missed the turn"]);
		expect(result.sessionOutput.result?.summary).toBe("second");
	});

	it("ignores notifications of other threads", async () => {
		fakeCodex.on("BUILD", async (turn) => {
			const other = { threadId: "thread-other", turnId: "turn-other" };
			turn.server.notify("item/completed", {
				...other,
				item: { type: "agentMessage", id: "x", text: "foreign", phase: null, memoryCitation: null },
			});
			turn.server.notify("turn/completed", {
				threadId: "thread-other",
				turn: { id: "turn-other", items: [], status: "completed", error: null },
			});
			// A completion of another turn id on this thread is ignored too
			turn.server.notify("turn/completed", {
				threadId: turn.server.threadId,
				turn: { id: "turn-stale", items: [], status: "completed", error: null },
			});
			await new Promise((r) => setTimeout(r, 10));
			turn.message(resultBlock("done", "mine"));
			turn.complete();
		});
		const events: SessionEvent[] = [];
		const result = await run("BUILD", { onEvent: (e) => events.push(e) });
		expect(result.sessionOutput.result?.summary).toBe("mine");
		expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
		expect(events.some((e) => e.type === "item" && e.text === "foreign")).toBe(false);
	});

	it("does not kill the app-server after it exited on close", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const session = new CodexSession(() => {}, fakeCodex.spawn);
			session.start({ prompt: "FIRST" });
			await vi.advanceTimersByTimeAsync(50);
			expect(session.state).toBe("idle");
			session.close();
			await vi.advanceTimersByTimeAsync(5000);
			expect(await session.done).toBeNull();
			expect(fakeCodex.servers[0].closed).toBe(true);
			expect(fakeCodex.servers[0].killed).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("interrupts the running turn with turn/interrupt", async () => {
		fakeCodex.on("LONG", async (turn) => {
			await turn.waitForInterrupt();
			turn.complete("interrupted");
		});
		const events: SessionEvent[] = [];
		const session = new CodexSession((e) => events.push(e), fakeCodex.spawn);
		session.start({ prompt: "LONG" });
		const turn = await fakeCodex.waitFor("LONG");
		await new Promise((r) => setTimeout(r, 10));
		await session.interrupt();
		await new Promise((r) => setTimeout(r, 10));
		expect(turn.interrupted).toBe(true);
		expect(events.find((e) => e.type === "turn.completed")).toMatchObject({ isError: true });
		expect(session.state).toBe("idle");
		session.close();
		await session.done;
	});

	it("kills the app-server when the step is aborted", async () => {
		fakeCodex.on("LONG", async (turn) => {
			await turn.waitForInterrupt();
		});
		const abort = new AbortController();
		const pending = run("LONG", {}, { signal: abort.signal });
		await fakeCodex.waitFor("LONG");
		abort.abort();
		const result = await pending;
		expect(result.returncode).toBe(-1);
		expect(fakeCodex.servers[0].killed).toBe(true);
	});

	it("fails the step when the app-server exits", async () => {
		fakeCodex.on("CRASH", async (turn) => {
			turn.server.crash("thread panicked");
		});
		const result = await run("CRASH");
		expect(result.returncode).toBe(1);
		expect(result.stderr).toMatch(/codex app-server exited with code 1: thread panicked/);
	});

	it("reports a failed turn as an error", async () => {
		fakeCodex.on("BAD", async (turn) => {
			turn.complete("failed", "model_not_found");
		});
		const result = await run("BAD");
		expect(result.returncode).toBe(1);
		expect(result.stderr).toBe("model_not_found");
	});

	it("fails when the thread cannot start", async () => {
		fakeCodex.failThread = "no rollout found for thread id";
		const result = await run("HELLO", {}, { resumeSessionId: "gone" });
		expect(result.returncode).toBe(1);
		expect(result.stderr).toContain("no rollout found");
	});

	it("resumes a stored thread with thread/resume", async () => {
		const result = await run("CONTINUE", {}, { resumeSessionId: "thread-old" });
		const server = fakeCodex.servers[0];
		expect(server.threadMethod).toBe("thread/resume");
		expect(server.threadParams).toMatchObject({ threadId: "thread-old" });
		expect(result.sessionOutput.sessionId).toBe("thread-old");
	});

	it("uses a native skill input when Codex has the skill", async () => {
		fakeCodex.skills = [{ name: "esp-skills:esp-review", path: "/skills/esp-review/SKILL.md" }];
		const events: SessionEvent[] = [];
		const result = await run(
			"INLINED SKILL.md",
			{ onEvent: (e) => events.push(e) },
			{ cwd: "/repo", skill: { id: "esp-skills:esp-review", text: "--run-dir /r" } },
		);
		expect(result.returncode).toBe(0);
		const server = fakeCodex.servers[0];
		expect(server.sent("skills/list")[0].params).toEqual({ cwds: ["/repo"] });
		expect(server.turns[0].input).toEqual([
			{ type: "skill", name: "esp-skills:esp-review", path: "/skills/esp-review/SKILL.md" },
			{ type: "text", text: "$esp-skills:esp-review --run-dir /r", text_elements: [] },
		]);
		expect(events.find((e) => e.type === "notice")).toMatchObject({
			text: expect.stringContaining("native Codex skill esp-skills:esp-review"),
		});
	});

	it("falls back to the inlined prompt when Codex does not have the skill", async () => {
		fakeCodex.skills = [{ name: "other", path: "/skills/other/SKILL.md" }];
		const events: SessionEvent[] = [];
		await run(
			"INLINED SKILL.md",
			{ onEvent: (e) => events.push(e) },
			{ skill: { id: "esp-skills:esp-review", text: "--run-dir /r" } },
		);
		expect(fakeCodex.servers[0].turns[0].text).toBe("INLINED SKILL.md");
		expect(events.find((e) => e.type === "notice")).toMatchObject({
			text: expect.stringContaining("sending its SKILL.md inline"),
		});
	});

	it("fails when the skill is neither in Codex nor on disk", async () => {
		const result = await run(
			"",
			{},
			{
				skill: { id: "missing", text: "", fallbackError: "Skill 'missing' was not found" },
			},
		);
		expect(result.returncode).toBe(1);
		expect(result.stderr).toContain("Skill 'missing' was not found");
	});
});

describe("Codex driver selection", () => {
	it("defaults Codex to the session driver and keeps cli on request", () => {
		const config = getDefaultConfig();
		expect(getRuntimeDriver(config, "codex")).toBe("session");
		expect(getRuntimeDriver({ runtimes: { codex: { driver: "cli" } } }, "codex")).toBe("cli");
		const base = { config: {}, runtimeAdapter: adapter } as unknown as Parameters<
			typeof driverOptions
		>[0];
		expect(driverOptions({ ...base, config }, "s").driver).toBe("session");
		expect(
			driverOptions({ ...base, config: { runtimes: { codex: { driver: "cli" } } } }, "s"),
		).toEqual({ driver: "cli" });
	});

	it("keeps codex exec for driver: cli", () => {
		const command = adapter.buildCommand({ prompt: "hi", appendSystemPrompt: false });
		expect(command.args.slice(0, 3)).toEqual(["exec", "--sandbox", "workspace-write"]);
	});
});

describe("Codex protocol helpers", () => {
	it("matches commands against Bash allowlist rules", () => {
		expect(commandAllowed("rm -rf /", ["Bash"])).toBe(true);
		expect(commandAllowed("rm -rf /", ["Bash(*)"])).toBe(true);
		expect(commandAllowed("git status", ["Bash(git *)"])).toBe(true);
		expect(commandAllowed("git", ["Bash(git:*)"])).toBe(true);
		expect(commandAllowed("gitk", ["Bash(git *)"])).toBe(false);
		expect(commandAllowed("npm test", ["Bash(npm test)"])).toBe(true);
		expect(commandAllowed("npm test --all", ["Bash(npm test)"])).toBe(false);
		expect(commandAllowed("ls", ["Read", "Edit"])).toBe(false);
		expect(commandAllowed("ls", null)).toBe(false);
		// Shell control syntax never matches a prefix or exact rule
		for (const rule of ["Bash(git *)", "Bash(git:*)"]) {
			expect(commandAllowed("git status; rm -rf /", [rule])).toBe(false);
			expect(commandAllowed("git status && x", [rule])).toBe(false);
			expect(commandAllowed("git $(x)", [rule])).toBe(false);
			expect(commandAllowed("git status\nx", [rule])).toBe(false);
			expect(commandAllowed("git log | sh", [rule])).toBe(false);
			expect(commandAllowed("git log > out", [rule])).toBe(false);
			expect(commandAllowed("git `x`", [rule])).toBe(false);
		}
		expect(commandAllowed("npm test; x", ["Bash(npm test*)"])).toBe(false);
		expect(commandAllowed("ls; ls", ["Bash(ls; ls)"])).toBe(false);
		expect(commandAllowed("git status; rm -rf /", ["Bash"])).toBe(true);
		expect(commandAllowed("git status; rm -rf /", ["Bash(*)"])).toBe(true);
		expect(editsAllowed(["Read", "Write"])).toBe(true);
		expect(editsAllowed(["Bash"])).toBe(false);
	});

	it("finds a skill by full name, then by the name after the plugin", () => {
		const list = {
			data: [
				{
					cwd: "/r",
					skills: [
						{ name: "esp-review", path: "/a", description: "", scope: "repo", enabled: true },
						{ name: "off", path: "/b", description: "", scope: "repo", enabled: false },
					],
					errors: [],
				},
			],
		} as unknown as Parameters<typeof findCodexSkill>[1];
		expect(findCodexSkill("esp-skills:esp-review", list)).toEqual({
			name: "esp-review",
			path: "/a",
		});
		expect(findCodexSkill("esp-review", list)).toEqual({ name: "esp-review", path: "/a" });
		expect(findCodexSkill("off", list)).toBeNull();
		expect(findCodexSkill("nope", list)).toBeNull();
	});

	it("maps MCP tool calls and failed commands", () => {
		const call = codexItemEvents(
			{
				type: "mcpToolCall",
				id: "m1",
				server: "agentic-forge",
				tool: "af_status",
				status: "inProgress",
				arguments: { run: "r1" },
				result: null,
				error: null,
				durationMs: null,
			},
			false,
		);
		expect(call).toEqual([
			{
				type: "item",
				id: "m1",
				kind: "tool_call",
				status: "started",
				tool: "agentic-forge.af_status",
				input: { run: "r1" },
			},
		]);
		const failed = codexItemEvents(
			{
				type: "commandExecution",
				id: "c1",
				command: "false",
				cwd: "/r",
				processId: null,
				source: "agent",
				status: "completed",
				commandActions: [],
				aggregatedOutput: "",
				exitCode: 1,
				durationMs: 1,
			} as unknown as Parameters<typeof codexItemEvents>[0],
			true,
		);
		expect(failed[0]).toMatchObject({ kind: "tool_result", isError: true });
	});
});
