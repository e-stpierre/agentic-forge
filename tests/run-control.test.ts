/**
 * Integration tests for run control (ORC-007): inbox and operator messages,
 * pause / resume at boundaries and with --now, cancel with safetyCommit and
 * worktree cleanup. In-process supervisor, fake runtime.
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { validateArtifact, validateContractFile } from "../src/contract/index.js";
import { shouldRemoveWorktree } from "../src/executor.js";
import { loadProgress } from "../src/progress.js";
import { dispatchRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { Inbox, formatOperatorMessages } from "../src/runs/inbox.js";
import { RunManager } from "../src/runs/manager.js";
import { RunStore } from "../src/runs/run-store.js";
import type { RuntimeResult, RuntimeRunOptions } from "../src/runtimes/types.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
import { fakeRuntime } from "./helpers/fake-runtime.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const { fakeRuntime: fake } = await import("./helpers/fake-runtime.js");
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return { ...original, runRuntime: fake.run };
});

const createWorktreeMock = vi.fn();
const safetyCommitMock = vi.fn();
const removeWorktreeMock = vi.fn();
vi.mock("../src/git/worktree.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/git/worktree.js")>();
	return {
		...original,
		copyLocalDirs: vi.fn(),
		createWorktree: (...args: unknown[]) => createWorktreeMock(...args),
		findExistingWorktree: vi.fn().mockReturnValue(null),
		removeWorktree: (...args: unknown[]) => removeWorktreeMock(...args),
		safetyCommit: (...args: unknown[]) => safetyCommitMock(...args),
	};
});

const home = useTempGlobalRoot();
let repo: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];

const THREE_STEPS = `
name: three-steps
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
  - name: review
    type: prompt
    prompt: "REVIEW"
`;

const LOOP = `
name: loop
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: iterate
    type: ralph-loop
    prompt: "LOOP {{ iteration }}"
    max-iterations: 3
    completion-promise: DONE
`;

function withWorktree(contents: string, cleanup: string): string {
	return contents.replace(
		"  max-retry: 0",
		`  max-retry: 0\n  worktree:\n    enabled: true\n    cleanup: ${cleanup}`,
	);
}

function payload(contents = THREE_STEPS): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		config: getDefaultConfig(),
		env: { PATH: process.env.PATH ?? "" },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "ctl",
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

function ok(options: RuntimeRunOptions, stdout = "ok"): RuntimeResult {
	return {
		returncode: 0,
		stdout,
		stderr: "",
		prompt: options.prompt,
		cwd: null,
		model: null,
		success: true,
		sessionOutput: { sessionId: null, isSuccess: true, context: "done" },
	};
}

/** Holds prompts containing `match` until `release()` is called. */
function hold(match: string) {
	let release!: () => void;
	const released = new Promise<void>((r) => {
		release = r;
	});
	fakeRuntime.on(match, async (o) => {
		await released;
		return ok(o);
	});
	return () => release();
}

function prompts(match: string): string[] {
	return fakeRuntime.calls.filter((c) => c.prompt.includes(match)).map((c) => c.prompt);
}

function types(store: RunStore): string[] {
	return store.readEvents().map((e) => e.type);
}

