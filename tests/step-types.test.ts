/**
 * Tests for the `skill` and `human-input` step types (ORC-013): parsing,
 * the skill invocation and config snapshot, result block outputs chained into
 * later steps, and human-input through needs_input and af answer. In-process
 * supervisor, fake runtime.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { validateContractFile } from "../src/contract/index.js";
import { WorkflowParseError, WorkflowParser } from "../src/parser.js";
import { dispatchRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager, pendingInput } from "../src/runs/manager.js";
import { RunStore } from "../src/runs/run-store.js";
import type { RuntimeResult, RuntimeRunOptions } from "../src/runtimes/types.js";
import { SessionOutput } from "../src/runtimes/types.js";
import { humanInputRequestId } from "../src/steps/human-input-step.js";
import { skillPrompt, writeConfigSnapshot } from "../src/steps/skill-step.js";
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

function parse(steps: string): ReturnType<WorkflowParser["parseString"]> {
	return new WorkflowParser().parseString(`name: t\nsteps:\n${steps}`);
}

function payload(contents: string, config = getDefaultConfig()): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		config,
		env: { PATH: process.env.PATH ?? "" },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "steps",
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

function prompts(match: string): string[] {
	return fakeRuntime.calls.filter((c) => c.prompt.includes(match)).map((c) => c.prompt);
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

function stepResult(dir: string, step: string): Record<string, unknown> {
	const name = readdirSync(path.join(dir, "steps")).find((d) => d.endsWith(`-${step}`));
	if (!name) throw new Error(`No step dir for ${step}`);
	return JSON.parse(readFileSync(path.join(dir, "steps", name, "result.json"), "utf-8"));
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-step-types-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("parsing", () => {
	it("parses skill steps and rejects a missing or invalid skill", () => {
		const wf = parse(
			[
				"  - { name: plan, type: skill, skill: esp-skills:esp-plan, args: --fast, model: opus }",
				"  - { name: local, type: skill, skill: /my-skill }",
				'  - { name: dyn, type: skill, skill: "{{ variables.pack }}:review" }',
			].join("\n"),
		);
		expect(wf.steps[0]).toMatchObject({
			type: "skill",
			skill: "esp-skills:esp-plan",
			args: "--fast",
			model: "opus",
		});
		expect(wf.steps[1].skill).toBe("my-skill");
		expect(wf.steps[1].args).toBeNull();
		expect(wf.steps[2].skill).toBe("{{ variables.pack }}:review");
		expect(() => parse("  - { name: s, type: skill }")).toThrow(/needs a 'skill' field/);
		expect(() => parse('  - { name: s, type: skill, skill: "a b:c" }')).toThrow(WorkflowParseError);
	});

	it("parses human-input steps with string and object options", () => {
		const wf = parse(
			[
				"  - name: approve",
				"    type: human-input",
				'    message: "Ship {{ variables.task }}?"',
				"    context: The plan is ready.",
				"    options: [Ship it, { id: no, label: Not yet, description: Keep planning }]",
				"    recommended: Ship-it",
				"    blocking: false",
				"    timeout-minutes: 30",
			].join("\n"),
		);
		expect(wf.steps[0]).toMatchObject({
			type: "human-input",
			message: "Ship {{ variables.task }}?",
			context: "The plan is ready.",
			options: [
				{ id: "Ship-it", label: "Ship it" },
				{ id: "no", label: "Not yet", description: "Keep planning" },
			],
			recommended: "Ship-it",
			blocking: false,
			stepTimeoutMinutes: 30,
		});
		const free = parse("  - { name: ask, type: human-input, message: Notes? }").steps[0];
		expect(free).toMatchObject({ options: [], recommended: null, blocking: true });
	});

	it("rejects invalid human-input fields", () => {
		expect(() => parse("  - { name: a, type: human-input }")).toThrow(/needs a 'message'/);
		expect(() =>
			parse("  - { name: a, type: human-input, message: Q, options: [x], recommended: y }"),
		).toThrow(/not one of its options/);
		expect(() => parse("  - { name: a, type: human-input, message: Q, options: [x, x] }")).toThrow(
			/unique/,
		);
		expect(() => parse("  - { name: a, type: human-input, message: Q, blocking: maybe }")).toThrow(
			/boolean/,
		);
		expect(() =>
			parse(
				"  - { name: a, type: human-input, message: Q, options: [x], recommended: x, timeout-minutes: 5 }",
			),
		).toThrow(/blocking: false/);
	});

	it("parses wait-for-human as a human-input alias", () => {
		const wait = parse("  - { name: w, type: wait-for-human, message: Approve? }").steps[0];
		expect(wait).toMatchObject({
			type: "human-input",
			message: "Approve?",
			options: [],
			blocking: true,
		});
		const proceed = parse(
			"  - { name: w, type: wait-for-human, message: Go?, on-timeout: continue, timeout-minutes: 2 }",
		).steps[0];
		expect(proceed).toMatchObject({
			type: "human-input",
			recommended: "continue",
			blocking: false,
			stepTimeoutMinutes: 2,
		});
		expect(proceed.options?.map((o) => o.id)).toEqual(["continue", "abort"]);
	});

	it("rejects the removed orchestrator step type", () => {
		expect(() => parse("  - { name: o, type: orchestrator }")).toThrow(/Invalid step type/);
	});
});

describe("skill invocation", () => {
	it("builds the slash command with the contract options", () => {
		expect(skillPrompt("esp-skills:esp-plan", " --fast ", "/runs/r1", "/runs/r1/c.json")).toBe(
			"/esp-skills:esp-plan --fast --run-dir /runs/r1 --config-snapshot /runs/r1/c.json",
		);
		expect(skillPrompt("x", null, "C:\\My Runs\\r", "C:\\My Runs\\r\\c.json")).toBe(
			'/x --run-dir "C:\\My Runs\\r" --config-snapshot "C:\\My Runs\\r\\c.json"',
		);
	});

	it("writes the skill pack's config snapshot, empty when unset", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "af-snapshot-"));
		try {
			const config = { skill_config: { "esp-skills": { plan: { depth: "deep" } } } };
			const file = writeConfigSnapshot(dir, config, "esp-skills:esp-plan");
			expect(file).toBe(path.join(dir, "skill-config", "esp-skills.json"));
			expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ plan: { depth: "deep" } });
			const other = writeConfigSnapshot(dir, config, "other");
			expect(JSON.parse(readFileSync(other, "utf-8"))).toEqual({});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("names the n-th question of a step", () => {
		expect(humanInputRequestId("approve plan", 2)).toBe("input-approve-plan-2");
	});
});

describe("skill steps through the supervisor", () => {
	const SKILL_FLOW = `
name: skill-flow
version: "1.0"
settings:
  max-retry: 0
variables:
  - { name: depth, type: string, required: false, default: deep }
steps:
  - name: plan
    type: skill
    skill: esp-skills:esp-plan
    args: "--depth {{ variables.depth }}"
  - name: build
    type: prompt
    prompt: "BUILD {{ outputs.plan.plan_path }} ({{ outputs.plan.milestones }})"
`;

	it("invokes the skill with args and chains its result block outputs", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("/esp-skills:esp-plan", (o) =>
			reply(
				o,
				`Planned.\n${JSON.stringify({
					status: "done",
					summary: "Plan ready.",
					outputs: { plan_path: "plan.md", milestones: 3 },
				})}`,
			),
		);
		const config = getDefaultConfig();
		config.skill_config = { "esp-skills": { plan: { depth: "deep" } } };
		const res = await dispatchRun(client, payload(SKILL_FLOW, config));
		await manager.idle();

		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("done");
		const [invocation] = prompts("/esp-skills:esp-plan");
		const snapshot = path.join(res.dir, "skill-config", "esp-skills.json");
		expect(invocation.startsWith("/esp-skills:esp-plan --depth deep --run-dir ")).toBe(true);
		expect(invocation).toContain(res.dir);
		expect(invocation).toContain(snapshot);
		expect(JSON.parse(readFileSync(snapshot, "utf-8"))).toEqual({ plan: { depth: "deep" } });
		expect(prompts("BUILD")[0]).toBe("BUILD plan.md (3)");
		expect(stepResult(res.dir, "plan")).toMatchObject({ status: "done", summary: "Plan ready." });
		expect(validateContractFile(path.join(res.dir, "run.json")).errors).toEqual([]);
	});

	it("puts operator messages after the slash command", async () => {
		const { manager, client } = await startSupervisor();
		fakeRuntime.on("/esp-skills:esp-plan", (o) => reply(o, "ok"));
		const contents = SKILL_FLOW.replace(
			"steps:\n",
			"steps:\n  - { name: first, type: prompt, prompt: FIRST }\n",
		);
		let release!: () => void;
		const released = new Promise<void>((r) => {
			release = r;
		});
		fakeRuntime.on("FIRST", async (o) => {
			await released;
			return reply(o, "ok");
		});
		const res = await dispatchRun(client, payload(contents));
		await fakeRuntime.waitFor("FIRST");
		await client.request("POST", `/v1/runs/${res.run.id}/messages`, {
			text: "Use the short plan template",
			mode: "next",
			step: "plan",
		});
		release();
		await manager.idle();
		const [invocation] = prompts("/esp-skills:esp-plan");
		expect(invocation.startsWith("/esp-skills:esp-plan --depth deep")).toBe(true);
		expect(invocation).toContain("\n\n## Operator Messages");
		expect(invocation).toContain("Use the short plan template");
	});

	it("fails a skill step on Codex with a clear message", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(
			client,
			payload(SKILL_FLOW.replace("    type: skill\n", "    type: skill\n    runtime: codex\n")),
		);
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("failed");
		const failed = store.readEvents().find((e) => e.type === "step.failed");
		expect(String(failed?.data?.error)).toContain("not supported yet on the 'codex' runtime");
		expect(prompts("/esp-skills")).toHaveLength(0);
	});
});

describe("human-input steps through the supervisor", () => {
	const APPROVAL = `
name: approval
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: approve
    type: human-input
    message: "Ship the plan?"
    options: [yes, no]
    recommended: "yes"
  - name: next
    type: prompt
    prompt: "NEXT {{ outputs.approve.answer }} from {{ outputs.approve.from }}"
`;

	it("waits for af answer, then records the answer as its outputs", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload(APPROVAL));
		await manager.idle();
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("awaiting-human");
		expect(fakeRuntime.calls).toHaveLength(0);
		const id = humanInputRequestId("approve", 1);
		const needs = store.readEvents().find((e) => e.type === "needs_input");
		expect(needs?.data).toMatchObject({
			id,
			step: "approve",
			question: "Ship the plan?",
			recommended: "yes",
			blocking: true,
			deadline: null,
		});
		expect(pendingInput(store.readRun())?.request.options.map((o) => o.id)).toEqual(["yes", "no"]);
		expect(stepResult(res.dir, "approve")).toMatchObject({ status: "awaiting-human" });

		// The single pending request is answered without its id (af input)
		await client.request("POST", `/v1/runs/${res.run.id}/answer`, { answer: "yes" });
		await waitForStatus(manager, res.run.id, "done");

		expect(prompts("NEXT")).toEqual(["NEXT yes from user"]);
		expect(stepResult(res.dir, "approve")).toMatchObject({
			status: "done",
			outputs: { answer: "yes", option: "yes", request_id: id },
		});
		const types = store.readEvents().map((e) => e.type);
		expect(types).toContain("message.delivered");
		expect(types.filter((t) => t === "needs_input")).toHaveLength(1);
		for (const file of ["run.json", "events.jsonl", "decisions.jsonl"]) {
			const full = path.join(res.dir, file);
			if (existsSync(full)) expect(validateContractFile(full).errors).toEqual([]);
		}
	});

	it("asks again when the run is resumed without an answer", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload(APPROVAL));
		await manager.idle();
		await client.request("POST", `/v1/runs/${res.run.id}/resume`, {});
		await waitForStatus(manager, res.run.id, "awaiting-human");
		const store = new RunStore(res.dir);
		expect(pendingInput(store.readRun())?.request.id).toBe(humanInputRequestId("approve", 2));
		await client.request("POST", `/v1/runs/${res.run.id}/answer`, { answer: "No" });
		await waitForStatus(manager, res.run.id, "done");
		expect(prompts("NEXT")).toEqual(["NEXT no from user"]);
	});

	it("applies the recommended option of a non-blocking step after its timeout", async () => {
		const { manager, client } = await startSupervisor();
		const contents = APPROVAL.replace(
			'    recommended: "yes"\n',
			'    recommended: "yes"\n    blocking: false\n    timeout-minutes: 0.001\n',
		);
		const res = await dispatchRun(client, payload(contents));
		await waitForStatus(manager, res.run.id, "done");
		const store = new RunStore(res.dir);
		expect(store.readEvents().find((e) => e.type === "needs_input")?.data?.deadline).toBeTruthy();
		expect(prompts("NEXT")).toEqual(["NEXT yes from policy"]);
		expect(store.readDecisions().find((d) => d.source === "policy")).toBeTruthy();
	});
});
