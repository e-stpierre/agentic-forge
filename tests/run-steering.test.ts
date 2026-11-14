/**
 * Integration tests for run steering (ORC-008): result blocks and exit codes,
 * needs_input and af answer, amendments with and without an amend step,
 * retry-step, send --mode now and reprioritize. In-process supervisor, fake
 * runtime.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { validateContractFile } from "../src/contract/index.js";
import { latestPlan } from "../src/contract/plan.js";
import { exitCodeForRun, parseResultBlock, resultStatusFromExit } from "../src/contract/result.js";
import { WorkflowParseError, WorkflowParser } from "../src/parser.js";
import { dispatchRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager, pendingInput, pendingInputs } from "../src/runs/manager.js";
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
    prompt: "REVIEW {{ plan_path }} v{{ plan_version }}"
`;

const WITH_AMEND_STEP = THREE_STEPS.replace(
	"  max-retry: 0",
	"  max-retry: 0\n  amend:\n    step: plan",
);

function payload(contents = THREE_STEPS, config = getDefaultConfig()): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		config,
		env: { PATH: process.env.PATH ?? "" },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "steer",
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

function reply(options: RuntimeRunOptions, stdout: string, returncode = 0): RuntimeResult {
	return {
		returncode,
		stdout,
		stderr: returncode === 0 ? "" : "exit",
		prompt: options.prompt,
		cwd: null,
		model: null,
		success: returncode === 0,
		sessionOutput: SessionOutput.fromStdout(stdout),
	};
}

function block(value: Record<string, unknown>): string {
	return `Work log...\n${JSON.stringify(value)}`;
}

const QUESTION = {
	id: "q1",
	question: "Which token store?",
	options: [
		{ id: "a", label: "Redis cache" },
		{ id: "b", label: "Database table" },
	],
	recommended: "a",
	context: "Both exist.",
	blocking: true,
};

/** Holds prompts containing `match` until `release()` is called. */
function hold(match: string) {
	let release!: () => void;
	const released = new Promise<void>((r) => {
		release = r;
	});
	fakeRuntime.on(match, async (o) => {
		await released;
		return reply(o, "ok");
	});
	return () => release();
}

function prompts(match: string): string[] {
	return fakeRuntime.calls.filter((c) => c.prompt.includes(match)).map((c) => c.prompt);
}

function types(store: RunStore): string[] {
	return store.readEvents().map((e) => e.type);
}

