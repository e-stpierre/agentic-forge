/**
 * Token Budget Rules of the MCP tools: every tool's default result stays
 * under RESULT_BUDGET_BYTES for a large run (20 steps, 200 events, a 50 KB
 * plan), cut content says so and names the way to the rest, event payload
 * strings are bounded at write time, and the tools/list response has a size
 * budget.
 *
 * Set AF_MEASURE_SIZES to a file path to write the measured sizes as JSON.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import {
	ARTIFACT_DEFAULT_CHARS,
	RESULT_BUDGET_BYTES,
	RUNS_MCP_DEFAULT_LIMIT,
	TOOLS_LIST_BUDGET_BYTES,
} from "../src/mcp/budgets.js";
import { createMcpServer } from "../src/mcp/index.js";
import { summaryChars } from "../src/mcp/views.js";
import { EVENT_STRING_MAX, boundEventData, cutText } from "../src/runs/event-data.js";
import { encodeCursor } from "../src/runs/events.js";
import { RunManager, STEP_ERROR_FILE } from "../src/runs/manager.js";
import { type RunEvent, RunStore } from "../src/runs/run-store.js";
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

const STEP_COUNT = 20;
const EVENT_COUNT = 200;

const TWENTY = `
name: twenty
version: "1.0"
settings:
  max-retry: 0
steps:
${Array.from(
	{ length: STEP_COUNT },
	(_, i) => `  - name: step-${i + 1}
    type: prompt
    prompt: "STEP ${i + 1}"`,
).join("\n")}
`;

const HELD = `
name: held
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: build
    type: prompt
    prompt: "HELD build"
  - name: after
    type: prompt
    prompt: "AFTER build"
`;

const FAILING = `
name: failing
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: crash
    type: prompt
    prompt: "CRASH now"
`;

function writeWorkflow(name: string, contents: string): void {
	const file = path.join(repo, "agentic", "workflows", `${name}.yaml`);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, contents, "utf-8");
}

function reply(options: RuntimeRunOptions, stdout: string, returncode = 0): RuntimeResult {
	return {
		returncode,
		stdout,
		stderr: returncode === 0 ? "" : stdout,
		prompt: options.prompt,
		cwd: null,
		model: null,
		success: returncode === 0,
		sessionOutput: SessionOutput.fromStdout(stdout),
	};
}

async function setup(env: NodeJS.ProcessEnv = {}) {
	const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
	const manager = new RunManager({ root: home.root });
	manager.attach(supervisor);
	const discovery = await supervisor.start();
	await manager.start();
	supervisors.push(supervisor);
	managers.push(manager);
	const client = new SupervisorClient(discovery);
	const mcp = await connect(client, env);
	return { manager, client, mcp };
}

async function connect(client: SupervisorClient, env: NodeJS.ProcessEnv = {}): Promise<Client> {
	const server = createMcpServer({
		getClient: async () => client,
		registryRoot: home.root,
		cwd: repo,
		version: "1.0.0",
		env,
	});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const mcp = new Client({ name: "budget-test", version: "1.0.0" });
	await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
	mcpClients.push(mcp);
	return mcp;
}

interface Sized {
	isError: boolean;
	text: string;
	bytes: number;
	// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of a tool result
	json: any;
}

const sizes: Record<string, number> = {};

async function call(
	mcp: Client,
	name: string,
	args: Record<string, unknown> = {},
	label = name,
): Promise<Sized> {
	const result = await mcp.callTool({ name, arguments: args });
	const text = (result.content as Array<{ text: string }>).map((c) => c.text).join("\n");
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	const bytes = Buffer.byteLength(text, "utf-8");
	sizes[label] = bytes;
	return { isError: result.isError === true, text, bytes, json };
}

/** Asserts a default result: compact JSON (or an error text) under the budget. */
function expectSmall(res: Sized, label: string): void {
	expect(res.bytes, `${label}: ${res.bytes} bytes`).toBeLessThan(RESULT_BUDGET_BYTES);
	if (!res.isError) expect(res.text, label).not.toContain("\n  ");
}

async function waitForStatus(manager: RunManager, id: string, status: string): Promise<void> {
	for (let i = 0; i < 500; i++) {
		if (manager.registry.get(id)?.status === status) {
			await manager.idle();
			return;
		}
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Run ${id} never reached ${status} (${manager.registry.get(id)?.status})`);
}

function bigPlan(): string {
	const sections: string[] = ["---\nstatus: draft\n---\n", "# Plan\n"];
	for (let m = 1; sections.join("\n").length < 50_000; m++) {
		sections.push(`## Milestone M${m}\n`);
		sections.push(`${"Implement the next part of the feature with tests. ".repeat(20)}\n`);
	}
	return sections.join("\n");
}

