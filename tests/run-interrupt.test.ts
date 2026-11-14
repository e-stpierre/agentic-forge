/**
 * Integration tests for interrupt and resume on the `cli` driver and for the
 * permission allowlists (ORC-021): `send --mode now` and `af answer` resume
 * the killed or stopped session (`claude --resume`, `codex exec resume`),
 * a failed resume restarts the step cold, the worktree is safety-committed
 * before a restart, and `runtimes.<id>` drives the allowlist and the bypass.
 * In-process supervisor; the real process runner spawns fake `claude` and
 * `codex` processes (node scripts) with the adapters' real arguments.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CLAUDE_ALLOW, getDefaultConfig, getRuntimePermissions } from "../src/config.js";
import { validateContractFile } from "../src/contract/index.js";
import { dispatchRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager } from "../src/runs/manager.js";
import { RunStore } from "../src/runs/run-store.js";
import { getAdapter } from "../src/runtimes/index.js";
import { type StepContext, permissionOptions } from "../src/steps/base.js";
import { stoppedSession } from "../src/steps/prompt-step.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
import type { StepDefinition, WorkflowProgress } from "../src/types.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("../src/runtimes/utils.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/runtimes/utils.js")>();
	return { ...original, getExecutable: (name: string) => name };
});

/** Runs the adapters' real arguments through a fake process (`FAKE_AGENT_SCRIPT`). */
function fakeProcess<T extends { buildCommand(o: unknown): unknown }>(Base: new () => T) {
	return class extends (Base as unknown as new () => {
		buildCommand(o: unknown): { args: string[]; env?: Record<string, string> };
	}) {
		buildCommand(options: unknown) {
			const cmd = super.buildCommand(options);
			return {
				...cmd,
				executable: process.execPath,
				args: [process.env.FAKE_AGENT_SCRIPT ?? "", ...cmd.args],
				env: { ...(cmd.env ?? {}), FAKE_AGENT_LOG: process.env.FAKE_AGENT_LOG ?? "" },
			};
		}
	};
}

vi.mock("../src/runtimes/claude.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/runtimes/claude.js")>();
	return { ...original, ClaudeAdapter: fakeProcess(original.ClaudeAdapter) };
});

vi.mock("../src/runtimes/codex.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/runtimes/codex.js")>();
	return { ...original, CodexAdapter: fakeProcess(original.CodexAdapter) };
});

const createWorktreeMock = vi.fn();
const safetyCommitMock = vi.fn();
vi.mock("../src/git/worktree.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/git/worktree.js")>();
	return {
		...original,
		copyLocalDirs: vi.fn(),
		createWorktree: (...args: unknown[]) => createWorktreeMock(...args),
		findExistingWorktree: vi.fn().mockReturnValue(null),
		removeWorktree: vi.fn(),
		safetyCommit: (...args: unknown[]) => safetyCommitMock(...args),
	};
});

/**
 * Fake `claude -p` and `codex exec`: logs its arguments and input, prints a
 * session id (the resumed one, else `cli-1` / `th-1`), hangs on a fresh
 * `HANG` prompt until killed, fails a resume of `gone`, prints an
 * awaiting-human block on a fresh `ASK` prompt, and else a done block.
 */
const FAKE_AGENT = `
const fs = require("fs");
const args = process.argv.slice(2);
const codex = args[0] === "exec";
const r = args.indexOf(codex ? "resume" : "--resume");
const resume = r >= 0 ? (codex ? args[args.length - 2] : args[r + 1]) : null;
let input = "";
const run = () => {
	if (codex) input = args[args.length - 1];
	fs.appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify({ args, input, resume }) + "\\n");
	const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
	const sid = resume ?? (codex ? "th-1" : "cli-1");
	if (resume === "gone") {
		process.stderr.write("no rollout found for thread id gone");
		process.exit(1);
	}
	if (codex) out({ type: "thread.started", thread_id: sid });
	else out({ type: "system", subtype: "init", session_id: sid, model: "fake" });
	if (!resume && input.includes("HANG")) return setInterval(() => {}, 1000);
	const block = !resume && input.includes("ASK")
		? { status: "awaiting-human", summary: "Need a choice", needs_input: { id: "q1", question: "Which store?", options: [{ id: "a", label: "Redis" }, { id: "b", label: "DB" }], recommended: "a", context: "", blocking: true } }
		: { status: "done", summary: "ok " + (resume ?? "fresh") };
	const text = "Work log\\n" + JSON.stringify(block);
	if (codex) {
		out({ type: "item.completed", item: { id: "i1", type: "agent_message", text } });
		out({ type: "turn.completed", usage: {} });
	} else {
		out({ type: "result", subtype: "success", is_error: false, session_id: sid, result: text });
	}
};
if (codex) run();
else {
	process.stdin.on("data", (d) => (input += d));
	process.stdin.on("end", run);
}
`;

