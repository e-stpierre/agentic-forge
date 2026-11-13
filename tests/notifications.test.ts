/**
 * Tests for notifications: the `notifications` config, message templates with
 * the answer commands, every channel through a mocked transport, the
 * supervisor's notifier (triggers, `notification.sent`, no duplicate after a
 * restart) and the `af_notify` MCP tool. In-process supervisor, fake runtime.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { validateArtifact } from "../src/contract/index.js";
import { createMcpServer } from "../src/mcp/index.js";
import {
	type NotificationTransport,
	Notifier,
	TOAST_BODY_ENV,
	TOAST_TITLE_ENV,
	buildNotification,
	channelsFor,
	deliver,
	desktopCommand,
	getNotificationsConfig,
	matchesTrigger,
	renderTemplate,
} from "../src/notifications/index.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager } from "../src/runs/manager.js";
import { RunRegistry } from "../src/runs/registry.js";
import { type RunEvent, RunStore } from "../src/runs/run-store.js";
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
const mcpClients: Client[] = [];

interface Sent {
	kind: "post" | "exec" | "comment";
	target: string;
	body: string;
	headers?: Record<string, string>;
	args?: string[];
	env?: Record<string, string>;
}

/** A transport that records every delivery; `failing` targets throw. */
function mockTransport(failing: string[] = []) {
	const sent: Sent[] = [];
	const transport: NotificationTransport = {
		async post(url, body, headers) {
			if (failing.some((f) => url.includes(f))) return 500;
			sent.push({ kind: "post", target: url, body, headers });
			return 200;
		},
		async exec(command, args, env) {
			if (failing.includes(command)) throw new Error("no notifier");
			sent.push({ kind: "exec", target: command, body: env[TOAST_BODY_ENV] ?? "", args, env });
		},
		async comment(repoName, number, body) {
			sent.push({ kind: "comment", target: `${repoName}#${number}`, body });
		},
	};
	return { sent, transport };
}

const NTFY = {
	channels: { ntfy: { enabled: true, topic: "af-test", server: "https://ntfy.example" } },
};

function configWith(notifications: Record<string, unknown>): Record<string, unknown> {
	return { ...getDefaultConfig(), notifications };
}

const ASK = `
name: ask
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: approve
    type: human-input
    message: "Ship the release?"
    context: The plan is ready.
    options: [{ id: ship, label: Ship it }, { id: wait, label: Not yet }]
    recommended: ship
`;

const ONE_STEP = `
name: one
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: build
    type: prompt
    prompt: "BUILD"
`;

function payload(contents: string, config: Record<string, unknown>): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		config,
		env: { PATH: process.env.PATH ?? "" },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "notify",
		terminal_output: "base",
	};
}

async function startSupervisor(transport: NotificationTransport) {
	const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
	const manager = new RunManager({ root: home.root, notifications: { transport, pollMs: 0 } });
	manager.attach(supervisor);
	const discovery = await supervisor.start();
	await manager.start();
	supervisors.push(supervisor);
	managers.push(manager);
	return { supervisor, manager, client: new SupervisorClient(discovery) };
}