beforeEach(() => {
	fakeRuntime.reset();
	createWorktreeMock.mockReset();
	safetyCommitMock.mockReset().mockReturnValue({ committed: false, failed: false });
	removeWorktreeMock.mockReset();
	repo = mkdtempSync(path.join(tmpdir(), "af-ctl-repo-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("inbox", () => {
	it("writes contract inbox files named <timestamp>-<id>.json in queue order", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "af-inbox-"));
		try {
			const inbox = new Inbox(dir);
			const a = inbox.queue({ text: "first" });
			const b = inbox.queue({ text: "second", from: "overseer", step: "build" });
			const files = readdirSync(path.join(dir, "inbox")).sort();
			expect(files).toHaveLength(2);
			for (const f of files) {
				expect(f).toMatch(/^\d{8}T\d{9}Z-m-[0-9a-f]{8}\.json$/);
				const message = JSON.parse(readFileSync(path.join(dir, "inbox", f), "utf-8"));
				expect(validateArtifact("inbox-message", message).valid).toBe(true);
			}
			expect(inbox.list().map((m) => m.id)).toEqual([a.id, b.id]);
			expect(b).toMatchObject({ target: "step", step: "build", from: "overseer" });
			expect(inbox.pending("plan").map((m) => m.id)).toEqual([a.id]);
			expect(inbox.pending("build").map((m) => m.id)).toEqual([a.id, b.id]);

			const delivered = inbox.markDelivered([a.id], "plan");
			expect(delivered[0].delivered_at).toBeTruthy();
			expect(delivered[0]["x-af-delivered-to"]).toBe("plan");
			expect(inbox.markDelivered([a.id], "plan")).toEqual([]);
			expect(inbox.pending("build").map((m) => m.id)).toEqual([b.id]);
			expect(validateArtifact("inbox-message", inbox.list()[0]).valid).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("formats the Operator Messages section", () => {
		const text = formatOperatorMessages([
			{
				id: "m001",
				at: "2026-11-10T12:00:00.000Z",
				from: "user",
				mode: "next",
				text: "Use the existing token cache.",
				target: "run",
			},
		]);
		expect(text).toBe(
			"## Operator Messages\n\n- [user, 2026-11-10T12:00:00Z, m001] Use the existing token cache.\n\n",
		);
		expect(formatOperatorMessages([])).toBe("");
	});
});

describe("af send", () => {
	it("injects the message at the start of the next step prompt, once", async () => {
		const { manager, client } = await startSupervisor();
		const release = hold("PLAN");
		const res = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("PLAN");
		const sent = await client.request<{ message: { id: string } }>(
			"POST",
			`/v1/runs/${res.run.id}/messages`,
			{ text: "Use the retry helper." },
		);
		release();
		await manager.idle();

		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("done");
		expect(prompts("PLAN")[0]).not.toContain("Operator Messages");
		const build = prompts("BUILD")[0];
		expect(build.startsWith("## Operator Messages\n\n- [user, ")).toBe(true);
		expect(build).toContain(`${sent.message.id}] Use the retry helper.`);
		expect(prompts("REVIEW")[0]).not.toContain("Operator Messages");

		const events = store.readEvents();
		const queued = events.filter((e) => e.type === "message.queued");
		const delivered = events.filter((e) => e.type === "message.delivered");
		expect(queued.map((e) => e.data?.id)).toEqual([sent.message.id]);
		expect(delivered.map((e) => e.data)).toEqual([{ id: sent.message.id, step: "build" }]);
		expect(validateContractFile(store.eventsFile).valid).toBe(true);

		const [message] = new Inbox(res.dir).list();
		expect(message.delivered_at).toBeTruthy();
		const decisions = store.readDecisions();
		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({ source: "operator", phase: "build" });
		expect(decisions[0].refs).toEqual([sent.message.id]);
		expect(validateContractFile(store.decisionsFile).valid).toBe(true);
	});

	it("delivers a step-targeted message to that step only", async () => {
		const { manager, client } = await startSupervisor();
		const release = hold("PLAN");
		const res = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("PLAN");
		await client.request("POST", `/v1/runs/${res.run.id}/messages`, {
			text: "Check the docs too.",
			step: "review",
			from: "overseer",
		});
		release();
		await manager.idle();
		expect(prompts("BUILD")[0]).not.toContain("Operator Messages");
		expect(prompts("REVIEW")[0]).toMatch(
			/^## Operator Messages\n\n- \[overseer, .*Check the docs too\./,
		);
	});

	it("injects the message at the next ralph-loop iteration", async () => {
		const { manager, client } = await startSupervisor();
		const release = hold("LOOP 1");
		const res = await dispatchRun(client, payload(LOOP));
		await fakeRuntime.waitFor("LOOP 1");
		await client.request("POST", `/v1/runs/${res.run.id}/messages`, { text: "Smaller steps." });
		release();
		await manager.idle();
		expect(prompts("LOOP 1")[0]).not.toContain("Operator Messages");
		expect(prompts("LOOP 2")[0].startsWith("## Operator Messages")).toBe(true);
		expect(prompts("LOOP 3")[0]).not.toContain("Operator Messages");
		expect(types(new RunStore(res.dir)).filter((t) => t === "message.delivered")).toHaveLength(1);
	});

	it("validates the message, the step and the run status", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const route = `/v1/runs/${res.run.id}/messages`;
		await expect(client.request("POST", route, { text: "  " })).rejects.toMatchObject({
			status: 400,
		});
		await expect(client.request("POST", route, { text: "x", mode: "now" })).rejects.toMatchObject({
			status: 400,
		});
		await expect(client.request("POST", route, { text: "x", from: "bot" })).rejects.toMatchObject({
			status: 400,
		});
		await expect(client.request("POST", route, { text: "x" })).rejects.toMatchObject({
			status: 409,
		});
		await expect(
			client.request("POST", "/v1/runs/nope/messages", { text: "x" }),
		).rejects.toMatchObject({ status: 404 });

		const release = hold("PLAN");
		const second = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("PLAN");
		await expect(
			client.request("POST", `/v1/runs/${second.run.id}/messages`, { text: "x", step: "deploy" }),
		).rejects.toMatchObject({ status: 400 });
		release();
		await manager.idle();
	});

	it("never delivers a message twice, including across a supervisor restart", async () => {
		// First supervisor: delivers the message to "build", then dies mid-step.
		const first = await startSupervisor();
		const release = hold("PLAN");
		fakeRuntime.on("BUILD", "hang");
		const res = await dispatchRun(first.client, payload());
		await fakeRuntime.waitFor("PLAN");
		await first.client.request("POST", `/v1/runs/${res.run.id}/messages`, { text: "Once only." });
		release();
		await fakeRuntime.waitFor("BUILD");
		expect(prompts("BUILD")[0]).toContain("Once only.");
		first.manager.close();
		await first.supervisor.stop();

		// Simulate a crash between delivered_at and its event and decision.
		const store = new RunStore(res.dir);
		const lines = readFileSync(store.eventsFile, "utf-8").trimEnd().split("\n");
		const kept = lines.filter((l) => !l.includes('"message.delivered"'));
		writeFileSync(
			store.eventsFile,
			`${kept.map((l, i) => JSON.stringify({ ...JSON.parse(l), seq: i + 1 })).join("\n")}\n`,
		);
		rmSync(store.decisionsFile);

		fakeRuntime.on("BUILD", "succeed");
		fakeRuntime.calls = [];
		const second = await startSupervisor();
		await second.manager.idle();

		expect(store.readRun().status).toBe("done");
		expect(prompts("BUILD")).toHaveLength(1);
		expect(prompts("BUILD")[0]).not.toContain("Operator Messages");
		const delivered = store.readEvents().filter((e) => e.type === "message.delivered");
		expect(delivered).toHaveLength(1);
		expect(delivered[0].data).toMatchObject({ step: "build", rebuilt: true });
		expect(store.readDecisions()).toHaveLength(1);
		expect(validateContractFile(store.eventsFile).valid).toBe(true);
	});
});

describe("af pause and af resume", () => {
	it("pauses at the next step boundary and resumes from the next step", async () => {
		const { manager, client } = await startSupervisor();
		const release = hold("PLAN");
		const res = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("PLAN");
		const paused = await client.request<{ status: string }>(
			"POST",
			`/v1/runs/${res.run.id}/pause`,
			{},
		);
		expect(paused.status).toBe("pausing");
		release();
		await manager.idle();

		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("paused");
		expect(prompts("BUILD")).toHaveLength(0);
		const last = store.readEvents().at(-1);
		expect(last).toMatchObject({ type: "run.paused", data: { status: "paused", now: false } });

		await client.request("POST", `/v1/runs/${res.run.id}/resume`);
		await manager.idle();
		expect(store.readRun().status).toBe("done");
		expect(fakeRuntime.calls.map((c) => c.prompt)).toEqual(["PLAN", "BUILD", "REVIEW"]);
		expect(types(store)).toContain("run.resumed");
	});

	it("pause --now kills the current step, which reruns on resume", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", "hang");
		const res = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("BUILD");
		await client.request("POST", `/v1/runs/${res.run.id}/pause`, { now: true });
		await manager.idle();

		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("paused");
		expect(fakeRuntime.calls.find((c) => c.prompt === "BUILD")?.aborted).toBe(true);
		expect(store.readEvents().at(-1)).toMatchObject({
			type: "run.paused",
			data: { now: true, interrupted_step: "build" },
		});
		expect(types(store)).not.toContain("step.failed");
		const progress = loadProgress(res.run.id, res.dir);
		expect(progress?.completedSteps.map((s) => `${s.name}:${s.status}`)).toEqual([
			"plan:completed",
			"build:interrupted",
		]);

		fakeRuntime.on("BUILD", "succeed");
		await client.request("POST", `/v1/runs/${res.run.id}/resume`);
		await manager.idle();
		expect(store.readRun().status).toBe("done");
		expect(fakeRuntime.calls.map((c) => c.prompt)).toEqual(["PLAN", "BUILD", "BUILD", "REVIEW"]);
		expect(validateContractFile(store.eventsFile).valid).toBe(true);
	});

	it("pauses a ralph loop between iterations and resumes at the next iteration", async () => {
		const { manager, client } = await startSupervisor();
		const release = hold("LOOP 1");
		const res = await dispatchRun(client, payload(LOOP));
		await fakeRuntime.waitFor("LOOP 1");
		await client.request("POST", `/v1/runs/${res.run.id}/pause`, {});
		release();
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("paused");
		expect(prompts("LOOP 2")).toHaveLength(0);

		await client.request("POST", `/v1/runs/${res.run.id}/resume`);
		await manager.idle();
		expect(store.readRun().status).toBe("done");
		expect(prompts("LOOP 1")).toHaveLength(1);
		expect(prompts("LOOP 2")).toHaveLength(1);
		expect(prompts("LOOP 3")).toHaveLength(1);
	});

	it("pauses a queued run directly and rejects pausing a finished run", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("PLAN", "hang");
		const first = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("PLAN");
		// Same checkout, no worktree: the second run waits in the queue
		const second = await dispatchRun(client, payload());
		const res = await client.request<{ status: string }>(
			"POST",
			`/v1/runs/${second.run.id}/pause`,
			{},
		);
		expect(res.status).toBe("paused");
		expect(new RunStore(second.dir).readRun().status).toBe("paused");

		await client.request("POST", `/v1/runs/${first.run.id}/cancel`);
		await manager.idle();
		expect(new RunStore(second.dir).readRun().status).toBe("paused");
		await expect(
			client.request("POST", `/v1/runs/${first.run.id}/pause`, {}),
		).rejects.toMatchObject({ status: 409 });
	});
});