const SUMMARY = `---
status: done
max_risk: medium
decisions: 4
findings: 2
---

# Summary

${"Everything that happened in the run. ".repeat(400)}
`;

/** Appends events of the usual shapes until the run has EVENT_COUNT events. */
async function fillEvents(store: RunStore): Promise<void> {
	let i = 0;
	while (store.readEvents().length < EVENT_COUNT) {
		i++;
		if (i % 3 === 0) {
			await store.appendEvent("message.queued", {
				id: `m${i}`,
				from: "overseer",
				mode: "next",
				target: "step",
				step: "step-20",
			});
		} else if (i % 3 === 1) {
			await store.appendEvent("message.delivered", { id: `m${i}`, step: "step-20" });
		} else {
			await store.appendEvent("notification.sent", {
				channels: ["desktop"],
				text: "x".repeat(2_000),
			});
		}
	}
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-budget-repo-"));
	writeWorkflow("twenty", TWENTY);
	writeWorkflow("held", HELD);
	writeWorkflow("failing", FAILING);
});

afterEach(async () => {
	await Promise.all(mcpClients.splice(0).map((c) => c.close()));
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	const out = process.env.AF_MEASURE_SIZES;
	if (out) {
		const previous = existsSync(out) ? JSON.parse(readFileSync(out, "utf-8")) : {};
		writeFileSync(out, JSON.stringify({ ...previous, ...sizes }, null, 2));
	}
});

