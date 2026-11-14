/**
 * Tests for the overseer backlog: the backlog model (items, triage,
 * dependencies, transitions, budgets), the scheduler (dependencies, conflict
 * zones, max_parallel, halts), discovered items, the answer policy, and the
 * supervisor and MCP sides (backlog routes, dispatch of an item, item outcome
 * from its run, discovered items of a child run, policy answers).
 * In-process supervisor, fake runtime.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig, getOverseerConfig } from "../src/config.js";
import { createMcpServer } from "../src/mcp/index.js";
import {
	type BacklogFile,
	acceptDiscovered,
	addItems,
	dispatchRefusal,
	emptyBacklog,
	evaluateAnswerPolicy,
	reconcileItems,
	scheduleBacklog,
	startItem,
	updateItem,
	zonesOverlap,
} from "../src/runs/backlog.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager } from "../src/runs/manager.js";
import type { OverseerOpenResult } from "../src/runs/overseer.js";
import { RunStore } from "../src/runs/run-store.js";
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

const DEFAULTS = getOverseerConfig({});

function withConfig(overseer: Record<string, unknown>) {
	return getOverseerConfig({ overseer });
}

function backlog(): BacklogFile {
	return emptyBacklog("2026-11-12-overseer");
}

function triaged(title: string, extra: Record<string, unknown> = {}) {
	return { title, status: "ready", track: "light", track_reason: "small change", ...extra };
}

function schedule(b: BacklogFile, config = DEFAULTS, runMinutes = 0) {
	return scheduleBacklog(b, { config, runMinutes });
}

describe("overseer config", () => {
	it("has the budget defaults and falls back on invalid values", () => {
		expect(DEFAULTS).toEqual({
			maxParallel: 2,
			acceptDiscoveredItems: "ask",
			haltEpicOn: ["halted", "critical", "budget"],
			budgets: { maxTasks: 20, maxRetries: 1, maxRunMinutes: 480 },
			answerPolicy: { enabled: true, maxRisk: "low", recommendedOnly: true, blocking: true },
		});
		const bad = withConfig({
			max_parallel: 0,
			accept_discovered_items: "maybe",
			halt_epic_on: ["failed", "nope"],
			budgets: { max_tasks: -1 },
			answer_policy: { max_risk: "critical", enabled: false },
		});
		expect(bad.maxParallel).toBe(2);
		expect(bad.acceptDiscoveredItems).toBe("ask");
		expect(bad.haltEpicOn).toEqual(["failed"]);
		expect(bad.budgets.maxTasks).toBe(20);
		expect(bad.answerPolicy).toMatchObject({ enabled: false, maxRisk: "low" });
	});
});

describe("backlog items", () => {
	it("adds proposed items with ids in order, dependencies inside the batch included", () => {
		const b = backlog();
		const added = addItems(
			b,
			[{ title: "Add the cache" }, { title: "Use the cache", depends_on: ["T01"] }],
			DEFAULTS,
		);
		expect(added.map((i) => [i.id, i.status, i.source])).toEqual([
			["T01", "proposed", "user"],
			["T02", "proposed", "user"],
		]);
		expect(b.next).toBe(3);
		expect(addItems(b, [{ title: "Third" }], DEFAULTS)[0].id).toBe("T03");
	});

	it("requires a reason with a track, and a track before ready", () => {
		const b = backlog();
		expect(() => addItems(b, [{ title: "x", track: "full" }], DEFAULTS)).toThrow(
			/track_reason is required/,
		);
		expect(() => addItems(b, [{ title: "x", status: "ready" }], DEFAULTS)).toThrow(/triage it/);
		const [item] = addItems(b, [{ title: "x" }], DEFAULTS);
		expect(() => updateItem(b, item.id, { status: "ready" }, DEFAULTS)).toThrow(/triage it/);
		const updated = updateItem(
			b,
			item.id,
			{ track: "instruction", track_reason: "one-line fix", status: "ready" },
			DEFAULTS,
		);
		expect(updated).toMatchObject({
			track: "instruction",
			track_reason: "one-line fix",
			status: "ready",
		});
		// A new track needs its own reason
		expect(() => updateItem(b, item.id, { track: "full" }, DEFAULTS)).toThrow(
			/track_reason is required/,
		);
	});

	it("refuses unknown fields, unknown or cyclic dependencies and the harness statuses", () => {
		const b = backlog();
		expect(() => addItems(b, [{ title: "x", color: "red" } as never], DEFAULTS)).toThrow(
			/Unknown item field/,
		);
		expect(() => addItems(b, [{ title: "x", depends_on: ["T09"] }], DEFAULTS)).toThrow(
			/unknown item T09/,
		);
		addItems(b, [{ title: "a" }, { title: "b", depends_on: ["T01"] }], DEFAULTS);
		expect(() => updateItem(b, "T01", { depends_on: ["T02"] }, DEFAULTS)).toThrow(
			/cycle: T01 -> T02 -> T01/,
		);
		expect(() => updateItem(b, "T01", { status: "running" }, DEFAULTS)).toThrow(/af_dispatch/);
		expect(() => updateItem(b, "T01", { status: "done" }, DEFAULTS)).toThrow(
			/cannot go from proposed to done/,
		);
		expect(() => updateItem(b, "T07", { title: "x" }, DEFAULTS)).toThrow(
			/Unknown backlog item T07/,
		);
		expect(() => addItems(b, [{ title: "x", source: "discovered" }], DEFAULTS)).toThrow(
			/set by the harness/,
		);
	});

	it("refuses items past budgets.max_tasks but still logs them", () => {
		const config = withConfig({ budgets: { max_tasks: 2 } });
		const b = backlog();
		addItems(b, [{ title: "a" }, { title: "b" }], config);
		expect(() => addItems(b, [{ title: "c" }], config)).toThrow(/Task budget exhausted/);
		expect(addItems(b, [{ title: "c", status: "logged" }], config)[0].status).toBe("logged");
		expect(() => updateItem(b, "T03", { status: "proposed" }, config)).toThrow(
			/Task budget exhausted/,
		);
		updateItem(b, "T01", { status: "dropped" }, config);
		expect(updateItem(b, "T03", { status: "proposed" }, config).status).toBe("proposed");
	});

	it("takes the outcome of its run, and goes back to ready for a retry", () => {
		const b = backlog();
		addItems(b, [triaged("a")], DEFAULTS);
		startItem(b, "T01", "run-1");
		expect(() => updateItem(b, "T01", { conflict_zones: ["src"] }, DEFAULTS)).toThrow(/is running/);
		expect(reconcileItems(b, () => "awaiting-human")).toEqual([]);
		expect(reconcileItems(b, () => "failed").map((i) => i.status)).toEqual(["failed"]);
		expect(updateItem(b, "T01", { status: "ready" }, DEFAULTS).runs).toEqual(["run-1"]);
		startItem(b, "T01", "run-2");
		reconcileItems(b, () => "merged");
		expect(b.items[0]).toMatchObject({ status: "done", run: "run-2", runs: ["run-1", "run-2"] });
		expect(() => updateItem(b, "T01", { status: "ready" }, DEFAULTS)).toThrow(
			/cannot go from done/,
		);
	});

	it("follows a run reopened after the item took its outcome", () => {
		const b = backlog();
		addItems(b, [triaged("a"), triaged("b")], DEFAULTS);
		startItem(b, "T01", "run-1");
		reconcileItems(b, () => "failed");
		expect(b.items[0].status).toBe("failed");
		// A missing run leaves an ended item as it is
		expect(reconcileItems(b, () => null)).toEqual([]);
		expect(reconcileItems(b, () => "queued").map((i) => i.status)).toEqual(["running"]);
		expect(reconcileItems(b, () => "running")).toEqual([]);
		reconcileItems(b, () => "halted");
		expect(b.items[0].status).toBe("halted");
		reconcileItems(b, () => "done");
		expect(b.items[0].status).toBe("done");

		// Set ready for a retry, then the old run is resumed instead
		startItem(b, "T02", "run-2");
		reconcileItems(b, () => "failed");
		updateItem(b, "T02", { status: "ready" }, DEFAULTS);
		const open = (run: string) => (run === "run-2" ? "queued" : "done");
		expect(dispatchRefusal(b, "T02", schedule(b), open)).toMatch(
			/T02 still has an open run run-2 \(queued\)/,
		);
		expect(reconcileItems(b, open).map((i) => i.id)).toEqual(["T02"]);
		expect(b.items[1].status).toBe("running");
		expect(dispatchRefusal(b, "T02", schedule(b), () => "failed")).toMatch(/T02 is running/);
	});
});

describe("backlog scheduling", () => {
	it("overlaps zones by path prefix, case and slashes aside", () => {
		expect(zonesOverlap("src/runs", "src/runs/manager.ts")).toBe(true);
		expect(zonesOverlap("./src/Runs/", "src\\runs\\backlog.ts")).toBe(true);
		expect(zonesOverlap("src/runs/**", "src/runs/x.ts")).toBe(true);
		expect(zonesOverlap("src/run", "src/runs")).toBe(false);
		expect(zonesOverlap("docs", "src")).toBe(false);
		expect(zonesOverlap("*", "src")).toBe(true);
	});

	it("never runs two items with overlapping conflict zones in parallel", () => {
		const b = backlog();
		addItems(
			b,
			[
				triaged("cache", { conflict_zones: ["src/cache"] }),
				triaged("cache client", { conflict_zones: ["src/cache/client.ts"] }),
				triaged("docs", { conflict_zones: ["docs"] }),
			],
			DEFAULTS,
		);
		let view = schedule(b);
		expect(view.runnable).toEqual(["T01", "T03"]);
		expect(view.waiting.T02).toMatch(/conflicts with T01 \(starts first\)/);
		startItem(b, "T01", "run-1");
		view = schedule(b);
		expect(view.runnable).toEqual(["T03"]);
		expect(view.waiting.T02).toMatch(/conflicts with T01 \(running\)/);
	});

	it("runs at most max_parallel items (default 2), by priority", () => {
		const b = backlog();
		addItems(
			b,
			[
				triaged("a", { conflict_zones: ["a"] }),
				triaged("b", { conflict_zones: ["b"] }),
				triaged("c", { conflict_zones: ["c"], priority: 5 }),
			],
			DEFAULTS,
		);
		const view = schedule(b);
		expect(view.max_parallel).toBe(2);
		expect(view.runnable).toEqual(["T03", "T01"]);
		expect(view.waiting.T02).toBe("max_parallel 2 reached");
		expect(schedule(b, withConfig({ max_parallel: 3 })).runnable).toHaveLength(3);
	});

	it("waits for dependencies, triage and retries, and runs an item without zones alone", () => {
		const b = backlog();
		addItems(
			b,
			[
				triaged("a", { conflict_zones: ["a"] }),
				triaged("b", { conflict_zones: ["b"], depends_on: ["T01"] }),
				triaged("anything"),
			],
			DEFAULTS,
		);
		let view = schedule(b);
		expect(view.runnable).toEqual(["T01"]);
		expect(view.waiting.T02).toBe("depends on T01 (ready)");
		expect(view.waiting.T03).toMatch(/no conflict_zones/);
		startItem(b, "T01", "r1");
		reconcileItems(b, () => "done");
		view = schedule(b);
		expect(view.runnable).toEqual(["T02"]);
		// Retries: one extra run by default
		startItem(b, "T02", "r2");
		reconcileItems(b, () => "failed");
		updateItem(b, "T02", { status: "ready" }, DEFAULTS);
		startItem(b, "T02", "r3");
		reconcileItems(b, () => "failed");
		updateItem(b, "T02", { status: "ready" }, DEFAULTS);
		expect(schedule(b).waiting.T02).toMatch(/retries exhausted \(2 runs/);
	});

	it("halts the epic on a halted item, an open critical finding or the run minutes budget", () => {
		const b = backlog();
		addItems(
			b,
			[triaged("a", { conflict_zones: ["a"] }), triaged("b", { conflict_zones: ["b"] })],
			DEFAULTS,
		);
		expect(schedule(b, DEFAULTS, 480).halt).toMatch(/budget: 480 run minutes/);
		startItem(b, "T01", "r1");
		reconcileItems(b, () => "halted");
		let view = schedule(b);
		expect(view.halt).toMatch(/T01 halted/);
		expect(view.runnable).toEqual([]);
		expect(view.waiting.T02).toBe("epic halted");
		expect(schedule(b, withConfig({ halt_epic_on: [] })).runnable).toEqual(["T02"]);
		updateItem(b, "T01", { status: "dropped" }, DEFAULTS);
		acceptDiscovered(
			b,
			{ run: "r1", step: "review" },
			[{ type: "security", title: "Token leak", severity: "critical" }],
			DEFAULTS,
		);
		view = schedule(b);
		expect(view.halt).toMatch(/critical finding T03/);
	});
});

describe("discovered items and the answer policy", () => {
	it("adds discovered items per accept_discovered_items, once per run, step and title", () => {
		const items = [{ type: "bug", title: "Null check", severity: "low", files: ["src/a.ts"] }];
		for (const [policy, status] of [
			["auto", "ready"],
			["ask", "proposed"],
			["log", "logged"],
		] as const) {
			const b = backlog();
			const config = withConfig({ accept_discovered_items: policy });
			const [outcome] = acceptDiscovered(b, { run: "r1", step: "build" }, items, config);
			expect(outcome.status).toBe(status);
			expect(outcome.item).toMatchObject({
				source: "discovered",
				track: null,
				conflict_zones: ["src/a.ts"],
				discovered: { run: "r1", step: "build", type: "bug", severity: "low" },
			});
			expect(acceptDiscovered(b, { run: "r1", step: "build" }, items, config)).toEqual([]);
		}
		const full = backlog();
		const config = withConfig({ accept_discovered_items: "auto", budgets: { max_tasks: 1 } });
		addItems(full, [{ title: "only" }], config);
		const [logged] = acceptDiscovered(full, { run: "r1", step: "build" }, items, config);
		expect(logged.status).toBe("logged");
		expect(logged.reason).toMatch(/task budget spent/);
	});

	it("adds the discovered items of every run of one backlog item once", () => {
		const items = [{ type: "bug", title: "Null check" }];
		const b = backlog();
		const config = withConfig({ accept_discovered_items: "ask" });
		addItems(b, [triaged("a")], config);
		startItem(b, "T01", "r1");
		expect(acceptDiscovered(b, { run: "r1", step: "build" }, items, config)).toHaveLength(1);
		reconcileItems(b, () => "failed");
		updateItem(b, "T01", { status: "ready" }, config);
		startItem(b, "T01", "r2");
		expect(acceptDiscovered(b, { run: "r2", step: "build" }, items, config)).toEqual([]);
		expect(acceptDiscovered(b, { run: "r3", step: "build", item: "T01" }, items, config)).toEqual(
			[],
		);
		// Runs dispatched without an item still dedupe per run
		expect(acceptDiscovered(b, { run: "r9", step: "build" }, items, config)).toHaveLength(1);
		expect(b.items.filter((i) => i.source === "discovered")).toHaveLength(2);
	});

	it("lets the overseer answer only low-risk requests with their recommended option", () => {
		const request = { recommended: "a", blocking: true };
		const low = { risk: "low", kind: "decision" };
		expect(evaluateAnswerPolicy(request, low, DEFAULTS)).toEqual({
			within: true,
			answer: "a",
			reason: "risk low <= low, recommended option a",
		});
		expect(
			evaluateAnswerPolicy(request, { risk: "medium", kind: "decision" }, DEFAULTS).reason,
		).toMatch(/above answer_policy.max_risk low/);
		expect(evaluateAnswerPolicy(request, { risk: null, kind: "decision" }, DEFAULTS).within).toBe(
			false,
		);
		expect(
			evaluateAnswerPolicy(request, { risk: "low", kind: "permission" }, DEFAULTS).within,
		).toBe(false);
		expect(evaluateAnswerPolicy({ recommended: null }, low, DEFAULTS).reason).toBe(
			"no recommended option",
		);
		expect(
			evaluateAnswerPolicy(request, low, withConfig({ answer_policy: { blocking: false } })).within,
		).toBe(false);
		expect(
			evaluateAnswerPolicy(request, low, withConfig({ answer_policy: { enabled: false } })).within,
		).toBe(false);
		expect(
			evaluateAnswerPolicy(
				{ recommended: null, blocking: false },
				low,
				withConfig({ answer_policy: { recommended_only: false } }),
			),
		).toMatchObject({ within: true, answer: null });
	});
});

// --- Supervisor and MCP ---

const home = useTempGlobalRoot();
let repo: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];
const mcpClients: Client[] = [];

const ONE_STEP = `
name: one-step
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: build
    type: prompt
    prompt: "BUILD {{ variables.task }}"
variables:
  - name: task
    type: string
    required: false
    default: "x"
`;

function reply(options: RuntimeRunOptions, stdout: string): RuntimeResult {
	return {
		returncode: 0,
		stdout,
		stderr: "",
		prompt: options.prompt,
		cwd: null,
		model: null,
		success: true,
		sessionOutput: SessionOutput.fromStdout(stdout),
	};
}

function block(value: Record<string, unknown>): string {
	return `Work log...\n${JSON.stringify(value)}`;
}

function payload(extra: Partial<DispatchPayload> = {}, task = "x"): DispatchPayload {
	return {
		repo_root: repo,
		workflow: {
			path: path.join(repo, "agentic", "workflows", "one-step.yaml"),
			contents: ONE_STEP,
		},
		config: getDefaultConfig(),
		env: { PATH: process.env.PATH ?? "" },
		variables: { task },
		runtime: null,
		from_step: null,
		slug: "wf",
		terminal_output: "base",
		...extra,
	};
}

async function startSupervisor() {
	const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
	const manager = new RunManager({ root: home.root, notifications: { pollMs: 0 } });
	manager.attach(supervisor);
	const discovery = await supervisor.start();
	await manager.start();
	supervisors.push(supervisor);
	managers.push(manager);
	return { manager, client: new SupervisorClient(discovery) };
}

async function openOverseer(client: SupervisorClient, overseer: Record<string, unknown> = {}) {
	const config = {
		...getDefaultConfig(),
		overseer: { ...(getDefaultConfig().overseer as object), ...overseer },
	};
	return client.request<OverseerOpenResult>("POST", "/v1/overseer", {
		repo_root: repo,
		config,
		env: {},
	});
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

/** Holds prompts containing `match` until the returned function is called. */
function hold(match: string): () => void {
	let release = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	fakeRuntime.on(match, async (o) => {
		await released;
		return reply(o, "ok");
	});
	return release;
}