async function waitForStatus(manager: RunManager, id: string, status: string): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if (manager.registry.get(id)?.status === status) {
			await manager.idle();
			return;
		}
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Run ${id} never reached ${status} (${manager.registry.get(id)?.status})`);
}

function expectValidRunDir(dir: string): void {
	for (const file of ["run.json", "events.jsonl", "decisions.jsonl", "amendments.jsonl"]) {
		const full = path.join(dir, file);
		if (!existsSync(full)) continue;
		expect(validateContractFile(full).errors).toEqual([]);
	}
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-steer-repo-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("result block", () => {
	it("parses the last line, tolerates a fenced block, and rejects invalid blocks", () => {
		const done = { status: "done", summary: "Built it." };
		expect(parseResultBlock(`text\n${JSON.stringify(done)}\n`)).toEqual(done);
		expect(parseResultBlock(`text\n\`\`\`json\n${JSON.stringify(done, null, 2)}\n\`\`\``)).toEqual(
			done,
		);
		expect(parseResultBlock('{"status": "done"}')).toBeNull();
		expect(parseResultBlock('{"status": "done", "summary": "x", "needs_input": {}}')).toBeNull();
		expect(parseResultBlock("no block")).toBeNull();
		expect(parseResultBlock("")).toBeNull();
	});

	it("maps exit codes to result statuses and run statuses to exit codes", () => {
		expect([0, 10, 20, 30, 1, 2].map(resultStatusFromExit)).toEqual([
			"done",
			"awaiting-human",
			"halted",
			"escalate",
			"failed",
			"failed",
		]);
		expect(
			["done", "merged", "awaiting-human", "halted", "blocked", "failed", "paused"].map(
				exitCodeForRun,
			),
		).toEqual([0, 0, 10, 20, 30, 1, 1]);
	});

	it("reads the session id from the stream, the summary from the block", () => {
		const out = SessionOutput.fromStdout(block({ status: "merged", summary: "Merged #4." }), "s-1");
		expect(out).toMatchObject({ sessionId: "s-1", isSuccess: true, context: "Merged #4." });
		expect(out.result?.status).toBe("merged");
		const legacy = SessionOutput.fromStdout(
			'{"sessionId": "x", "isSuccess": true, "context": "c"}',
		);
		expect(legacy).toMatchObject({ sessionId: "x", isSuccess: true, context: "c", result: null });
	});

	it("writes steps/<NN-step>/result.json and maps result statuses to run statuses", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", (o) =>
			reply(o, block({ status: "done", summary: "Built.", max_risk: "medium" })),
		);
		fakeRuntime.on("REVIEW", (o) =>
			reply(o, block({ status: "merged", summary: "Merged.", pr: "https://x/pr/1" })),
		);
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const store = new RunStore(res.dir);
		const run = store.readRun();
		expect(run).toMatchObject({ status: "merged", max_risk: "medium", pr: "https://x/pr/1" });
		const result = JSON.parse(
			readFileSync(path.join(res.dir, "steps", "02-build", "result.json"), "utf-8"),
		);
		expect(result.summary).toBe("Built.");
		expect(validateContractFile(path.join(res.dir, "steps", "02-build", "result.json")).valid).toBe(
			true,
		);
		const reviewDone = store
			.readEvents()
			.find((e) => e.type === "step.completed" && e.data?.step === "review");
		expect(reviewDone?.data?.result_status).toBe("merged");
		expectValidRunDir(res.dir);
	});

	it.each([
		["halted", 20, "halted", "run.halted"],
		["escalate", 30, "blocked", "run.paused"],
	])("exit status %s (code %i) ends the run %s", async (status, code, runStatus, event) => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", (o) => reply(o, "no block", code));
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe(runStatus);
		expect(types(store)).toContain(event);
		expect(prompts("REVIEW")).toHaveLength(0);
		// Same outcome from a result block
		fakeRuntime.reset();
		fakeRuntime.on("BUILD", (o) => reply(o, block({ status, summary: "stop" })));
		const second = await dispatchRun(client, payload());
		await manager.idle();
		expect(new RunStore(second.dir).readRun().status).toBe(runStatus);
	});

	it("a reported failed status fails the step even with exit code 0", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", (o) =>
			reply(o, block({ status: "failed", summary: "Tests fail.", blockers: ["flaky db"] })),
		);
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("failed");
		const failed = store.readEvents().find((e) => e.type === "step.failed");
		expect(String(failed?.data?.error)).toContain("flaky db");
	});
});

