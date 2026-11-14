/**
 * Tests for cross-runtime dispatch: an agent dispatches a child run on
 * another runtime through the af MCP server and waits for its result block
 * (af_wait, af_dispatch wait), the run tree (parent links, depth, af status),
 * the tree guards, and the af MCP server given to every Codex session.
 * Claude sessions run on the fake SDK, Codex sessions on the fake
 * app-server, against an in-process supervisor.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdStatus } from "../src/commands/status.js";
import { deepMerge, getDefaultConfig } from "../src/config.js";
import { createMcpServer } from "../src/mcp/index.js";
import { dispatchRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager } from "../src/runs/manager.js";
import { RunStore } from "../src/runs/run-store.js";
import { AF_MCP_SERVER } from "../src/runtimes/af-mcp.js";
import { codexAppServer, spawnAppServer } from "../src/runtimes/codex-session.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
import { fakeCodex } from "./helpers/fake-app-server.js";
import { fakeSdk, resultBlock } from "./helpers/fake-sdk.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
	const { fakeSdk: fake } = await import("./helpers/fake-sdk.js");
	return { query: fake.query };
});

const home = useTempGlobalRoot();
let repo: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];
const mcpClients: Client[] = [];

function workflow(name: string, runtime: string, prompt: string): string {
	return `
name: ${name}
version: "1.0"
settings:
  runtime: ${runtime}
  max-retry: 0
steps:
  - name: work
    type: prompt
    prompt: "${prompt}"
`;
}

/** Writes a project workflow that af_dispatch finds by name. */
function addWorkflow(name: string, runtime: string, prompt: string): string {
	const contents = workflow(name, runtime, prompt);
	writeFileSync(path.join(repo, "agentic", "workflows", `${name}.yaml`), contents, "utf-8");
	return contents;
}

function payload(
	contents: string,
	extra: Partial<DispatchPayload> = {},
	config: Record<string, unknown> = getDefaultConfig(),
): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		config,
		env: { PATH: process.env.PATH ?? "", CLAUDE_CONFIG_DIR: path.join(repo, ".no-claude") },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "tree",
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

/** An MCP client of the af server, with the environment the agent's MCP server gets. */
async function connect(client: SupervisorClient, env: NodeJS.ProcessEnv = {}): Promise<Client> {
	const server = createMcpServer({
		getClient: async () => client,
		registryRoot: home.root,
		cwd: repo,
		version: "1.0.0",
		env,
	});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const mcp = new Client({ name: "tree-test", version: "1.0.0" });
	await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
	mcpClients.push(mcp);
	return mcp;
}

// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of a tool result
async function call(mcp: Client, name: string, args: Record<string, unknown>): Promise<any> {
	const result = await mcp.callTool({ name, arguments: args });
	const text = (result.content as Array<{ text: string }>).map((c) => c.text).join("\n");
	if (result.isError) return { isError: true, text };
	return JSON.parse(text);
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
	for (let i = 0; i < 1000; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

async function waitForStatus(manager: RunManager, id: string, status: string): Promise<void> {
	await waitFor(() => manager.registry.get(id)?.status === status, `${id} ${status}`);
}

function stepResult(dir: string): { status: string; summary: string } {
	return new RunStore(dir).readJson(path.join("steps", "01-work", "result.json"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
	fakeSdk.reset();
	codexAppServer.spawn = fakeCodex.spawn;
	repo = mkdtempSync(path.join(tmpdir(), "af-tree-repo-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	await Promise.all(mcpClients.splice(0).map((c) => c.close()));
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	fakeCodex.reset();
	codexAppServer.spawn = spawnAppServer;
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("cross-runtime dispatch", () => {
	it("a Claude session dispatches a Codex child, waits with af_wait in a loop and gets its result block", async () => {
		const { manager, client } = await startSupervisor();
		addWorkflow("codex-check", "codex", "CHECK the plan");
		fakeCodex.on("CHECK", async (turn) => {
			await sleep(300);
			turn.message(resultBlock("done", "The plan is valid", { max_risk: "low" }));
			turn.complete();
		});
		// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of tool results
		const seen: { dispatched?: any; waited?: any; calls: number } = { calls: 0 };
		fakeSdk.on("DELEGATE", async (s, first) => {
			s.init();
			const mcp = await connect(client, s.options.env as NodeJS.ProcessEnv);
			seen.dispatched = await call(mcp, "af_dispatch", { workflow: "codex-check" });
			const run = seen.dispatched.run_id;
			let waited = await call(mcp, "af_wait", { run, timeout_seconds: 0.05 });
			seen.calls = 1;
			while (waited.state === "waiting") {
				waited = await call(mcp, "af_wait", {
					run,
					cursor: waited.cursor,
					timeout_seconds: 0.5,
				});
				seen.calls += 1;
			}
			seen.waited = waited;
			s.result(resultBlock("done", `Codex says: ${waited.result.summary}`), [first]);
		});

		const parent = await dispatchRun(
			client,
			payload(workflow("claude-parent", "claude", "DELEGATE")),
		);
		await waitForStatus(manager, parent.run.id, "done");

		expect(seen.dispatched).toMatchObject({ status: "queued", parent: parent.run.id });
		const child = String(seen.dispatched.run_id);
		expect(seen.calls).toBeGreaterThanOrEqual(2);
		expect(seen.waited).toMatchObject({
			run: child,
			status: "done",
			state: "ended",
			reason: "done",
			step: "work",
			result: { status: "done", summary: "The plan is valid", max_risk: "low", pr: null },
		});
		expect(stepResult(parent.dir).summary).toBe("Codex says: The plan is valid");

		// The Codex child's session got the af MCP server, tagged with the child run
		const server = fakeCodex.servers[0];
		const afServer = (server.threadParams?.config as Record<string, never>)[
			`mcp_servers.${AF_MCP_SERVER}`
		] as { command: string; args: string[]; env: Record<string, string> };
		expect(afServer.args[afServer.args.length - 1]).toBe("mcp");
		expect(afServer.env).toMatchObject({ AF_RUN_ID: child, AF_STEP: "work" });

		// Run tree: the child links to the parent, one level down
		expect(manager.registry.get(child)?.parent).toBe(parent.run.id);
		const user = await connect(client);
		const listed = await call(user, "af_list_runs", { tree: parent.run.id });
		expect(
			listed.runs.map((r: { id: string; depth: number; parent: string | null }) => [
				r.id,
				r.depth,
				r.parent,
			]),
		).toEqual([
			[parent.run.id, 0, null],
			[child, 1, parent.run.id],
		]);
		const status = await call(user, "af_status", { run: parent.run.id });
		expect(status.tree).toMatchObject({
			parent: null,
			depth: 0,
			root: parent.run.id,
			children: [{ id: child, workflow: "codex-check", status: "done", runtime: "codex" }],
		});
	});

	it("a Codex session dispatches a Claude child through the af MCP server of its thread", async () => {
		const { manager, client } = await startSupervisor();
		addWorkflow("claude-review", "claude", "REVIEW the diff");
		fakeSdk.on("REVIEW", async (s, first) => {
			s.init();
			await sleep(100);
			s.result(resultBlock("done", "Reviewed by Claude: no findings"), [first]);
		});
		// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of a tool result
		let dispatched: any = null;
		fakeCodex.on("DELEGATE", async (turn) => {
			// The agent's af MCP server: the one the thread config starts
			const config = turn.server.threadParams?.config as Record<string, unknown>;
			const afServer = config[`mcp_servers.${AF_MCP_SERVER}`] as { env: NodeJS.ProcessEnv };
			const mcp = await connect(client, afServer.env);
			dispatched = await call(mcp, "af_dispatch", {
				workflow: "claude-review",
				wait: true,
				timeout_seconds: 20,
			});
			turn.message(resultBlock("done", `Claude says: ${dispatched.wait.result.summary}`));
			turn.complete();
		});

		const parent = await dispatchRun(
			client,
			payload(workflow("codex-parent", "codex", "DELEGATE")),
		);
		await waitForStatus(manager, parent.run.id, "done");

		expect(dispatched).toMatchObject({
			parent: parent.run.id,
			wait: {
				state: "ended",
				status: "done",
				result: { summary: "Reviewed by Claude: no findings" },
			},
		});
		expect(stepResult(parent.dir).summary).toBe("Claude says: Reviewed by Claude: no findings");
		const child = manager.registry.get(dispatched.run_id);
		expect(child?.parent).toBe(parent.run.id);
		// The child inherits the parent's dispatch environment under its own
		const childDispatch = new RunStore(String(dispatched.dir)).readJson<{
			env: Record<string, string>;
		}>("dispatch.json");
		expect(childDispatch.env.CLAUDE_CONFIG_DIR).toBe(path.join(repo, ".no-claude"));
	});

	it("af_wait with until attention reports an open question once, then waits", async () => {
		const { manager, client } = await startSupervisor();
		const contents = workflow("asks", "claude", "ASK");
		fakeSdk.on("ASK", async (s, first) => {
			s.init();
			s.result(
				resultBlock("awaiting-human", "Need a choice", {
					max_risk: "medium",
					needs_input: {
						id: "q1",
						question: "Keep the cache?",
						options: [
							{ id: "a", label: "Keep" },
							{ id: "b", label: "Drop" },
						],
						recommended: "a",
						blocking: true,
					},
				}),
				[first],
			);
		});
		const res = await dispatchRun(client, payload(contents));
		const mcp = await connect(client);
		const first = await call(mcp, "af_wait", {
			run: res.run.id,
			until: "attention",
			timeout_seconds: 10,
		});
		expect(first).toMatchObject({
			state: "attention",
			status: "awaiting-human",
			needs_input: [
				{ id: "q1", step: "work", question: "Keep the cache?", recommended: "a", risk: "medium" },
			],
			result: { status: "awaiting-human", summary: "Need a choice" },
		});
		const again = await call(mcp, "af_wait", {
			run: res.run.id,
			until: "attention",
			cursor: first.cursor,
			timeout_seconds: 0.3,
		});
		expect(again).toMatchObject({
			state: "waiting",
			status: "awaiting-human",
			cursor: first.cursor,
		});
		await manager.idle();
	});
});

describe("run tree guards", () => {
	function guarded(budgets: Record<string, number>) {
		return deepMerge(getDefaultConfig(), { overseer: { budgets } }) as Record<string, unknown>;
	}

	it("refuses a dispatch past max_dispatch_depth with a reason the agent reads", async () => {
		const { manager, client } = await startSupervisor();
		writeFileSync(
			path.join(repo, "agentic", "config.json"),
			JSON.stringify({ overseer: { budgets: { max_dispatch_depth: 1 } } }),
			"utf-8",
		);
		addWorkflow("leaf", "claude", "LEAF");
		const contents = workflow("node", "claude", "NODE");
		const root = await manager.dispatch(payload(contents, {}, guarded({ max_dispatch_depth: 1 })));
		const child = await manager.dispatch(
			payload(contents, { parent: root.run.id }, guarded({ max_dispatch_depth: 1 })),
		);
		expect(child.run.parent).toBe(root.run.id);
		await expect(
			manager.dispatch(
				payload(contents, { parent: child.run.id }, guarded({ max_dispatch_depth: 1 })),
			),
		).rejects.toThrow(/Dispatch refused: the run would be at depth 2 .*max_dispatch_depth 1/);

		// An agent of the child run (AF_RUN_ID) gets the same refusal as a tool error
		const mcp = await connect(client, { AF_RUN_ID: child.run.id });
		const refused = await call(mcp, "af_dispatch", { workflow: "leaf" });
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain("Dispatch refused");
		expect(refused.text).toContain("max_dispatch_depth 1");
		expect(refused.text).toContain(`af_list_runs tree: ${root.run.id}`);
		await manager.idle();
	});

	it("refuses a dispatch past the tree caps on runs and active runs", async () => {
		const { manager } = await startSupervisor();
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		fakeSdk.on("HOLD", async (s, first) => {
			s.init();
			await gate;
			s.result(resultBlock("done", "held"), [first]);
		});
		const hold = workflow("hold", "claude", "HOLD");
		const active = guarded({ max_tree_active: 2 });
		const root = await manager.dispatch(payload(hold, {}, active));
		await manager.dispatch(payload(hold, { parent: root.run.id }, active));
		await expect(manager.dispatch(payload(hold, { parent: root.run.id }, active))).rejects.toThrow(
			/run tree .* has 2 runs that have not ended .*max_tree_active 2/,
		);
		await expect(
			manager.dispatch(payload(hold, { parent: root.run.id }, guarded({ max_tree_runs: 2 }))),
		).rejects.toThrow(/already has 2 runs \(overseer.budgets.max_tree_runs 2\)/);
		release();
		await waitForStatus(manager, root.run.id, "done");
		await manager.idle();
	});
});

describe("af status run tree", () => {
	it("prints the run tree with the current run marked", async () => {
		const { manager } = await startSupervisor();
		const contents = workflow("node", "claude", "NODE");
		const root = await manager.dispatch(payload(contents));
		const child = await manager.dispatch(payload(contents, { parent: root.run.id }));
		const grandchild = await manager.dispatch(payload(contents, { parent: child.run.id }));
		for (const run of [root, child, grandchild]) await waitForStatus(manager, run.run.id, "done");
		await manager.idle();

		const out: string[] = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			out.push(String(chunk));
			return true;
		});
		try {
			cmdStatus(child.run.id);
		} finally {
			spy.mockRestore();
		}
		const text = out.join("");
		expect(text).toContain(`Parent: ${root.run.id}`);
		expect(text).toContain("Run tree (depth 1):");
		const lines = text.split("\n").filter((l) => l.includes("(node, claude)"));
		expect(lines).toEqual([
			`  ${root.run.id} (node, claude) done`,
			`    ${child.run.id} (node, claude) done  <- this run`,
			`      ${grandchild.run.id} (node, claude) done`,
		]);
	});
});