describe("af cancel", () => {
	it("kills the running step, safety-commits, and keeps the worktree under on-success", async () => {
		const wtPath = mkdtempSync(path.join(tmpdir(), "af-ctl-wt-"));
		createWorktreeMock.mockReturnValue({ path: wtPath, branch: "agentic/x", baseBranch: "main" });
		try {
			const { manager, client } = await startSupervisor();
			fakeRuntime.on("BUILD", "hang");
			const res = await dispatchRun(client, payload(withWorktree(THREE_STEPS, "on-success")));
			await fakeRuntime.waitFor("BUILD");
			const cancel = await client.request<{ status: string }>(
				"POST",
				`/v1/runs/${res.run.id}/cancel`,
			);
			expect(cancel.status).toBe("canceling");
			await manager.idle();

			const store = new RunStore(res.dir);
			expect(store.readRun().status).toBe("canceled");
			expect(fakeRuntime.calls.find((c) => c.prompt === "BUILD")?.aborted).toBe(true);
			expect(store.readEvents().at(-1)).toMatchObject({
				type: "run.canceled",
				data: { interrupted_step: "build" },
			});
			expect(safetyCommitMock).toHaveBeenCalledWith(wtPath, expect.anything());
			expect(removeWorktreeMock).not.toHaveBeenCalled();
		} finally {
			rmSync(wtPath, { recursive: true, force: true });
		}
	});

	it("removes the worktree after the safety commit under on-complete", async () => {
		const wtPath = mkdtempSync(path.join(tmpdir(), "af-ctl-wt-"));
		createWorktreeMock.mockReturnValue({ path: wtPath, branch: "agentic/x", baseBranch: "main" });
		try {
			const { manager, client } = await startSupervisor();
			fakeRuntime.on("BUILD", "hang");
			const res = await dispatchRun(client, payload(withWorktree(THREE_STEPS, "on-complete")));
			await fakeRuntime.waitFor("BUILD");
			await client.request("POST", `/v1/runs/${res.run.id}/cancel`);
			await manager.idle();
			expect(safetyCommitMock).toHaveBeenCalledTimes(1);
			expect(removeWorktreeMock).toHaveBeenCalledTimes(1);
		} finally {
			rmSync(wtPath, { recursive: true, force: true });
		}
	});

	it("keeps the worktree of a paused run, then applies the policy on cancel", async () => {
		const wtPath = mkdtempSync(path.join(tmpdir(), "af-ctl-wt-"));
		writeFileSync(path.join(wtPath, ".git"), "gitdir: elsewhere\n");
		createWorktreeMock.mockReturnValue({ path: wtPath, branch: "agentic/x", baseBranch: "main" });
		try {
			const { manager, client } = await startSupervisor();
			fakeRuntime.on("BUILD", "hang");
			const res = await dispatchRun(client, payload(withWorktree(THREE_STEPS, "on-complete")));
			await fakeRuntime.waitFor("BUILD");
			await client.request("POST", `/v1/runs/${res.run.id}/pause`, { now: true });
			await manager.idle();
			expect(new RunStore(res.dir).readRun().status).toBe("paused");
			expect(removeWorktreeMock).not.toHaveBeenCalled();
			expect(safetyCommitMock).not.toHaveBeenCalled();

			const cancel = await client.request<{ status: string }>(
				"POST",
				`/v1/runs/${res.run.id}/cancel`,
			);
			expect(cancel.status).toBe("canceled");
			expect(safetyCommitMock).toHaveBeenCalledWith(wtPath);
			expect(removeWorktreeMock).toHaveBeenCalledTimes(1);
			const store = new RunStore(res.dir);
			expect(store.readEvents().at(-1)).toMatchObject({
				type: "run.canceled",
				data: { worktree: "removed" },
			});
		} finally {
			rmSync(wtPath, { recursive: true, force: true });
		}
	});
});

