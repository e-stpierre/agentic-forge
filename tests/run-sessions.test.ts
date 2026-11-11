/**
 * Integration tests for live session steps (ORC-035): Claude steps on the
 * session driver through the in-process supervisor, with the fake SDK
 * transport. Permission and question requests become needs_input while the
 * session waits, af answer reaches the waiting session, send --mode next and
 * now reach the live session without a step restart, and parallel steps can
 * each wait on their own request.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { validateContractFile } from "../src/contract/index.js";
import { dispatchRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager, pendingInputs } from "../src/runs/manager.js";
import { RunStore } from "../src/runs/run-store.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
import { type FakeSdkSession, fakeSdk, resultBlock, userText } from "./helpers/fake-sdk.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
	const { fakeSdk: fake } = await import("./helpers/fake-sdk.js");
	return { query: fake.query };
});

const home = useTempGlobalRoot();
let repo: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];

const TWO_STEPS = `
name: two-steps
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: build
    type: prompt
    prompt: "BUILD"
  - name: review
    type: prompt
    prompt: "REVIEW"
`;

const PARALLEL = `
name: parallel
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: par
    type: parallel
    steps:
      - name: left
        type: prompt
        prompt: "LEFT"
      - name: right
        type: prompt
        prompt: "RIGHT"
`;

function payload(contents = TWO_STEPS, config = getDefaultConfig()): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		config,
		env: { PATH: process.env.PATH ?? "" },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "session",
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
	return { supervisor, manager, client: new SupervisorClient(discovery) };
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

function types(store: RunStore): string[] {
	return store.readEvents().map((e) => e.type);
}

function eventsOf(store: RunStore, type: string) {
	return store.readEvents().filter((e) => e.type === type);
}

function expectValidRunDir(dir: string): void {
	for (const file of ["run.json", "events.jsonl", "decisions.jsonl"]) {
		const full = path.join(dir, file);
		if (existsSync(full)) expect(validateContractFile(full).errors).toEqual([]);
	}
}

/** Script: one tool call that needs a permission, then a done turn. */
function toolScript(tool: string, input: Record<string, unknown>, seen: string[]) {
	return async (s: FakeSdkSession, first: Parameters<typeof s.result>[1][number]) => {
		s.init();
		const decision = await s.tool(tool, input);
		seen.push(decision.behavior === "allow" ? "allow" : `deny: ${decision.message}`);
		s.result(`Done\n${resultBlock("done", `tool ${decision.behavior}`)}`, [first]);
		await s.nextUser();
	};
}