describe("needs_input and af answer", () => {
	it("puts the run in awaiting-human, emits needs_input, and resumes with the answer", async () => {
		const { manager, client } = await startSupervisor();
		let asks = 0;
		fakeRuntime.on("BUILD", (o) => {
			asks++;
			if (asks === 1) {
				return reply(
					o,
					block({ status: "awaiting-human", summary: "Need a choice.", needs_input: QUESTION }),
					10,
				);
			}
			return reply(o, block({ status: "done", summary: "Built with Redis." }));
		});
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("awaiting-human");
		const event = store.readEvents().find((e) => e.type === "needs_input");
		expect(event?.data).toMatchObject({ id: "q1", step: "build", blocking: true, deadline: null });
		expect(pendingInput(store.readRun())?.request.id).toBe("q1");
		expect(prompts("REVIEW")).toHaveLength(0);

		const route = `/v1/runs/${res.run.id}/answer`;
		await expect(
			client.request("POST", route, { request_id: "q9", answer: "a" }),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			client.request("POST", route, { request_id: "q1", answer: " " }),
		).rejects.toMatchObject({ status: 400 });
		const answered = await client.request<{ status: string; message: string }>("POST", route, {
			request_id: "q1",
			answer: "a",
		});
		expect(answered.status).toBe("queued");
		await manager.idle();

		expect(store.readRun().status).toBe("done");
		expect(pendingInput(store.readRun())).toBeNull();
		const rerun = prompts("BUILD")[1];
		expect(rerun.startsWith("## Operator Messages")).toBe(true);
		expect(rerun).toContain('Answer to q1 ("Which token store?"): a (Redis cache)');
		const answeredEvent = store.readEvents().find((e) => e.type === "input.answered");
		expect(answeredEvent?.data).toMatchObject({
			id: "q1",
			step: "build",
			option: "a",
			from: "user",
		});
		const decision = store.readDecisions().find((d) => d.id === "d-q1");
		expect(decision).toMatchObject({ source: "operator", phase: "build" });
		expect(decision?.refs).toContain("q1");
		const order = types(store);
		expect(order.indexOf("needs_input")).toBeLessThan(order.indexOf("run.paused"));
		expect(order.indexOf("input.answered")).toBeLessThan(order.indexOf("run.resumed"));
		// A done run has nothing to answer
		await expect(client.request("POST", route, { answer: "a" })).rejects.toMatchObject({
			status: 409,
		});
		expectValidRunDir(res.dir);
	});

	it("keeps the other requests pending and waits until every one is answered", async () => {
		const { manager, client } = await startSupervisor();
		let asks = 0;
		fakeRuntime.on("BUILD", (o) => {
			asks++;
			return asks === 1
				? reply(
						o,
						block({ status: "awaiting-human", summary: "Need a choice.", needs_input: QUESTION }),
					)
				: reply(o, block({ status: "done", summary: "Built." }));
		});
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const store = new RunStore(res.dir);
		// A second request, as recovered from parallel live sessions after a restart
		const first = pendingInput(store.readRun());
		const second = { ...first, request: { ...QUESTION, id: "q2", question: "Which cache?" } };
		await store.updateRun({ "x-af-needs-input": [first, second] });

		const route = `/v1/runs/${res.run.id}/answer`;
		const one = await client.request<{ status: string }>("POST", route, {
			request_id: "q1",
			answer: "a",
		});
		expect(one.status).toBe("awaiting-human");
		await manager.idle();
		expect(store.readRun().status).toBe("awaiting-human");
		expect(pendingInputs(store.readRun()).map((p) => p.request.id)).toEqual(["q2"]);
		expect(prompts("BUILD")).toHaveLength(1);

		const two = await client.request<{ status: string }>("POST", route, {
			request_id: "q2",
			answer: "b",
		});
		expect(two.status).toBe("queued");
		await manager.idle();
		expect(store.readRun().status).toBe("done");
		const rerun = prompts("BUILD")[1];
		expect(rerun).toContain("Answer to q1");
		expect(rerun).toContain("Answer to q2");
	});

	it("applies the recommended option of a non-blocking request after the timeout", async () => {
		const { manager, client } = await startSupervisor();
		let asks = 0;
		fakeRuntime.on("BUILD", (o) => {
			asks++;
			if (asks === 1) {
				return reply(
					o,
					block({
						status: "awaiting-human",
						summary: "Choice.",
						needs_input: { ...QUESTION, blocking: false, risk: "low" },
					}),
				);
			}
			return reply(o, "ok");
		});
		const config = getDefaultConfig();
		(config.supervisor as Record<string, unknown>).needs_input_timeout = 0.001; // 60 ms
		const res = await dispatchRun(client, payload(THREE_STEPS, config));
		await waitForStatus(manager, res.run.id, "done");
		const store = new RunStore(res.dir);
		const needs = store.readEvents().find((e) => e.type === "needs_input");
		expect(needs?.data?.deadline).toBeTruthy();
		const answered = store.readEvents().find((e) => e.type === "input.answered");
		expect(answered?.data).toMatchObject({ id: "q1", option: "a", from: "policy" });
		expect(store.readDecisions().find((d) => d.id === "d-q1")?.source).toBe("policy");
		expect(prompts("BUILD")[1]).toContain("Answer to q1");
		expectValidRunDir(res.dir);
	});

	it("never auto-applies without a configured timeout or for blocking requests", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", (o) =>
			reply(
				o,
				block({
					status: "awaiting-human",
					summary: "Choice.",
					needs_input: { ...QUESTION, blocking: false },
				}),
			),
		);
		const res = await dispatchRun(client, payload());
		await manager.idle();
		await new Promise((r) => setTimeout(r, 50));
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("awaiting-human");
		expect(pendingInput(store.readRun())?.deadline).toBeNull();
	});

	it("skips the timeout for requests whose risk is not low", async () => {
		const { manager, client } = await startSupervisor();
		const config = getDefaultConfig();
		(config.supervisor as Record<string, unknown>).needs_input_timeout = 0.001;
		for (const extra of [{}, { risk: "medium" }, { max_risk: "low", risk: "high" }]) {
			const { max_risk, ...risk } = extra as { max_risk?: string; risk?: string };
			fakeRuntime.reset();
			fakeRuntime.on("BUILD", (o) =>
				reply(
					o,
					block({
						status: "awaiting-human",
						summary: "Choice.",
						...(max_risk ? { max_risk } : {}),
						needs_input: { ...QUESTION, blocking: false, ...risk },
					}),
				),
			);
			const res = await dispatchRun(client, payload(THREE_STEPS, config));
			await manager.idle();
			await new Promise((r) => setTimeout(r, 100));
			const store = new RunStore(res.dir);
			expect(store.readRun().status).toBe("awaiting-human");
			expect(pendingInput(store.readRun())?.deadline).toBeNull();
			expect(store.readEvents().find((e) => e.type === "needs_input")?.data).toMatchObject({
				kind: "decision",
				risk: risk.risk ?? null,
			});
		}
	});

	it("never applies the timeout to a permission request, even at risk low", async () => {
		const { manager, client } = await startSupervisor();
		const config = getDefaultConfig();
		(config.supervisor as Record<string, unknown>).needs_input_timeout = 0.001;
		fakeRuntime.on("BUILD", (o) =>
			reply(
				o,
				block({
					status: "awaiting-human",
					summary: "Permission.",
					needs_input: { ...QUESTION, blocking: false, risk: "low", kind: "permission" },
				}),
			),
		);
		const res = await dispatchRun(client, payload(THREE_STEPS, config));
		await manager.idle();
		await new Promise((r) => setTimeout(r, 100));
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("awaiting-human");
		expect(pendingInput(store.readRun())?.deadline).toBeNull();
		expect(store.readEvents().some((e) => e.type === "input.answered")).toBe(false);
		expect(store.readEvents().find((e) => e.type === "needs_input")?.data).toMatchObject({
			kind: "permission",
			risk: "low",
		});
	});

	it("re-arms a pending deadline after a supervisor restart", async () => {
		const first = await startSupervisor();
		let asks = 0;
		fakeRuntime.on("BUILD", (o) => {
			asks++;
			return asks === 1
				? reply(
						o,
						block({
							status: "awaiting-human",
							summary: "Choice.",
							max_risk: "low",
							needs_input: { ...QUESTION, blocking: false },
						}),
					)
				: reply(o, "ok");
		});
		const config = getDefaultConfig();
		(config.supervisor as Record<string, unknown>).needs_input_timeout = 10;
		const res = await dispatchRun(first.client, payload(THREE_STEPS, config));
		await first.manager.idle();
		first.manager.close();
		await first.supervisor.stop();
		// Move the deadline into the past, as if the supervisor was down for 10 minutes
		const store = new RunStore(res.dir);
		const pending = pendingInput(store.readRun());
		await store.updateRun({
			"x-af-needs-input": { ...pending, deadline: new Date(Date.now() - 1000).toISOString() },
		});
		const second = await startSupervisor();
		await waitForStatus(second.manager, res.run.id, "done");
		expect(store.readEvents().find((e) => e.type === "input.answered")?.data?.from).toBe("policy");
	});
});