async function expectRejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
	await expect(promise).rejects.toThrow(pattern);
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-backlog-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
	writeFileSync(path.join(repo, "agentic", "workflows", "one-step.yaml"), ONE_STEP, "utf-8");
});

afterEach(async () => {
	await Promise.all(mcpClients.splice(0).map((c) => c.close()));
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("backlog in the supervisor", () => {
	it("dispatches runnable items only, and an item takes the outcome of its run", async () => {
		const { manager, client } = await startSupervisor();
		const overseer = await openOverseer(client);
		const base = `/v1/overseer/${overseer.run.id}/backlog`;
		const added = await client.request<{ added: { id: string }[]; runnable: string[] }>(
			"POST",
			base,
			{
				items: [
					triaged("cache", { conflict_zones: ["src/cache"] }),
					triaged("cache client", { conflict_zones: ["src/cache/client.ts"] }),
				],
			},
		);
		expect(added.runnable).toEqual(["T01"]);
		expect(existsSync(path.join(overseer.dir, "backlog.json"))).toBe(true);

		const release = hold("BUILD one");
		const first = await manager.dispatch(payload({ parent: overseer.run.id, item: "T01" }, "one"));
		await fakeRuntime.waitFor("BUILD one");
		await expectRejects(
			manager.dispatch(payload({ parent: overseer.run.id, item: "T02" }, "two")),
			/T02 cannot start now: conflicts with T01 \(running\): src\/cache/,
		);
		await expectRejects(manager.dispatch(payload({ item: "T02" })), /item needs parent/);
		await expectRejects(
			manager.dispatch(payload({ parent: overseer.run.id, item: "T09" })),
			/Unknown backlog item T09/,
		);
		// Only the refused dispatches' runs were never created
		expect(manager.list({ parent: overseer.run.id }).map((r) => r.id)).toEqual([first.run.id]);
		expect(
			new RunStore(first.dir).readEvents().find((e) => e.type === "run.queued")?.data,
		).toMatchObject({
			parent: overseer.run.id,
			item: "T01",
		});

		release();
		await waitForStatus(manager, first.run.id, "done");
		const list = await client.request<{
			items: { id: string; status: string; run: string }[];
			runnable: string[];
		}>("GET", base);
		expect(list.items[0]).toMatchObject({ id: "T01", status: "done", run: first.run.id });
		expect(list.runnable).toEqual(["T02"]);
		const second = await manager.dispatch(payload({ parent: overseer.run.id, item: "T02" }, "two"));
		await waitForStatus(manager, second.run.id, "done");
		const run = new RunStore(overseer.dir).readRun();
		await client.request("GET", base);
		expect(new RunStore(overseer.dir).readRun().budgets_used).toMatchObject({
			tasks: 2,
			dispatches: 2,
			retries: 0,
		});
		expect(run.type).toBe("overseer");
	});

	it("tracks an item again when its failed run is resumed", async () => {
		const { manager, client } = await startSupervisor();
		const overseer = await openOverseer(client);
		const base = `/v1/overseer/${overseer.run.id}/backlog`;
		await client.request("POST", base, {
			items: [
				triaged("cache", { conflict_zones: ["src/cache"] }),
				triaged("cache client", { conflict_zones: ["src/cache/client.ts"] }),
			],
		});
		let calls = 0;
		let release = () => {};
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		fakeRuntime.on("BUILD one", async (o) => {
			calls++;
			if (calls === 1) return reply(o, block({ status: "failed", summary: "Tests fail." }));
			await released;
			return reply(o, block({ status: "done", summary: "Built." }));
		});
		type List = {
			items: { id: string; status: string; run: string }[];
			runnable: string[];
			waiting: Record<string, string>;
		};
		const run = await manager.dispatch(payload({ parent: overseer.run.id, item: "T01" }, "one"));
		await waitForStatus(manager, run.run.id, "failed");
		let list = await client.request<List>("GET", base);
		expect(list.items[0]).toMatchObject({ id: "T01", status: "failed", run: run.run.id });
		expect(list.runnable).toEqual(["T02"]);

		await manager.resume(run.run.id);
		for (let i = 0; i < 300 && calls < 2; i++) await new Promise((r) => setTimeout(r, 10));
		expect(calls).toBe(2);
		list = await client.request<List>("GET", base);
		expect(list.items[0]).toMatchObject({ id: "T01", status: "running", run: run.run.id });
		expect(list.runnable).toEqual([]);
		expect(list.waiting.T02).toMatch(/conflicts with T01 \(running\): src\/cache/);
		await expectRejects(
			manager.dispatch(payload({ parent: overseer.run.id, item: "T01" }, "again")),
			/T01 still has an open run/,
		);

		release();
		await waitForStatus(manager, run.run.id, "done");
		list = await client.request<List>("GET", base);
		expect(list.items[0]).toMatchObject({ id: "T01", status: "done", run: run.run.id });
		expect(list.runnable).toEqual(["T02"]);
	});

	it("adds a discovered item once when its backlog item is dispatched again", async () => {
		const { manager, client } = await startSupervisor();
		const overseer = await openOverseer(client, { accept_discovered_items: "ask" });
		const base = `/v1/overseer/${overseer.run.id}/backlog`;
		await client.request("POST", base, { items: [triaged("pager")] });
		let calls = 0;
		fakeRuntime.on("BUILD", (o) => {
			calls++;
			return reply(
				o,
				block({
					status: calls === 1 ? "failed" : "done",
					summary: "Pager work.",
					discovered_items: [{ type: "bug", title: "Off-by-one in pager" }],
				}),
			);
		});
		const first = await manager.dispatch(payload({ parent: overseer.run.id, item: "T01" }));
		await waitForStatus(manager, first.run.id, "failed");
		await client.request("POST", `${base}/T01`, { fields: { status: "ready" } });
		const second = await manager.dispatch(payload({ parent: overseer.run.id, item: "T01" }));
		await waitForStatus(manager, second.run.id, "done");
		const file = JSON.parse(readFileSync(path.join(overseer.dir, "backlog.json"), "utf-8"));
		const discovered = file.items.filter((i: { source: string }) => i.source === "discovered");
		expect(discovered).toHaveLength(1);
		expect(discovered[0]).toMatchObject({ discovered: { run: first.run.id, type: "bug" } });
	});

	it("refuses backlog operations on workflow runs and ended overseers", async () => {
		const { manager, client } = await startSupervisor();
		const run = await manager.dispatch(payload());
		await expectRejects(
			client.request("GET", `/v1/overseer/${run.run.id}/backlog`),
			/not an overseer run/,
		);
		await expectRejects(client.request("GET", "/v1/overseer/nope/backlog"), /Run not found/);
		const overseer = await openOverseer(client);
		await client.request("POST", `/v1/overseer/${overseer.run.id}/finish`, {});
		await expectRejects(
			client.request("POST", `/v1/overseer/${overseer.run.id}/backlog`, {
				items: [{ title: "x" }],
			}),
			/has ended/,
		);
		await waitForStatus(manager, run.run.id, "done");
	});

	it("adds the discovered items of a child run per policy and logs the decision", async () => {
		const { manager, client } = await startSupervisor();
		const overseer = await openOverseer(client, { accept_discovered_items: "ask" });
		fakeRuntime.on("BUILD", (o) =>
			reply(
				o,
				block({
					status: "done",
					summary: "Built.",
					discovered_items: [
						{
							type: "bug",
							title: "Off-by-one in pager",
							severity: "medium",
							files: ["src/pager.ts"],
						},
					],
				}),
			),
		);
		const run = await manager.dispatch(payload({ parent: overseer.run.id }));
		await waitForStatus(manager, run.run.id, "done");
		const file = JSON.parse(readFileSync(path.join(overseer.dir, "backlog.json"), "utf-8"));
		expect(file.items).toHaveLength(1);
		expect(file.items[0]).toMatchObject({
			id: "T01",
			status: "proposed",
			source: "discovered",
			discovered: { run: run.run.id, step: "build", type: "bug" },
		});
		const decision = new RunStore(overseer.dir).readDecisions()[0];
		expect(decision).toMatchObject({ id: "d-backlog-T01", source: "policy", risk: "medium" });
		expect(decision.rationale).toBe("accept_discovered_items: ask");
	});

	it("lets the overseer answer within its answer policy, and asks the user otherwise", async () => {
		const { manager, client } = await startSupervisor();
		const overseer = await openOverseer(client);
		const question = {
			id: "q1",
			question: "Which store?",
			options: [
				{ id: "a", label: "Redis" },
				{ id: "b", label: "DB" },
			],
			recommended: "a",
			context: "",
			blocking: true,
		};
		const asks: Record<string, number> = {};
		const ask = (risk: string) => (o: RuntimeRunOptions) => {
			asks[risk] = (asks[risk] ?? 0) + 1;
			return asks[risk] === 1
				? reply(
						o,
						block({
							status: "awaiting-human",
							summary: "Need a choice",
							max_risk: risk,
							needs_input: question,
						}),
					)
				: reply(o, block({ status: "done", summary: "Built." }));
		};
		fakeRuntime.on("BUILD low", ask("low"));
		fakeRuntime.on("BUILD high", ask("high"));

		const low = await manager.dispatch(payload({ parent: overseer.run.id }, "low"));
		await waitForStatus(manager, low.run.id, "awaiting-human");
		const event = new RunStore(low.dir).readEvents().find((e) => e.type === "needs_input");
		expect(event?.data.overseer_policy).toMatchObject({ within: true, answer: "a" });
		await expectRejects(
			manager.answer(low.run.id, { request_id: "q1", answer: "b", from: "overseer" }),
			/only allows the recommended option a/,
		);
		await manager.answer(low.run.id, { request_id: "q1", answer: "a", from: "overseer" });
		await waitForStatus(manager, low.run.id, "done");
		const decision = new RunStore(low.dir).readDecisions().find((d) => d.id === "d-q1");
		expect(decision).toMatchObject({ source: "policy" });
		expect(decision?.rationale).toMatch(/within its answer_policy: risk low <= low/);

		const high = await manager.dispatch(payload({ parent: overseer.run.id }, "high"));
		await waitForStatus(manager, high.run.id, "awaiting-human");
		await expectRejects(
			manager.answer(high.run.id, { request_id: "q1", answer: "a", from: "overseer" }),
			/Outside the overseer answer_policy \(risk high above answer_policy.max_risk low\)/,
		);
		await manager.answer(high.run.id, { request_id: "q1", answer: "b", from: "user" });
		await waitForStatus(manager, high.run.id, "done");
		expect(new RunStore(high.dir).readDecisions().find((d) => d.id === "d-q1")?.source).toBe(
			"operator",
		);
	});
});

describe("backlog over MCP", () => {
	async function connect(client: SupervisorClient) {
		const server = createMcpServer({
			getClient: async () => client,
			registryRoot: home.root,
			cwd: repo,
			version: "1.0.0",
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const mcp = new Client({ name: "backlog-test", version: "1.0.0" });
		await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
		mcpClients.push(mcp);
		return mcp;
	}

	async function call(mcp: Client, name: string, args: Record<string, unknown>) {
		const result = await mcp.callTool({ name, arguments: args });
		const text = (result.content as Array<{ text: string }>).map((c) => c.text).join("\n");
		let json: unknown = null;
		try {
			json = JSON.parse(text);
		} catch {
			json = null;
		}
		// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of a tool result
		return { isError: result.isError === true, json: json as any, text };
	}

	it("adds, triages, approves and dispatches an item through the backlog tools", async () => {
		const { manager, client } = await startSupervisor();
		const mcp = await connect(client);
		const names = (await mcp.listTools()).tools.map((t) => t.name);
		expect(names).toEqual(
			expect.arrayContaining(["af_backlog_list", "af_backlog_add", "af_backlog_update"]),
		);
		const overseer = await openOverseer(client);
		const run = overseer.run.id;

		const added = await call(mcp, "af_backlog_add", {
			run,
			items: [{ title: "Add the pager", source: "epic", conflict_zones: ["src/pager"] }],
		});
		expect(added.isError, added.text).toBe(false);
		expect(added.json.added[0]).toEqual({
			id: "T01",
			title: "Add the pager",
			status: "proposed",
			conflict_zones: ["src/pager"],
			priority: 0,
			source: "epic",
		});
		const invalid = await call(mcp, "af_backlog_add", {
			run,
			items: [{ title: "x", track: "huge" }],
		});
		expect(invalid.isError).toBe(true);
		const running = await call(mcp, "af_backlog_update", {
			run,
			id: "T01",
			fields: { status: "running" },
		});
		expect(running.isError).toBe(true);
		expect(running.text).toContain("status must be one of proposed, ready, logged, dropped");

		const approved = await call(mcp, "af_backlog_update", {
			run,
			id: "T01",
			fields: { track: "light", track_reason: "one module", status: "ready" },
		});
		expect(approved.isError, approved.text).toBe(false);
		expect(approved.json.runnable).toEqual(["T01"]);

		const dispatched = await call(mcp, "af_dispatch", {
			workflow: "one-step",
			repo,
			parent: run,
			item: "T01",
		});
		expect(dispatched.isError, dispatched.text).toBe(false);
		await waitForStatus(manager, dispatched.json.run_id, "done");
		const list = await call(mcp, "af_backlog_list", { run, status: "done" });
		expect(list.json.items.map((i: { id: string }) => i.id)).toEqual(["T01"]);
		expect(list.json).toMatchObject({ max_parallel: 2, halt: null, budgets: { max_tasks: 20 } });
		const again = await call(mcp, "af_dispatch", {
			workflow: "one-step",
			repo,
			parent: run,
			item: "T01",
		});
		expect(again.isError).toBe(true);
		expect(again.text).toContain("T01 is done");
	});
});
