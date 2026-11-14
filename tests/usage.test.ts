/**
 * Tests for usage accounting: the adapters' usage parsing against stream
 * fixtures (Claude captured from a real run; Codex written from the
 * `codex exec --json` field names until a capture exists), per-step `usage.json`, `budgets_used`, `step.completed`
 * usage, `af usage` / `af_usage`, MCP session accounting and the per-run
 * token budget (warning and pause), with an in-process supervisor and the
 * fake runtime.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdUsage } from "../src/commands/events.js";
import { getVersion } from "../src/commands/version.js";
import { getRunBudgets } from "../src/config.js";
import { RESULT_BUDGET_BYTES } from "../src/mcp/budgets.js";
import { createMcpServer } from "../src/mcp/index.js";
import { RunManager } from "../src/runs/manager.js";
import { RunStore } from "../src/runs/run-store.js";
import {
	USAGE_FILE,
	buildUsageReport,
	formatUsageReport,
	readRunUsage,
} from "../src/runs/usage.js";
import { claudeStreamEvents } from "../src/runtimes/claude-stream.js";
import { codexStreamEvents } from "../src/runtimes/codex.js";
import { ClaudeAdapter, CodexAdapter } from "../src/runtimes/index.js";
import type { RuntimeResult, RuntimeRunOptions } from "../src/runtimes/types.js";
import { SessionOutput } from "../src/runtimes/types.js";
import { type Usage, addUsage, claudeResultUsage, totalTokens } from "../src/runtimes/usage.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
import { fakeRuntime } from "./helpers/fake-runtime.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const { fakeRuntime: fake } = await import("./helpers/fake-runtime.js");
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return { ...original, runRuntime: fake.run };
});

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "runtimes", "fixtures");
const home = useTempGlobalRoot();
let repo: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];
const mcpClients: Client[] = [];

function lines(file: string): string[] {
	return readFileSync(path.join(fixtures, file), "utf-8").split("\n").filter(Boolean);
}

function usage(input: number, output: number, cost: number | null = null): Usage {
	return {
		input_tokens: input,
		cached_input_tokens: 0,
		cache_creation_tokens: 0,
		output_tokens: output,
		cost_usd: cost,
	};
}

function writeWorkflow(name: string, steps: string[], settings: string[] = []): void {
	const file = path.join(repo, "agentic", "workflows", `${name}.yaml`);
	mkdirSync(path.dirname(file), { recursive: true });
	const yaml = [
		`name: ${name}`,
		'version: "1.0"',
		"settings:",
		"  max-retry: 0",
		...settings,
		"steps:",
		...steps.flatMap((step) => [
			`  - name: ${step.toLowerCase()}`,
			"    type: prompt",
			`    prompt: "${step}"`,
		]),
		"",
	].join("\n");
	writeFileSync(file, yaml, "utf-8");
}

function reply(options: RuntimeRunOptions, used: Usage | null): RuntimeResult {
	return {
		returncode: 0,
		stdout: "ok",
		stderr: "",
		prompt: options.prompt,
		cwd: null,
		model: options.model ?? "test-model",
		success: true,
		sessionOutput: SessionOutput.fromStdout("ok"),
		usage: used,
	};
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

async function connect(client: SupervisorClient): Promise<Client> {
	const server = createMcpServer({
		getClient: async () => client,
		registryRoot: home.root,
		cwd: repo,
		version: "1.0.0",
	});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const mcp = new Client({ name: "usage-test", version: "1.0.0" });
	await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
	mcpClients.push(mcp);
	return mcp;
}

// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of a tool result
async function call(mcp: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
	const result = await mcp.callTool({ name, arguments: args });
	const text = (result.content as Array<{ text: string }>).map((c) => c.text).join("\n");
	expect(result.isError, text).not.toBe(true);
	expect(Buffer.byteLength(text)).toBeLessThan(RESULT_BUDGET_BYTES);
	return JSON.parse(text);
}

async function waitForStatus(manager: RunManager, id: string, status: string): Promise<void> {
	for (let i = 0; i < 500; i++) {
		if (manager.registry.get(id)?.status === status) return;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Run ${id} never reached ${status} (${manager.registry.get(id)?.status})`);
}

async function runWorkflow(manager: RunManager, client: SupervisorClient, workflow: string) {
	const mcp = await connect(client);
	const res = await call(mcp, "af_dispatch", { workflow });
	return { mcp, run: res.run_id as string };
}

function captureStdout(fn: () => void): string {
	const chunks: string[] = [];
	const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		chunks.push(String(chunk));
		return true;
	});
	try {
		fn();
	} finally {
		spy.mockRestore();
	}
	return chunks.join("");
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-usage-repo-"));
});

afterEach(async () => {
	await Promise.all(mcpClients.splice(0).map((c) => c.close()));
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("adapter usage parsing", () => {
	it("reads the Claude result message of a captured stream-json run", () => {
		const adapter = new ClaudeAdapter();
		const events = lines("claude-stream.jsonl").map((l) => adapter.parseStreamLine(l));
		const withUsage = events.filter((e) => e?.usage);
		expect(withUsage).toHaveLength(1);
		const expected = {
			input_tokens: 2,
			cached_input_tokens: 16_813,
			cache_creation_tokens: 16_858,
			output_tokens: 4,
			cost_usd: 0.003542,
		};
		expect(withUsage[0]?.usage).toEqual(expected);
		expect(withUsage[0]?.type).toBe("result");
		// The transcript mapping carries the same usage on turn.completed
		const turn = lines("claude-stream.jsonl")
			.flatMap((l) => claudeStreamEvents(JSON.parse(l)))
			.find((e) => e.type === "turn.completed");
		expect(turn && "usage" in turn ? turn.usage : null).toEqual(expected);
	});

	it("counts the subagent tokens of every model, not only the main loop usage", () => {
		const usage = claudeResultUsage({
			type: "result",
			// Main agent loop only
			usage: {
				input_tokens: 2,
				cache_read_input_tokens: 100,
				cache_creation_input_tokens: 10,
				output_tokens: 4,
			},
			total_cost_usd: 0.9,
			model_usage_since_last_result: {
				"claude-opus": {
					inputTokens: 2,
					cacheReadInputTokens: 100,
					cacheCreationInputTokens: 10,
					outputTokens: 4,
					costUSD: 0.1,
				},
				"claude-haiku": {
					inputTokens: 30,
					cacheReadInputTokens: 500,
					cacheCreationInputTokens: 0,
					outputTokens: 20,
					costUSD: 0.05,
				},
			},
		});
		expect(usage).toEqual({
			input_tokens: 32,
			cached_input_tokens: 600,
			cache_creation_tokens: 10,
			output_tokens: 24,
			cost_usd: 0.15,
		});
	});

	it("reads the Codex turn.completed usage of an exec --json run", () => {
		const adapter = new CodexAdapter();
		const events = lines("codex-exec.jsonl").map((l) => adapter.parseStreamLine(l));
		const expected = {
			input_tokens: 1_026,
			cached_input_tokens: 11_008,
			cache_creation_tokens: 0,
			output_tokens: 58,
			cost_usd: null,
		};
		expect(events.find((e) => e?.usage)?.usage).toEqual(expected);
		const turn = lines("codex-exec.jsonl")
			.flatMap((l) => codexStreamEvents(JSON.parse(l)))
			.find((e) => e.type === "turn.completed");
		expect(turn && "usage" in turn ? turn.usage : null).toEqual(expected);
		expect(totalTokens(expected)).toBe(12_034 + 58);
	});

	it("never turns an unknown usage into zeros", () => {
		expect(addUsage(null, null)).toBeNull();
		expect(addUsage(null, usage(1, 2))).toEqual(usage(1, 2));
		expect(addUsage(usage(1, 2, 0.1), usage(3, 4))).toEqual(usage(4, 6, 0.1));
		expect(new ClaudeAdapter().parseStreamLine('{"type":"result","result":"x"}')?.usage).toBeNull();
	});
});

describe("run usage", () => {
	it("writes usage.json, budgets_used and step.completed usage for a step that reports usage", async () => {
		writeWorkflow("two-steps", ["PLAN", "BUILD"]);
		fakeRuntime.on("PLAN", (o) => reply(o, usage(100, 20, 0.01)));
		fakeRuntime.on("BUILD", (o) => reply(o, usage(300, 80, 0.03)));
		const { manager, client } = await startSupervisor();
		const { mcp, run } = await runWorkflow(manager, client, "two-steps");
		await waitForStatus(manager, run, "done");

		const entry = manager.registry.get(run);
		if (!entry) throw new Error("no entry");
		const files = readRunUsage(entry.dir);
		expect(files.map((f) => f.step)).toEqual(["plan", "build"]);
		expect(files[0].usage).toEqual(usage(100, 20, 0.01));
		expect(files[0].calls).toHaveLength(1);
		expect(files[0].calls[0]).toMatchObject({ runtime: "claude", model: "sonnet" });
		expect(existsSync(path.join(entry.dir, "steps", "01-plan", USAGE_FILE))).toBe(true);

		const store = new RunStore(entry.dir);
		expect(store.readRun().budgets_used).toMatchObject({
			tokens: 500,
			input_tokens: 400,
			output_tokens: 100,
			cost_usd: 0.04,
		});
		const completed = store.readEvents().filter((e) => e.type === "step.completed");
		expect(completed.map((e) => e.data?.usage)).toEqual([
			{ tokens: 120, ...usage(100, 20, 0.01) },
			{ tokens: 380, ...usage(300, 80, 0.03) },
		]);

		// af_usage and af usage --by step return the totals of the finished run
		const report = await call(mcp, "af_usage", { run, by: "step" });
		expect(report.rows.map((r: { key: string; tokens: number }) => [r.key, r.tokens])).toEqual([
			["plan", 120],
			["build", 380],
		]);
		expect(report.total).toMatchObject({ tokens: 500, cost_usd: 0.04 });
		expect(report.cost_note).toBe("estimate");
		const text = captureStdout(() => cmdUsage({ runId: run, by: "step" }));
		expect(text).toMatch(/^plan\s+1\s+120\s/m);
		expect(text).toMatch(/^total\s+2\s+500\s/m);
		expect(text).toContain("estimates");
		const json = JSON.parse(
			captureStdout(() => cmdUsage({ runId: run, by: "runtime", json: true })),
		);
		expect(json.rows).toEqual([expect.objectContaining({ key: "claude", tokens: 500 })]);
	});

	it("stores null for a runtime that reports no usage and shows it as unknown", async () => {
		writeWorkflow("silent", ["QUIET"]);
		const { manager, client } = await startSupervisor();
		const { run } = await runWorkflow(manager, client, "silent");
		await waitForStatus(manager, run, "done");
		const entry = manager.registry.get(run);
		if (!entry) throw new Error("no entry");
		const [file] = readRunUsage(entry.dir);
		expect(file.usage).toBeNull();
		expect(file.unknown_calls).toBe(1);
		expect(file.calls[0].usage).toBeNull();
		const store = new RunStore(entry.dir);
		expect(store.readRun().budgets_used).toEqual({});
		const completed = store.readEvents().find((e) => e.type === "step.completed");
		expect(completed?.data?.usage).toBeNull();
		const report = buildUsageReport([{ id: run, workflow: "silent", dir: entry.dir }], "step");
		expect(report.total.tokens).toBeNull();
		const text = formatUsageReport(report);
		expect(text).toMatch(/^quiet\s+1 \(1 unknown\)\s+unknown/m);
	});

	it("warns at 80% of max_tokens and pauses at the limit with reason budget", async () => {
		writeWorkflow("budgeted", ["S1", "S2", "S3", "S4"], ["  budgets:", "    max_tokens: 1000"]);
		for (const step of ["S1", "S2", "S3", "S4"]) {
			fakeRuntime.on(step, (o) => reply(o, usage(400, 50)));
		}
		const { manager, client } = await startSupervisor();
		const { mcp, run } = await runWorkflow(manager, client, "budgeted");
		await waitForStatus(manager, run, "paused");
		const entry = manager.registry.get(run);
		if (!entry) throw new Error("no entry");
		const store = new RunStore(entry.dir);
		const events = store.readEvents();
		const warnings = events.filter((e) => e.type === "budget.warning");
		// 900 of 1000 after S2: one warning, never repeated
		expect(warnings).toHaveLength(1);
		expect(warnings[0].data).toMatchObject({
			budget: "max_tokens",
			used: 900,
			limit: 1000,
			step: "s2",
		});
		const paused = events.find((e) => e.type === "run.paused");
		expect(paused?.data).toMatchObject({
			reason: "budget",
			budget: "max_tokens",
			used: 1350,
			limit: 1000,
			step: "s3",
		});
		// Paused at the boundary after S3: S4 never ran
		expect(fakeRuntime.calls.map((c) => c.prompt).some((p) => p.includes("S4"))).toBe(false);

		// Resuming without a raise pauses again before the next step, with no new call
		const callsAtPause = fakeRuntime.calls.length;
		await call(mcp, "af_resume", { run });
		await vi.waitFor(
			() => expect(store.readEvents().filter((e) => e.type === "run.paused")).toHaveLength(2),
			{ timeout: 5000 },
		);
		await waitForStatus(manager, run, "paused");
		expect(fakeRuntime.calls).toHaveLength(callsAtPause);
		const repaused = store.readEvents().filter((e) => e.type === "run.paused")[1];
		expect(repaused.data).toMatchObject({
			reason: "budget",
			budget: "max_tokens",
			used: 1350,
			limit: 1000,
		});

		// Raising the budget on resume lets the run finish
		const resumed = await call(mcp, "af_resume", { run, max_tokens: 5000 });
		expect(resumed.budgets).toMatchObject({ maxTokens: 5000 });
		await waitForStatus(manager, run, "done");
		expect(store.readRun()["x-af-budgets"]).toEqual({ max_tokens: 5000 });
		expect(store.readRun().budgets_used).toMatchObject({ tokens: 1800 });
	});

	it("reads budgets from the config, the workflow and resume raises, in that order", () => {
		const config = { runs: { budgets: { max_tokens: 100, max_cost_usd: 2 } } };
		expect(getRunBudgets(config)).toEqual({ maxTokens: 100, maxCostUsd: 2 });
		expect(getRunBudgets(config, { maxTokens: null })).toEqual({ maxTokens: null, maxCostUsd: 2 });
		expect(getRunBudgets(config, { maxTokens: 50 }, { maxCostUsd: 5 })).toEqual({
			maxTokens: 50,
			maxCostUsd: 5,
		});
		expect(getRunBudgets({})).toEqual({ maxTokens: null, maxCostUsd: null });
	});
});

describe("MCP session accounting", () => {
	it("af_usage(scope: mcp) reports the bytes returned per tool in this session", async () => {
		const { client } = await startSupervisor();
		const mcp = await connect(client);
		await call(mcp, "af_list_runs");
		await call(mcp, "af_list_runs");
		await call(mcp, "af_digest");
		const view = await call(mcp, "af_usage", { scope: "mcp" });
		expect(view.calls).toBe(3);
		const byTool = Object.fromEntries(
			view.tools.map((t: { tool: string; calls: number; bytes: number }) => [t.tool, t]),
		);
		expect(byTool.af_list_runs.calls).toBe(2);
		expect(byTool.af_digest.calls).toBe(1);
		expect(view.bytes).toBe(byTool.af_list_runs.bytes + byTool.af_digest.bytes);
		expect(view.est_tokens).toBe(Math.ceil(view.bytes / 4));
		// Written to the af global dir, per session
		expect(view.path.startsWith(path.join(home.root, "mcp-sessions"))).toBe(true);
		const saved = JSON.parse(readFileSync(view.path, "utf-8"));
		expect(saved.session).toBe(view.session);
	});
});
