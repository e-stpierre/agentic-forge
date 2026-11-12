/**
 * Tests for the prompt step `agent:` field (ORC-023): the agent file resolves
 * relative to the workflow file, then to the repo root, with no bundled
 * fallback. In-process supervisor, fake runtime.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { dispatchRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager } from "../src/runs/manager.js";
import type { StepContext } from "../src/steps/base.js";
import { resolveAgentPath, withAgent } from "../src/steps/prompt-step.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
import type { StepDefinition } from "../src/types.js";
import { fakeRuntime } from "./helpers/fake-runtime.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const { fakeRuntime: fake } = await import("./helpers/fake-runtime.js");
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return { ...original, runRuntime: fake.run };
});

const home = useTempGlobalRoot();
let repo: string;
let workflowDir: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];

function write(file: string, text: string): string {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
	return file;
}

function context(dir: string | null): StepContext {
	return { repoRoot: repo, workflowDir: dir } as StepContext;
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-agent-path-"));
	workflowDir = path.join(repo, "agentic", "workflows");
	mkdirSync(workflowDir, { recursive: true });
});

afterEach(async () => {
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("resolveAgentPath", () => {
	it("prefers the workflow directory, then the repo root", () => {
		const repoAgent = write(path.join(repo, "agents", "helper.md"), "repo");
		expect(resolveAgentPath("agents/helper.md", context(workflowDir))).toBe(repoAgent);
		const local = write(path.join(workflowDir, "agents", "helper.md"), "local");
		expect(resolveAgentPath("agents/helper.md", context(workflowDir))).toBe(local);
		expect(resolveAgentPath("agents/helper.md", context(null))).toBe(repoAgent);
	});

	it("resolves ../ paths and absolute paths, and returns null when missing", () => {
		const shared = write(path.join(repo, "agentic", "agents", "shared.md"), "shared");
		expect(resolveAgentPath("../agents/shared.md", context(workflowDir))).toBe(shared);
		expect(resolveAgentPath(shared, context(null))).toBe(shared);
		expect(resolveAgentPath("agents/missing.md", context(workflowDir))).toBeNull();
	});

	it("prepends the agent file and ignores a missing one", () => {
		write(path.join(workflowDir, "agents", "helper.md"), "You are a helper.");
		const step = { agent: "agents/helper.md" } as StepDefinition;
		expect(withAgent(step, context(workflowDir), "Do it")).toBe("You are a helper.\n\nDo it");
		const missing = { agent: "agents/none.md" } as StepDefinition;
		expect(withAgent(missing, context(workflowDir), "Do it")).toBe("Do it");
	});
});

describe("agent: in a dispatched workflow", () => {
	it("loads the agent file next to the workflow", async () => {
		write(path.join(workflowDir, "agents", "helper.md"), "AGENT-INSTRUCTIONS");
		const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
		const manager = new RunManager({ root: home.root });
		manager.attach(supervisor);
		const discovery = await supervisor.start();
		await manager.start();
		supervisors.push(supervisor);
		managers.push(manager);
		const client = new SupervisorClient(discovery);

		const contents = [
			"name: wf",
			"steps:",
			"  - name: work",
			"    type: prompt",
			"    agent: agents/helper.md",
			"    prompt: STEP-PROMPT",
		].join("\n");
		const payload: DispatchPayload = {
			repo_root: repo,
			workflow: { path: path.join(workflowDir, "wf.yaml"), contents },
			config: getDefaultConfig(),
			env: { PATH: process.env.PATH ?? "" },
			variables: {},
			runtime: null,
			from_step: null,
			slug: "agent",
			terminal_output: "base",
		};
		await dispatchRun(client, payload);
		await manager.idle();

		const call = fakeRuntime.calls.find((c) => c.prompt.includes("STEP-PROMPT"));
		expect(call?.prompt.startsWith("AGENT-INSTRUCTIONS")).toBe(true);
	});
});
