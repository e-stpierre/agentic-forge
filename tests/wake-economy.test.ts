/**
 * Tests for the wake-up economy: af_wait (`boundary`, `runs`, the client
 * defaults), af_digest, and `af events --compact --until`, against an
 * in-process supervisor with the fake runtime.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdEvents } from "../src/commands/events.js";
import { getVersion } from "../src/commands/version.js";
import { RESULT_BUDGET_BYTES } from "../src/mcp/budgets.js";
import { createMcpServer } from "../src/mcp/index.js";
import { DIGEST_TYPES } from "../src/mcp/tools-digest.js";
import { defaultWaitSeconds } from "../src/mcp/tools.js";
import { cursorAfter, formatEventCompact } from "../src/runs/client.js";
import { decodeCursor, encodeCursor } from "../src/runs/events.js";
import { RunManager } from "../src/runs/manager.js";
import type { RunEvent } from "../src/runs/run-store.js";
import {
	DEFAULT_WAIT_SECONDS,
	LONG_WAIT_SECONDS,
	eventMeets,
	wakeReason,
} from "../src/runs/wait.js";
import type { RuntimeResult, RuntimeRunOptions } from "../src/runtimes/types.js";
import { SessionOutput } from "../src/runtimes/types.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
import { fakeRuntime } from "./helpers/fake-runtime.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const { fakeRuntime: fake } = await import("./helpers/fake-runtime.js");
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return { ...original, runRuntime: fake.run };
});

const home = useTempGlobalRoot();
let repo: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];
const mcpClients: Client[] = [];

function workflowYaml(name: string, steps: string[]): string {
	return [
		`name: ${name}`,
		'version: "1.0"',
		"settings:",
		"  max-retry: 0",
		"steps:",
		...steps.flatMap((step) => [
			`  - name: ${step.toLowerCase()}`,
			"    type: prompt",
			`    prompt: "${step}"`,
		]),
		"",
	].join("\n");
}

const repos: string[] = [];

function writeWorkflow(name: string, steps: string[], dir = repo): void {
	const file = path.join(dir, "agentic", "workflows", `${name}.yaml`);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, workflowYaml(name, steps), "utf-8");
}

/** Another repository (a run holds its checkout: runs in one repo run one at a time). */
function otherRepo(name: string, steps: string[]): string {
	const dir = mkdtempSync(path.join(tmpdir(), "af-wake-other-"));
	repos.push(dir);
	writeWorkflow(name, steps, dir);
	return dir;
}

async function startSupervisor() {
	const supervisor = new Supervisor({ root: home.root, version: getVersion() });
	const manager = new RunManager({ root: home.root });
	manager.attach(supervisor);
	const discovery = await supervisor.start();
	await manager.start();
	supervisors.push(supervisor);
	managers.push(manager);
	return { manager, client: new SupervisorClient(discovery) };
}

async function connect(client: SupervisorClient, name = "mcp-test"): Promise<Client> {
	const server = createMcpServer({
		getClient: async () => client,
		registryRoot: home.root,
		cwd: repo,
		version: "1.0.0",
	});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const mcp = new Client({ name, version: "1.0.0" });
	await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
	mcpClients.push(mcp);
	return mcp;
}

interface ToolOutput {
	isError: boolean;
	text: string;
	// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of a tool result
	json: any;
}

async function call(mcp: Client, name: string, args: Record<string, unknown> = {}) {
	const result = await mcp.callTool({ name, arguments: args });
	const text = (result.content as Array<{ text: string }>).map((c) => c.text).join("\n");
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { isError: result.isError === true, text, json } as ToolOutput;
}

function reply(options: RuntimeRunOptions, stdout: string, returncode = 0): RuntimeResult {
	return {
		returncode,
		stdout,
		stderr: returncode === 0 ? "" : "exit",
		prompt: options.prompt,
		cwd: null,
		model: null,
		success: returncode === 0,
		sessionOutput: SessionOutput.fromStdout(stdout),
	};
}

/** Holds prompts containing `match` until the returned function is called. */
function hold(match: string): () => void {
	let release!: () => void;
	const released = new Promise<void>((r) => {
		release = r;
	});
	fakeRuntime.on(match, async (o) => {
		await released;
		return reply(o, "ok");
	});
	return () => release();
}

