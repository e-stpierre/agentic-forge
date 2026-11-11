/**
 * Tests for the af MCP server (ORC-010): the dispatch and read tools
 * (af_dispatch, af_status, af_list_runs, af_events, af_artifacts) and the
 * steering tools (af_send, af_amend, af_answer, af_pause, af_resume,
 * af_cancel, af_retry_step) over an in-memory MCP transport, against an
 * in-process supervisor with the fake runtime.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectConsoleToStderr } from "../src/commands/mcp.js";
import { createMcpServer } from "../src/mcp/index.js";
import { RunManager } from "../src/runs/manager.js";
import type { RunEvent } from "../src/runs/run-store.js";
import type { RuntimeResult, RuntimeRunOptions } from "../src/runtimes/types.js";
import { SessionOutput } from "../src/runtimes/types.js";
import {
	Supervisor,
	SupervisorClient,
	SupervisorUnavailableError,
} from "../src/supervisor/index.js";
import { fakeRuntime } from "./helpers/fake-runtime.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const { fakeRuntime: fake } = await import("./helpers/fake-runtime.js");
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return { ...original, runRuntime: fake.run };
});

const home = useTempGlobalRoot();
let repo: string;
let elsewhere: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];
const mcpClients: Client[] = [];

const TWO_STEPS = `
name: two-steps
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: plan
    type: prompt
    prompt: "PLAN {{ topic }}"
  - name: build
    type: prompt
    prompt: "BUILD"
variables:
  - name: topic
    type: string
    required: true
`;

const COUNTED = `
name: counted
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: count
    type: prompt
    prompt: "COUNT {{ count }} {{ flag }}"
variables:
  - name: count
    type: string
    required: true
  - name: flag
    type: string
    required: false
    default: "off"
`;

function writeWorkflow(dir: string, name: string, contents: string): string {
	const file = path.join(dir, "agentic", "workflows", `${name}.yaml`);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, contents, "utf-8");
	return file;
}

async function startSupervisor() {
	const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
	const manager = new RunManager({ root: home.root });
	manager.attach(supervisor);
	const discovery = await supervisor.start();
	await manager.start();
	supervisors.push(supervisor);
	managers.push(manager);
	return { supervisor, manager, client: new SupervisorClient(discovery) };
}

async function connect(options: {
	getClient: () => Promise<SupervisorClient>;
	cwd?: string;
}): Promise<Client> {
	const server = createMcpServer({
		getClient: options.getClient,
		registryRoot: home.root,
		cwd: options.cwd ?? repo,
		version: "1.0.0",
	});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const mcp = new Client({ name: "mcp-test", version: "1.0.0" });
	await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
	mcpClients.push(mcp);
	return mcp;
}

async function setup(cwd?: string) {
	const started = await startSupervisor();
	const mcp = await connect({ getClient: async () => started.client, cwd });
	return { ...started, mcp };
}

interface ToolOutput {
	isError: boolean;
	text: string;
	// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of a tool result
	json: any;
}

async function callTool(
	mcp: Client,
	name: string,
	args: Record<string, unknown> = {},
): Promise<ToolOutput> {
	const result = await mcp.callTool({ name, arguments: args });
	const content = result.content as Array<{ type: string; text: string }>;
	const text = content.map((c) => c.text).join("\n");
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { isError: result.isError === true, text, json };
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

function block(value: Record<string, unknown>): string {
	return `Work log...
${JSON.stringify(value)}`;
}

const QUESTION = {
	id: "q1",
	question: "Which token store?",
	options: [
		{ id: "a", label: "Redis cache" },
		{ id: "b", label: "Database table" },
	],
	recommended: "a",
	context: "Both exist.",
	blocking: true,
};

function prompts(match: string): string[] {
	return fakeRuntime.calls.filter((c) => c.prompt.includes(match)).map((c) => c.prompt);
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

async function waitForStatus(manager: RunManager, id: string, status: string): Promise<void> {
	for (let i = 0; i < 300; i++) {
		if (manager.registry.get(id)?.status === status) {
			await manager.idle();
			return;
		}
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Run ${id} never reached ${status} (${manager.registry.get(id)?.status})`);
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-mcp-repo-"));
	elsewhere = mkdtempSync(path.join(tmpdir(), "af-mcp-cwd-"));
	writeWorkflow(repo, "two-steps", TWO_STEPS);
});

afterEach(async () => {
	await Promise.all(mcpClients.splice(0).map((c) => c.close()));
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	for (const dir of [repo, elsewhere]) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});

describe("server", () => {
	it("lists the twelve dispatch, read and steering tools, each with a title and a description", async () => {
		const { mcp } = await setup();
		const { tools } = await mcp.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual([
			"af_amend",
			"af_answer",
			"af_artifacts",
			"af_cancel",
			"af_dispatch",
			"af_events",
			"af_list_runs",
			"af_pause",
			"af_resume",
			"af_retry_step",
			"af_send",
			"af_status",
		]);
		for (const tool of tools) {
			expect(tool.title).toBeTruthy();
			expect(tool.description?.length).toBeGreaterThan(100);
			expect(tool.inputSchema.type).toBe("object");
		}
		const events = tools.find((t) => t.name === "af_events");
		expect(events?.inputSchema.properties).toHaveProperty("wait_seconds");
	});

	it("redirects console output to stderr", () => {
		const saved = { log: console.log, info: console.info, debug: console.debug };
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			redirectConsoleToStderr();
			console.log("a");
			console.info("b");
			console.debug("c");
			expect(spy.mock.calls).toEqual([["a"], ["b"], ["c"]]);
		} finally {
			Object.assign(console, saved);
			spy.mockRestore();
		}
	});

	it("never writes to stdout from src/mcp or the mcp command", () => {
		const root = path.join(__dirname, "..", "src");
		const files = [
			...readdirSync(path.join(root, "mcp")).map((f) => path.join(root, "mcp", f)),
			path.join(root, "commands", "mcp.ts"),
		];
		for (const file of files) {
			const source = readFileSync(file, "utf-8");
			expect(source, file).not.toMatch(/process\.stdout|console\.(log|info|debug)\(/);
		}
	});
});

describe("af_dispatch", () => {
	it("resolves a workflow name in <repo>/agentic/workflows, not the server's cwd", async () => {
		// Same name in the server's cwd with another prompt: it must not be used
		writeWorkflow(elsewhere, "two-steps", TWO_STEPS.replace("PLAN", "WRONG"));
		const { manager, mcp } = await setup(elsewhere);
		const res = await callTool(mcp, "af_dispatch", {
			workflow: "two-steps",
			repo,
			vars: { topic: "auth" },
			slug: "named",
		});
		expect(res.isError, res.text).toBe(false);
		expect(res.json.run_id).toMatch(/named/);
		expect(res.json.status).toMatch(/queued|running/);
		expect(res.json.workflow).toBe(path.join(repo, "agentic", "workflows", "two-steps.yaml"));
		expect(res.json.warnings).toEqual([]);
		await waitForStatus(manager, res.json.run_id, "done");
		const entry = manager.registry.get(res.json.run_id);
		expect(path.resolve(entry?.repo ?? "")).toBe(path.resolve(repo));
		expect(entry?.dir).toBe(res.json.dir);
		const prompts = fakeRuntime.calls.map((c) => c.prompt);
		expect(prompts.some((p) => p.includes("PLAN auth"))).toBe(true);
		expect(prompts.some((p) => p.includes("WRONG"))).toBe(false);
	});

	it("dispatches a path relative to the repo and coerces numbers and booleans", async () => {
		const file = path.join(repo, "flows", "counted.yaml");
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, COUNTED, "utf-8");
		const { manager, mcp } = await setup();
		const res = await callTool(mcp, "af_dispatch", {
			workflow: "flows/counted.yaml",
			vars: { count: 3, flag: true },
			priority: 2,
		});
		expect(res.isError, res.text).toBe(false);
		expect(res.json.workflow).toBe(file);
		await waitForStatus(manager, res.json.run_id, "done");
		expect(fakeRuntime.calls.some((c) => c.prompt.includes("COUNT 3 true"))).toBe(true);
		expect(manager.registry.get(res.json.run_id)?.priority).toBe(2);
	});

	it("returns the supervisor's missing variable error with a next step", async () => {
		const { mcp } = await setup();
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps" });
		expect(res.isError).toBe(true);
		expect(res.text).toContain("Missing required variable: topic (HTTP 400)");
		expect(res.text).toContain('vars: { "topic": "<value>" }');
	});

	it("rejects an unknown workflow and a missing repo with what to pass instead", async () => {
		const { mcp } = await setup();
		const unknown = await callTool(mcp, "af_dispatch", { workflow: "no-such-flow" });
		expect(unknown.isError).toBe(true);
		expect(unknown.text).toContain("Workflow not found: no-such-flow");
		expect(unknown.text).toContain("two-steps");
		expect(unknown.text).toContain("one-shot");
		const noRepo = await callTool(mcp, "af_dispatch", {
			workflow: "two-steps",
			repo: path.join(repo, "missing"),
		});
		expect(noRepo.isError).toBe(true);
		expect(noRepo.text).toContain("Repository directory not found");
		expect(noRepo.text).toContain("Pass repo as the absolute path");
	});
});

describe("af_status", () => {
	it("returns one run's details, and the active runs without a run", async () => {
		const { manager, mcp } = await setup();
		const release = hold("BUILD");
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await fakeRuntime.waitFor("BUILD");

		const active = await callTool(mcp, "af_status");
		expect(active.isError, active.text).toBe(false);
		expect(active.json.runs.map((r: { id: string }) => r.id)).toEqual([id]);
		expect(active.json.runs[0].status).toBe("running");

		const running = await callTool(mcp, "af_status", { run: id });
		expect(running.json.entry.status).toBe("running");
		expect(running.json.current_step).toBe("build");

		release();
		await waitForStatus(manager, id, "done");
		const done = await callTool(mcp, "af_status", { run: id });
		expect(done.json.entry.status).toBe("done");
		expect(done.json.run.status).toBe("done");
		expect(done.json.steps.map((s: { name: string }) => s.name)).toEqual(["plan", "build"]);
		expect((await callTool(mcp, "af_status")).json.runs).toEqual([]);
	});
});

describe("af_list_runs", () => {
	it("filters by status, repo and since, newest first, cut to limit", async () => {
		const { manager, mcp } = await setup();
		fakeRuntime.on("PLAN broken", "fail");
		const ids: string[] = [];
		for (const topic of ["one", "broken", "three"]) {
			const res = await callTool(mcp, "af_dispatch", {
				workflow: "two-steps",
				vars: { topic },
				slug: topic,
			});
			expect(res.isError, res.text).toBe(false);
			ids.push(res.json.run_id);
			await waitForStatus(manager, res.json.run_id, topic === "broken" ? "failed" : "done");
			// Distinct created_at for a stable newest-first order
			await new Promise((r) => setTimeout(r, 15));
		}

		const all = await callTool(mcp, "af_list_runs");
		expect(all.json.total).toBe(3);
		expect(all.json.runs.map((r: { id: string }) => r.id)).toEqual([...ids].reverse());

		const limited = await callTool(mcp, "af_list_runs", { limit: 1 });
		expect(limited.json.runs.map((r: { id: string }) => r.id)).toEqual([ids[2]]);
		expect(limited.json.total).toBe(3);

		const failed = await callTool(mcp, "af_list_runs", { status: "failed" });
		expect(failed.json.runs.map((r: { id: string }) => r.id)).toEqual([ids[1]]);
		const several = await callTool(mcp, "af_list_runs", { status: ["done", "failed"] });
		expect(several.json.total).toBe(3);

		expect((await callTool(mcp, "af_list_runs", { repo })).json.total).toBe(3);
		expect((await callTool(mcp, "af_list_runs", { repo: elsewhere })).json.total).toBe(0);
		expect((await callTool(mcp, "af_list_runs", { since: "1h" })).json.total).toBe(3);
		const future = new Date(Date.now() + 3_600_000).toISOString();
		expect((await callTool(mcp, "af_list_runs", { since: future })).json.total).toBe(0);

		const bad = await callTool(mcp, "af_list_runs", { since: "yesterday-ish" });
		expect(bad.isError).toBe(true);
		expect(bad.text).toContain("Invalid since: yesterday-ish");
		expect(bad.text).toContain("(HTTP 400)");
		expect(bad.text).toContain("call af_list_runs again");
	});
});

describe("af_events", () => {
	it("pages with a cursor and long-polls until a held step is released", async () => {
		const { manager, mcp } = await setup();
		const release = hold("BUILD");
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await fakeRuntime.waitFor("BUILD");
		// Let the step.started event of build reach the event file
		for (let i = 0; i < 100; i++) {
			const page = await callTool(mcp, "af_events", { run: id });
			if (
				page.json.events.some(
					(e: RunEvent) => e.type === "step.started" && e.data?.step === "build",
				)
			)
				break;
			await new Promise((r) => setTimeout(r, 10));
		}

		const first = await callTool(mcp, "af_events", { run: id });
		expect(first.isError, first.text).toBe(false);
		expect(first.json.status).toBe("running");
		expect(first.json.more).toBe(false);
		const seen: RunEvent[] = [...first.json.events];
		expect(seen.map((e) => e.type)).toContain("run.started");

		// Nothing new: a long-poll waits for the release
		const started = Date.now();
		const pending = callTool(mcp, "af_events", {
			run: id,
			cursor: first.json.cursor,
			wait_seconds: 10,
		});
		await new Promise((r) => setTimeout(r, 400));
		release();
		const second = await pending;
		expect(second.isError, second.text).toBe(false);
		expect(Date.now() - started).toBeGreaterThanOrEqual(350);
		expect(second.json.events.length).toBeGreaterThan(0);

		// Follow to the end with the cursor; no event is returned twice
		let cursor = second.json.cursor as string;
		seen.push(...second.json.events);
		while (!seen.some((e) => e.type === "run.completed")) {
			const page = await callTool(mcp, "af_events", { run: id, cursor, wait_seconds: 5 });
			expect(page.isError, page.text).toBe(false);
			seen.push(...page.json.events);
			cursor = page.json.cursor;
		}
		const seqs = seen.map((e) => e.seq);
		expect(new Set(seqs).size).toBe(seqs.length);
		expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
		await waitForStatus(manager, id, "done");

		// The wait ends without new events
		const waitStart = Date.now();
		const idle = await callTool(mcp, "af_events", { run: id, cursor, wait_seconds: 1 });
		expect(idle.json.events).toEqual([]);
		expect(idle.json.status).toBe("done");
		expect(Date.now() - waitStart).toBeGreaterThanOrEqual(900);
	});

	it("filters by type across runs and starts from now", async () => {
		const { manager, mcp } = await setup();
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		await waitForStatus(manager, res.json.run_id, "done");
		const runEvents = await callTool(mcp, "af_events", { types: ["run.*"] });
		const types = runEvents.json.events.map((e: RunEvent) => e.type);
		expect(types).toContain("run.completed");
		expect(types.every((t: string) => t.startsWith("run."))).toBe(true);
		const limited = await callTool(mcp, "af_events", { limit: 1 });
		expect(limited.json.events).toHaveLength(1);
		expect(limited.json.more).toBe(true);
		const fromNow = await callTool(mcp, "af_events", { from_now: true });
		expect(fromNow.json.events).toEqual([]);
		expect(typeof fromNow.json.cursor).toBe("string");
	});
});

describe("af_artifacts", () => {
	it("lists artifacts by kind and returns the latest content", async () => {
		const { manager, mcp } = await setup();
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await waitForStatus(manager, id, "done");
		const dir = res.json.dir as string;
		writeFileSync(path.join(dir, "plan.md"), "# Plan v1\n", "utf-8");
		writeFileSync(path.join(dir, "plan.v2.md"), "# Plan v2\n", "utf-8");
		writeFileSync(path.join(dir, "summary.md"), "# Summary\n\nAll done.\n", "utf-8");

		const all = await callTool(mcp, "af_artifacts", { run: id });
		expect(all.isError, all.text).toBe(false);
		expect(all.json.dir).toBe(dir);
		const byKind = Object.fromEntries(
			all.json.artifacts.map((a: { kind: string }) => [a.kind, a]),
		) as Record<string, { paths: string[]; latest: string | null }>;
		expect(Object.keys(byKind)).toEqual(["plan", "summary", "decisions", "review"]);
		expect(byKind.plan.paths).toEqual([path.join(dir, "plan.md"), path.join(dir, "plan.v2.md")]);
		expect(byKind.plan.latest).toBe(path.join(dir, "plan.v2.md"));
		expect(byKind.review.paths).toEqual([]);

		const plan = await callTool(mcp, "af_artifacts", { run: id, kind: "plan", content: true });
		expect(plan.json).toMatchObject({ run: id, kind: "plan", content: "# Plan v2\n" });
		const summary = await callTool(mcp, "af_artifacts", {
			run: id,
			kind: "summary",
			content: true,
		});
		expect(summary.json.content).toContain("All done.");

		const one = await callTool(mcp, "af_artifacts", { run: id, kind: "summary" });
		expect(one.json.artifacts).toHaveLength(1);

		const none = await callTool(mcp, "af_artifacts", { run: id, kind: "review", content: true });
		expect(none.isError).toBe(true);
		expect(none.text).toContain(`No review artifact in run ${id}`);
		const noKind = await callTool(mcp, "af_artifacts", { run: id, content: true });
		expect(noKind.isError).toBe(true);
		expect(noKind.text).toContain("content: true needs a kind");
	});
});

describe("af_send", () => {
	it("queues a next message for a step and rejects an unknown step and a finished run", async () => {
		const { client, manager, mcp } = await setup();
		const release = hold("PLAN");
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await fakeRuntime.waitFor("PLAN");

		const sent = await callTool(mcp, "af_send", { run: id, text: "Use pnpm.", step: "build" });
		expect(sent.isError, sent.text).toBe(false);
		expect(sent.json.message).toMatchObject({
			text: "Use pnpm.",
			mode: "next",
			target: "step",
			step: "build",
			from: "overseer",
		});
		const listed = await client.request<{ messages: { id: string }[] }>(
			"GET",
			`/v1/runs/${id}/messages`,
		);
		expect(listed.messages.map((m) => m.id)).toEqual([sent.json.message.id]);

		const unknown = await callTool(mcp, "af_send", { run: id, text: "x", step: "nope" });
		expect(unknown.isError).toBe(true);
		expect(unknown.text).toContain("Unknown step 'nope'. Steps: plan, build (HTTP 400)");
		expect(unknown.text).toContain("call af_send again");

		release();
		await waitForStatus(manager, id, "done");
		expect(prompts("BUILD")[0]).toContain("Use pnpm.");
		expect(prompts("PLAN")[0]).not.toContain("Use pnpm.");

		const finished = await callTool(mcp, "af_send", { run: id, text: "Too late.", from: "user" });
		expect(finished.isError).toBe(true);
		expect(finished.text).toContain("Cannot send a message to a run in 'done' status (HTTP 409)");
		expect(finished.text).toContain("Call af_status to see the run's current status.");
	});

	it("mode now restarts the running step with the message", async () => {
		const { manager, mcp } = await setup();
		fakeRuntime.on("BUILD", "hang");
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await fakeRuntime.waitFor("BUILD");
		fakeRuntime.reset();
		const sent = await callTool(mcp, "af_send", {
			run: id,
			text: "Stop, use pnpm.",
			mode: "now",
			step: "build",
		});
		expect(sent.isError, sent.text).toBe(false);
		expect(sent.json.message.mode).toBe("now");
		await waitForStatus(manager, id, "done");
		const restarted = prompts("BUILD");
		expect(restarted).toHaveLength(1);
		expect(restarted[0]).toContain("Stop, use pnpm.");
	});
});

describe("af_amend", () => {
	it("records an amendment with affects and delivers it to the next step", async () => {
		const { manager, mcp } = await setup();
		const release = hold("PLAN");
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await fakeRuntime.waitFor("PLAN");
		const amended = await callTool(mcp, "af_amend", {
			run: id,
			text: "Drop the cache layer.",
			affects: ["M2"],
		});
		expect(amended.isError, amended.text).toBe(false);
		expect(amended.json).toMatchObject({ id, amendment: "A001", delivery: "message", step: null });
		release();
		await waitForStatus(manager, id, "done");
		expect(prompts("BUILD")[0]).toContain("Drop the cache layer.");
		const finished = await callTool(mcp, "af_amend", { run: id, text: "More." });
		expect(finished.isError).toBe(true);
		expect(finished.text).toContain("(HTTP 409)");
	});
});

describe("af_answer", () => {
	it("answers a needs_input question and the run resumes to done", async () => {
		const { manager, mcp } = await setup();
		let asks = 0;
		fakeRuntime.on("BUILD", (o) => {
			asks++;
			if (asks === 1) {
				return reply(
					o,
					block({ status: "awaiting-human", summary: "Need a choice.", needs_input: QUESTION }),
					10,
				);
			}
			return reply(o, block({ status: "done", summary: "Built with Redis." }));
		});
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await waitForStatus(manager, id, "awaiting-human");

		const status = await callTool(mcp, "af_status", { run: id });
		const requestId = status.json.run["x-af-needs-input"].request.id as string;
		expect(requestId).toBe("q1");

		const wrong = await callTool(mcp, "af_answer", { run: id, request_id: "q9", answer: "a" });
		expect(wrong.isError).toBe(true);
		expect(wrong.text).toContain("Unknown request 'q9'. Pending: q1 (HTTP 404)");

		const answered = await callTool(mcp, "af_answer", {
			run: id,
			request_id: requestId,
			answer: "a",
		});
		expect(answered.isError, answered.text).toBe(false);
		expect(answered.json).toMatchObject({ id, request: "q1", status: "queued" });
		await waitForStatus(manager, id, "done");
		expect(prompts("BUILD")[1]).toContain('Answer to q1 ("Which token store?"): a (Redis cache)');

		const again = await callTool(mcp, "af_answer", { run: id, answer: "b" });
		expect(again.isError).toBe(true);
		expect(again.text).toContain("Cannot answer a run in 'done' status (HTTP 409)");
		expect(again.text).toContain("Call af_status");
	});
});

describe("af_pause and af_resume", () => {
	it("pauses at the step boundary and resumes from the next step", async () => {
		const { manager, mcp } = await setup();
		const release = hold("PLAN");
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await fakeRuntime.waitFor("PLAN");

		const running = await callTool(mcp, "af_resume", { run: id });
		expect(running.isError).toBe(true);
		expect(running.text).toContain("Cannot resume run in 'running' status (HTTP 409)");
		expect(running.text).toContain("Call af_status to see the run's current status.");

		const paused = await callTool(mcp, "af_pause", { run: id });
		expect(paused.isError, paused.text).toBe(false);
		expect(paused.json).toEqual({ id, status: "pausing" });
		release();
		await waitForStatus(manager, id, "paused");
		expect(prompts("BUILD")).toHaveLength(0);

		const resumed = await callTool(mcp, "af_resume", { run: id });
		expect(resumed.isError, resumed.text).toBe(false);
		expect(resumed.json).toEqual({ id, status: "queued" });
		await waitForStatus(manager, id, "done");
		expect(prompts("PLAN")).toHaveLength(1);
		expect(prompts("BUILD")).toHaveLength(1);

		const finished = await callTool(mcp, "af_pause", { run: id });
		expect(finished.isError).toBe(true);
		expect(finished.text).toContain("Cannot pause run in 'done' status (HTTP 409)");
	});

	it("pause now kills the held step, which reruns on resume", async () => {
		const { manager, mcp } = await setup();
		fakeRuntime.on("BUILD", "hang");
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await fakeRuntime.waitFor("BUILD");
		const paused = await callTool(mcp, "af_pause", { run: id, now: true });
		expect(paused.isError, paused.text).toBe(false);
		expect(paused.json.status).toBe("pausing");
		await waitForStatus(manager, id, "paused");
		expect(fakeRuntime.calls.find((c) => c.prompt.includes("BUILD"))?.aborted).toBe(true);

		fakeRuntime.reset();
		const resumed = await callTool(mcp, "af_resume", { run: id });
		expect(resumed.json.status).toBe("queued");
		await waitForStatus(manager, id, "done");
		expect(prompts("PLAN")).toHaveLength(0);
		expect(prompts("BUILD")).toHaveLength(1);
	});
});

describe("af_cancel", () => {
	it("cancels a held run and returns a 409 for a finished run", async () => {
		const { manager, mcp } = await setup();
		fakeRuntime.on("BUILD", "hang");
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await fakeRuntime.waitFor("BUILD");
		const canceled = await callTool(mcp, "af_cancel", { run: id });
		expect(canceled.isError, canceled.text).toBe(false);
		expect(canceled.json).toEqual({ id, status: "canceling" });
		await waitForStatus(manager, id, "canceled");
		expect(fakeRuntime.calls.find((c) => c.prompt.includes("BUILD"))?.aborted).toBe(true);

		const again = await callTool(mcp, "af_cancel", { run: id });
		expect(again.isError).toBe(true);
		expect(again.text).toContain("Cannot cancel run in 'canceled' status (HTTP 409)");
		expect(again.text).toContain("Call af_status to see the run's current status.");
	});
});

describe("af_retry_step", () => {
	it("reruns a failed run from a step with context", async () => {
		const { manager, mcp } = await setup();
		fakeRuntime.on("BUILD", "fail");
		const res = await callTool(mcp, "af_dispatch", { workflow: "two-steps", vars: { topic: "x" } });
		const id = res.json.run_id as string;
		await waitForStatus(manager, id, "failed");

		const notTop = await callTool(mcp, "af_retry_step", { run: id, step: "nope" });
		expect(notTop.isError).toBe(true);
		expect(notTop.text).toContain("'nope' is not a top-level step. Steps: plan, build (HTTP 400)");

		fakeRuntime.reset();
		const retried = await callTool(mcp, "af_retry_step", {
			run: id,
			step: "plan",
			context: "Use the v2 API.",
		});
		expect(retried.isError, retried.text).toBe(false);
		expect(retried.json).toMatchObject({ id, step: "plan", status: "queued" });
		expect(retried.json.message).toMatch(/^m-/);
		await waitForStatus(manager, id, "done");
		expect(prompts("PLAN")[0]).toContain("Use the v2 API.");
		expect(prompts("BUILD")).toHaveLength(1);

		const finished = await callTool(mcp, "af_retry_step", { run: id, step: "plan" });
		expect(finished.isError).toBe(true);
		expect(finished.text).toContain("(HTTP 409)");
	});
});

describe("end to end", () => {
	it("dispatches a workflow by name and follows it to completion through MCP tools only", async () => {
		const { mcp } = await setup();
		const res = await callTool(mcp, "af_dispatch", {
			workflow: "two-steps",
			vars: { topic: "e2e" },
		});
		expect(res.isError, res.text).toBe(false);
		const id = res.json.run_id as string;

		const types: string[] = [];
		let cursor: string | undefined;
		for (let i = 0; i < 20 && !types.includes("run.completed"); i++) {
			const page = await callTool(mcp, "af_events", {
				run: id,
				wait_seconds: 5,
				...(cursor ? { cursor } : {}),
			});
			expect(page.isError, page.text).toBe(false);
			types.push(...page.json.events.map((e: RunEvent) => e.type));
			cursor = page.json.cursor;
		}
		expect(types).toContain("run.started");
		expect(types).toContain("run.completed");

		const status = await callTool(mcp, "af_status", { run: id });
		expect(status.json.entry.status).toBe("done");
		expect(status.json.steps.map((s: { name: string }) => s.name)).toEqual(["plan", "build"]);
		const artifacts = await callTool(mcp, "af_artifacts", { run: id });
		expect(artifacts.isError, artifacts.text).toBe(false);
		expect(artifacts.json).toMatchObject({ run: id, dir: res.json.dir });
		expect(artifacts.json.artifacts).toHaveLength(4);
	});
});

describe("errors", () => {
	it("returns isError results for schema violations naming the field", async () => {
		const { mcp } = await setup();
		const cases: [string, Record<string, unknown>, RegExp][] = [
			["af_artifacts", {}, /run/],
			["af_artifacts", { run: "x", kind: "bogus" }, /kind must be one of plan, summary/],
			["af_events", { wait_seconds: 121 }, /wait_seconds must be an integer from 0 to 120/],
			["af_events", { wait_seconds: 1.5 }, /wait_seconds/],
			["af_status", { run: "" }, /af_list_runs/],
			["af_list_runs", { status: "sleeping" }, /status must be/],
			["af_list_runs", { limit: 0 }, /limit must be an integer/],
			["af_dispatch", {}, /workflow/],
			["af_dispatch", { workflow: "two-steps", runtime: "gpt" }, /runtime must be claude or codex/],
			["af_send", { run: "x", text: "hi", mode: "later" }, /mode must be next or now/],
			["af_send", { run: "x", text: "" }, /text must not be empty/],
			["af_send", { run: "x", text: "hi", from: "bot" }, /from must be user or overseer/],
			["af_amend", { run: "x", text: "t", affects: [""] }, /affects entry must not be empty/],
			["af_amend", { run: "x", text: "t", affects: "M2" }, /affects must be a list/],
			["af_answer", { run: "x" }, /answer/],
			["af_pause", { run: "x", now: "yes" }, /now must be a boolean/],
			["af_resume", {}, /run/],
			["af_cancel", { run: "" }, /af_list_runs/],
			["af_retry_step", { run: "x" }, /step/],
		];
		for (const [tool, args, pattern] of cases) {
			const res = await callTool(mcp, tool, args);
			expect(res.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
			expect(res.text).toMatch(pattern);
		}
	});

	it("maps an unknown run to a 404 with the af_list_runs hint", async () => {
		const { mcp } = await setup();
		for (const [tool, args] of [
			["af_status", { run: "nope" }],
			["af_events", { run: "nope" }],
			["af_artifacts", { run: "nope" }],
			["af_send", { run: "nope", text: "hi" }],
			["af_amend", { run: "nope", text: "hi" }],
			["af_answer", { run: "nope", answer: "a" }],
			["af_pause", { run: "nope" }],
			["af_resume", { run: "nope" }],
			["af_cancel", { run: "nope" }],
			["af_retry_step", { run: "nope", step: "plan" }],
		] as const) {
			const res = await callTool(mcp, tool, args);
			expect(res.isError).toBe(true);
			expect(res.text).toContain("Run not found: nope");
			expect(res.text).toContain("Use af_list_runs to find run ids.");
		}
		expect((await callTool(mcp, "af_status", { run: "nope" })).text).toContain("(HTTP 404)");
		const badCursor = await callTool(mcp, "af_events", { cursor: "not-a-cursor" });
		expect(badCursor.isError).toBe(true);
		expect(badCursor.text).toContain("(HTTP 400)");
	});

	it("reports an unreachable supervisor after one retry", async () => {
		let calls = 0;
		const mcp = await connect({
			getClient: async () => {
				calls++;
				throw new SupervisorUnavailableError("Supervisor did not start within 10 ms");
			},
		});
		const res = await callTool(mcp, "af_list_runs");
		expect(res.isError).toBe(true);
		expect(res.text).toContain("The af supervisor is not reachable");
		expect(res.text).toContain("Start it with af serve --detach, then call af_list_runs again.");
		expect(calls).toBe(2);
	});

	it("drops a stale cached client and retries with a fresh one", async () => {
		const { client: live } = await startSupervisor();
		// A supervisor that restarted on another port leaves the cached client unreachable
		const stale = new SupervisorClient({ ...live.discovery, port: 1 });
		const handed: SupervisorClient[] = [stale, live];
		let calls = 0;
		const mcp = await connect({ getClient: async () => handed[calls++] ?? live });
		const res = await callTool(mcp, "af_list_runs");
		expect(res.isError, res.text).toBe(false);
		expect(res.json.runs).toEqual([]);
		expect(calls).toBe(2);
		// The fresh client is cached
		await callTool(mcp, "af_list_runs");
		expect(calls).toBe(2);
	});

	it("does not resend a control call when the supervisor is unreachable", async () => {
		const { client: live } = await startSupervisor();
		const stale = new SupervisorClient({ ...live.discovery, port: 1 });
		const handed: SupervisorClient[] = [stale, live];
		let calls = 0;
		const mcp = await connect({ getClient: async () => handed[calls++] ?? live });
		const res = await callTool(mcp, "af_cancel", { run: "nope" });
		expect(res.isError).toBe(true);
		expect(res.text).toContain("The af supervisor is not reachable");
		expect(calls).toBe(1);
		// The stale client was dropped: the next call finds the live supervisor
		const next = await callTool(mcp, "af_cancel", { run: "nope" });
		expect(next.text).toContain("(HTTP 404)");
		expect(calls).toBe(2);
	});
});
