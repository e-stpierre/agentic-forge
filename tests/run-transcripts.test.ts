/**
 * Tests for live transcripts and session recovery (ORC-036): the normalized
 * transcript entries of both drivers (the session driver on the fake SDK
 * transport, the `cli` driver on a fake process printing stream-json),
 * capped reads with cursors, `af logs --follow` through the supervisor, and
 * resuming a session after a supervisor restart (or restarting the step at
 * its boundary, with the choice logged).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { validateContractFile } from "../src/contract/index.js";
import { loadProgress } from "../src/progress.js";
import { dispatchRun, followLogs, formatTranscriptEntry } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager, pendingInputs } from "../src/runs/manager.js";
import { RunStore } from "../src/runs/run-store.js";
import {
	SESSION_FILE,
	TRANSCRIPT_FILE,
	type TranscriptEntry,
	TranscriptWriter,
	decodeTranscriptCursor,
	readStepSession,
	readTranscriptPage,
	transcriptEntries,
} from "../src/runs/transcript.js";
import { ClaudeAdapter } from "../src/runtimes/claude.js";
import { codexStreamEvents } from "../src/runtimes/codex.js";
import { runRuntime } from "../src/runtimes/process-runner.js";
import type { SessionEvent } from "../src/runtimes/session.js";
import type { RuntimeCommand, RuntimeRunOptions } from "../src/runtimes/types.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
import { type FakeSdkSession, fakeSdk, resultBlock, userText } from "./helpers/fake-sdk.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
	const { fakeSdk: fake } = await import("./helpers/fake-sdk.js");
	return { query: fake.query };
});

const home = useTempGlobalRoot();
let repo: string;
let scratch: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];

const TWO_STEPS = `
name: two-steps
version: "1.0"
settings:
  max-retry: 0
  required-tools: [Edit]
steps:
  - name: build
    type: prompt
    prompt: "BUILD"
  - name: review
    type: prompt
    prompt: "REVIEW"
`;

function payload(contents = TWO_STEPS): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		config: getDefaultConfig(),
		env: { PATH: process.env.PATH ?? "" },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "transcript",
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

/** Stops a supervisor as `af serve` does on shutdown (live steps are aborted, runs kept). */
async function stopSupervisor(s: { supervisor: Supervisor; manager: RunManager }): Promise<void> {
	await s.supervisor.stop();
	s.manager.close();
	supervisors.splice(supervisors.indexOf(s.supervisor), 1);
	managers.splice(managers.indexOf(s.manager), 1);
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

function transcript(runDir: string, stepDir: string): TranscriptEntry[] {
	return readFileSync(path.join(runDir, "steps", stepDir, TRANSCRIPT_FILE), "utf-8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as TranscriptEntry);
}

/** Blocks until `release()` is called, or the session is aborted. */
function gate(): { wait: (s: FakeSdkSession) => Promise<void>; release: () => void } {
	let open: () => void = () => {};
	const opened = new Promise<void>((r) => {
		open = r;
	});
	return {
		wait: (s) =>
			Promise.race([
				opened,
				new Promise<void>((r) =>
					s.options.abortController?.signal.addEventListener("abort", () => r()),
				),
			]),
		release: () => open(),
	};
}

beforeEach(() => {
	fakeSdk.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-transcript-repo-"));
	scratch = mkdtempSync(path.join(tmpdir(), "af-transcript-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("transcript entries", () => {
	it("maps tool calls to entries, with a diff for file edits and capped inputs", () => {
		const entries = transcriptEntries({
			type: "item",
			id: "t1",
			kind: "tool_call",
			status: "started",
			tool: "Edit",
			input: {
				file_path: "a.ts",
				old_string: "one\ntwo",
				new_string: "three",
				note: "x".repeat(3000),
			},
		});
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			type: "tool_call",
			id: "t1",
			tool: "Edit",
			truncated: true,
		});
		expect(String(entries[0].input?.note).length).toBeLessThan(2100);
		expect(entries[1]).toEqual({
			type: "diff",
			id: "t1",
			path: "a.ts",
			change: "update",
			patch: "-one\n-two\n+three",
		});
		expect(transcriptEntries({ type: "state", state: "idle" })).toEqual([]);
	});

	it("maps Codex JSONL lines to normalized events", () => {
		expect(codexStreamEvents({ type: "thread.started", thread_id: "th-1" })).toMatchObject([
			{ type: "session.started", sessionId: "th-1" },
		]);
		expect(
			codexStreamEvents({
				type: "item.started",
				item: { id: "i1", type: "command_execution", command: "ls" },
			}),
		).toMatchObject([{ type: "item", kind: "tool_call", tool: "shell", input: { command: "ls" } }]);
		expect(
			codexStreamEvents({
				type: "item.completed",
				item: { id: "i1", type: "command_execution", aggregated_output: "boom", exit_code: 2 },
			}),
		).toMatchObject([{ type: "item", kind: "tool_result", text: "boom", isError: true }]);
		expect(
			codexStreamEvents({
				type: "item.completed",
				item: {
					id: "i2",
					type: "file_change",
					changes: [
						{ path: "a.ts", kind: "add" },
						{ path: "b.ts", kind: "delete" },
					],
				},
			}),
		).toEqual([
			{ type: "diff", id: "i2:0", path: "a.ts", change: "add" },
			{ type: "diff", id: "i2:1", path: "b.ts", change: "delete" },
		]);
		expect(
			codexStreamEvents({
				type: "item.completed",
				item: { id: "i3", type: "agent_message", text: "Hi" },
			}),
		).toMatchObject([{ type: "item", kind: "message", role: "assistant", text: "Hi" }]);
	});

	it("numbers entries per step across writers and pages them with a cursor", () => {
		const runDir = path.join(scratch, "run");
		const dir = path.join(runDir, "steps", "01-build");
		const message = (text: string): SessionEvent => ({
			type: "item",
			id: text,
			kind: "message",
			status: "completed",
			role: "assistant",
			text,
		});
		const first = new TranscriptWriter(dir, "build");
		first.write({
			type: "session.started",
			sessionId: "s-1",
			model: "m",
			authSource: null,
			driver: "session",
		});
		first.write(message("one"));
		// A second attempt of the step continues the numbering
		new TranscriptWriter(dir, "build").write(message("two"));
		expect(transcript(runDir, "01-build").map((e) => e.seq)).toEqual([1, 2, 3]);
		expect(readStepSession(dir)).toMatchObject({ session_id: "s-1", driver: "session" });

		const tail = readTranscriptPage(runDir, { limit: 2 });
		expect(tail.entries.map((e) => e.text)).toEqual(["one", "two"]);
		expect(tail.truncated).toBe(true);
		expect(decodeTranscriptCursor(tail.cursor)).toEqual({ "01-build": 3 });
		expect(readTranscriptPage(runDir, { cursor: tail.cursor }).entries).toEqual([]);

		new TranscriptWriter(dir, "build").write(message("x".repeat(2000)));
		const next = readTranscriptPage(runDir, { cursor: tail.cursor, maxChars: 100 });
		expect(next.entries).toHaveLength(1);
		expect(next.entries[0]).toMatchObject({ seq: 4, truncated: true });
		expect(next.entries[0].text?.length).toBe(103);
		expect(next.truncated).toBe(true);

		const budget = readTranscriptPage(runDir, { cursor: "e30", maxBytes: 400 });
		expect(budget.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
		expect(budget.more).toBe(true);
		expect(readTranscriptPage(runDir, { cursor: budget.cursor }).entries.map((e) => e.seq)).toEqual(
			[4],
		);
		expect(() => readTranscriptPage(runDir, { cursor: "%%" })).toThrow(/Invalid logs cursor/);
	});
});

describe("cli driver transcript", () => {
	it("maps the stream-json lines of a fake claude -p process", async () => {
		const lines = [
			{
				type: "system",
				subtype: "init",
				session_id: "cli-1",
				model: "claude-sonnet",
				apiKeySource: "none",
			},
			{
				type: "assistant",
				session_id: "cli-1",
				message: {
					id: "m1",
					content: [
						{
							type: "tool_use",
							id: "t1",
							name: "Write",
							input: { file_path: "a.ts", content: "x" },
						},
					],
				},
			},
			{
				type: "user",
				session_id: "cli-1",
				message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
			},
			{
				type: "assistant",
				session_id: "cli-1",
				message: { id: "m2", content: [{ type: "text", text: "Done" }] },
			},
			{
				type: "result",
				subtype: "success",
				is_error: false,
				session_id: "cli-1",
				result: `Done\n${resultBlock()}`,
			},
		];
		const data = path.join(scratch, "stream.jsonl");
		writeFileSync(data, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf-8");
		const script = path.join(scratch, "fake-claude.cjs");
		writeFileSync(
			script,
			"process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(require('fs').readFileSync(process.argv[2],'utf8')));",
			"utf-8",
		);
		class FakeClaude extends ClaudeAdapter {
			buildCommand(options: RuntimeRunOptions): RuntimeCommand {
				return { executable: process.execPath, args: [script, data], stdinInput: options.prompt };
			}
		}
		const runDir = path.join(scratch, "run");
		const writer = new TranscriptWriter(path.join(runDir, "steps", "01-build"), "build");
		const result = await runRuntime(new FakeClaude(), {
			prompt: "BUILD",
			driver: "cli",
			printOutput: true,
			sessionHost: { onEvent: (e) => writer.write(e) },
		});
		expect(result.success).toBe(true);
		expect(result.sessionOutput.sessionId).toBe("cli-1");
		const entries = transcript(runDir, "01-build");
		expect(entries.map((e) => e.type)).toEqual([
			"message",
			"session",
			"tool_call",
			"diff",
			"tool_result",
			"message",
			"turn",
		]);
		expect(entries[0]).toMatchObject({ role: "user", text: "BUILD", step: "build" });
		expect(entries[1]).toMatchObject({ session_id: "cli-1", runtime: "claude", driver: "cli" });
		expect(entries[3]).toMatchObject({ path: "a.ts", change: "add", patch: "+x" });
		expect(entries[4]).toMatchObject({ id: "t1", text: "ok", is_error: false });
		expect(readStepSession(path.join(runDir, "steps", "01-build"))?.driver).toBe("cli");
		expect(formatTranscriptEntry(entries[2])).toMatch(/build tool Write/);
	});
});

describe("session driver transcript", () => {
	it("writes the transcript of each step apart from events.jsonl", async () => {
		fakeSdk.on("BUILD", async (s, first) => {
			s.init();
			await s.tool("Edit", { file_path: "a.ts", old_string: "a", new_string: "b" });
			s.text("Edited");
			s.result(`Edited\n${resultBlock()}`, [first]);
			await s.nextUser();
		});
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "done");

		const build = transcript(res.dir, "01-build");
		expect(build.map((e) => e.type)).toEqual([
			"message",
			"session",
			"tool_call",
			"diff",
			"tool_result",
			"message",
			"turn",
		]);
		expect(build[1]).toMatchObject({
			session_id: "fake-session-1",
			runtime: "claude",
			driver: "session",
		});
		expect(build.every((e) => e.step === "build")).toBe(true);
		expect(transcript(res.dir, "02-review")[0]).toMatchObject({ role: "user", text: "REVIEW" });
		expect(existsSync(path.join(res.dir, "steps", "01-build", SESSION_FILE))).toBe(true);
		const store = new RunStore(res.dir);
		expect(store.readEvents().some((e) => ["message", "tool_call"].includes(e.type))).toBe(false);
		expect(validateContractFile(store.eventsFile).valid).toBe(true);

		const page = await manager.logs(res.run.id, { step: "build" });
		expect(page).toMatchObject({ step: "build", active: false, more: false, status: "done" });
		expect(page.entries).toHaveLength(7);
		await expect(manager.logs(res.run.id, { step: "nope" })).rejects.toThrow(/Unknown step/);
	});

	it("follows a running step and stops when it ends", async () => {
		const hold = gate();
		fakeSdk.on("BUILD", async (s, first) => {
			s.init();
			s.text("one");
			await hold.wait(s);
			s.text("two");
			s.result(`two\n${resultBlock()}`, [first]);
			await s.nextUser();
		});
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload());
		const seen: TranscriptEntry[] = [];
		const following = followLogs(client, {
			run: res.run.id,
			step: "build",
			follow: true,
			waitSeconds: 1,
			onEntry: (e) => {
				seen.push(e);
				if (e.text === "one") hold.release();
			},
		});
		const { last } = await following;
		expect(seen.filter((e) => e.type === "message").map((e) => e.text)).toEqual([
			"BUILD",
			"one",
			"two",
		]);
		expect(seen.at(-1)?.type).toBe("turn");
		expect(last?.active).toBe(false);
		await waitForStatus(manager, res.run.id, "done");
	});
	it("stops following a parallel branch when that branch ends", async () => {
		let release!: () => void;
		const held = new Promise<void>((r) => {
			release = r;
		});
		fakeSdk.on("LEFT", async (s, first) => {
			s.init();
			s.result(
				`left
${resultBlock()}`,
				[first],
			);
			await s.nextUser();
		});
		fakeSdk.on("RIGHT", async (s, first) => {
			s.init();
			await held;
			s.result(
				`right
${resultBlock()}`,
				[first],
			);
			await s.nextUser();
		});
		const contents = `
name: par
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: par
    type: parallel
    steps:
      - { name: left, type: prompt, prompt: "LEFT" }
      - { name: right, type: prompt, prompt: "RIGHT" }
  - { name: after, type: prompt, prompt: "AFTER" }
`;
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload(contents));
		await fakeSdk.waitFor("RIGHT");
		// The branch follows its top-level step: still active while its sibling runs
		const page = await manager.logs(res.run.id, { step: "left" });
		expect(page.active).toBe(true);
		release();
		await waitForStatus(manager, res.run.id, "done");
		const { last } = await followLogs(client, {
			run: res.run.id,
			step: "left",
			follow: true,
			waitSeconds: 1,
			onEntry: () => {},
		});
		expect(last?.active).toBe(false);
	});
});

describe("session recovery", () => {
	it("resumes a running session from its id after a supervisor restart", async () => {
		fakeSdk.on("BUILD", async (s) => {
			s.init();
			s.text("halfway");
			await new Promise(() => {});
		});
		const first = await startSupervisor();
		const res = await dispatchRun(first.client, payload());
		const store = new RunStore(res.dir);
		await waitFor(
			() => existsSync(path.join(res.dir, "steps", "01-build", SESSION_FILE)),
			"session.json",
		);
		await stopSupervisor(first);
		expect(store.readRun().status).toBe("running");

		const second = await startSupervisor();
		await waitForStatus(second.manager, res.run.id, "done");
		const resumed = fakeSdk.sessions[1];
		expect(resumed.options.resume).toBe("fake-session-1");
		expect(userText(resumed.received[0])).toMatch(/harness restarted/);
		const recovered = store.readEvents().find((e) => e.type === "run.recovered");
		expect(recovered?.data?.sessions).toEqual([
			{
				step: "build",
				action: "resume",
				session_id: "fake-session-1",
				reason: "the session driver resumes the stored session id",
			},
		]);
		const decision = store.readDecisions().find((d) => d.id === "d-recover-1-build");
		expect(decision).toMatchObject({ source: "policy", phase: "build", refs: ["fake-session-1"] });
		const progress = loadProgress(res.run.id, res.dir);
		expect(progress?.completedSteps.map((s) => `${s.name}:${s.status}`)).toEqual([
			"build:interrupted",
			"build:completed",
			"review:completed",
		]);
		// One transcript across both supervisors
		expect(transcript(res.dir, "01-build").map((e) => e.seq)).toEqual(
			transcript(res.dir, "01-build").map((_, i) => i + 1),
		);
		expect(validateContractFile(store.decisionsFile).valid).toBe(true);
	});

	it("resumes a skill step's session after a supervisor restart", async () => {
		fakeSdk.on("/esp:go", async (s) => {
			s.init();
			s.text("halfway");
			await new Promise(() => {});
		});
		const contents = TWO_STEPS.replace(
			'type: prompt\n    prompt: "BUILD"',
			"type: skill\n    skill: esp:go",
		);
		const first = await startSupervisor();
		const res = await dispatchRun(first.client, payload(contents));
		await waitFor(
			() => existsSync(path.join(res.dir, "steps", "01-build", SESSION_FILE)),
			"session.json",
		);
		await stopSupervisor(first);

		const second = await startSupervisor();
		await waitForStatus(second.manager, res.run.id, "done");
		expect(fakeSdk.sessions[1].options.resume).toBe("fake-session-1");
		const recovered = new RunStore(res.dir).readEvents().find((e) => e.type === "run.recovered");
		expect(recovered?.data?.sessions).toEqual([
			expect.objectContaining({ step: "build", action: "resume", session_id: "fake-session-1" }),
		]);
	});

	it("restarts the step from its boundary when no session was recorded", async () => {
		fakeSdk.on("BUILD", async () => {
			await new Promise(() => {});
		});
		const first = await startSupervisor();
		const res = await dispatchRun(first.client, payload());
		await fakeSdk.waitFor("BUILD");
		await stopSupervisor(first);

		fakeSdk.on("BUILD", async (s, first) => {
			s.init();
			s.result(resultBlock(), [first]);
			await s.nextUser();
		});
		const second = await startSupervisor();
		await waitForStatus(second.manager, res.run.id, "done");
		expect(fakeSdk.sessions[1].options.resume).toBeUndefined();
		expect(userText(fakeSdk.sessions[1].received[0])).toBe("BUILD");
		const store = new RunStore(res.dir);
		const recovered = store.readEvents().find((e) => e.type === "run.recovered");
		expect(recovered?.data?.sessions).toEqual([
			{
				step: "build",
				action: "restart",
				session_id: null,
				reason: "no runtime session was recorded for this attempt",
			},
		]);
		expect(store.readDecisions().some((d) => d.id.startsWith("d-recover"))).toBe(false);
	});

	it("resumes a session that waited for an answer when the supervisor stopped", async () => {
		fakeSdk.on("BUILD", async (s) => {
			s.init();
			await s.tool("Bash", { command: "npm publish" });
			await new Promise(() => {});
		});
		const first = await startSupervisor();
		const res = await dispatchRun(first.client, payload());
		await waitForStatus(first.manager, res.run.id, "awaiting-human");
		await stopSupervisor(first);
		const store = new RunStore(res.dir);
		expect(store.readRun().status).toBe("awaiting-human");
		expect(pendingInputs(store.readRun())[0]).toMatchObject({ live: true });

		const second = await startSupervisor();
		const run = store.readRun();
		expect(run.status).toBe("awaiting-human");
		const [pending] = pendingInputs(run);
		expect(pending).toMatchObject({ step: "build", live: false, session_id: "fake-session-1" });
		const recovered = store.readEvents().find((e) => e.type === "run.recovered");
		expect(recovered?.data).toMatchObject({
			waiting: true,
			sessions: [{ step: "build", action: "resume", session_id: "fake-session-1" }],
		});

		await second.client.request("POST", `/v1/runs/${res.run.id}/answer`, {
			request_id: pending.request.id,
			answer: "allow",
		});
		await waitForStatus(second.manager, res.run.id, "done");
		const resumed = fakeSdk.sessions[1];
		expect(resumed.options.resume).toBe("fake-session-1");
		const prompt = userText(resumed.received[0]);
		expect(prompt).toContain(`Answer to ${pending.request.id}`);
		expect(prompt).toMatch(/harness restarted/);
		// A second restart does not recover the run again
		await stopSupervisor(second);
		await startSupervisor();
		expect(store.readEvents().filter((e) => e.type === "run.recovered")).toHaveLength(1);
	});
});
