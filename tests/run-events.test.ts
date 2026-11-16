/**
 * Tests for the event stream (ORC-009): the full event taxonomy emitted by
 * runs (iterations, retries, re-queues, supervisor restarts), cursors across
 * runs, type filters, the `GET /v1/events` long-poll, `af events`,
 * `af list` filters and `af artifacts`. In-process supervisor, fake runtime.
 */

import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdArtifacts, cmdEvents } from "../src/commands/events.js";
import { CliExitError } from "../src/commands/run.js";
import { cmdList } from "../src/commands/status.js";
import { getVersion } from "../src/commands/version.js";
import { getDefaultConfig } from "../src/config.js";
import { validateArtifact, validateContractFile } from "../src/contract/index.js";
import { listArtifacts } from "../src/runs/artifacts.js";
import { dispatchRun, fetchEvents, followEvents, formatEvent } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import {
	CursorError,
	decodeCursor,
	encodeCursor,
	matchesTypes,
	parseTypeFilter,
	readEventPage,
} from "../src/runs/events.js";
import { RunManager } from "../src/runs/manager.js";
import { type RegistryEntry, filterRuns, parseSince } from "../src/runs/registry.js";
import { type RunEvent, RunStore, parseEvents } from "../src/runs/run-store.js";
import type { RuntimeResult, RuntimeRunOptions } from "../src/runtimes/types.js";
import { Supervisor, SupervisorClient, SupervisorHttpError } from "../src/supervisor/index.js";
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

function payload(contents = TWO_STEPS, slug = "ev"): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		config: getDefaultConfig(),
		env: { PATH: process.env.PATH ?? "" },
		variables: {},
		runtime: null,
		from_step: null,
		slug,
		terminal_output: "base",
	};
}

