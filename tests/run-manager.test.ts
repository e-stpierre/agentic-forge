/** Integration tests: workflows run through an in-process supervisor with a fake runtime. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { validateArtifact, validateContractFile } from "../src/contract/index.js";
import { loadProgress, saveProgress } from "../src/progress.js";
import { dispatchRun, followRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { filterEnv } from "../src/runs/dispatch.js";
import { RunManager, toRunStatus } from "../src/runs/manager.js";
import type { RegistryEntry } from "../src/runs/registry.js";
import { RunStore } from "../src/runs/run-store.js";
import { pickRunnable } from "../src/runs/scheduler.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
import { fakeRuntime } from "./helpers/fake-runtime.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const { fakeRuntime: fake } = await import("./helpers/fake-runtime.js");
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return { ...original, runRuntime: fake.run };
});

const createWorktreeMock = vi.fn();
vi.mock("../src/git/worktree.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/git/worktree.js")>();
	return {
		...original,
		copyLocalDirs: vi.fn(),
		createWorktree: (...args: unknown[]) => createWorktreeMock(...args),
		findExistingWorktree: vi.fn().mockReturnValue(null),
		removeWorktree: vi.fn(),
		safetyCommit: vi.fn().mockReturnValue({ failed: false }),
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
    prompt: "PLAN {{ task }}"
  - name: build
    type: prompt
    prompt: "BUILD"
  - name: review
    type: prompt
    prompt: "REVIEW"
variables:
  - name: task
    type: string
    required: true
`;

function payload(
	contents = THREE_STEPS,
	overrides: Partial<DispatchPayload> = {},
): DispatchPayload {
	const wfPath = path.join(repo, "agentic", "workflows", "wf.yaml");
	return {
		repo_root: repo,
		workflow: { path: wfPath, contents },
		config: getDefaultConfig(),
		env: { PATH: process.env.PATH ?? "", CLAUDE_TEST_TOKEN: "abc" },
		variables: { task: "demo" },
		runtime: null,
		from_step: null,
		slug: "demo",
		terminal_output: "base",
		...overrides,
	};
}

async function startSupervisor(): Promise<{
	supervisor: Supervisor;
	manager: RunManager;
	client: SupervisorClient;
}> {
	const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
	const manager = new RunManager({ root: home.root });
	manager.attach(supervisor);
	const discovery = await supervisor.start();
	await manager.start();
	supervisors.push(supervisor);
	managers.push(manager);
	return { supervisor, manager, client: new SupervisorClient(discovery) };
}

beforeEach(() => {
	fakeRuntime.reset();
	createWorktreeMock.mockReset();
	repo = mkdtempSync(path.join(tmpdir(), "af-repo-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function eventTypes(store: RunStore): string[] {
	return store.readEvents().map((e) => (e.data?.step ? `${e.type}:${e.data.step}` : e.type));
}

describe("dispatch and execution", () => {
	it("dispatches over IPC, returns a run id, and runs the workflow to done", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		expect(res.run.id).toMatch(/^\d{4}-\d{2}-\d{2}-demo$/);
		expect(res.dir).toBe(path.join(home.root, "runs", res.run.id));
		await manager.idle();

		const store = new RunStore(res.dir);
		const run = store.readRun();
		expect(run.status).toBe("done");
		expect(run.ended_at).toBeTruthy();
		expect(validateArtifact("run", run).valid).toBe(true);
		expect(validateContractFile(store.eventsFile).valid).toBe(true);
		expect(eventTypes(store)).toEqual([
			"run.queued",
			"run.started",
			"step.started:plan",
			"step.completed:plan",
			"step.started:build",
			"step.completed:build",
			"step.started:review",
			"step.completed:review",
			"run.completed",
		]);
		expect(manager.registry.get(res.run.id)?.status).toBe("done");
		expect(fakeRuntime.calls.map((c) => c.prompt.split("\n")[0])).toContain("PLAN demo");
	});

	it("uses the dispatching repo's config, workflow and environment", async () => {
		const { manager, client } = await startSupervisor();
		const otherRepo = mkdtempSync(path.join(tmpdir(), "af-other-"));
		try {
			const config = { ...getDefaultConfig(), runs: { root: "my-runs" } };
			const res = await dispatchRun(
				client,
				payload(THREE_STEPS, {
					repo_root: otherRepo,
					config,
					env: { PATH: process.env.PATH ?? "", CLAUDE_MARKER: "from-client" },
				}),
			);
			await manager.idle();
			expect(res.dir).toBe(path.join(otherRepo, "my-runs", res.run.id));
			expect(new RunStore(res.dir).readRun().repo).toBe(otherRepo);
			const call = fakeRuntime.calls[0];
			expect(call.cwd).toBe(otherRepo);
			expect(call.env?.CLAUDE_MARKER).toBe("from-client");
			const stored = new RunStore(res.dir).readJson<DispatchPayload>("dispatch.json");
			expect(stored.workflow.contents).toBe(THREE_STEPS);
		} finally {
			rmSync(otherRepo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});

	it("maps a failing step to a failed run with step.failed and run.failed", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", "fail");
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("failed");
		const types = eventTypes(store);
		expect(types).toContain("step.failed:build");
		expect(types.at(-1)).toBe("run.failed");
		expect(types).not.toContain("step.started:review");
	});

	it("rejects an invalid dispatch and a missing required variable", async () => {
		const { client } = await startSupervisor();
		await expect(client.request("POST", "/v1/runs", { repo_root: repo })).rejects.toMatchObject({
			status: 400,
		});
		await expect(dispatchRun(client, payload(THREE_STEPS, { variables: {} }))).rejects.toThrow(
			/Missing required variable: task/,
		);
	});

	it("allocates a new directory on id collisions", async () => {
		const { manager, client } = await startSupervisor();
		const a = await dispatchRun(client, payload());
		await manager.idle();
		const b = await dispatchRun(client, payload());
		await manager.idle();
		expect(b.run.id).toBe(`${a.run.id}-2`);
	});

	it("maps outputDirectory: local to <repo>/agentic/runs with a deprecation warning", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(
			client,
			payload(THREE_STEPS, { config: { ...getDefaultConfig(), outputDirectory: "local" } }),
		);
		await manager.idle();
		expect(res.dir).toBe(path.join(repo, "agentic", "runs", res.run.id));
		expect(res.warnings[0]).toMatch(/deprecated/);
	});

	it("follows a run until it ends (af run --foreground)", async () => {
		const { client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		const seen: string[] = [];
		const status = await followRun(client, res.run.id, {
			intervalMs: 20,
			onEvent: (e) => seen.push(e.type),
		});
		expect(status).toBe("done");
		expect(seen[0]).toBe("run.queued");
		expect(seen.at(-1)).toBe("run.completed");
	});

	it("detaches without stopping the run when the follow is aborted", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", "hang");
		const res = await dispatchRun(client, payload());
		const controller = new AbortController();
		await fakeRuntime.waitFor("BUILD");
		const following = followRun(client, res.run.id, {
			intervalMs: 20,
			signal: controller.signal,
			onEvent: () => {},
		});
		controller.abort();
		expect(await following).toBe("detached");
		expect(manager.registry.get(res.run.id)?.status).toBe("running");
	});

	it("records the workflow worktree in run.json", async () => {
		const wtPath = mkdtempSync(path.join(tmpdir(), "af-wt-"));
		createWorktreeMock.mockReturnValue({ path: wtPath, branch: "af/demo", baseBranch: "main" });
		try {
			const { manager, client } = await startSupervisor();
			const res = await dispatchRun(
				client,
				payload(
					`${THREE_STEPS}\n`.replace(
						"  max-retry: 0",
						"  max-retry: 0\n  worktree:\n    enabled: true\n    cleanup: manual",
					),
				),
			);
			await manager.idle();
			const run = new RunStore(res.dir).readRun();
			expect(run.worktree).toBe(wtPath);
			expect(run.branch).toBe("af/demo");
			expect(manager.registry.get(res.run.id)?.worktree).toBe(true);
			expect(fakeRuntime.calls[0].cwd).toBe(wtPath);
		} finally {
			rmSync(wtPath, { recursive: true, force: true });
		}
	});
});

describe("status endpoints, cancel and resume", () => {
	it("lists runs and returns details", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const list = await client.request<{ runs: RegistryEntry[] }>("GET", "/v1/runs?status=done");
		expect(list.runs.map((r) => r.id)).toEqual([res.run.id]);
		const details = await client.request<{ steps: { name: string }[] }>(
			"GET",
			`/v1/runs/${res.run.id}`,
		);
		expect(details.steps.map((s) => s.name)).toEqual(["plan", "build", "review"]);
		await expect(client.request("GET", "/v1/runs/nope")).rejects.toMatchObject({ status: 404 });
	});

	it("cancels a running run at the next step boundary", async () => {
		const { manager, client } = await startSupervisor();
		let release!: () => void;
		fakeRuntime.on("PLAN", async (o) => {
			await new Promise<void>((r) => {
				release = r;
			});
			return {
				returncode: 0,
				stdout: "ok",
				stderr: "",
				prompt: o.prompt,
				cwd: null,
				model: null,
				success: true,
				sessionOutput: { sessionId: null, isSuccess: true, context: "done" },
			};
		});
		const res = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("PLAN");
		const cancel = await client.request<{ status: string }>(
			"POST",
			`/v1/runs/${res.run.id}/cancel`,
		);
		expect(cancel.status).toBe("canceling");
		release();
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("canceled");
		expect(eventTypes(store)).not.toContain("step.started:build");
		expect(eventTypes(store).at(-1)).toBe("run.canceled");
		await expect(client.request("POST", `/v1/runs/${res.run.id}/cancel`)).rejects.toMatchObject({
			status: 409,
		});
	});

	it("resumes a failed run from the failed step", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", "fail");
		const res = await dispatchRun(client, payload());
		await manager.idle();
		fakeRuntime.on("BUILD", "succeed");
		fakeRuntime.calls = [];
		await client.request("POST", `/v1/runs/${res.run.id}/resume`);
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("done");
		expect(fakeRuntime.calls.map((c) => c.prompt.split("\n")[0])).toEqual(["BUILD", "REVIEW"]);
		expect(eventTypes(store)).toContain("run.resumed");
		await expect(client.request("POST", `/v1/runs/${res.run.id}/resume`)).rejects.toMatchObject({
			status: 409,
		});
	});
});

describe("crash recovery", () => {
	it("marks the interrupted step, resumes from it, and emits run.recovered once", async () => {
		// First supervisor: dies while "build" is running (the step never settles).
		const first = await startSupervisor();
		fakeRuntime.on("BUILD", "hang");
		const res = await dispatchRun(first.client, payload());
		await fakeRuntime.waitFor("BUILD");
		first.manager.close();
		await first.supervisor.stop();

		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("running");
		const before = store.readEvents();

		// Second supervisor: recovers and finishes the run.
		fakeRuntime.on("BUILD", "succeed");
		fakeRuntime.calls = [];
		const second = await startSupervisor();
		await second.manager.idle();

		const run = store.readRun();
		expect(run.status).toBe("done");
		expect(run["x-af-recoveries"]).toBe(1);
		expect(fakeRuntime.calls.map((c) => c.prompt.split("\n")[0])).toEqual(["BUILD", "REVIEW"]);

		const progress = loadProgress(run.id, res.dir);
		expect(progress?.completedSteps.map((s) => `${s.name}:${s.status}`)).toEqual([
			"plan:completed",
			"build:interrupted",
			"build:completed",
			"review:completed",
		]);

		const events = store.readEvents();
		expect(events.slice(0, before.length)).toEqual(before);
		const types = eventTypes(store);
		expect(types.filter((t) => t === "run.recovered")).toHaveLength(1);
		expect(types.filter((t) => t === "step.completed:plan")).toHaveLength(1);
		expect(events.find((e) => e.type === "run.recovered")?.data).toMatchObject({
			recovery: 1,
			interrupted_steps: ["build"],
			resume_from: "build",
		});
		expect(validateContractFile(store.eventsFile).valid).toBe(true);
		expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
	});

	it("rebuilds a step event missing after a crash, and never emits one twice", async () => {
		const first = await startSupervisor();
		fakeRuntime.on("BUILD", "hang");
		const res = await dispatchRun(first.client, payload());
		await fakeRuntime.waitFor("BUILD");
		first.manager.close();
		await first.supervisor.stop();

		// Simulate a crash between the state write and the step.completed event of "plan".
		const store = new RunStore(res.dir);
		const lines = readFileSync(store.eventsFile, "utf-8").trimEnd().split("\n");
		const kept = lines.filter((l) => !l.includes('"step.completed"') && !l.includes('"build"'));
		writeFileSync(
			store.eventsFile,
			`${kept.map((l, i) => JSON.stringify({ ...JSON.parse(l), seq: i + 1 })).join("\n")}\n`,
		);

		const manager = new RunManager({ root: home.root });
		await manager.recover();
		await manager.recover();
		const types = eventTypes(store);
		expect(types.filter((t) => t === "step.completed:plan")).toHaveLength(1);
		expect(types.filter((t) => t === "step.started:build")).toHaveLength(1);
		expect(types.filter((t) => t === "run.recovered")).toHaveLength(1);
		expect(validateContractFile(store.eventsFile).valid).toBe(true);
	});

	it("reuses the worktree recorded in run.json on recovery", async () => {
		const wtPath = mkdtempSync(path.join(tmpdir(), "af-wt-"));
		createWorktreeMock.mockReturnValue({ path: wtPath, branch: "af/demo", baseBranch: "main" });
		try {
			const first = await startSupervisor();
			fakeRuntime.on("BUILD", "hang");
			const wf = THREE_STEPS.replace(
				"  max-retry: 0",
				"  max-retry: 0\n  worktree:\n    enabled: true\n    cleanup: manual",
			);
			const res = await dispatchRun(first.client, payload(wf));
			await fakeRuntime.waitFor("BUILD");
			first.manager.close();
			await first.supervisor.stop();

			fakeRuntime.on("BUILD", "succeed");
			fakeRuntime.calls = [];
			const second = await startSupervisor();
			await second.manager.idle();
			expect(createWorktreeMock).toHaveBeenCalledTimes(1);
			expect(fakeRuntime.calls.every((c) => c.cwd === wtPath)).toBe(true);
			expect(new RunStore(res.dir).readRun().status).toBe("done");
		} finally {
			rmSync(wtPath, { recursive: true, force: true });
		}
	});
});

describe("scheduler", () => {
	const entry = (id: string, repoPath: string, worktree = false, priority = 0): RegistryEntry => ({
		id,
		dir: id,
		repo: repoPath,
		workflow: "wf",
		status: "queued",
		worktree,
		priority,
		created_at: `2026-11-10T00:00:0${id.length % 10}Z`,
		updated_at: "",
	});
	const limits = (runs: number, tasks: number) => ({
		maxParallelRuns: runs,
		maxParallelTasks: () => tasks,
	});

	it("enforces the global limit", () => {
		const picked = pickRunnable(
			[entry("a", "/r1"), entry("bb", "/r2"), entry("ccc", "/r3")],
			[],
			limits(2, 5),
		);
		expect(picked.map((e) => e.id)).toEqual(["a", "bb"]);
	});

	it("enforces the per-repo limit", () => {
		const queued = [entry("a", "/r1", true), entry("bb", "/r1", true), entry("ccc", "/r1", true)];
		expect(pickRunnable(queued, [], limits(10, 2)).map((e) => e.id)).toEqual(["a", "bb"]);
	});

	it("never runs two runs on one checkout without worktrees", () => {
		const running = [{ ...entry("a", "/r1"), status: "running" as const }];
		expect(pickRunnable([entry("bb", "/r1")], running, limits(10, 10))).toEqual([]);
		expect(pickRunnable([entry("bb", "/r1", true)], running, limits(10, 10))).toHaveLength(1);
		expect(pickRunnable([entry("bb", "/r2")], running, limits(10, 10))).toHaveLength(1);
	});

	it("lets a child run use the slot and checkout of its running ancestors", () => {
		const running = [{ ...entry("a", "/r1"), status: "running" as const }];
		const child = entry("bb", "/r1");
		const ancestors = (e: RegistryEntry) => (e.id === "bb" ? ["a"] : []);
		expect(pickRunnable([child], running, limits(1, 1))).toEqual([]);
		expect(pickRunnable([child], running, { ...limits(1, 1), ancestors })).toEqual([child]);
		// Another run on the checkout still waits
		expect(pickRunnable([entry("ccc", "/r1")], running, { ...limits(10, 10), ancestors })).toEqual(
			[],
		);
	});

	it("starts higher priority runs first", () => {
		const picked = pickRunnable(
			[entry("a", "/r1"), entry("bb", "/r2", false, 5)],
			[],
			limits(1, 1),
		);
		expect(picked.map((e) => e.id)).toEqual(["bb"]);
	});

	it("makes a second run on the same checkout wait until the first ends", async () => {
		const { manager, client } = await startSupervisor();
		let release!: () => void;
		fakeRuntime.on("PLAN first", async (o) => {
			await new Promise<void>((r) => {
				release = r;
			});
			return {
				returncode: 0,
				stdout: "ok",
				stderr: "",
				prompt: o.prompt,
				cwd: null,
				model: null,
				success: true,
				sessionOutput: { sessionId: null, isSuccess: true, context: "done" },
			};
		});
		const a = await dispatchRun(
			client,
			payload(THREE_STEPS, { variables: { task: "first" }, slug: "a" }),
		);
		await fakeRuntime.waitFor("PLAN first");
		const b = await dispatchRun(
			client,
			payload(THREE_STEPS, { variables: { task: "second" }, slug: "b" }),
		);
		await new Promise((r) => setTimeout(r, 50));
		expect(manager.registry.get(b.run.id)?.status).toBe("queued");
		expect(fakeRuntime.calls.some((c) => c.prompt.includes("PLAN second"))).toBe(false);
		release();
		await manager.idle();
		expect(manager.registry.get(a.run.id)?.status).toBe("done");
		expect(manager.registry.get(b.run.id)?.status).toBe("done");
	});

	it("reads max_parallel_runs from the global config", async () => {
		writeFileSync(
			path.join(home.root, "config.json"),
			JSON.stringify({ supervisor: { max_parallel_runs: 1 } }),
		);
		const otherRepo = mkdtempSync(path.join(tmpdir(), "af-other-"));
		try {
			const { manager, client } = await startSupervisor();
			fakeRuntime.on("PLAN first", "hang");
			await dispatchRun(client, payload(THREE_STEPS, { variables: { task: "first" }, slug: "a" }));
			await fakeRuntime.waitFor("PLAN first");
			const b = await dispatchRun(
				client,
				payload(THREE_STEPS, { repo_root: otherRepo, variables: { task: "second" }, slug: "b" }),
			);
			await new Promise((r) => setTimeout(r, 50));
			expect(manager.registry.get(b.run.id)?.status).toBe("queued");
		} finally {
			rmSync(otherRepo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});
});

describe("helpers", () => {
	it("filters the client environment to the allowlist plus passthrough", () => {
		const env = filterEnv(
			{ PATH: "/bin", CLAUDE_X: "1", GH_TOKEN: "t", SECRET: "s", MY_VAR: "m" },
			["MY_VAR"],
		);
		expect(env).toEqual({ PATH: "/bin", CLAUDE_X: "1", GH_TOKEN: "t", MY_VAR: "m" });
	});

	it("maps engine statuses to contract run statuses", () => {
		const base = { currentStep: null } as unknown as Parameters<typeof toRunStatus>[0];
		expect(toRunStatus({ ...base, status: "completed" })).toBe("done");
		expect(toRunStatus({ ...base, status: "failed" })).toBe("failed");
		expect(toRunStatus({ ...base, status: "canceled" })).toBe("canceled");
		expect(toRunStatus({ ...base, status: "paused" })).toBe("paused");
		expect(
			toRunStatus({
				...base,
				status: "paused",
				currentStep: { name: "x", retryCount: 0, startedAt: "", type: "wait-for-human" },
			}),
		).toBe("awaiting-human");
		expect(toRunStatus({ ...base, status: "awaiting-human" })).toBe("awaiting-human");
		expect(toRunStatus({ ...base, status: "halted" })).toBe("halted");
		expect(toRunStatus({ ...base, status: "blocked" })).toBe("blocked");
		const merged = {
			...base,
			status: "completed",
			completedSteps: [{ name: "merge", status: "completed", resultStatus: "merged" }],
		} as unknown as Parameters<typeof toRunStatus>[0];
		expect(toRunStatus(merged)).toBe("merged");
	});

	it("keeps progress.json as engine state next to run.json", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await manager.idle();
		expect(existsSync(path.join(res.dir, "progress.json"))).toBe(true);
		const progress = loadProgress(res.run.id, res.dir);
		expect(progress?.workflowId).toBe(res.run.id);
		if (progress) saveProgress(progress, res.dir);
	});
});
