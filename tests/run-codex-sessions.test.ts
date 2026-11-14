/**
 * Integration tests for Codex steps on the session driver (`codex app-server`)
 * through the in-process supervisor, with the fake app-server: result blocks,
 * approvals and questions as needs_input answered by af answer while the
 * session waits, send --mode next and now, and skill steps with a native
 * Codex skill or the inlined SKILL.md.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { validateContractFile } from "../src/contract/index.js";
import { dispatchRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager, pendingInputs } from "../src/runs/manager.js";
import { RunStore } from "../src/runs/run-store.js";
import { codexAppServer, spawnAppServer } from "../src/runtimes/codex-session.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
import { fakeCodex, inputText, resultBlock } from "./helpers/fake-app-server.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

const home = useTempGlobalRoot();
let repo: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];

const ONE_STEP = `
name: codex-one
version: "1.0"
settings:
  runtime: codex
  max-retry: 0
steps:
  - name: build
    type: prompt
    prompt: "BUILD"
`;

function skillWorkflow(skill: string): string {
	return `
name: codex-skill
version: "1.0"
settings:
  runtime: codex
  max-retry: 0
steps:
  - name: plan
    type: skill
    skill: ${skill}
    args: "--fast"
`;
}

function payload(contents = ONE_STEP): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		config: getDefaultConfig(),
		env: { PATH: process.env.PATH ?? "", CLAUDE_CONFIG_DIR: path.join(repo, ".no-claude") },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "codex",
		terminal_output: "base",
	};
}

async function startSupervisor() {
	const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
	const manager = new RunManager({ root: home.root });
	manager.attach(supervisor);
	const discovery = await supervisor.start();
	await manager.start();
	supervisors.push(supervisor);
	managers.push(manager);
	return { manager, client: new SupervisorClient(discovery) };
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
	for (let i = 0; i < 300; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

async function waitForStatus(manager: RunManager, id: string, status: string): Promise<void> {
	await waitFor(() => manager.registry.get(id)?.status === status, `status ${status}`);
	if (status !== "awaiting-human") await manager.idle();
}

function eventsOf(store: RunStore, type: string) {
	return store.readEvents().filter((e) => e.type === type);
}

function stepResult(store: RunStore, step: string) {
	return store.readJson<{ status: string; summary: string }>(
		path.join("steps", step, "result.json"),
	);
}

beforeEach(() => {
	codexAppServer.spawn = fakeCodex.spawn;
	repo = mkdtempSync(path.join(tmpdir(), "af-codex-repo-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	fakeCodex.reset();
	codexAppServer.spawn = spawnAppServer;
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("Codex session steps", () => {
	it("runs a Codex prompt step on the session driver and records its result block", async () => {
		fakeCodex.on("BUILD", async (turn) => {
			turn.message(`Built it\n${resultBlock("done", "Built on Codex")}`);
			turn.complete();
		});
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "done");
		const store = new RunStore(res.dir);
		expect(stepResult(store, "01-build").summary).toBe("Built on Codex");
		expect(
			validateContractFile(path.join(res.dir, "steps", "01-build", "result.json")).errors,
		).toEqual([]);
		const session = store.readJson<{ session_id: string; runtime: string; driver: string }>(
			path.join("steps", "01-build", "session.json"),
		);
		expect(session).toMatchObject({ session_id: "thread-1", runtime: "codex", driver: "session" });
	});

	it("raises an approval as needs_input and continues with af answer while the session waits", async () => {
		const decisions: unknown[] = [];
		fakeCodex.on("BUILD", async (turn) => {
			decisions.push(await turn.command("npm publish", { approval: true }));
			turn.message(resultBlock("done", "published"));
			turn.complete();
		});
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "awaiting-human");
		const store = new RunStore(res.dir);
		const [asked] = eventsOf(store, "needs_input");
		expect(asked.data).toMatchObject({
			step: "build",
			question: "Allow shell? npm publish",
			options: [{ id: "allow" }, { id: "deny" }],
			live: true,
			tool: "shell",
		});
		expect(pendingInputs(store.readRun())[0]).toMatchObject({ live: true, session_id: "thread-1" });
		const answer = await client.request<{ status: string }>(
			"POST",
			`/v1/runs/${res.run.id}/answer`,
			{ request_id: asked.data?.id, answer: "allow" },
		);
		expect(answer.status).toBe("running");
		await waitForStatus(manager, res.run.id, "done");
		expect(decisions).toEqual(["accept"]);
		// Same app-server and thread: no step rerun
		expect(fakeCodex.servers).toHaveLength(1);
		expect(eventsOf(store, "input.answered")[0].data).toMatchObject({ live: true });
	});

	it("answers a requestUserInput question with af answer", async () => {
		let answers: unknown;
		fakeCodex.on("BUILD", async (turn) => {
			answers = await turn.ask([
				{
					id: "q1",
					header: "Store",
					question: "Which token store?",
					isOther: false,
					isSecret: false,
					options: [
						{ label: "Redis cache", description: "" },
						{ label: "Database table", description: "" },
					],
				},
			]);
			turn.message(resultBlock());
			turn.complete();
		});
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "awaiting-human");
		const store = new RunStore(res.dir);
		const [asked] = eventsOf(store, "needs_input");
		expect(asked.data).toMatchObject({
			question: "Which token store?",
			tool: "request_user_input",
		});
		await client.request("POST", `/v1/runs/${res.run.id}/answer`, { answer: "b" });
		await waitForStatus(manager, res.run.id, "done");
		expect(answers).toEqual({ q1: { answers: ["Database table"] } });
	});

	it("steers the running turn with send --mode now and sends --mode next as the next turn", async () => {
		fakeCodex.on("BUILD", async (turn) => {
			await turn.waitForSteers(1);
			turn.message(resultBlock("done", "steered"));
			turn.complete();
		});
		fakeCodex.on("Also cover", async (turn) => {
			turn.message(resultBlock("done", "second turn"));
			turn.complete();
		});
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		const turn = await fakeCodex.waitFor("BUILD");
		await waitFor(() => manager.registry.get(res.run.id)?.status === "running", "running");
		await client.request("POST", `/v1/runs/${res.run.id}/messages`, {
			text: "Also cover the edge case",
			step: "build",
		});
		const sent = await client.request<{ steered: boolean }>(
			"POST",
			`/v1/runs/${res.run.id}/messages`,
			{ text: "Use the v2 API", mode: "now", step: "build" },
		);
		expect(sent.steered).toBe(true);
		await waitForStatus(manager, res.run.id, "done");
		expect(inputText(turn.steers[0].input)).toContain("Use the v2 API");
		const server = fakeCodex.servers[0];
		expect(server.turns).toHaveLength(2);
		expect(server.turns[1].text).toContain("Also cover the edge case");
		const store = new RunStore(res.dir);
		expect(stepResult(store, "01-build").summary).toBe("second turn");
		expect(eventsOf(store, "step.retried")).toEqual([]);
	});

	it("runs a skill step with the native Codex skill when skills/list has it", async () => {
		fakeCodex.skills = [{ name: "esp-skills:esp-plan", path: "/codex/skills/esp-plan/SKILL.md" }];
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload(skillWorkflow("esp-skills:esp-plan")));
		await waitForStatus(manager, res.run.id, "done");
		const [first] = fakeCodex.servers[0].turns;
		expect(first.input[0]).toEqual({
			type: "skill",
			name: "esp-skills:esp-plan",
			path: "/codex/skills/esp-plan/SKILL.md",
		});
		expect(first.text).toMatch(/^\$esp-skills:esp-plan --fast --run-dir /);
		const log = new RunStore(res.dir).readEvents();
		expect(log.find((e) => e.type === "step.completed")).toBeTruthy();
	});

	it("falls back to the inlined SKILL.md when Codex does not have the skill", async () => {
		const dir = path.join(repo, ".claude", "skills", "probe");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			path.join(dir, "SKILL.md"),
			"---\nname: probe\ndescription: probe\n---\nPROBE BODY $ARGUMENTS\n",
		);
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload(skillWorkflow("probe")));
		await waitForStatus(manager, res.run.id, "done");
		const [first] = fakeCodex.servers[0].turns;
		expect(first.input.some((i) => i.type === "skill")).toBe(false);
		expect(first.text).toContain("PROBE BODY --fast --run-dir");
		expect(first.text).toContain("# Skill: probe");
	});

	it("fails a skill step that is neither in Codex nor on disk", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload(skillWorkflow("esp-skills:nowhere")));
		await waitForStatus(manager, res.run.id, "failed");
		const store = new RunStore(res.dir);
		expect(JSON.stringify(eventsOf(store, "step.failed")[0].data)).toContain("was not found");
		expect(fakeCodex.servers[0].turns).toEqual([]);
	});
});