async function waitForStatus(manager: RunManager, id: string, status: string): Promise<void> {
	for (let i = 0; i < 300; i++) {
		if (manager.registry.get(id)?.status === status) {
			await manager.idle();
			return;
		}
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Run ${id} never reached ${status} (${manager.registry.get(id)?.status})`);
}

function sentEvents(dir: string): RunEvent[] {
	return new RunStore(dir).readEvents().filter((e) => e.type === "notification.sent");
}

/** A run created by hand (any run type), with its dispatch snapshot and registry entry. */
async function makeRun(id: string, type: "overseer" | "workflow", config: Record<string, unknown>) {
	const dir = path.join(home.root, "runs", id);
	const store = new RunStore(dir);
	await store.create({
		type,
		workflow: "wf",
		repo,
		status: "running",
		started_at: new Date().toISOString(),
	});
	store.writeJson("dispatch.json", payload(ONE_STEP, config));
	const now = new Date().toISOString();
	await new RunRegistry(home.root).upsert({
		id,
		dir,
		repo,
		workflow: "wf",
		status: "running",
		worktree: false,
		priority: 0,
		created_at: now,
		updated_at: now,
	});
	return store;
}

beforeEach(() => {
	fakeRuntime.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-notify-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	await Promise.all(mcpClients.splice(0).map((c) => c.close()));
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("config", () => {
	it("defaults to needs_input, run.halted, run.failed and run.completed of overseer runs, every channel off", () => {
		const config = getNotificationsConfig(getDefaultConfig());
		expect(config.enabled).toBe(true);
		expect(config.triggers).toEqual([
			{ event: "needs_input", runType: null },
			{ event: "run.halted", runType: null },
			{ event: "run.failed", runType: null },
			{ event: "run.completed", runType: "overseer" },
		]);
		expect(Object.values(config.channels).every((c) => !c.enabled)).toBe(true);
		expect(config.channels.ntfy.settings.server).toBe("https://ntfy.sh");
		expect(channelsFor(config, "needs_input", "workflow")).toEqual([]);
	});

	it("matches triggers by type, prefix and run type, with per-channel overrides", () => {
		const config = getNotificationsConfig(
			configWith({
				triggers: ["run.*", { event: "merge.completed", run_type: "overseer" }],
				channels: {
					ntfy: { enabled: true, topic: "t" },
					slack: { enabled: true, webhook_url: "u", triggers: ["needs_input"] },
				},
			}),
		);
		expect(matchesTrigger(config.triggers, "run.failed", "workflow")).toBe(true);
		expect(matchesTrigger(config.triggers, "merge.completed", "workflow")).toBe(false);
		expect(matchesTrigger(config.triggers, "merge.completed", "overseer")).toBe(true);
		expect(channelsFor(config, "run.failed", "workflow")).toEqual(["ntfy"]);
		expect(channelsFor(config, "needs_input", "workflow")).toEqual(["slack"]);
		expect(channelsFor(config, null, null)).toEqual(["ntfy", "slack"]);
		expect(channelsFor({ ...config, enabled: false }, null, null)).toEqual([]);
	});
});

describe("messages", () => {
	const run = {
		id: "2026-11-11-x",
		workflow: "esp-go",
		repo: "app",
		status: "awaiting-human",
		type: "workflow",
		pr: null,
	};
	const ask: RunEvent = {
		seq: 4,
		at: "2026-11-11T10:00:00.000Z",
		run: run.id,
		type: "needs_input",
		data: {
			id: "q1",
			step: "approve",
			question: "Ship the release?",
			options: [
				{ id: "ship", label: "Ship it" },
				{ id: "wait", label: "Not yet" },
			],
			recommended: "ship",
			blocking: true,
		},
	};

	it("includes the run, the question and options, and the CLI and MCP answer commands", () => {
		const n = buildNotification(ask, run);
		expect(n.title).toBe("af: 2026-11-11-x needs input");
		expect(n.level).toBe("warning");
		expect(n.body).toContain("Run 2026-11-11-x (workflow esp-go, repo app), step approve.");
		expect(n.body).toContain("Question (q1): Ship the release?");
		expect(n.body).toContain("ship: Ship it (recommended)");
		expect(n.body).toContain("wait: Not yet");
		expect(n.body).toContain("Answer: af answer 2026-11-11-x q1 ship");
		expect(n.body).toContain(
			'MCP: af_answer(run: "2026-11-11-x", request_id: "q1", answer: "ship")',
		);
	});

	it("uses a configured template and tells how to inspect a failed run", () => {
		const custom = buildNotification(ask, run, {
			needs_input: { title: "{{ repo }}: {{question}}", body: "{{answer_cli}}{{unknown}}" },
		});
		expect(custom.title).toBe("app: Ship the release?");
		expect(custom.body).toBe("af answer 2026-11-11-x q1 ship");
		const failed = buildNotification(
			{
				seq: 9,
				at: ask.at,
				run: run.id,
				type: "run.failed",
				data: { status: "failed", error: "boom" },
			},
			run,
		);
		expect(failed.level).toBe("error");
		expect(failed.body).toContain("boom");
		expect(failed.body).toContain("af resume 2026-11-11-x");
		expect(renderTemplate("{{a}}-{{ b }}", { a: "1" })).toBe("1-");
	});

	it("uses placeholders without angle brackets in the default hints", () => {
		const halted = buildNotification(
			{ seq: 9, at: ask.at, run: run.id, type: "run.halted", data: { reason: "stop" } },
			run,
		);
		expect(halted.body).toContain("af retry-step 2026-11-11-x STEP");
		expect(halted.body).toContain('af_retry_step(run: "2026-11-11-x", step: STEP)');
		const open = buildNotification({ ...ask, data: { id: "q2", question: "Name?" } }, run);
		expect(open.body).toContain("Answer: af answer 2026-11-11-x q2 ANSWER");
		expect(`${halted.body}${open.body}`).not.toMatch(/[<>]/);
	});

	it("points an ended overseer run to its summary and a new overseer", () => {
		const overseer = { ...run, id: "2026-11-11-overseer", workflow: "overseer", type: "overseer" };
		for (const type of ["run.halted", "run.failed"]) {
			const n = buildNotification(
				{
					seq: 7,
					at: ask.at,
					run: overseer.id,
					type,
					data: { status: type.slice(4), type: "overseer", summary: "summary.md" },
				},
				overseer,
			);
			expect(n.title).toBe(`af: overseer 2026-11-11-overseer ${type.slice(4)}`);
			expect(n.body).toContain("Summary: af artifacts 2026-11-11-overseer --kind summary");
			expect(n.body).toContain("Start a new overseer: af overseer --new");
			expect(n.body).not.toContain("af resume");
			expect(n.body).not.toContain("af retry-step");
			expect(n.body).not.toContain("summary.md");
		}
		// A configured template still wins
		const custom = buildNotification(
			{ seq: 7, at: ask.at, run: overseer.id, type: "run.halted", data: {} },
			overseer,
			{ "run.halted": { body: "custom {{run}}" } },
		);
		expect(custom.body).toBe("custom 2026-11-11-overseer");
	});
});

describe("channels", () => {
	const n = {
		title: "af: r1 needs input",
		body: "Question: ok?",
		level: "warning" as const,
		run: "r1",
		trigger: "needs_input",
		url: "https://github.com/acme/app/pull/42",
	};

	it("delivers to ntfy, Slack, Discord, GitHub and the desktop through the transport", async () => {
		const config = getNotificationsConfig(
			configWith({
				channels: {
					desktop: { enabled: true },
					ntfy: { enabled: true, topic: "my topic", server: "https://ntfy.example/", token: "tk" },
					slack: { enabled: true, webhook_url: "https://hooks.slack.test/x" },
					discord: { enabled: true, webhook_url: "https://discord.test/api/webhooks/1" },
					github: { enabled: true },
				},
			}),
		);
		const { sent, transport } = mockTransport();
		const report = await deliver(
			n,
			["desktop", "ntfy", "slack", "discord", "github"],
			config,
			transport,
		);
		expect(report).toEqual({ sent: ["desktop", "ntfy", "slack", "discord", "github"], errors: [] });

		const ntfy = sent.find((s) => s.target.startsWith("https://ntfy.example"));
		expect(ntfy?.target).toBe("https://ntfy.example/my%20topic");
		expect(ntfy?.body).toBe("Question: ok?");
		expect(ntfy?.headers).toMatchObject({
			Title: "af: r1 needs input",
			Priority: "high",
			Click: n.url,
			Authorization: "Bearer tk",
		});
		const slack = sent.find((s) => s.target.includes("slack"));
		expect(JSON.parse(slack?.body ?? "")).toEqual({ text: "*af: r1 needs input*\nQuestion: ok?" });
		const discord = sent.find((s) => s.target.includes("discord"));
		expect(JSON.parse(discord?.body ?? "")).toMatchObject({
			content: "**af: r1 needs input**\nQuestion: ok?",
			allowed_mentions: { parse: [] },
		});
		const comment = sent.find((s) => s.kind === "comment");
		expect(comment?.target).toBe("acme/app#42");
		expect(comment?.body).toContain("Question: ok?");
		const desktop = sent.find((s) => s.kind === "exec");
		expect(desktop?.target).toBe(desktopCommand().command);
		expect(desktop?.env).toEqual({ [TOAST_TITLE_ENV]: n.title, [TOAST_BODY_ENV]: n.body });
	});

	it("escapes Slack control characters so text cannot mention or get mangled", async () => {
		const config = getNotificationsConfig(
			configWith({
				channels: { slack: { enabled: true, webhook_url: "https://hooks.slack.test/x" } },
			}),
		);
		const { sent, transport } = mockTransport();
		const report = await deliver(
			{
				...n,
				title: "af: <r1> & co",
				body: "Context: <!channel> <@U123> look\nRetry: af retry-step r1 <step>",
			},
			["slack"],
			config,
			transport,
		);
		expect(report.sent).toEqual(["slack"]);
		const text = JSON.parse(sent[0].body).text as string;
		expect(text).toBe(
			"*af: &lt;r1&gt; &amp; co*\nContext: &lt;!channel&gt; &lt;@U123&gt; look\nRetry: af retry-step r1 &lt;step&gt;",
		);
		expect(text).not.toMatch(/[<>]/);
	});

	it("keeps the toast text off the command line on every platform", () => {
		const win = desktopCommand("win32");
		expect(win.command).toBe("powershell.exe");
		const script = Buffer.from(win.args.at(-1) ?? "", "base64").toString("utf16le");
		expect(script).toContain(`$env:${TOAST_TITLE_ENV}`);
		expect(script).toContain("ToastNotificationManager");
		expect(desktopCommand("darwin").args[1]).toContain(`system attribute "${TOAST_BODY_ENV}"`);
		expect(desktopCommand("linux").command).toBe("notify-send");
	});

	it("reports a failing or misconfigured channel without stopping the others", async () => {
		const config = getNotificationsConfig(
			configWith({
				channels: {
					desktop: { enabled: true },
					ntfy: { enabled: true },
					slack: { enabled: true, webhook_url: "https://hooks.slack.test/fail" },
					discord: { enabled: true, webhook_url: "https://discord.test/ok" },
				},
			}),
		);
		const { transport } = mockTransport(["fail", desktopCommand().command]);
		const report = await deliver(
			{ ...n, url: null },
			["desktop", "ntfy", "slack", "discord", "github"],
			config,
			transport,
		);
		expect(report.sent).toEqual(["discord"]);
		expect(report.errors).toEqual([
			{ channel: "desktop", error: "no notifier" },
			{ channel: "ntfy", error: "notifications.channels.ntfy.topic is not set" },
			{ channel: "slack", error: "HTTP 500" },
			{ channel: "github", error: "the run has no pull request" },
		]);
	});
});

describe("notifier", () => {
	it("notifies needs_input with the answer commands and records notification.sent once", async () => {
		const { sent, transport } = mockTransport();
		const { manager, client } = await startSupervisor(transport);
		const res = await client.request<{ run: { id: string }; dir: string }>(
			"POST",
			"/v1/runs",
			payload(ASK, configWith(NTFY)),
		);
		await waitForStatus(manager, res.run.id, "awaiting-human");
		await manager.notifier.poll();

		expect(sent).toHaveLength(1);
		expect(sent[0].headers?.Title).toBe(`af: ${res.run.id} needs input`);
		expect(sent[0].body).toContain("Ship the release?");
		expect(sent[0].body).toMatch(new RegExp(`af answer ${res.run.id} \\S+ ship`));
		expect(sent[0].body).toContain("af_answer(");

		const events = sentEvents(res.dir);
		expect(events).toHaveLength(1);
		const ask = new RunStore(res.dir).readEvents().find((e) => e.type === "needs_input");
		expect(events[0].data).toMatchObject({
			event: "needs_input",
			event_seq: ask?.seq,
			trigger: "needs_input",
			channels: ["ntfy"],
		});
		expect(validateArtifact("event", events[0]).valid).toBe(true);

		await manager.notifier.poll();
		expect(sent).toHaveLength(1);
	});

	it("notifies a failed run but not a completed workflow run (only overseer runs)", async () => {
		fakeRuntime.on("BUILD", "fail");
		const { sent, transport } = mockTransport();
		const { manager, client } = await startSupervisor(transport);
		const failed = await client.request<{ run: { id: string } }>(
			"POST",
			"/v1/runs",
			payload(ONE_STEP, configWith(NTFY)),
		);
		await waitForStatus(manager, failed.run.id, "failed");
		fakeRuntime.reset();
		const done = await client.request<{ run: { id: string } }>(
			"POST",
			"/v1/runs",
			payload(ONE_STEP, configWith(NTFY)),
		);
		await waitForStatus(manager, done.run.id, "done");
		await manager.notifier.poll();
		expect(sent.map((s) => s.headers?.Title)).toEqual([`af: ${failed.run.id} failed`]);
	});

	it("notifies the completion of an overseer run, and a restarted notifier sends nothing twice", async () => {
		const { sent, transport } = mockTransport();
		const registry = new RunRegistry(home.root);
		const options = {
			root: home.root,
			registry,
			globalConfig: getDefaultConfig,
			transport,
			pollMs: 0,
		};
		const first = new Notifier(options);
		first.start();
		const overseer = await makeRun("2026-11-11-overseer", "overseer", configWith(NTFY));
		const worker = await makeRun("2026-11-11-worker", "workflow", configWith(NTFY));
		await overseer.appendEvent("run.completed", { status: "done" });
		await worker.appendEvent("run.completed", { status: "done" });
		await first.poll();
		expect(sent.map((s) => s.headers?.Title)).toEqual(["af: 2026-11-11-overseer completed"]);

		// Restart from the saved positions: nothing new
		const second = new Notifier(options);
		second.start();
		await second.poll();
		expect(sent).toHaveLength(1);

		// Crash before the positions were saved: the saved positions are still before
		// run.completed, so the event replays and its notification.sent dedupes it
		const completed = overseer.readEvents().find((e) => e.type === "run.completed");
		const workerCompleted = worker.readEvents().find((e) => e.type === "run.completed");
		expect(completed).toBeDefined();
		writeFileSync(
			path.join(home.root, "notifications", "positions.json"),
			JSON.stringify({
				[overseer.id]: (completed?.seq ?? 1) - 1,
				[worker.id]: (workerCompleted?.seq ?? 1) - 1,
			}),
		);
		expect(sentEvents(overseer.dir)[0].data).toMatchObject({ event_seq: completed?.seq });
		const third = new Notifier(options);
		third.start();
		await third.poll();
		expect(sent).toHaveLength(1);
		expect(sentEvents(overseer.dir)).toHaveLength(1);
	});
});

describe("af_notify", () => {
	async function connectMcp(client: SupervisorClient): Promise<Client> {
		const server = createMcpServer({
			getClient: async () => client,
			registryRoot: home.root,
			cwd: repo,
			version: "1.0.0",
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const mcp = new Client({ name: "notify-test", version: "1.0.0" });
		await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
		mcpClients.push(mcp);
		return mcp;
	}

	async function call(mcp: Client, args: Record<string, unknown>) {
		const result = await mcp.callTool({ name: "af_notify", arguments: args });
		const text = (result.content as { text: string }[]).map((c) => c.text).join("");
		return {
			isError: result.isError === true,
			text,
			json: result.isError ? null : JSON.parse(text),
		};
	}

	it("sends to the run's channels and emits notification.sent", async () => {
		const { sent, transport } = mockTransport();
		const { manager, client } = await startSupervisor(transport);
		const res = await client.request<{ run: { id: string }; dir: string }>(
			"POST",
			"/v1/runs",
			payload(ONE_STEP, configWith(NTFY)),
		);
		await waitForStatus(manager, res.run.id, "done");
		const mcp = await connectMcp(client);

		const out = await call(mcp, {
			text: "Epic done: 4 PRs merged",
			level: "warning",
			run: res.run.id,
		});
		expect(out.json).toMatchObject({ sent: ["ntfy"], errors: [] });
		expect(sent[0].body).toBe("Epic done: 4 PRs merged");
		expect(sent[0].headers).toMatchObject({ Title: `af: ${res.run.id}`, Priority: "high" });
		const event = sentEvents(res.dir).find((e) => e.seq === out.json.event);
		expect(event?.data).toMatchObject({
			event: "af_notify",
			trigger: "af_notify",
			level: "warning",
			channels: ["ntfy"],
		});

		const bad = await call(mcp, { text: "x", level: "loud" });
		expect(bad.isError).toBe(true);
		const unknown = await call(mcp, { text: "x", run: "nope" });
		expect(unknown.isError).toBe(true);
	});

	it("uses the global config without a run, and says when no channel is enabled", async () => {
		const { sent, transport } = mockTransport();
		const { client } = await startSupervisor(transport);
		const mcp = await connectMcp(client);
		const none = await call(mcp, { text: "hello" });
		expect(none.json).toMatchObject({ sent: [], event: null });
		expect(none.json.hint).toMatch(/No notification channel is enabled/);

		writeFileSync(path.join(home.root, "config.json"), JSON.stringify({ notifications: NTFY }));
		const out = await call(mcp, { text: "hello", title: "Overseer" });
		expect(out.json).toEqual({ sent: ["ntfy"], errors: [], event: null });
		expect(sent[0].headers?.Title).toBe("Overseer");
	});
});