beforeEach(() => {
	fakeSdk.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-session-repo-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("session steps", () => {
	it("runs Claude prompt steps on the session driver by default", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "done");
		expect(fakeSdk.sessions.map((s) => userText(s.received[0]))).toEqual(["BUILD", "REVIEW"]);
		const store = new RunStore(res.dir);
		const completed = eventsOf(store, "step.completed");
		expect(completed.map((e) => e.data?.result_status)).toEqual(["done", "done"]);
		expectValidRunDir(res.dir);
	});

	it("asks for an off-allowlist tool and continues with the answer while the session waits", async () => {
		const seen: string[] = [];
		fakeSdk.on("BUILD", toolScript("Bash", { command: "npm publish" }, seen));
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "awaiting-human");
		const store = new RunStore(res.dir);
		const [asked] = eventsOf(store, "needs_input");
		expect(asked.data).toMatchObject({
			step: "build",
			question: "Allow Bash? npm publish",
			options: [{ id: "allow" }, { id: "deny" }],
			blocking: true,
			live: true,
			tool: "Bash",
		});
		const pending = pendingInputs(store.readRun());
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({ step: "build", live: true, session_id: "fake-session-1" });
		// No pause: the session waits alive, and resume is refused
		expect(types(store)).not.toContain("run.paused");
		await expect(client.request("POST", `/v1/runs/${res.run.id}/resume`, {})).rejects.toThrow(
			/live session/,
		);

		const answer = await client.request<{ status: string; message: string | null }>(
			"POST",
			`/v1/runs/${res.run.id}/answer`,
			{ request_id: asked.data?.id, answer: "allow" },
		);
		expect(answer).toMatchObject({ status: "running", message: null });
		await waitForStatus(manager, res.run.id, "done");
		expect(seen).toEqual(["allow"]);
		// Same session, no step rerun
		expect(fakeSdk.sessions.map((s) => userText(s.received[0]))).toEqual(["BUILD", "REVIEW"]);
		const answered = eventsOf(store, "input.answered")[0];
		expect(answered.data).toMatchObject({ answer: "allow", option: "allow", live: true });
		expect(types(store)).toContain("run.resumed");
		expect(store.readDecisions().map((d) => d.id)).toContain(`d-${asked.data?.id}`);
		expect(pendingInputs(store.readRun())).toEqual([]);
		expectValidRunDir(res.dir);
	});

	it("denies a tool call with the operator's answer", async () => {
		const seen: string[] = [];
		fakeSdk.on("BUILD", toolScript("Write", { file_path: "x" }, seen));
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "awaiting-human");
		await client.request("POST", `/v1/runs/${res.run.id}/answer`, { answer: "deny" });
		await waitForStatus(manager, res.run.id, "done");
		expect(seen).toEqual(["deny: Denied by the operator"]);
	});

	it("returns an AskUserQuestion answer as the tool result", async () => {
		let answers: unknown;
		fakeSdk.on("BUILD", async (s, first) => {
			s.init();
			const d = await s.tool("AskUserQuestion", {
				questions: [
					{
						question: "Which token store?",
						header: "Store",
						options: [{ label: "Redis cache" }, { label: "Database table" }],
					},
				],
			});
			answers = d.behavior === "allow" ? d.updatedInput?.answers : null;
			s.result(resultBlock(), [first]);
			await s.nextUser();
		});
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "awaiting-human");
		const store = new RunStore(res.dir);
		const [asked] = eventsOf(store, "needs_input");
		expect(asked.data).toMatchObject({
			question: "Which token store?",
			options: [
				{ id: "a", label: "Redis cache" },
				{ id: "b", label: "Database table" },
			],
			tool: "AskUserQuestion",
		});
		await client.request("POST", `/v1/runs/${res.run.id}/answer`, {
			request_id: asked.data?.id,
			answer: "database table",
		});
		await waitForStatus(manager, res.run.id, "done");
		expect(answers).toEqual({ "Which token store?": "Database table" });
	});

	it("delivers send --mode next as the next turn of the live session", async () => {
		let release!: () => void;
		const held = new Promise<void>((r) => {
			release = r;
		});
		fakeSdk.on("BUILD", async (s, first) => {
			s.init();
			await held;
			s.result(resultBlock("done", "first turn"), [first]);
			const second = await s.nextUser();
			if (second) s.result(resultBlock("done", "second turn"), [second]);
			await s.nextUser();
		});
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		const session = await fakeSdk.waitFor("BUILD");
		await client.request("POST", `/v1/runs/${res.run.id}/messages`, {
			text: "Also cover the edge case",
			step: "build",
		});
		release();
		await waitForStatus(manager, res.run.id, "done");
		expect(userText(session.received[1])).toContain("Also cover the edge case");
		const store = new RunStore(res.dir);
		expect(eventsOf(store, "message.delivered")[0].data).toMatchObject({ step: "build" });
		expect(
			store.readJson<{ status: string; summary: string }>(
				path.join("steps", "01-build", "result.json"),
			).summary,
		).toBe("second turn");
	});

	it("steers the live session with send --mode now, with no step restart", async () => {
		fakeSdk.on("BUILD", async (s, first) => {
			s.init();
			const steer = await s.nextUser();
			s.result("", [first]);
			s.result(resultBlock("done", "steered"), [steer]);
			await s.nextUser();
		});
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		const session = await fakeSdk.waitFor("BUILD");
		await waitFor(() => manager.registry.get(res.run.id)?.status === "running", "running");
		const sent = await client.request<{ steered: boolean }>(
			"POST",
			`/v1/runs/${res.run.id}/messages`,
			{ text: "Use the v2 API", mode: "now" },
		);
		expect(sent.steered).toBe(true);
		await waitForStatus(manager, res.run.id, "done");
		expect(session.received[1].priority).toBe("now");
		expect(userText(session.received[1])).toContain("Use the v2 API");
		const store = new RunStore(res.dir);
		expect(types(store)).not.toContain("step.retried");
		expect(fakeSdk.sessions.filter((s) => userText(s.received[0]) === "BUILD")).toHaveLength(1);
		expect(eventsOf(store, "message.delivered")[0].data).toMatchObject({ live: true });
	});

	it("lets two parallel session steps each wait and be answered by request id", async () => {
		const seen: string[] = [];
		fakeSdk.on("LEFT", toolScript("Bash", { command: "left" }, seen));
		fakeSdk.on("RIGHT", toolScript("Bash", { command: "right" }, seen));
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload(PARALLEL));
		const store = new RunStore(res.dir);
		await waitFor(() => pendingInputs(store.readRun()).length === 2, "two requests");
		expect(manager.registry.get(res.run.id)?.status).toBe("awaiting-human");
		const pending = pendingInputs(store.readRun());
		expect(pending.map((p) => p.step).sort()).toEqual(["left", "right"]);
		await expect(
			client.request("POST", `/v1/runs/${res.run.id}/answer`, { answer: "allow" }),
		).rejects.toThrow(/Several requests are pending/);

		const right = pending.find((p) => p.step === "right");
		const first = await client.request<{ status: string }>(
			"POST",
			`/v1/runs/${res.run.id}/answer`,
			{ request_id: right?.request.id, answer: "deny" },
		);
		expect(first.status).toBe("awaiting-human");
		expect(pendingInputs(store.readRun()).map((p) => p.step)).toEqual(["left"]);
		const left = pending.find((p) => p.step === "left");
		const second = await client.request<{ status: string }>(
			"POST",
			`/v1/runs/${res.run.id}/answer`,
			{ request_id: left?.request.id, answer: "allow" },
		);
		expect(second.status).toBe("running");
		await waitForStatus(manager, res.run.id, "done");
		expect(seen.sort()).toEqual(["allow", "deny: Denied by the operator"]);
		expectValidRunDir(res.dir);
	});

	it("resumes the same session when a step ended awaiting-human and is answered", async () => {
		const question = {
			id: "q1",
			question: "Keep v1?",
			options: [
				{ id: "keep", label: "Keep" },
				{ id: "drop", label: "Drop" },
			],
			recommended: "keep",
			blocking: true,
		};
		fakeSdk.on("BUILD", async (s, first) => {
			s.init();
			s.result(resultBlock("awaiting-human", "Need a decision", { needs_input: question }), [
				first,
			]);
			await s.nextUser();
		});
		fakeSdk.on("Answer to q1", async (s, first) => {
			s.init();
			s.result(resultBlock("done", "resumed"), [first]);
			await s.nextUser();
		});
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "awaiting-human");
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(pendingInputs(store.readRun())[0]).toMatchObject({ step: "build" });
		expect(pendingInputs(store.readRun())[0].live).toBeUndefined();
		await client.request("POST", `/v1/runs/${res.run.id}/answer`, {
			request_id: "q1",
			answer: "drop",
		});
		await waitForStatus(manager, res.run.id, "done");
		const resumed = fakeSdk.sessions[1];
		expect(resumed.options.resume).toBe("fake-session-1");
		expect(userText(resumed.received[0])).toContain("Answer to q1");
		expect(userText(resumed.received[0])).not.toContain("BUILD");
	});

	it("drops the request of a session canceled while it waits", async () => {
		fakeSdk.on("BUILD", toolScript("Bash", { command: "x" }, []));
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "awaiting-human");
		await client.request("POST", `/v1/runs/${res.run.id}/cancel`, {});
		await waitForStatus(manager, res.run.id, "canceled");
		expect(pendingInputs(new RunStore(res.dir).readRun())).toEqual([]);
	});

	it("still reads the single-object x-af-needs-input form", () => {
		const request = { id: "q1", question: "?", options: [], recommended: null, blocking: true };
		const single = { step: "s", request, asked_at: "x", deadline: null };
		expect(pendingInputs({ "x-af-needs-input": single } as never)).toEqual([single]);
		expect(pendingInputs({ "x-af-needs-input": null } as never)).toEqual([]);
	});
});