function askOn(match: string): void {
	fakeRuntime.on(match, (o) =>
		reply(
			o,
			`Work log...\n${JSON.stringify({
				status: "awaiting-human",
				summary: "Need a choice.",
				needs_input: {
					id: "q1",
					question: "Which token store?",
					options: [
						{ id: "a", label: "Redis" },
						{ id: "b", label: "Table" },
					],
					recommended: "a",
					blocking: true,
				},
			})}`,
		),
	);
}

async function waitForStatus(manager: RunManager, id: string, status: string): Promise<void> {
	for (let i = 0; i < 500; i++) {
		// No manager.idle(): a held run keeps the manager busy
		if (manager.registry.get(id)?.status === status) return;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Run ${id} never reached ${status} (${manager.registry.get(id)?.status})`);
}

async function dispatch(
	mcp: Client,
	workflow: string,
	dir?: string,
): Promise<{ run: string; cursor: string }> {
	const res = await call(mcp, "af_dispatch", { workflow, ...(dir ? { repo: dir } : {}) });
	expect(res.isError, res.text).toBe(false);
	return { run: res.json.run_id, cursor: res.json.cursor };
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-wake-repo-"));
	writeWorkflow("two-steps", ["PLAN", "BUILD"]);
});

afterEach(async () => {
	await Promise.all(mcpClients.splice(0).map((c) => c.close()));
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	for (const dir of [repo, ...repos.splice(0)]) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});

describe("wait conditions", () => {
	it("boundary wakes on a step end, attention does not", () => {
		const events = [{ type: "step.started" }, { type: "step.completed" }] as RunEvent[];
		expect(wakeReason("boundary", "running", events, false)).toBe("step.completed");
		expect(wakeReason("attention", "running", events, false)).toBeNull();
		expect(wakeReason("terminal", "done", [], false)).toBe("done");
		expect(eventMeets("terminal", "run.completed")).toBe(true);
		expect(eventMeets("terminal", "needs_input")).toBe(false);
		expect(eventMeets("attention", "needs_input")).toBe(true);
		expect(eventMeets("attention", "step.completed")).toBe(false);
		expect(eventMeets("boundary", "step.completed")).toBe(true);
	});

	it("defaults to a long wait only on clients with a long tool timeout", async () => {
		expect(defaultWaitSeconds({ clients: null as never, cwd: "." })).toBe(DEFAULT_WAIT_SECONDS);
		const ctx = (name: string) => ({ clients: null as never, cwd: ".", clientName: () => name });
		expect(defaultWaitSeconds(ctx("claude-code"))).toBe(LONG_WAIT_SECONDS);
		expect(defaultWaitSeconds(ctx("codex-mcp-client"))).toBe(LONG_WAIT_SECONDS);
		expect(defaultWaitSeconds(ctx("claude-ai"))).toBe(DEFAULT_WAIT_SECONDS);
		// The MCP server reads the name the client sent at initialization
		const { client } = await startSupervisor();
		const mcp = await connect(client, "claude-code");
		const tools = await mcp.listTools();
		const wait = tools.tools.find((t) => t.name === "af_wait");
		expect(JSON.stringify(wait?.inputSchema)).toContain(String(LONG_WAIT_SECONDS));
	});
});

describe("af_wait", () => {
	it("follows a 10-step run to completion in at most 2 calls, under the result budget", async () => {
		const steps = Array.from({ length: 10 }, (_, i) => `STEP${i + 1}`);
		writeWorkflow("ten-steps", steps);
		const { client } = await startSupervisor();
		const mcp = await connect(client);
		const { run, cursor } = await dispatch(mcp, "ten-steps");

		// The first call takes the cursor af_dispatch returned, the next ones af_wait's
		let calls = 0;
		let res: ToolOutput;
		let next: string | number = cursor;
		do {
			res = await call(mcp, "af_wait", { run, until: "terminal", cursor: next, timeout_seconds: 30 });
			expect(res.isError, res.text).toBe(false);
			next = res.json.cursor;
			calls += 1;
		} while (res.json.state === "waiting" && calls < 5);
		expect(calls).toBeLessThanOrEqual(2);
		expect(res.json).toMatchObject({ run, status: "done", state: "ended", reason: "done" });
		expect(Buffer.byteLength(res.text)).toBeLessThan(RESULT_BUDGET_BYTES);
	});

	it("returns waiting with a cursor on timeout, and boundary on the next step end", async () => {
		const { manager, client } = await startSupervisor();
		const mcp = await connect(client);
		const releasePlan = hold("PLAN");
		const releaseBuild = hold("BUILD");
		const { run } = await dispatch(mcp, "two-steps");

		const timedOut = await call(mcp, "af_wait", { run, until: "boundary", timeout_seconds: 0.2 });
		expect(timedOut.json).toMatchObject({ run, state: "waiting" });
		expect(typeof timedOut.json.cursor).toBe("number");

		releasePlan();
		const boundary = await call(mcp, "af_wait", {
			run,
			until: "boundary",
			cursor: timedOut.json.cursor,
			timeout_seconds: 10,
		});
		expect(boundary.json).toMatchObject({
			run,
			status: "running",
			state: "boundary",
			reason: "step.completed",
		});

		releaseBuild();
		await waitForStatus(manager, run, "done");
	});

	it("waits on several runs and reports each final status once", async () => {
		const asks = otherRepo("asks", ["ASK"]);
		askOn("ASK");
		const { manager, client } = await startSupervisor();
		const mcp = await connect(client);
		const release = hold("BUILD");
		const slow = await dispatch(mcp, "two-steps");
		const asking = await dispatch(mcp, "asks", asks);
		await waitForStatus(manager, asking.run, "awaiting-human");

		const first = await call(mcp, "af_wait", {
			runs: [slow.run, asking.run],
			until: "attention",
			timeout_seconds: 10,
		});
		expect(first.isError, first.text).toBe(false);
		expect(first.json.state).toBe("attention");
		expect(first.json.woke.map((r: { run: string }) => r.run)).toEqual([asking.run]);
		expect(first.json.woke[0].needs_input[0]).toMatchObject({ id: "q1" });
		expect(first.json.waiting).toEqual([slow.run]);
		expect(typeof first.json.cursor).toBe("string");

		// The question is reported once: the next call waits for the other run
		const again = await call(mcp, "af_wait", {
			runs: [slow.run, asking.run],
			until: "attention",
			cursor: first.json.cursor,
			timeout_seconds: 0.2,
		});
		expect(again.json).toMatchObject({ state: "waiting", woke: [] });

		release();
		const ended = await call(mcp, "af_wait", {
			runs: [slow.run, asking.run],
			cursor: again.json.cursor,
			timeout_seconds: 10,
		});
		expect(ended.json.state).toBe("ended");
		expect(ended.json.woke.map((r: { run: string }) => r.run)).toEqual([slow.run]);

		// An ended run already reported does not wake the waiter again
		const after = await call(mcp, "af_wait", {
			runs: [slow.run],
			cursor: ended.json.cursor,
			timeout_seconds: 0.2,
		});
		expect(after.json).toMatchObject({ state: "waiting", woke: [], ended: [slow.run] });
	});

	it("refuses run and runs together, and a cursor of the other form", async () => {
		const { client } = await startSupervisor();
		const mcp = await connect(client);
		const both = await call(mcp, "af_wait", { run: "a", runs: ["b"] });
		expect(both.isError).toBe(true);
		expect(both.text).toContain("Pass either run or runs");
		const wrong = await call(mcp, "af_wait", { runs: ["b"], cursor: 3 });
		expect(wrong.isError).toBe(true);
		expect(wrong.text).toContain("cursor does not match");
	});
});

describe("af_digest", () => {
	it("lists active runs and reports only the needs_input and the failure raised since its cursor", async () => {
		const earlyRepo = otherRepo("asks", ["ASK"]);
		const asks = otherRepo("asks", ["ASK"]);
		const breaks = otherRepo("breaks", ["BREAK"]);
		askOn("ASK");
		fakeRuntime.on("BREAK", "fail");
		const { manager, client } = await startSupervisor();
		const mcp = await connect(client);

		// Before the cursor: a run that asks (its event must not be reported)
		const early = await dispatch(mcp, "asks", earlyRepo);
		await waitForStatus(manager, early.run, "awaiting-human");

		const start = await call(mcp, "af_digest");
		expect(start.isError, start.text).toBe(false);
		expect(start.json.changes).toEqual([]);
		expect(start.json.runs).toEqual([`${early.run} asks awaiting-human needs_input=1`]);
		expect(start.json.cursor).toMatch(/^c1\./);

		const release = hold("BUILD");
		const running = await dispatch(mcp, "two-steps");
		const asking = await dispatch(mcp, "asks", asks);
		const failing = await dispatch(mcp, "breaks", breaks);
		await waitForStatus(manager, asking.run, "awaiting-human");
		await waitForStatus(manager, failing.run, "failed");

		const digest = await call(mcp, "af_digest", { cursor: start.json.cursor });
		expect(digest.isError, digest.text).toBe(false);
		const changes = digest.json.changes as { run: string; type: string }[];
		expect(changes.map((c) => [c.run, c.type])).toEqual(
			expect.arrayContaining([
				[asking.run, "needs_input"],
				[failing.run, "step.failed"],
				[failing.run, "run.failed"],
			]),
		);
		expect(changes).toHaveLength(3);
		expect(changes.every((c) => (DIGEST_TYPES as readonly string[]).includes(c.type))).toBe(true);
		expect(changes.find((c) => c.type === "needs_input")).toMatchObject({
			id: "q1",
			text: "Which token store?",
		});
		expect(digest.json.runs).toContain(`${running.run} two-steps running step=build`);
		expect(digest.json.runs).not.toContain(expect.stringContaining(failing.run));
		expect(Buffer.byteLength(digest.text)).toBeLessThan(RESULT_BUDGET_BYTES);

		// Nothing new since the returned cursor
		const quiet = await call(mcp, "af_digest", { cursor: digest.json.cursor });
		expect(quiet.json.changes).toEqual([]);
		release();
		await waitForStatus(manager, running.run, "done");
	});

	it("stays under the result budget with 20 active runs", async () => {
		const { manager, client } = await startSupervisor();
		const mcp = await connect(client);
		const release = hold("PLAN");
		const runs: string[] = [];
		// One checkout: the first run holds it, the others stay queued
		for (let i = 0; i < 22; i++) runs.push((await dispatch(mcp, "two-steps")).run);
		await waitForStatus(manager, runs[0], "running");
		const digest = await call(mcp, "af_digest");
		expect(digest.json.runs).toHaveLength(20);
		expect(digest.json.more_runs).toBe(2);
		expect(Buffer.byteLength(digest.text)).toBeLessThan(RESULT_BUDGET_BYTES);
		release();
		for (const id of runs) await call(mcp, "af_cancel", { run: id });
	});
});

describe("af events --compact --until", () => {
	function captureStdout() {
		let out = "";
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
			out += String(chunk);
			return true;
		});
		return { text: () => out, restore: () => spy.mockRestore() };
	}

	it("prints one short line per matching event and exits on the first attention event", async () => {
		writeWorkflow("asks", ["PLAN", "ASK", "LATER"]);
		askOn("ASK");
		const { manager, client } = await startSupervisor();
		const mcp = await connect(client);
		const { run } = await dispatch(mcp, "asks");
		await waitForStatus(manager, run, "awaiting-human");

		const cursorFile = path.join(home.root, "monitor", "cursor.txt");
		const out = captureStdout();
		try {
			await cmdEvents({
				run,
				types: "needs_input,run.*,step.*",
				compact: true,
				until: "attention",
				cursorFile,
			});
		} finally {
			out.restore();
		}
		const lines = out.text().trim().split("\n");
		expect(lines.at(-1)).toMatch(/^\d\d:\d\d:\d\d needs_input ask q1$/);
		expect(lines.some((l) => / step\.completed plan completed$/.test(l))).toBe(true);
		expect(lines.every((l) => l.length < 80)).toBe(true);
		// run.paused comes after needs_input: the command stopped before it
		expect(lines.some((l) => l.includes("run.paused"))).toBe(false);

		// The cursor file stops just after the attention event
		const next = captureStdout();
		try {
			await cmdEvents({ run, types: "run.*", compact: true, cursorFile });
		} finally {
			next.restore();
		}
		expect(next.text()).toMatch(/run\.paused awaiting-human/);
	});

	it("renders compact lines and cuts a page cursor after an event", () => {
		const event = (run: string, seq: number, type: string, data = {}) =>
			({ run, seq, type, at: "2026-11-14T10:11:12.000Z", data }) as RunEvent;
		expect(
			formatEventCompact(event("r1", 3, "step.failed", { step: "build", error: "x".repeat(900) })),
		).toBe("10:11:12 r1 step.failed build");
		expect(formatEventCompact(event("r1", 4, "run.failed", { status: "failed" }), false)).toBe(
			"10:11:12 run.failed failed",
		);
		const events = [event("a", 5, "x"), event("b", 2, "x"), event("a", 6, "x"), event("c", 9, "x")];
		const cursor = cursorAfter(encodeCursor({ a: 6, b: 2, c: 9 }), events, 1);
		expect(decodeCursor(cursor)).toEqual({ a: 5, b: 2, c: 8 });
	});
});