const home = useTempGlobalRoot();
let repo: string;
let scratch: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];

function workflow(prompt: string, extra = ""): string {
	return `
name: interrupt
version: "1.0"
settings:
  max-retry: 0${extra}
steps:
  - name: build
    type: prompt
    prompt: "${prompt}"
`;
}

function cliConfig(): Record<string, unknown> {
	const config = getDefaultConfig();
	const runtimes = config.runtimes as Record<string, Record<string, unknown>>;
	runtimes.claude.driver = "cli";
	runtimes.codex.driver = "cli";
	return config;
}

function payload(contents: string, config = cliConfig()): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		config,
		env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "interrupt",
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

interface Invocation {
	args: string[];
	input: string;
	resume: string | null;
}

function invocations(): Invocation[] {
	const log = process.env.FAKE_AGENT_LOG ?? "";
	try {
		return readFileSync(log, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as Invocation);
	} catch {
		return [];
	}
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 500; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error(`Timed out waiting for ${what}`);
}

async function waitForStatus(manager: RunManager, id: string, status: string): Promise<void> {
	await waitFor(() => manager.registry.get(id)?.status === status, `status ${status}`);
	await manager.idle();
}

function expectValidRunDir(dir: string): void {
	for (const file of ["run.json", "events.jsonl", "decisions.jsonl"]) {
		try {
			expect(validateContractFile(path.join(dir, file)).errors).toEqual([]);
		} catch (e) {
			if (!String(e).includes("ENOENT")) throw e;
		}
	}
}