async function startSupervisor(version = "1.0.0") {
	const supervisor = new Supervisor({ root: home.root, version });
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

/** Holds prompts containing `match` until the returned function is called. */
function hold(match: string): () => void {
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

function eventKeys(events: RunEvent[]): string[] {
	return events.map((e) => `${e.run}#${e.seq}`);
}

function captureStdout(): { text: () => string; restore: () => void } {
	let out = "";
	const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
		out += String(chunk);
		return true;
	});
	return { text: () => out, restore: () => spy.mockRestore() };
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-ev-repo-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("cursors and filters", () => {
	it("round-trips cursors and rejects invalid ones", () => {
		const cursor = encodeCursor({ "2026-11-09-a": 3, "2026-11-09-b": 0 });
		expect(cursor.startsWith("c1.")).toBe(true);
		expect(decodeCursor(cursor)).toEqual({ "2026-11-09-a": 3, "2026-11-09-b": 0 });
		expect(decodeCursor(null)).toEqual({});
		expect(decodeCursor("")).toEqual({});
		expect(() => decodeCursor("nope")).toThrow(CursorError);
		expect(() => decodeCursor("c1.!!!")).toThrow(CursorError);
		expect(() => decodeCursor(encodeCursor({ a: -1 }))).toThrow(CursorError);
	});

	it("matches exact types and trailing-star prefixes", () => {
		const types = parseTypeFilter("needs_input, run.* ,");
		expect(types).toEqual(["needs_input", "run.*"]);
		expect(matchesTypes("run.completed", types)).toBe(true);
		expect(matchesTypes("needs_input", types)).toBe(true);
		expect(matchesTypes("step.failed", types)).toBe(false);
		expect(matchesTypes("anything", [])).toBe(true);
	});

	it("parses since as an ISO date or a duration", () => {
		const now = Date.parse("2026-11-09T12:00:00Z");
		expect(parseSince("2h", now)).toBe(now - 2 * 3_600_000);
		expect(parseSince("7d", now)).toBe(now - 7 * 86_400_000);
		expect(parseSince("2026-11-01", now)).toBe(Date.parse("2026-11-01"));
		expect(parseSince(undefined, now)).toBeNull();
		expect(() => parseSince("yesterday", now)).toThrow(/Invalid since/);
	});

	it("filters runs by status list, repo, since and parent", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "af-ev-list-"));
		try {
			const entry = (id: string, status: string, created: string, parent: string | null) => {
				const runDir = path.join(dir, id);
				mkdirSync(runDir);
				writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ id, parent }));
				return {
					id,
					dir: runDir,
					repo: "/r1",
					workflow: "wf",
					status,
					worktree: false,
					priority: 0,
					created_at: created,
					updated_at: created,
				} as RegistryEntry;
			};
			const runs = [
				entry("a", "running", "2026-11-01T00:00:00Z", null),
				entry("b", "paused", "2026-11-08T00:00:00Z", "a"),
				entry("c", "done", "2026-11-09T00:00:00Z", "a"),
			];
			const ids = (f: Parameters<typeof filterRuns>[1]) => filterRuns(runs, f).map((r) => r.id);
			expect(ids({ status: "running,paused" })).toEqual(["a", "b"]);
			expect(ids({ since: Date.parse("2026-11-05T00:00:00Z") })).toEqual(["b", "c"]);
			expect(ids({ parent: "a" })).toEqual(["b", "c"]);
			expect(ids({ repo: "/r2" })).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("events.jsonl", () => {
	it("keeps seq monotonic after a torn last line", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "af-ev-torn-"));
		try {
			const store = new RunStore(path.join(dir, "2026-11-09-torn"));
			mkdirSync(store.dir);
			await store.appendEvent("run.queued", {});
			await store.appendEvent("run.started", {});
			appendFileSync(store.eventsFile, '{"seq":3,"at":"2026', "utf-8");
			expect(store.readEvents().map((e) => e.seq)).toEqual([1, 2]);
			const next = await store.appendEvent("step.started", { step: "plan" });
			expect(next.seq).toBe(3);
			expect(store.readEvents().map((e) => e.seq)).toEqual([1, 2, 3]);
			expect(parseEvents(readFileSync(store.eventsFile, "utf-8"))).toHaveLength(3);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("event taxonomy", () => {
	it("emits iteration.started and iteration.completed for every ralph-loop iteration", async () => {
		const { client, manager } = await startSupervisor();
		fakeRuntime.on("LOOP 2", (o) => ok(o, '{"ralph_complete": true, "promise": "DONE"}'));
		const res = await dispatchRun(client, payload(LOOP));
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("done");
		const iterations = store
			.readEvents()
			.filter((e) => e.type.startsWith("iteration."))
			.map((e) => `${e.type}:${e.data?.iteration}:${e.data?.outcome ?? ""}`);
		expect(iterations).toEqual([
			"iteration.started:1:",
			"iteration.completed:1:continue",
			"iteration.started:2:",
			"iteration.completed:2:complete",
		]);
		expect(store.readEvents().find((e) => e.type === "iteration.started")?.data).toMatchObject({
			step: "iterate",
			max_iterations: 3,
		});
		expect(validateContractFile(store.eventsFile).errors).toEqual([]);
	});

	it("emits step.retried with reason retry when a prompt step is retried", async () => {
		const { client, manager } = await startSupervisor();
		let calls = 0;
		fakeRuntime.on("BUILD", (o) => {
			calls += 1;
			return calls === 1 ? { ...ok(o, ""), returncode: 1, success: false, stderr: "boom" } : ok(o);
		});
		const res = await dispatchRun(
			client,
			payload(TWO_STEPS.replace('prompt: "BUILD"', 'prompt: "BUILD"\n    max-retry: 1')),
		);
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("done");
		const retried = store.readEvents().filter((e) => e.type === "step.retried");
		expect(retried.map((e) => e.data)).toEqual([
			{ step: "build", reason: "retry", attempt: 2, max_attempts: 2, error: "boom" },
		]);
	});

	it("emits run.queued when a paused run is resumed, then run.resumed", async () => {
		const { client, manager } = await startSupervisor();
		const release = hold("PLAN");
		const res = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("PLAN");
		await manager.pause(res.run.id, { now: false });
		release();
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("paused");
		await manager.resume(res.run.id);
		await manager.idle();
		const types = store.readEvents().map((e) => e.type);
		const paused = types.indexOf("run.paused");
		expect(types.slice(paused, paused + 3)).toEqual(["run.paused", "run.queued", "run.resumed"]);
		expect(store.readEvents().filter((e) => e.type === "run.queued")[1].data).toMatchObject({
			reason: "resumed",
			from: "paused",
		});
		expect(types.at(-1)).toBe("run.completed");
	});

	it("emits supervisor.restarted once for each run a new supervisor takes over", async () => {
		const first = await startSupervisor();
		fakeRuntime.on("BUILD", "hang");
		const res = await dispatchRun(first.client, payload());
		await fakeRuntime.waitFor("BUILD");
		first.manager.close();
		await first.supervisor.stop();

		fakeRuntime.on("BUILD", "succeed");
		const second = await startSupervisor("1.0.1");
		await second.manager.recover(); // a second scan in the same process adds nothing
		await second.manager.idle();
		const store = new RunStore(res.dir);
		const types = store.readEvents().map((e) => e.type);
		expect(types.filter((t) => t === "supervisor.restarted")).toHaveLength(1);
		expect(types.indexOf("supervisor.restarted")).toBeLessThan(types.indexOf("run.recovered"));
		expect(store.readEvents().find((e) => e.type === "supervisor.restarted")?.data).toMatchObject({
			pid: process.pid,
			version: "1.0.1",
		});
		expect(validateContractFile(store.eventsFile).errors).toEqual([]);
	});

	it("writes only envelopes that validate against the v1 schema", async () => {
		const { client, manager } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const store = new RunStore(res.dir);
		await manager.send(res.run.id, { text: "late" }).catch(() => {});
		for (const event of store.readEvents()) {
			expect(validateArtifact("event", event).errors).toEqual([]);
		}
		const seqs = store.readEvents().map((e) => e.seq);
		expect(seqs).toEqual(seqs.map((_, i) => i + 1));
	});
});

describe("GET /v1/events", () => {
	it("pages across runs with a cursor, without gaps or duplicates", async () => {
		const { client, manager } = await startSupervisor();
		await dispatchRun(client, payload(TWO_STEPS, "one"));
		await dispatchRun(client, payload(TWO_STEPS, "two"));
		await manager.idle();
		const all = await fetchEvents(client, {});
		expect(all.more).toBe(false);
		expect(new Set(all.events.map((e) => e.run)).size).toBe(2);

		const seen: RunEvent[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 100; i++) {
			const page = await fetchEvents(client, { cursor, limit: 3 });
			seen.push(...page.events);
			cursor = page.cursor;
			if (!page.more) break;
		}
		expect(eventKeys(seen).sort()).toEqual(eventKeys(all.events).sort());
		expect(new Set(eventKeys(seen)).size).toBe(seen.length);
		const after = await fetchEvents(client, { cursor });
		expect(after.events).toEqual([]);
	});

	it("filters by type and run, and the cursor skips filtered-out events", async () => {
		const { client, manager } = await startSupervisor();
		const one = await dispatchRun(client, payload(TWO_STEPS, "one"));
		await dispatchRun(client, payload(TWO_STEPS, "two"));
		await manager.idle();
		const page = await fetchEvents(client, { run: one.run.id, types: ["run.*"] });
		expect(page.status).toBe("done");
		expect(page.events.every((e) => e.run === one.run.id && e.type.startsWith("run."))).toBe(true);
		expect(page.events.map((e) => e.type)).toEqual(["run.queued", "run.started", "run.completed"]);
		const positions = decodeCursor(page.cursor);
		expect(positions[one.run.id]).toBe(new RunStore(one.dir).readEvents().length);
	});

	it("long-polls until a new event arrives, starting from now", async () => {
		const { client, manager } = await startSupervisor();
		await dispatchRun(client, payload(TWO_STEPS, "old"));
		await manager.idle();
		const started = Date.now();
		const pending = fetchEvents(client, { fromNow: true, waitSeconds: 10, types: ["run.queued"] });
		await new Promise((r) => setTimeout(r, 400));
		const res = await dispatchRun(client, payload(TWO_STEPS, "new"));
		const page = await pending;
		expect(Date.now() - started).toBeLessThan(9_000);
		expect(page.events.map((e) => `${e.run}:${e.type}`)).toEqual([`${res.run.id}:run.queued`]);
		await manager.idle();
	});

	it("returns an empty page after the wait when nothing happens", async () => {
		const { client } = await startSupervisor();
		const page = await fetchEvents(client, { waitSeconds: 0.3 });
		expect(page.events).toEqual([]);
		expect(decodeCursor(page.cursor)).toEqual({});
	});

	it("rejects an invalid cursor (400) and an unknown run (404)", async () => {
		const { client } = await startSupervisor();
		await expect(fetchEvents(client, { cursor: "bad" })).rejects.toMatchObject({ status: 400 });
		await expect(fetchEvents(client, { run: "2026-01-01-nope" })).rejects.toBeInstanceOf(
			SupervisorHttpError,
		);
		await expect(fetchEvents(client, { run: "2026-01-01-nope" })).rejects.toMatchObject({
			status: 404,
		});
	});

	it("follows needs_input,run.* across a disconnect and resumes from the cursor", async () => {
		const { client, manager } = await startSupervisor();
		const types = ["needs_input", "run.*"];
		const releasePlan = hold("PLAN");
		const res = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("PLAN");

		// First follower: reads what exists, then detaches
		const first: RunEvent[] = [];
		const controller = new AbortController();
		let cursor: string | null = null;
		const following = followEvents(client, {
			types,
			waitSeconds: 0.3,
			onEvent: (e) => first.push(e),
			onCursor: (c) => {
				cursor = c;
			},
			signal: controller.signal,
		});
		await new Promise((r) => setTimeout(r, 500));
		controller.abort();
		await following;

		// Events happen while nobody follows
		fakeRuntime.on("BUILD", (o) =>
			ok(
				o,
				`${JSON.stringify({
					status: "awaiting-human",
					summary: "Need a choice",
					needs_input: {
						id: "q1",
						question: "Which one?",
						options: [
							{ id: "a", label: "A" },
							{ id: "b", label: "B" },
						],
						recommended: "a",
						blocking: true,
					},
				})}`,
			),
		);
		releasePlan();
		await manager.idle();

		// Second follower resumes from the stored cursor until the run stops
		const second: RunEvent[] = [];
		await followEvents(client, {
			cursor,
			run: res.run.id,
			types,
			waitSeconds: 0.3,
			untilStopped: true,
			onEvent: (e) => second.push(e),
		});

		const expected = new RunStore(res.dir).readEvents().filter((e) => matchesTypes(e.type, types));
		const got = [...first, ...second];
		expect(eventKeys(got)).toEqual(eventKeys(expected));
		expect(second.map((e) => e.type)).toEqual(["needs_input", "run.paused"]);
		expect(formatEvent(second[0])).toContain("needs_input build: q1 Which one?");
	});
});

describe("GET /v1/runs filters", () => {
	it("filters by status list and since, and rejects a bad since", async () => {
		const { client, manager } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const list = (q: string) =>
			client.request<{ runs: RegistryEntry[] }>("GET", `/v1/runs?${q}`).then((r) => r.runs);
		expect((await list("status=running,done")).map((r) => r.id)).toEqual([res.run.id]);
		expect(await list("status=paused")).toEqual([]);
		expect((await list("since=1h")).map((r) => r.id)).toEqual([res.run.id]);
		expect(await list("since=2999-01-01")).toEqual([]);
		expect(await list("parent=someone")).toEqual([]);
		await expect(list("since=whenever")).rejects.toMatchObject({ status: 400 });
	});
});

describe("CLI", () => {
	it("af events prints events, keeps a cursor file and resumes from it", async () => {
		const { client, manager } = await startSupervisor(getVersion());
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const cursorFile = path.join(home.root, "monitor", "cursor.txt");

		let out = captureStdout();
		try {
			await cmdEvents({ run: res.run.id, types: "run.*", cursorFile, json: true });
		} finally {
			out.restore();
		}
		const lines = out
			.text()
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l) as RunEvent);
		expect(lines.map((e) => e.type)).toEqual(["run.queued", "run.started", "run.completed"]);
		expect(readFileSync(cursorFile, "utf-8").trim()).toMatch(/^c1\./);

		await manager.resume(res.run.id).catch(() => {});
		out = captureStdout();
		try {
			await cmdEvents({ run: res.run.id, types: "run.*", cursorFile });
		} finally {
			out.restore();
		}
		expect(out.text()).toBe("");

		await expect(cmdEvents({ cursor: "garbage" })).rejects.toBeInstanceOf(CliExitError);
		await expect(cmdEvents({ run: "2026-01-01-nope" })).rejects.toBeInstanceOf(CliExitError);
	});

	it("af list filters and prints JSON", async () => {
		const { client, manager } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await manager.idle();
		let out = captureStdout();
		try {
			cmdList({ status: "done", since: "1d", json: true });
		} finally {
			out.restore();
		}
		expect((JSON.parse(out.text()) as RegistryEntry[]).map((r) => r.id)).toEqual([res.run.id]);
		out = captureStdout();
		try {
			cmdList({ parent: "nobody" });
		} finally {
			out.restore();
		}
		expect(out.text()).toContain("No runs found. (parent=nobody)");
		expect(() => cmdList({ since: "soon" })).toThrow(CliExitError);
	});

	it("af artifacts lists plans, reviews, summary and decisions", async () => {
		const { client, manager } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await manager.idle();
		writeFileSync(path.join(res.dir, "plan.md"), "# Plan v1\n");
		writeFileSync(path.join(res.dir, "plan.v2.md"), "# Plan v2\n");
		writeFileSync(path.join(res.dir, "review-2.md"), "r2\n");
		writeFileSync(path.join(res.dir, "review-1.md"), "r1\n");
		expect(listArtifacts(res.dir, "plan")).toEqual({
			kind: "plan",
			paths: [path.join(res.dir, "plan.md"), path.join(res.dir, "plan.v2.md")],
			latest: path.join(res.dir, "plan.v2.md"),
		});
		expect(listArtifacts(res.dir, "review").latest).toBe(path.join(res.dir, "review-2.md"));
		expect(listArtifacts(res.dir, "summary")).toEqual({ kind: "summary", paths: [], latest: null });

		let out = captureStdout();
		try {
			cmdArtifacts({ runId: res.run.id, kind: "plan", content: true });
		} finally {
			out.restore();
		}
		expect(out.text()).toBe("# Plan v2\n");
		out = captureStdout();
		try {
			cmdArtifacts({ runId: res.run.id });
		} finally {
			out.restore();
		}
		expect(out.text()).toContain("summary: (none)");
		expect(out.text()).toContain("(latest)");
		expect(() => cmdArtifacts({ runId: res.run.id, kind: "logs" })).toThrow(CliExitError);
		expect(() => cmdArtifacts({ runId: "2026-01-01-nope" })).toThrow(CliExitError);
	});
});

describe("readEventPage", () => {
	it("from now pins every stream at its end", async () => {
		const { client, manager } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const page = readEventPage(manager.registry.list(), { fromNow: true });
		expect(page.events).toEqual([]);
		expect(decodeCursor(page.cursor)[res.run.id]).toBe(new RunStore(res.dir).readEvents().length);
	});
});
