/**
 * Tests for the overseer: overseer runs in the supervisor (open, reuse,
 * resume, finish, guards, recovery, notifications), `parent` on dispatch,
 * the `af overseer` launcher (claude command, MCP config, plugin) and an
 * overseer flow over the MCP tools (dispatch a workflow with the overseer as
 * parent, relay a correction with af_send, follow it to completion, finish).
 * In-process supervisor, fake runtime, no real claude.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	OVERSEER_EVENT_TYPES,
	type OverseerCommand,
	afShellCommand,
	cmdOverseer,
	getOverseerPluginDir,
	readEpic,
} from "../src/commands/overseer.js";
import { getDefaultConfig } from "../src/config.js";
import { validateArtifact } from "../src/contract/index.js";
import { createMcpServer } from "../src/mcp/index.js";
import type { NotificationTransport } from "../src/notifications/index.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager } from "../src/runs/manager.js";
import { type OverseerOpenResult, type OverseerPayload, epicTitle } from "../src/runs/overseer.js";
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

const home = useTempGlobalRoot();
let repo: string;
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
    prompt: "PLAN"
  - name: build
    type: prompt
    prompt: "BUILD"
`;

function ok(options: RuntimeRunOptions): RuntimeResult {
	return {
		returncode: 0,
		stdout: "ok",
		stderr: "",
		prompt: options.prompt,
		cwd: null,
		model: null,
		success: true,
		sessionOutput: SessionOutput.fromStdout("ok"),
	};
}

function writeWorkflow(name: string, contents: string): string {
	const file = path.join(repo, "agentic", "workflows", `${name}.yaml`);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, contents, "utf-8");
	return file;
}

function dispatchPayload(extra: Partial<DispatchPayload> = {}): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents: TWO_STEPS },
		config: getDefaultConfig(),
		env: { PATH: process.env.PATH ?? "" },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "wf",
		terminal_output: "base",
		...extra,
	};
}

function overseerPayload(extra: Partial<OverseerPayload> = {}): OverseerPayload {
	return { repo_root: repo, config: getDefaultConfig(), env: {}, ...extra };
}

async function startSupervisor(transport?: NotificationTransport) {
	const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
	const manager = new RunManager({
		root: home.root,
		notifications: transport ? { transport, pollMs: 0 } : { pollMs: 0 },
	});
	manager.attach(supervisor);
	const discovery = await supervisor.start();
	await manager.start();
	supervisors.push(supervisor);
	managers.push(manager);
	return { supervisor, manager, client: new SupervisorClient(discovery) };
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

function eventTypes(dir: string): string[] {
	return new RunStore(dir).readEvents().map((e) => e.type);
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-overseer-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	await Promise.all(mcpClients.splice(0).map((c) => c.close()));
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("overseer runs", () => {
	it("creates an overseer run with its epic, config snapshot and run.started", async () => {
		const { manager } = await startSupervisor();
		const open = await manager.openOverseer(
			overseerPayload({ epic: "# Auth epic\n\n- T01 login\n", epic_source: "/tmp/epic.md" }),
		);
		expect(open.mode).toBe("created");
		expect(open.session).toBe(1);
		expect(open.run.id).toMatch(/^\d{4}-\d{2}-\d{2}-overseer$/);
		const run = new RunStore(open.dir).readRun();
		expect(run).toMatchObject({
			type: "overseer",
			status: "running",
			title: "Auth epic",
			workflow: null,
			repo,
		});
		expect(validateArtifact("run", run).valid).toBe(true);
		expect(manager.registry.get(open.run.id)).toMatchObject({
			type: "overseer",
			workflow: "overseer",
			status: "running",
		});
		expect(readFileSync(path.join(open.dir, "epic.md"), "utf-8")).toContain("T01 login");
		expect(open.epic).toBe(path.join(open.dir, "epic.md"));
		const file = JSON.parse(readFileSync(path.join(open.dir, "overseer.json"), "utf-8"));
		expect(file.epic_source).toBe("/tmp/epic.md");
		expect(file.sessions).toHaveLength(1);
		const [started] = new RunStore(open.dir).readEvents();
		expect(started).toMatchObject({
			type: "run.started",
			data: { type: "overseer", session: 1, epic: "epic.md" },
		});
	});

	it("reuses the open overseer run of the repository, unless new or an epic is given", async () => {
		const { manager } = await startSupervisor();
		const first = await manager.openOverseer(overseerPayload());
		expect(first.epic).toBeNull();
		const again = await manager.openOverseer(overseerPayload());
		expect(again).toMatchObject({ mode: "reused", session: 2, run: { id: first.run.id } });
		expect(eventTypes(first.dir)).toEqual(["run.started", "run.resumed"]);
		const fresh = await manager.openOverseer(overseerPayload({ new: true }));
		expect(fresh.run.id).not.toBe(first.run.id);
		expect(fresh.mode).toBe("created");
		const epic = await manager.openOverseer(overseerPayload({ epic: "Another epic" }));
		expect(epic.mode).toBe("created");
		expect(new Set([first.run.id, fresh.run.id, epic.run.id]).size).toBe(3);
	});

	it("resumes an overseer run by id and refuses workflow, unknown and ended runs", async () => {
		const { manager, client } = await startSupervisor();
		const open = await manager.openOverseer(overseerPayload({ epic: "Epic" }));
		const resumed = await manager.openOverseer(overseerPayload({ resume: open.run.id }));
		expect(resumed).toMatchObject({ mode: "resumed", session: 2, epic: open.epic });
		const sessions = JSON.parse(readFileSync(path.join(open.dir, "overseer.json"), "utf-8"));
		expect(sessions.sessions.map((s: { n: number }) => s.n)).toEqual([1, 2]);

		await expect(
			client.request("POST", "/v1/overseer", overseerPayload({ resume: "nope" })),
		).rejects.toThrow(/Run not found: nope/);
		await expect(
			client.request(
				"POST",
				"/v1/overseer",
				overseerPayload({ resume: open.run.id, epic: "new epic" }),
			),
		).rejects.toThrow(/cannot be combined/);
		const wf = await manager.dispatch(dispatchPayload());
		await waitForStatus(manager, wf.run.id, "done");
		await expect(manager.openOverseer(overseerPayload({ resume: wf.run.id }))).rejects.toThrow(
			/not an overseer run/,
		);
		await manager.finishOverseer(open.run.id, {});
		await expect(
			manager.openOverseer(overseerPayload({ resume: open.run.id })),
		).rejects.toMatchObject({ status: 409 });
	});

	it("never holds the checkout, counts as no active run and is skipped by crash recovery", async () => {
		const first = await startSupervisor();
		const open = await first.manager.openOverseer(overseerPayload());
		expect(first.manager.activeCount()).toBe(0);
		// A workflow run without a worktree in the same checkout still starts
		const wf = await first.manager.dispatch(dispatchPayload());
		await waitForStatus(first.manager, wf.run.id, "done");
		expect(fakeRuntime.calls.map((c) => c.prompt.includes("PLAN"))).toContain(true);

		// A new supervisor leaves the overseer run open and untouched
		for (const m of managers.splice(0)) m.close();
		await Promise.all(supervisors.splice(0).map((s) => s.stop()));
		const second = await startSupervisor();
		expect(second.manager.registry.get(open.run.id)?.status).toBe("running");
		expect(eventTypes(open.dir)).toEqual(["run.started"]);
	});

	it("refuses pause, resume and messages, and can be canceled", async () => {
		const { manager } = await startSupervisor();
		const open = await manager.openOverseer(overseerPayload());
		await expect(manager.pause(open.run.id)).rejects.toMatchObject({ status: 409 });
		await expect(manager.send(open.run.id, { text: "hi" })).rejects.toThrow(
			/overseer run: talk to the overseer in its session/,
		);
		await expect(manager.resume(open.run.id)).rejects.toMatchObject({ status: 409 });
		expect(await manager.cancel(open.run.id)).toEqual({ id: open.run.id, status: "canceled" });
		expect(eventTypes(open.dir)).toContain("run.canceled");
	});

	it("finishes with summary.md and run.completed, or halted", async () => {
		const { manager, client } = await startSupervisor();
		const open = await manager.openOverseer(overseerPayload({ epic: "# Ship auth" }));
		await expect(
			client.request("POST", `/v1/overseer/${open.run.id}/finish`, { status: "merged" }),
		).rejects.toThrow(/expected done, halted, failed/);
		const res = await client.request<{ status: string; summary: string }>(
			"POST",
			`/v1/overseer/${open.run.id}/finish`,
			{ summary: "T01 done (run x)." },
		);
		expect(res.status).toBe("done");
		const summary = readFileSync(res.summary, "utf-8");
		expect(summary).toContain("T01 done (run x).");
		const frontmatter = summary.split("---")[1];
		expect(frontmatter).toContain(`task: "${open.run.id}"`);
		expect(frontmatter).toContain('status: "done"');
		const run = new RunStore(open.dir).readRun();
		expect(run.status).toBe("done");
		expect(run.ended_at).toBeTruthy();
		expect(new RunStore(open.dir).readEvents().at(-1)).toMatchObject({
			type: "run.completed",
			data: { status: "done", type: "overseer" },
		});
		await expect(manager.finishOverseer(open.run.id, {})).rejects.toMatchObject({ status: 409 });

		const other = await manager.openOverseer(overseerPayload({ new: true }));
		await manager.finishOverseer(other.run.id, { status: "halted", summary: "Stopped" });
		expect(eventTypes(other.dir).at(-1)).toBe("run.halted");

		const wf = await manager.dispatch(dispatchPayload());
		await waitForStatus(manager, wf.run.id, "done");
		await expect(manager.finishOverseer(wf.run.id, {})).rejects.toThrow(/not an overseer run/);
	});

	it("notifies run.completed of an overseer run by default, with the overseer's config", async () => {
		const sent: string[] = [];
		const transport: NotificationTransport = {
			async post(url, body) {
				sent.push(`${url} ${body}`);
				return 200;
			},
			async exec() {},
			async comment() {},
		};
		const { manager } = await startSupervisor(transport);
		const config = {
			...getDefaultConfig(),
			notifications: {
				channels: { ntfy: { enabled: true, topic: "af-test", server: "https://ntfy.example" } },
			},
		};
		await manager.notifier.poll();
		const open = await manager.openOverseer(overseerPayload({ config }));
		await manager.notifier.poll();
		await manager.finishOverseer(open.run.id, { summary: "All done" });
		await manager.notifier.poll();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("https://ntfy.example/af-test");
		expect(eventTypes(open.dir).at(-1)).toBe("notification.sent");
	});

	it("records the parent of a dispatched run and refuses an unknown parent", async () => {
		const { manager } = await startSupervisor();
		const open = await manager.openOverseer(overseerPayload());
		const child = await manager.dispatch(dispatchPayload({ parent: open.run.id }));
		expect(child.run.parent).toBe(open.run.id);
		expect(new RunStore(child.dir).readEvents()[0].data).toMatchObject({ parent: open.run.id });
		expect(manager.list({ parent: open.run.id }).map((r) => r.id)).toEqual([child.run.id]);
		await expect(manager.dispatch(dispatchPayload({ parent: "missing" }))).rejects.toThrow(
			/Parent run not found: missing/,
		);
		await waitForStatus(manager, child.run.id, "done");
	});

	it("titles a run from the first line of its epic", () => {
		expect(epicTitle("\n\n## Payments v2\nmore")).toBe("Payments v2");
		expect(epicTitle(null)).toBe("overseer");
		expect(epicTitle("x".repeat(100))).toHaveLength(80);
	});
});

describe("af overseer launcher", () => {
	async function launch(options: Parameters<typeof cmdOverseer>[0], client: SupervisorClient) {
		const commands: OverseerCommand[] = [];
		const output: string[] = [];
		const code = await cmdOverseer(options, {
			client,
			cwd: repo,
			env: { PATH: "x", ANTHROPIC_API_KEY: "secret-not-forwarded-check", HOME: "h" },
			claude: "claude-bin",
			launch: async (command) => {
				commands.push(command);
				return 3;
			},
			out: (text) => output.push(text),
		});
		return { code, command: commands[0], output: output.join("") };
	}

	it("starts claude with the overseer skill, the af MCP server and the run dir", async () => {
		const { manager, client } = await startSupervisor();
		const { code, command, output } = await launch(
			{ model: "opus", claudeArgs: ["--verbose"] },
			client,
		);
		expect(code).toBe(3);
		const [entry] = manager.list({});
		expect(entry.type).toBe("overseer");
		expect(output).toContain(`Overseer run created: ${entry.id}`);
		expect(output).toContain(`agentic-forge overseer --resume ${entry.id}`);

		expect(command.executable).toBe("claude-bin");
		expect(command.cwd).toBe(repo);
		const [prompt, ...rest] = command.args;
		expect(prompt).toMatch(
			new RegExp(`^/af-overseer:overseer --run ${entry.id} --run-dir \\S+ --af ".+" --session 1$`),
		);
		expect(prompt).toContain(JSON.stringify(afShellCommand()));
		const option = (name: string) => rest[rest.indexOf(name) + 1];
		expect(option("--mcp-config")).toBe(command.mcpConfig);
		expect(option("--plugin-dir")).toBe(getOverseerPluginDir());
		expect(option("--add-dir")).toBe(entry.dir);
		expect(option("--allowedTools")).toBe("mcp__agentic-forge");
		expect(option("--model")).toBe("opus");
		expect(rest.at(-1)).toBe("--verbose");
		expect(command.env).toMatchObject({
			AF_OVERSEER_RUN: entry.id,
			AF_OVERSEER_RUN_DIR: entry.dir,
		});

		const mcp = JSON.parse(readFileSync(command.mcpConfig, "utf-8"));
		expect(path.dirname(command.mcpConfig)).toBe(path.join(entry.dir, "overseer"));
		expect(mcp.mcpServers["agentic-forge"]).toEqual({
			command: process.execPath,
			args: [expect.stringMatching(/cli\.js$/), "mcp"],
			env: { AF_OVERSEER_RUN: entry.id },
		});
	});

	it("reads an epic file, then rehydrates on --resume", async () => {
		const { client } = await startSupervisor();
		const epicFile = path.join(repo, "epic.md");
		writeFileSync(epicFile, "# Search epic\n\n- T01 index\n", "utf-8");
		const first = await launch({ epic: "epic.md" }, client);
		const id = first.command.env.AF_OVERSEER_RUN;
		const dir = first.command.env.AF_OVERSEER_RUN_DIR;
		expect(readFileSync(path.join(dir, "epic.md"), "utf-8")).toContain("T01 index");
		expect(new RunStore(dir).readRun().title).toBe("Search epic");
		expect(first.command.args[0]).toContain("--epic ");
		expect(first.command.args[0]).not.toContain("--rehydrate");

		const again = await launch({ resume: id }, client);
		expect(again.output).toContain(`Overseer run resumed: ${id} (session 2)`);
		expect(again.command.args[0]).toMatch(/--session 2 --epic \S+ --rehydrate$/);
		await expect(launch({ resume: id, epic: "x" }, client)).rejects.toThrow(/drop --epic/);
	});

	it("prints the command without launching, and finishes a run", async () => {
		const { client } = await startSupervisor();
		const output: string[] = [];
		let launched = false;
		await cmdOverseer(
			{ printCommand: true },
			{
				client,
				cwd: repo,
				env: {},
				launch: async () => {
					launched = true;
					return 0;
				},
				out: (t) => output.push(t),
			},
		);
		expect(launched).toBe(false);
		const id = /Overseer run created: (\S+)/.exec(output.join(""))?.[1] ?? "";
		expect(output.join("")).toContain("/af-overseer:overseer --run");

		const finished: string[] = [];
		await cmdOverseer(
			{ finish: id, summary: "Done" },
			{ client, cwd: repo, out: (t) => finished.push(t) },
		);
		expect(finished.join("")).toContain(`Overseer run done: ${id}`);
		await expect(
			cmdOverseer({ finish: id, resume: id }, { client, cwd: repo, out: () => {} }),
		).rejects.toThrow(/cannot be combined/);
	});

	it("treats an --epic that is not a file as text", () => {
		expect(readEpic("Build the cache layer", repo)).toEqual({
			epic: "Build the cache layer",
			source: null,
		});
		expect(readEpic(undefined, repo)).toEqual({ epic: null, source: null });
	});

	it("ships the af-overseer plugin with the overseer skill", () => {
		const dir = getOverseerPluginDir();
		const manifest = JSON.parse(
			readFileSync(path.join(dir, ".claude-plugin", "plugin.json"), "utf-8"),
		);
		expect(manifest.name).toBe("af-overseer");
		const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8"));
		expect(manifest.version).toBe(pkg.version);
		const skillFile = path.join(dir, "skills", "overseer", "SKILL.md");
		expect(existsSync(skillFile)).toBe(true);
		const skill = readFileSync(skillFile, "utf-8");
		expect(skill).toMatch(/^---\nname: overseer\n/);
		expect(skill).toContain(`--types "${OVERSEER_EVENT_TYPES}"`);
		expect(skill).toContain("--cursor-file");
		for (const word of [
			"af_dispatch",
			"parent",
			"af_send",
			"af_answer",
			"AskUserQuestion",
			"--finish",
			"Rehydration",
			"af_backlog_list",
			"af_backlog_add",
			"af_backlog_update",
			"item: <id>",
			"overseer_policy",
			"track_reason",
		]) {
			expect(skill).toContain(word);
		}
	});
});

describe("overseer flow over MCP", () => {
	interface ToolOutput {
		isError: boolean;
		// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of a tool result
		json: any;
		text: string;
	}

	async function callTool(
		mcp: Client,
		name: string,
		args: Record<string, unknown>,
	): Promise<ToolOutput> {
		const result = await mcp.callTool({ name, arguments: args });
		const text = (result.content as Array<{ text: string }>).map((c) => c.text).join("\n");
		let json: unknown = null;
		try {
			json = JSON.parse(text);
		} catch {
			json = null;
		}
		return { isError: result.isError === true, json, text };
	}

	it("dispatches a workflow as a child, relays a correction, follows it to completion and finishes", async () => {
		const { manager, client } = await startSupervisor();
		writeWorkflow("two-steps", TWO_STEPS);
		const server = createMcpServer({
			getClient: async () => client,
			registryRoot: home.root,
			cwd: repo,
			version: "1.0.0",
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const mcp = new Client({ name: "overseer-test", version: "1.0.0" });
		await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
		mcpClients.push(mcp);

		const overseer: OverseerOpenResult = await client.request(
			"POST",
			"/v1/overseer",
			overseerPayload(),
		);
		let release = () => {};
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		fakeRuntime.on("PLAN", async (options) => {
			await released;
			return ok(options);
		});

		const dispatched = await callTool(mcp, "af_dispatch", {
			workflow: "two-steps",
			repo,
			parent: overseer.run.id,
		});
		expect(dispatched.isError).toBe(false);
		const runId = dispatched.json.run_id as string;
		await fakeRuntime.waitFor("PLAN");

		const sent = await callTool(mcp, "af_send", {
			run: runId,
			text: "Use the existing cache client",
			from: "user",
		});
		expect(sent.isError).toBe(false);
		release();

		let cursor: string | undefined;
		let status = "";
		for (let i = 0; i < 20 && status !== "run.completed"; i++) {
			const page = await callTool(mcp, "af_events", {
				run: runId,
				types: ["run.*"],
				wait_seconds: 2,
				...(cursor ? { cursor } : {}),
			});
			cursor = page.json.cursor;
			status = page.json.events.at(-1)?.type ?? status;
		}
		expect(status).toBe("run.completed");
		const build = fakeRuntime.calls.find((c) => c.prompt.includes("BUILD"));
		expect(build?.prompt).toContain("## Operator Messages");
		expect(build?.prompt).toContain("Use the existing cache client");

		const children = await callTool(mcp, "af_list_runs", { parent: overseer.run.id });
		expect(children.json.runs.map((r: { id: string }) => r.id)).toEqual([runId]);

		await cmdOverseer(
			{ finish: overseer.run.id, summary: `two-steps done (${runId})` },
			{ client, cwd: repo, out: () => {} },
		);
		expect(manager.registry.get(overseer.run.id)?.status).toBe("done");
		expect(readFileSync(path.join(overseer.dir, "summary.md"), "utf-8")).toContain(runId);
	});
});