beforeEach(() => {
	repo = mkdtempSync(path.join(tmpdir(), "af-int-repo-"));
	scratch = mkdtempSync(path.join(tmpdir(), "af-int-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
	const script = path.join(scratch, "fake-agent.cjs");
	writeFileSync(script, FAKE_AGENT, "utf-8");
	process.env.FAKE_AGENT_SCRIPT = script;
	process.env.FAKE_AGENT_LOG = path.join(scratch, "calls.jsonl");
	createWorktreeMock.mockReset();
	safetyCommitMock.mockReset();
	safetyCommitMock.mockReturnValue({ committed: true, failed: false });
});

afterEach(async () => {
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	Reflect.deleteProperty(process.env, "FAKE_AGENT_SCRIPT");
	Reflect.deleteProperty(process.env, "FAKE_AGENT_LOG");
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("send --mode now on the cli driver", () => {
	it("kills claude -p, safety-commits the worktree and resumes the session with the message", async () => {
		const wtPath = mkdtempSync(path.join(tmpdir(), "af-int-wt-"));
		writeFileSync(path.join(wtPath, ".git"), "gitdir: elsewhere\n");
		createWorktreeMock.mockReturnValue({ path: wtPath, branch: "agentic/x", baseBranch: "main" });
		try {
			const { manager, client } = await startSupervisor();
			const contents = workflow(
				"BUILD HANG",
				"\n  worktree:\n    enabled: true\n    cleanup: manual",
			);
			const res = await dispatchRun(client, payload(contents));
			const store = new RunStore(res.dir);
			// The session id is known (session.json) before the message is sent
			await waitFor(
				() => store.readEvents().some((e) => e.type === "step.started"),
				"step.started",
			);
			await waitFor(() => invocations().length === 1, "the first process");
			await waitFor(() => {
				try {
					return (
						readFileSync(path.join(res.dir, "steps", "01-build", "session.json"), "utf-8").length >
						0
					);
				} catch {
					return false;
				}
			}, "session.json");
			await client.request("POST", `/v1/runs/${res.run.id}/messages`, {
				text: "Stop, use pnpm.",
				mode: "now",
			});
			await waitForStatus(manager, res.run.id, "done");

			const calls = invocations();
			expect(calls).toHaveLength(2);
			expect(calls[0].resume).toBeNull();
			expect(calls[1].args).toContain("--resume");
			expect(calls[1].resume).toBe("cli-1");
			expect(calls[1].input).toContain("Stop, use pnpm.");
			expect(calls[1].input).toContain("Continue the step with the operator messages above");
			expect(calls[1].input).not.toContain("BUILD HANG");
			expect(safetyCommitMock).toHaveBeenCalledWith(
				wtPath,
				undefined,
				expect.stringContaining("before it restarts"),
			);
			expect(store.readEvents().find((e) => e.type === "step.retried")?.data).toMatchObject({
				step: "build",
				reason: "message",
			});
			expectValidRunDir(res.dir);
		} finally {
			rmSync(wtPath, { recursive: true, force: true });
		}
	});

	it("codex: falls back to a cold restart when codex exec resume fails, and logs the choice", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload(workflow("BUILD HANG", "\n  runtime: codex")));
		const store = new RunStore(res.dir);
		await waitFor(() => invocations().length === 1, "the first process");
		await waitFor(() => {
			try {
				return readFileSync(
					path.join(res.dir, "steps", "01-build", "session.json"),
					"utf-8",
				).includes("th-1");
			} catch {
				return false;
			}
		}, "session.json");
		// The thread is gone: the resume fails, then the step restarts with its prompt
		writeFileSync(
			path.join(res.dir, "steps", "01-build", "session.json"),
			JSON.stringify({
				session_id: "gone",
				runtime: "codex",
				driver: "cli",
				model: null,
				at: new Date().toISOString(),
			}),
		);
		await client.request("POST", `/v1/runs/${res.run.id}/messages`, {
			text: "Use pnpm.",
			mode: "now",
		});
		await waitFor(() => invocations().length >= 2, "the resume");
		// The cold restart prompt contains HANG: release it with a cancel once it runs
		await waitFor(() => invocations().length >= 3, "the cold restart");
		const calls = invocations();
		expect(calls[1].args.slice(0, 1)).toEqual(["exec"]);
		expect(calls[1].args).toContain("resume");
		expect(calls[1].resume).toBe("gone");
		expect(calls[1].input).toContain("Use pnpm.");
		expect(calls[2].args).not.toContain("resume");
		expect(calls[2].input).toContain("BUILD HANG");
		expect(calls[2].input).toContain("Use pnpm.");
		await waitFor(
			() =>
				store
					.readEvents()
					.some((e) => e.type === "step.retried" && e.data?.reason === "resume-failed"),
			"the resume-failed event",
		);
		expect(
			store
				.readEvents()
				.find((e) => e.type === "step.retried" && e.data?.reason === "resume-failed")?.data,
		).toMatchObject({ step: "build", session_id: "gone" });
		await client.request("POST", `/v1/runs/${res.run.id}/cancel`);
		await waitForStatus(manager, res.run.id, "canceled");
	});
});

describe("af answer on the cli driver", () => {
	it("resumes the session that stopped awaiting-human with the answer", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(client, payload(workflow("BUILD ASK")));
		await waitForStatus(manager, res.run.id, "awaiting-human");
		await client.request("POST", `/v1/runs/${res.run.id}/answer`, {
			request_id: "q1",
			answer: "b",
		});
		await waitForStatus(manager, res.run.id, "done");
		const calls = invocations();
		expect(calls).toHaveLength(2);
		expect(calls[1].resume).toBe("cli-1");
		expect(calls[1].input).toContain("Continue the step with the operator messages above");
		expectValidRunDir(res.dir);
	});
});

describe("permission allowlists", () => {
	it("passes the default allowlist plus required-tools as --settings, with no bypass flag", async () => {
		const { manager, client } = await startSupervisor();
		const res = await dispatchRun(
			client,
			payload(workflow("BUILD", "\n  required-tools:\n    - Bash(git *)")),
		);
		await waitForStatus(manager, res.run.id, "done");
		const args = invocations()[0].args;
		expect(args).not.toContain("--dangerously-skip-permissions");
		const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
		expect(settings.permissions.allow).toEqual([...DEFAULT_CLAUDE_ALLOW, "Bash(git *)"]);
	});

	it("runtimes.claude.permissions: bypass restores the bypass flag", async () => {
		const { manager, client } = await startSupervisor();
		const config = cliConfig();
		(config.runtimes as Record<string, Record<string, unknown>>).claude.permissions = "bypass";
		const res = await dispatchRun(client, payload(workflow("BUILD"), config));
		await waitForStatus(manager, res.run.id, "done");
		expect(invocations()[0].args).toContain("--dangerously-skip-permissions");
	});

	it("codex: no bypass by default, runtimes.codex.permissions: bypass adds it", async () => {
		const { manager, client } = await startSupervisor();
		const first = await dispatchRun(client, payload(workflow("BUILD", "\n  runtime: codex")));
		await waitForStatus(manager, first.run.id, "done");
		expect(invocations()[0].args).toContain("workspace-write");
		expect(invocations()[0].args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
		const config = cliConfig();
		(config.runtimes as Record<string, Record<string, unknown>>).codex.permissions = "bypass";
		const second = await dispatchRun(
			client,
			payload(workflow("BUILD", "\n  runtime: codex"), config),
		);
		await waitForStatus(manager, second.run.id, "done");
		expect(invocations()[1].args).toContain("--dangerously-bypass-approvals-and-sandbox");
	});
});

describe("permissionOptions and stoppedSession", () => {
	const step = { name: "build", bypassPermissions: null } as unknown as StepDefinition;
	function context(config: Record<string, unknown>, requiredTools: string[] = []): StepContext {
		return {
			config,
			runtimeAdapter: getAdapter("claude"),
			workflowSettings: { requiredTools, bypassPermissions: false },
		} as unknown as StepContext;
	}

	it("reads runtimes.<id>.permissions and allow", () => {
		expect(getRuntimePermissions({}, "claude")).toEqual({
			mode: "allowlist",
			allow: [...DEFAULT_CLAUDE_ALLOW],
		});
		expect(getRuntimePermissions({}, "codex")).toEqual({ mode: "allowlist", allow: [] });
		expect(
			getRuntimePermissions(
				{ runtimes: { claude: { permissions: "bypass", allow: ["Read"] } } },
				"claude",
			),
		).toEqual({ mode: "bypass", allow: ["Read"] });
		expect(
			getRuntimePermissions({ runtimes: { claude: { permissions: "x" } } }, "claude").mode,
		).toBe("allowlist");
	});

	it("warns on every step that bypasses, never otherwise", () => {
		const warnings: string[] = [];
		const logger = { warning: (_s: string, m: string) => warnings.push(m) };
		const console = { warning: () => {} };
		const allow = permissionOptions(context(getDefaultConfig(), ["Bash"]), step, logger, console);
		expect(allow).toEqual({
			skipPermissions: false,
			allowedTools: [...DEFAULT_CLAUDE_ALLOW, "Bash"],
		});
		expect(warnings).toEqual([]);
		const bypass = permissionOptions(
			context({ runtimes: { claude: { permissions: "bypass" } } }),
			step,
			logger,
			console,
		);
		expect(bypass.skipPermissions).toBe(true);
		const flagged = permissionOptions(
			context(getDefaultConfig()),
			{ ...step, bypassPermissions: true } as StepDefinition,
			logger,
			console,
		);
		expect(flagged.skipPermissions).toBe(true);
		expect(warnings).toEqual([
			"Permission checks are bypassed for this step on claude (runtimes.claude.permissions: bypass)",
			"Permission checks are bypassed for this step on claude (bypass-permissions: true)",
		]);
	});

	it("resumes a killed attempt only with operator messages and a session from that attempt", () => {
		const progress = {
			completedSteps: [
				{ name: "build", status: "interrupted", startedAt: "2026-11-10T10:00:00.000Z" },
			],
		} as unknown as WorkflowProgress;
		const current = { sessionId: "s-2", driver: "cli", at: "2026-11-10T10:00:01.000Z" };
		const stale = { sessionId: "s-1", driver: "cli", at: "2026-11-10T09:00:00.000Z" };
		expect(stoppedSession(progress, "build", true, current)?.id).toBe("s-2");
		expect(stoppedSession(progress, "build", false, current)).toBeNull();
		expect(stoppedSession(progress, "build", true, stale)).toBeNull();
		expect(stoppedSession(progress, "build", true, null)).toBeNull();
	});
});