describe("af amend", () => {
	it("with settings.amend.step: runs the amend step at the next boundary, later steps read the new plan", async () => {
		const { manager, client } = await startSupervisor();
		const release = hold("BUILD");
		fakeRuntime.on("PLAN", (o) => {
			writeFileSync(path.join(o.outputDir ?? "", "plan.md"), "# Plan\n");
			return reply(o, "ok");
		});
		// Registered last so it wins over "PLAN" for the amend step prompt
		fakeRuntime.on("Amendment A001", (o) => {
			writeFileSync(path.join(o.outputDir ?? "", "plan.v2.md"), "# Plan v2\n");
			return reply(o, block({ status: "done", summary: "Plan amended." }));
		});
		const res = await dispatchRun(client, payload(WITH_AMEND_STEP));
		await fakeRuntime.waitFor("BUILD");
		const amended = await client.request<{ amendment: string; delivery: string; step: string }>(
			"POST",
			`/v1/runs/${res.run.id}/amend`,
			{ text: "Support GHE hosts.", affects: ["M2"] },
		);
		expect(amended).toMatchObject({ amendment: "A001", delivery: "amend-step", step: "plan" });
		release();
		await manager.idle();

		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("done");
		const planPrompts = prompts("PLAN");
		expect(planPrompts).toHaveLength(2);
		expect(planPrompts[1]).toContain("Amendment A001 (affects M2): Support GHE hosts.");
		expect(prompts("REVIEW")[0]).toContain(`${path.join(res.dir, "plan.v2.md")} v2`);
		const amendments = store.readAmendments();
		expect(amendments).toEqual([
			expect.objectContaining({ id: "A001", affects: ["M2"], plan_version: 2, from: "user" }),
		]);
		const applied = store.readEvents().find((e) => e.type === "amendment.applied");
		expect(applied?.data).toMatchObject({ id: "A001", step: "plan", plan_version: 2 });
		const decision = store.readDecisions().find((d) => d.id === "d-A001");
		expect(decision?.refs).toEqual(["A001", "M2"]);
		// Order: build done, then the amend step, then review
		const steps = store
			.readEvents()
			.filter((e) => e.type === "step.started")
			.map((e) => e.data?.step);
		expect(steps).toEqual(["plan", "build", "plan", "review"]);
		expect(store.readRun()["x-af-amendments"]).toEqual([]);
		expectValidRunDir(res.dir);
	});

	it("without an amend step: records the amendment and delivers it as an operator message", async () => {
		const { manager, client } = await startSupervisor();
		const release = hold("BUILD");
		const res = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("BUILD");
		const amended = await client.request<{ amendment: string; delivery: string }>(
			"POST",
			`/v1/runs/${res.run.id}/amend`,
			{ text: "Keep the API unchanged.", from: "overseer" },
		);
		expect(amended).toMatchObject({ amendment: "A001", delivery: "message" });
		const store = new RunStore(res.dir);
		expect(store.readAmendments()).toEqual([
			expect.objectContaining({ id: "A001", plan_version: null, from: "overseer", affects: [] }),
		]);
		release();
		await manager.idle();
		expect(store.readRun().status).toBe("done");
		expect(prompts("PLAN")).toHaveLength(1);
		const review = prompts("REVIEW")[0];
		expect(review.startsWith("## Operator Messages")).toBe(true);
		expect(review).toContain("Amendment: Keep the API unchanged.");
		expect(types(store)).toContain("amendment.applied");
		expect(store.readDecisions().map((d) => d.id)).toContain("d-A001");
		expectValidRunDir(res.dir);
	});

	it("validates input and the run status", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const route = `/v1/runs/${res.run.id}/amend`;
		await expect(client.request("POST", route, { text: "" })).rejects.toMatchObject({
			status: 400,
		});
		await expect(client.request("POST", route, { text: "x", affects: "M1" })).rejects.toMatchObject(
			{
				status: 400,
			},
		);
		await expect(client.request("POST", route, { text: "x" })).rejects.toMatchObject({
			status: 409,
		});
	});

	it("parses settings.amend.step and rejects unknown steps", () => {
		const parser = new WorkflowParser(repo);
		expect(parser.parseString(WITH_AMEND_STEP).settings.amend).toEqual({ step: "plan" });
		expect(parser.parseString(THREE_STEPS).settings.amend).toBeNull();
		expect(() => parser.parseString(WITH_AMEND_STEP.replace("step: plan", "step: nope"))).toThrow(
			WorkflowParseError,
		);
		expect(() => parser.parseString(WITH_AMEND_STEP.replace("step: plan", "step: ''"))).toThrow(
			WorkflowParseError,
		);
	});

	it("finds the latest plan version", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "af-plan-"));
		try {
			expect(latestPlan(dir)).toEqual({ version: 0, path: null });
			writeFileSync(path.join(dir, "plan.md"), "");
			expect(latestPlan(dir).version).toBe(1);
			writeFileSync(path.join(dir, "plan.v3.md"), "");
			writeFileSync(path.join(dir, "plan.v2.md"), "");
			expect(latestPlan(dir)).toEqual({ version: 3, path: path.join(dir, "plan.v3.md") });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("af retry-step", () => {
	it("reruns a chosen step and the later ones with extra context", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", (o) => reply(o, "", 1));
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("failed");

		const route = `/v1/runs/${res.run.id}/retry`;
		await expect(client.request("POST", route, { step: "nope" })).rejects.toMatchObject({
			status: 400,
		});
		fakeRuntime.reset();
		const retried = await client.request<{ status: string; message: string }>("POST", route, {
			step: "plan",
			context: "Use the v2 API.",
		});
		expect(retried.status).toBe("queued");
		await manager.idle();
		expect(store.readRun().status).toBe("done");
		expect(prompts("PLAN")[0]).toContain("Use the v2 API.");
		expect(prompts("BUILD")).toHaveLength(1);
		expect(prompts("REVIEW")).toHaveLength(1);
		const event = store
			.readEvents()
			.find((e) => e.type === "step.retried" && e.data?.reason === "operator");
		expect(event?.data).toMatchObject({
			step: "plan",
			reason: "operator",
			message: retried.message,
		});
		await expect(client.request("POST", route, { step: "plan" })).rejects.toMatchObject({
			status: 409,
		});
		expectValidRunDir(res.dir);
	});
});