describe("worktree policy and process control", () => {
	it("never removes the worktree of a paused or awaiting-human run", () => {
		expect(shouldRemoveWorktree("on-complete", "paused")).toBe(false);
		expect(shouldRemoveWorktree("on-complete", "completed", { awaitingHuman: true })).toBe(false);
		expect(shouldRemoveWorktree("on-complete", "canceled")).toBe(true);
		expect(shouldRemoveWorktree("on-success", "canceled")).toBe(false);
		expect(shouldRemoveWorktree("on-success", "completed")).toBe(true);
		expect(shouldRemoveWorktree("manual", "completed")).toBe(false);
	});

	it("pruneOrphaned with recorded paths only prunes those orphaned directories", async () => {
		const { pruneOrphaned } =
			await vi.importActual<typeof import("../src/git/worktree.js")>("../src/git/worktree.js");
		const root = mkdtempSync(path.join(tmpdir(), "af-prune-"));
		try {
			const recorded = path.join(root, "recorded");
			const live = path.join(root, "live");
			const stepNested = path.join(root, "step-nested");
			for (const d of [recorded, live, stepNested]) mkdirSync(d);
			writeFileSync(path.join(live, ".git"), "gitdir: x\n");
			expect(pruneOrphaned(root, undefined, [recorded, live])).toBe(1);
			expect(existsSync(recorded)).toBe(false);
			expect(existsSync(live)).toBe(true);
			expect(existsSync(stepNested)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("killProcessTree stops the child and its descendants", async () => {
		const { killProcessTree, treeSpawnOptions } = await import("../src/runtimes/kill-tree.js");
		const script =
			"const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});" +
			"console.log(c.pid);setInterval(()=>{},1000);";
		const parent = spawn(process.execPath, ["-e", script], {
			stdio: ["ignore", "pipe", "ignore"],
			...treeSpawnOptions(),
		});
		const childPid = await new Promise<number>((resolve) => {
			parent.stdout?.once("data", (d: Buffer) => resolve(Number.parseInt(d.toString(), 10)));
		});
		const alive = (pid: number) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		};
		expect(alive(childPid)).toBe(true);
		const closed = new Promise((resolve) => parent.once("close", resolve));
		killProcessTree(parent.pid);
		await closed;
		for (let i = 0; i < 50 && alive(childPid); i++) {
			await new Promise((r) => setTimeout(r, 100));
		}
		expect(alive(childPid)).toBe(false);
	});
});