describe("event payload bounds", () => {
	it("cuts every string over 500 characters at any depth and reports it", () => {
		const long = "y".repeat(EVENT_STRING_MAX + 1);
		const bounded = boundEventData({ a: long, b: [{ c: long }], n: 3, ok: "short" });
		expect(bounded.cut).toBe(true);
		expect(bounded.data.a).toHaveLength(EVENT_STRING_MAX);
		expect((bounded.data.a as string).endsWith("...")).toBe(true);
		expect((bounded.data.b as Array<{ c: string }>)[0].c).toHaveLength(EVENT_STRING_MAX);
		expect(bounded.data).toMatchObject({ n: 3, ok: "short" });
		expect(boundEventData({ a: "short" })).toEqual({ data: { a: "short" }, cut: false });
		expect(cutText("abc", 10)).toBe("abc");
	});

	it("keeps the full payload of a cut event in event-data and names it", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "af-budget-run-"));
		try {
			const store = new RunStore(dir);
			const event = await store.appendEvent("notification.sent", { text: "z".repeat(1_200) });
			expect((event.data?.text as string).length).toBe(EVENT_STRING_MAX);
			const file = event.data?.data_path as string;
			expect(file).toBe(path.join(dir, "event-data", `${event.seq}-notification.sent.json`));
			expect(JSON.parse(readFileSync(file, "utf-8")).text).toHaveLength(1_200);
			const short = await store.appendEvent("message.delivered", { id: "m1" });
			expect(short.data).toEqual({ id: "m1" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("cuts the step.failed error and writes the full text to the step directory", async () => {
		const error = `Boom: ${"stack line\n".repeat(200)}`;
		fakeRuntime.on("CRASH", (o) => reply(o, error, 1));
		const { manager, mcp } = await setup();
		const res = await call(mcp, "af_dispatch", { workflow: "failing" });
		const id = res.json.run_id as string;
		await waitForStatus(manager, id, "failed");
		const failed = new RunStore(res.json.dir)
			.readEvents()
			.find((e: RunEvent) => e.type === "step.failed");
		expect(failed?.data?.step).toBe("crash");
		expect((failed?.data?.error as string).length).toBeLessThanOrEqual(EVENT_STRING_MAX);
		const file = failed?.data?.error_path as string;
		expect(file).toBe(path.join(res.json.dir, "steps", "01-crash", STEP_ERROR_FILE));
		const full = readFileSync(file, "utf-8");
		expect(full.length).toBeGreaterThan(EVENT_STRING_MAX);
		expect(full).toContain("Boom:");
		for (const event of new RunStore(res.json.dir).readEvents()) {
			for (const value of Object.values(event.data ?? {})) {
				if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(EVENT_STRING_MAX);
			}
		}
	});
});

describe("tool result sizes", () => {
	it("keeps every tool's default result under the budget for a large run", async () => {
		const longOutput = `${"Step output with details. ".repeat(200)}`;
		fakeRuntime.on("STEP", (o) => reply(o, longOutput));
		const release = (() => {
			let open!: () => void;
			const gate = new Promise<void>((r) => {
				open = r;
			});
			fakeRuntime.on("HELD", async (o) => {
				await gate;
				return reply(o, "ok");
			});
			return () => open();
		})();
		const { manager, client, mcp } = await setup();

		// A finished run with 20 steps, 200 events, a 50 KB plan and a summary
		const dispatched = await call(mcp, "af_dispatch", { workflow: "twenty" });
		expectSmall(dispatched, "af_dispatch");
		const id = dispatched.json.run_id as string;
		const dir = dispatched.json.dir as string;
		await waitForStatus(manager, id, "done");
		const store = new RunStore(dir);
		await fillEvents(store);
		expect(store.readEvents()).toHaveLength(EVENT_COUNT);
		const plan = bigPlan();
		expect(plan.length).toBeGreaterThanOrEqual(50_000);
		writeFileSync(path.join(dir, "plan.md"), plan, "utf-8");
		writeFileSync(path.join(dir, "summary.md"), SUMMARY, "utf-8");

		const status = await call(mcp, "af_status", { run: id });
		expectSmall(status, "af_status(run)");
		expect(status.json.steps).toHaveLength(STEP_COUNT);
		const chars = summaryChars(STEP_COUNT);
		for (const step of status.json.steps) expect(step.summary.length).toBeLessThanOrEqual(chars);
		const verbose = await call(mcp, "af_status", { run: id, verbose: true }, "af_status(verbose)");
		expect(verbose.json.steps).toHaveLength(STEP_COUNT);

		const history = await call(mcp, "af_events", { from_start: true }, "af_events(from_start)");
		expectSmall(history, "af_events(from_start)");
		expect(history.json.more).toBe(true);
		// Paging with the cursor returns the rest without gaps
		let seen = history.json.events.length as number;
		let cursor = history.json.cursor as string;
		for (let i = 0; i < 100 && seen < EVENT_COUNT; i++) {
			const page = await call(mcp, "af_events", { cursor }, "af_events(page)");
			expectSmall(page, "af_events(page)");
			seen += page.json.events.length;
			cursor = page.json.cursor;
		}
		expect(seen).toBe(EVENT_COUNT);
		expectSmall(await call(mcp, "af_events"), "af_events");

		expectSmall(await call(mcp, "af_wait", { run: id }), "af_wait");
		expectSmall(await call(mcp, "af_wait", { runs: [id] }), "af_wait(runs)");
		expectSmall(await call(mcp, "af_digest"), "af_digest");
		const replay = await call(mcp, "af_digest", { cursor: encodeCursor({}) }, "af_digest(replay)");
		expectSmall(replay, "af_digest(replay)");
		expectSmall(await call(mcp, "af_logs", { run: id }), "af_logs");
		expectSmall(
			await call(mcp, "af_usage", { run: id, by: "step" }, "af_usage(by step)"),
			"af_usage(by step)",
		);
		expectSmall(await call(mcp, "af_usage", { scope: "mcp" }, "af_usage(mcp)"), "af_usage(mcp)");

		expectSmall(await call(mcp, "af_artifacts", { run: id }), "af_artifacts");
		const planContent = await call(
			mcp,
			"af_artifacts",
			{ run: id, kind: "plan", content: true },
			"af_artifacts(plan content)",
		);
		expectSmall(planContent, "af_artifacts(plan content)");
		expect(planContent.json).toMatchObject({
			offset: 0,
			total_chars: plan.length,
			truncated: true,
			next_offset: ARTIFACT_DEFAULT_CHARS,
		});
		expect(planContent.json.content).toBe(plan.slice(0, ARTIFACT_DEFAULT_CHARS));
		const nextPage = await call(
			mcp,
			"af_artifacts",
			{ run: id, kind: "plan", content: true, offset: planContent.json.next_offset },
			"af_artifacts(plan page 2)",
		);
		expect(nextPage.json.content).toBe(
			plan.slice(ARTIFACT_DEFAULT_CHARS, 2 * ARTIFACT_DEFAULT_CHARS),
		);
		const section = await call(
			mcp,
			"af_artifacts",
			{ run: id, kind: "plan", section: "Milestone M3" },
			"af_artifacts(plan section)",
		);
		expectSmall(section, "af_artifacts(plan section)");
		expect(section.json.section).toBe("Milestone M3");
		expect(section.json.content.startsWith("## Milestone M3")).toBe(true);
		expect(section.json.content).not.toContain("## Milestone M4");
		expect(section.json.truncated).toBe(false);
		const unknown = await call(mcp, "af_artifacts", { run: id, kind: "plan", section: "Nope" });
		expect(unknown.isError).toBe(true);
		expect(unknown.text).toContain("Milestone M1");
		const frontmatter = await call(
			mcp,
			"af_artifacts",
			{ run: id, kind: "summary", frontmatter_only: true },
			"af_artifacts(summary frontmatter)",
		);
		expectSmall(frontmatter, "af_artifacts(summary frontmatter)");
		expect(frontmatter.json.frontmatter).toEqual({
			status: "done",
			max_risk: "medium",
			decisions: 4,
			findings: 2,
		});
		expect(frontmatter.json.content).toBeUndefined();
		const wrongKind = await call(mcp, "af_artifacts", {
			run: id,
			kind: "plan",
			frontmatter_only: true,
		});
		expect(wrongKind.isError).toBe(true);

		// A running run: the steering tools and af_ask
		const held = await call(mcp, "af_dispatch", { workflow: "held" }, "af_dispatch(held)");
		const heldId = held.json.run_id as string;
		await fakeRuntime.waitFor("HELD");
		expectSmall(await call(mcp, "af_status"), "af_status");
		expectSmall(
			await call(mcp, "af_send", { run: heldId, text: "Use pnpm.", step: "build" }),
			"af_send",
		);
		expectSmall(await call(mcp, "af_amend", { run: heldId, text: "Drop M3." }), "af_amend");
		const asker = await connect(client, { AF_RUN_ID: heldId, AF_STEP: "build" });
		const asked = await call(
			asker,
			"af_ask",
			{ question: "Which store?", options: ["Redis", "Postgres"], wait_seconds: 0 },
			"af_ask",
		);
		expectSmall(asked, "af_ask");
		expectSmall(await call(mcp, "af_answer", { run: heldId, answer: "a" }), "af_answer");
		expectSmall(await call(mcp, "af_pause", { run: heldId }), "af_pause");
		release();
		await waitForStatus(manager, heldId, "paused");
		expectSmall(await call(mcp, "af_resume", { run: heldId }), "af_resume");
		await waitForStatus(manager, heldId, "done");
		expectSmall(await call(mcp, "af_cancel", { run: heldId }), "af_cancel");
		expectSmall(await call(mcp, "af_retry_step", { run: heldId, step: "build" }), "af_retry_step");
		expectSmall(await call(mcp, "af_notify", { text: "Heads up" }), "af_notify");

		// The backlog tools of an overseer run
		const overseer = await client.request<{ run: { id: string } }>("POST", "/v1/overseer", {
			repo_root: repo,
			config: getDefaultConfig(),
			env: {},
		});
		const items = Array.from({ length: 10 }, (_, i) => ({
			title: `Task ${i + 1}: ${"implement the part ".repeat(5)}`,
			source: "epic",
		}));
		expectSmall(
			await call(mcp, "af_backlog_add", { run: overseer.run.id, items }),
			"af_backlog_add",
		);
		expectSmall(await call(mcp, "af_backlog_list", { run: overseer.run.id }), "af_backlog_list");
		expectSmall(
			await call(mcp, "af_backlog_update", {
				run: overseer.run.id,
				id: "T01",
				fields: { status: "dropped" },
			}),
			"af_backlog_update",
		);

		// Many runs: af_list_runs and af_status list at most RUNS_MCP_DEFAULT_LIMIT
		for (let i = 0; i < 30; i++) {
			const at = new Date(Date.now() - i * 1000).toISOString();
			await manager.registry.upsert({
				id: `2026-11-14-extra-${i}`,
				dir: path.join(home.root, "runs", `2026-11-14-extra-${i}`),
				repo,
				workflow: "twenty",
				status: "done",
				worktree: false,
				priority: 0,
				created_at: at,
				updated_at: at,
			});
		}
		const listed = await call(mcp, "af_list_runs");
		expectSmall(listed, "af_list_runs");
		expect(listed.json.runs).toHaveLength(RUNS_MCP_DEFAULT_LIMIT);
		expect(listed.json.total).toBeGreaterThan(30);
	}, 30_000);

	it("keeps the tools/list response under its budget", async () => {
		const { mcp } = await setup();
		const list = await mcp.listTools();
		const bytes = Buffer.byteLength(JSON.stringify(list), "utf-8");
		sizes["tools/list"] = bytes;
		expect(bytes).toBeLessThan(TOOLS_LIST_BUDGET_BYTES);
		for (const tool of list.tools) {
			expect(tool.description?.length, tool.name).toBeLessThanOrEqual(600);
		}
	});
});