describe("af send --mode now", () => {
	it("kills the current step and restarts it with the message", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", "hang");
		const res = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("BUILD");
		fakeRuntime.reset();
		const sent = await client.request<{ message: { id: string } }>(
			"POST",
			`/v1/runs/${res.run.id}/messages`,
			{ text: "Stop, use pnpm.", mode: "now" },
		);
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("done");
		const restarted = prompts("BUILD");
		expect(restarted).toHaveLength(1);
		expect(restarted[0]).toContain("Stop, use pnpm.");
		const retried = store.readEvents().find((e) => e.type === "step.retried");
		expect(retried?.data).toMatchObject({
			step: "build",
			reason: "message",
			message: sent.message.id,
		});
		expect(types(store)).not.toContain("run.paused");
		expectValidRunDir(res.dir);
	});
});

describe("af reprioritize", () => {
	it("changes the priority of a run that has not ended", async () => {
		const { manager, client } = await startSupervisor();
		const release = hold("BUILD");
		const res = await dispatchRun(client, payload());
		await fakeRuntime.waitFor("BUILD");
		const route = `/v1/runs/${res.run.id}/priority`;
		await expect(client.request("POST", route, { priority: 1.5 })).rejects.toMatchObject({
			status: 400,
		});
		expect(await client.request("POST", route, { priority: 5 })).toMatchObject({ priority: 5 });
		expect(manager.registry.get(res.run.id)?.priority).toBe(5);
		release();
		await manager.idle();
		await expect(client.request("POST", route, { priority: 1 })).rejects.toMatchObject({
			status: 409,
		});
	});
});

describe("review fixes", () => {
	it("supervisor shutdown ends executing runs and leaves them for recovery", async () => {
		const first = await startSupervisor();
		fakeRuntime.on("BUILD", "hang");
		const res = await dispatchRun(first.client, payload());
		await fakeRuntime.waitFor("BUILD");
		await first.supervisor.stop();
		const store = new RunStore(res.dir);
		expect(fakeRuntime.calls.find((c) => c.prompt.includes("BUILD"))?.aborted).toBe(true);
		expect(store.readRun().status).toBe("running");

		fakeRuntime.reset();
		const second = await startSupervisor();
		await second.manager.idle();
		expect(store.readRun().status).toBe("done");
		expect(prompts("PLAN")).toHaveLength(0);
		expect(prompts("BUILD")).toHaveLength(1);
		expect(types(store)).toContain("run.recovered");
	});

	it("keeps awaiting-human from a step nested in a serial step", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("BUILD", (o) =>
			reply(
				o,
				block({ status: "awaiting-human", summary: "Need a choice.", needs_input: QUESTION }),
				10,
			),
		);
		const nested = [
			"name: nested",
			'version: "1.0"',
			"settings:",
			"  max-retry: 0",
			"steps:",
			"  - name: group",
			"    type: serial",
			"    steps:",
			"      - name: build",
			"        type: prompt",
			'        prompt: "BUILD"',
			"  - name: review",
			"    type: prompt",
			'    prompt: "REVIEW"',
			"",
		].join("\n");
		const res = await dispatchRun(client, payload(nested));
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("awaiting-human");
		expect(pendingInput(store.readRun())?.request.id).toBe("q1");
		expect(prompts("REVIEW")).toHaveLength(0);
	});

	it("retry-step keeps the invalidation when the rerun stops before completing", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("REVIEW", (o) => reply(o, "", 1));
		const res = await dispatchRun(client, payload());
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("failed");

		fakeRuntime.reset();
		let asks = 0;
		fakeRuntime.on("BUILD", (o) => {
			asks++;
			if (asks === 1) {
				return reply(
					o,
					block({ status: "awaiting-human", summary: "Need a choice.", needs_input: QUESTION }),
					10,
				);
			}
			return reply(o, block({ status: "done", summary: "Built." }));
		});
		await client.request("POST", `/v1/runs/${res.run.id}/retry`, { step: "build" });
		await manager.idle();
		expect(store.readRun().status).toBe("awaiting-human");

		await client.request("POST", `/v1/runs/${res.run.id}/answer`, {
			request_id: "q1",
			answer: "a",
		});
		await manager.idle();
		expect(store.readRun().status).toBe("done");
		expect(prompts("PLAN")).toHaveLength(0);
		expect(prompts("BUILD")).toHaveLength(2);
		expect(prompts("REVIEW")).toHaveLength(1);
		expectValidRunDir(res.dir);
	});
});
