/**
 * Tests for af_ask (asking from inside a running step): the MCP tool over an
 * in-memory transport, called by a fake Claude session (session driver)
 * against an in-process supervisor. A blocking call returns the answer; a
 * call whose wait runs out returns `pending` and the answer is the session's
 * next turn; the overseer answer policy and the needs_input timeout use the
 * request's kind and risk.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { validateContractFile } from "../src/contract/index.js";
import { createMcpServer } from "../src/mcp/index.js";
import { dispatchRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager, pendingInputs } from "../src/runs/manager.js";
import type { OverseerOpenResult } from "../src/runs/overseer.js";
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
const mcpClients: Client[] = [];

const ONE_STEP = `
name: one-step
version: "1.0"
settings:
  max-retry: 0
steps:
  - name: build
    type: prompt
    prompt: "BUILD {{ task }}"
variables:
  - name: task
    type: string
    required: false
    default: "x"
`;

function payload(
	extra: Partial<DispatchPayload> = {},
	config = getDefaultConfig(),
): DispatchPayload {
	return {
		repo_root: repo,
		workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents: ONE_STEP },
		config,
		env: { PATH: process.env.PATH ?? "" },
		variables: {},
		runtime: null,
		from_step: null,
		slug: "ask",
		terminal_output: "base",
		...extra,
	};
}

async function startSupervisor() {
	const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
	const manager = new RunManager({ root: home.root, notifications: { pollMs: 0 } });
	manager.attach(supervisor);
	const discovery = await supervisor.start();
	await manager.start();
	supervisors.push(supervisor);
	managers.push(manager);
	return { manager, client: new SupervisorClient(discovery) };
}

/** An MCP client of the af server, with the environment the agent's MCP server would get. */
async function connect(client: SupervisorClient, env: NodeJS.ProcessEnv = {}): Promise<Client> {
	const server = createMcpServer({
		getClient: async () => client,
		registryRoot: home.root,
		cwd: repo,
		version: "1.0.0",
		env,
	});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const mcp = new Client({ name: "ask-test", version: "1.0.0" });
	await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
	mcpClients.push(mcp);
	return mcp;
}

// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of a tool result
async function call(mcp: Client, name: string, args: Record<string, unknown>): Promise<any> {
	const result = await mcp.callTool({ name, arguments: args });
	const text = (result.content as Array<{ text: string }>).map((c) => c.text).join("\n");
	if (result.isError) return { isError: true, text };
	return JSON.parse(text);
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
	for (let i = 0; i < 500; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

async function waitForStatus(manager: RunManager, id: string, status: string): Promise<void> {
	await waitFor(() => manager.registry.get(id)?.status === status, `status ${status}`);
	if (status !== "awaiting-human") await manager.idle();
}

function eventsOf(store: RunStore, type: string) {
	return store.readEvents().filter((e) => e.type === type);
}

const ASK = {
	question: "Keep the legacy endpoint?",
	options: ["Keep it", { id: "drop", label: "Remove it", description: "Breaks two clients" }],
	recommended: "Keep it",
	context: "Two clients still call it.",
};

/**
 * Session script: asks with af_ask through the af MCP server (environment
 * from the session, as the agent's MCP server inherits it), reports the
 * tool result, and ends its turn; later turns echo `done`.
 */
function askingScript(
	client: SupervisorClient,
	args: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: parsed JSON of a tool result
	results: any[],
) {
	return async (s: FakeSdkSession, first: Parameters<FakeSdkSession["result"]>[1][number]) => {
		s.init();
		const mcp = await connect(client, s.options.env as NodeJS.ProcessEnv);
		const result = await call(mcp, "af_ask", args);
		results.push(result);
		s.result(
			result.status === "answered"
				? resultBlock("done", `answer ${result.option ?? result.answer}`)
				: `Waiting for the answer to ${result.request_id}.`,
			[first],
		);
		let message = await s.nextUser();
		while (message) {
			s.result(resultBlock("done", `next turn: ${userText(message)}`), [message]);
			message = await s.nextUser();
		}
	};
}

beforeEach(() => {
	fakeSdk.reset();
	repo = mkdtempSync(path.join(tmpdir(), "af-ask-repo-"));
	mkdirSync(path.join(repo, "agentic", "workflows"), { recursive: true });
});

afterEach(async () => {
	await Promise.all(mcpClients.splice(0).map((c) => c.close()));
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("af_ask", () => {
	it("blocks until answered and returns the answer to the waiting call", async () => {
		const { manager, client } = await startSupervisor();
		const results: unknown[] = [];
		fakeSdk.on("BUILD", askingScript(client, { ...ASK, wait_seconds: 20 }, results));
		const res = await dispatchRun(client, payload());
		const store = new RunStore(res.dir);
		await waitFor(() => eventsOf(store, "needs_input").length === 1, "needs_input");
		await waitForStatus(manager, res.run.id, "awaiting-human");

		const asked = eventsOf(store, "needs_input")[0].data ?? {};
		expect(asked).toMatchObject({
			question: "Keep the legacy endpoint?",
			options: [
				{ id: "a", label: "Keep it" },
				{ id: "drop", label: "Remove it", description: "Breaks two clients" },
			],
			recommended: "a",
			kind: "question",
			risk: null,
			blocking: true,
			step: "build",
			via: "af_ask",
			live: true,
		});
		const requestId = String(asked.id);
		expect(requestId).toMatch(/^ask-[0-9a-f]{8}$/);
		expect(pendingInputs(store.readRun())[0]).toMatchObject({ step: "build", ask: true });

		const user = await connect(client);
		const answered = await call(user, "af_answer", {
			run: res.run.id,
			request_id: requestId,
			answer: "drop",
			from: "user",
		});
		expect(answered).toMatchObject({ request: requestId, status: "running" });
		expect(answered.message).toBeTruthy();
		await waitForStatus(manager, res.run.id, "done");

		expect(results[0]).toMatchObject({
			status: "answered",
			request_id: requestId,
			answer: "drop",
			option: "drop",
			from: "user",
		});
		expect(eventsOf(store, "input.answered")[0].data).toMatchObject({
			id: requestId,
			message: answered.message,
			via: "af_ask",
		});
		// The answer's operator message is queued, and consumed by the call that returned it
		expect(eventsOf(store, "message.queued")).toHaveLength(1);
		expect(eventsOf(store, "message.delivered")[0]?.data).toMatchObject({
			id: answered.message,
			step: "build",
		});
		const decision = store.readDecisions().find((d) => d.id === `d-${requestId}`);
		expect(decision?.rationale).toContain("returned to the waiting af_ask call");
		expect(fakeSdk.sessions).toHaveLength(1);
		expect(fakeSdk.sessions[0].received).toHaveLength(1);
		for (const file of ["run.json", "events.jsonl", "decisions.jsonl"]) {
			expect(validateContractFile(path.join(res.dir, file)).errors).toEqual([]);
		}
	});

	it("returns pending when the wait runs out, and the answer is the session's next turn", async () => {
		const { manager, client } = await startSupervisor();
		const results: { status: string; request_id: string; next: string }[] = [];
		fakeSdk.on("BUILD", askingScript(client, { ...ASK, wait_seconds: 0.2 }, results));
		const res = await dispatchRun(client, payload());
		await waitFor(() => results.length === 1, "af_ask result");
		expect(results[0]).toMatchObject({ status: "pending" });
		expect(results[0].next).toMatch(/End your turn now/);
		// The turn ended, but the session stays open while the question is open
		await new Promise((r) => setTimeout(r, 100));
		expect(manager.registry.get(res.run.id)?.status).toBe("awaiting-human");
		const session = fakeSdk.sessions[0];
		expect(session.ended).toBe(false);

		await manager.answer(res.run.id, {
			request_id: results[0].request_id,
			answer: "a",
			from: "user",
		});
		await waitForStatus(manager, res.run.id, "done");
		expect(userText(session.received[1])).toContain(
			`Answer to ${results[0].request_id} ("Keep the legacy endpoint?"): a (Keep it)`,
		);
		const store = new RunStore(res.dir);
		expect(eventsOf(store, "input.answered")[0].data?.message).toBeTruthy();
		expect(eventsOf(store, "message.delivered")).toHaveLength(1);
		expect(fakeSdk.sessions).toHaveLength(1);

		// Checking an answered request again returns the answer
		const mcp = await connect(client, { AF_RUN_ID: res.run.id });
		expect(await call(mcp, "af_ask", { request_id: results[0].request_id })).toMatchObject({
			status: "answered",
			option: "a",
		});
	});

	it("auto-answers a low-risk non-blocking question after the timeout, never a medium one", async () => {
		const { manager, client } = await startSupervisor();
		const config = getDefaultConfig();
		(config.supervisor as Record<string, unknown>).needs_input_timeout = 0.001;
		const low: unknown[] = [];
		fakeSdk.on(
			"BUILD low",
			askingScript(client, { ...ASK, blocking: false, risk: "low", wait_seconds: 20 }, low),
		);
		const first = await dispatchRun(client, {
			...payload({}, config),
			variables: { task: "low" },
		});
		await waitForStatus(manager, first.run.id, "done");
		expect(low[0]).toMatchObject({ status: "answered", option: "a", from: "policy" });

		const medium: unknown[] = [];
		fakeSdk.on(
			"BUILD medium",
			askingScript(client, { ...ASK, blocking: false, risk: "medium", wait_seconds: 0.3 }, medium),
		);
		const second = await dispatchRun(client, {
			...payload({}, config),
			variables: { task: "medium" },
		});
		await waitFor(() => medium.length === 1, "af_ask result");
		expect(medium[0]).toMatchObject({ status: "pending" });
		const store = new RunStore(second.dir);
		expect(pendingInputs(store.readRun())[0]).toMatchObject({ risk: "medium", deadline: null });
		await manager.cancel(second.run.id);
		await waitForStatus(manager, second.run.id, "canceled");
	});

	it("lets the overseer answer a low-risk question and escalates a high-risk one", async () => {
		const { manager, client } = await startSupervisor();
		const overseer = await client.request<OverseerOpenResult>("POST", "/v1/overseer", {
			repo_root: repo,
			config: getDefaultConfig(),
			env: {},
		});
		const results: Record<string, { status: string; option: string; from: string }[]> = {
			low: [],
			high: [],
		};
		for (const risk of ["low", "high"]) {
			fakeSdk.on(
				`BUILD ${risk}`,
				askingScript(client, { ...ASK, kind: "decision", risk, wait_seconds: 20 }, results[risk]),
			);
		}
		const overseerMcp = await connect(client);
		const start = async (risk: string) => {
			const res = await dispatchRun(client, {
				...payload({ parent: overseer.run.id }),
				variables: { task: risk },
			});
			const store = new RunStore(res.dir);
			await waitFor(() => eventsOf(store, "needs_input").length === 1, risk);
			return { id: res.run.id, store, request: String(eventsOf(store, "needs_input")[0].data?.id) };
		};

		const low = await start("low");
		expect(eventsOf(low.store, "needs_input")[0].data).toMatchObject({
			kind: "decision",
			risk: "low",
			overseer_policy: { within: true, answer: "a" },
		});
		const lowAnswer = await call(overseerMcp, "af_answer", {
			run: low.id,
			request_id: low.request,
			answer: "a",
		});
		expect(lowAnswer.isError).toBeUndefined();
		await waitForStatus(manager, low.id, "done");
		expect(results.low[0]).toMatchObject({ status: "answered", option: "a", from: "overseer" });
		expect(low.store.readDecisions().find((d) => d.id === `d-${low.request}`)).toMatchObject({
			source: "policy",
		});

		const high = await start("high");
		expect(eventsOf(high.store, "needs_input")[0].data?.overseer_policy).toMatchObject({
			within: false,
		});
		const refused = await call(overseerMcp, "af_answer", {
			run: high.id,
			request_id: high.request,
			answer: "a",
		});
		expect(refused.text).toMatch(/Outside the overseer answer_policy \(risk high above/);
		await call(overseerMcp, "af_answer", {
			run: high.id,
			request_id: high.request,
			answer: "drop",
			from: "user",
		});
		await waitForStatus(manager, high.id, "done");
		expect(results.high[0]).toMatchObject({ status: "answered", option: "drop", from: "user" });
	});

	it("an answer after the af_ask call was canceled reaches the session as its next turn", async () => {
		const { manager, client } = await startSupervisor();
		const controller = new AbortController();
		let call1: Promise<unknown> | null = null;
		fakeSdk.on("BUILD", async (s, first) => {
			s.init();
			const mcp = await connect(client, s.options.env as NodeJS.ProcessEnv);
			// The MCP client gives up (its tool timeout) while the call waits
			call1 = mcp
				.callTool({ name: "af_ask", arguments: { ...ASK, wait_seconds: 30 } }, undefined, {
					signal: controller.signal,
				})
				.catch((err: unknown) => err);
			await waitFor(() => controller.signal.aborted, "the canceled call");
			await call1;
			s.result("Waiting for the answer.", [first]);
			let message = await s.nextUser();
			while (message) {
				s.result(resultBlock("done", `next turn: ${userText(message)}`), [message]);
				message = await s.nextUser();
			}
		});
		const res = await dispatchRun(client, payload());
		const store = new RunStore(res.dir);
		await waitFor(() => eventsOf(store, "needs_input").length === 1, "needs_input");
		const requestId = String(eventsOf(store, "needs_input")[0].data?.id);
		// biome-ignore lint/suspicious/noExplicitAny: private waiter count of the manager
		const waiters = (manager as any).askWaiters as Map<string, number>;
		await waitFor(() => waiters.size === 1, "the waiting long-poll");
		controller.abort();
		// The supervisor's long-poll leaves at once: no waiter is left to take the answer
		await waitFor(() => waiters.size === 0, "the long-poll to leave");

		const answered = await manager.answer(res.run.id, {
			request_id: requestId,
			answer: "drop",
			from: "user",
		});
		expect(answered.message).toBeTruthy();
		await waitForStatus(manager, res.run.id, "done");
		const session = fakeSdk.sessions[0];
		expect(userText(session.received[1])).toContain(`Answer to ${requestId}`);
		expect(eventsOf(store, "message.delivered")).toHaveLength(1);
		const decision = store.readDecisions().find((d) => d.id === `d-${requestId}`);
		expect(decision?.rationale).toContain("queued for the asking step");
	});

	it("pauses the step timeout while the agent waits in af_ask for the answer", async () => {
		const { manager, client } = await startSupervisor();
		const results: unknown[] = [];
		fakeSdk.on("BUILD", askingScript(client, { ...ASK, wait_seconds: 20 }, results));
		// A 0.6 s step timeout, shorter than the time the question stays open
		const contents = ONE_STEP.replace(
			'    prompt: "BUILD {{ task }}"',
			'    prompt: "BUILD {{ task }}"\n    timeout-minutes: 0.01',
		);
		const res = await dispatchRun(client, {
			...payload(),
			workflow: { path: path.join(repo, "agentic", "workflows", "wf.yaml"), contents },
		});
		const store = new RunStore(res.dir);
		await waitFor(() => eventsOf(store, "needs_input").length === 1, "needs_input");
		await new Promise((r) => setTimeout(r, 1500));
		expect(manager.registry.get(res.run.id)?.status).toBe("awaiting-human");
		const requestId = String(eventsOf(store, "needs_input")[0].data?.id);
		await manager.answer(res.run.id, { request_id: requestId, answer: "a", from: "user" });
		await waitForStatus(manager, res.run.id, "done");
		expect(results[0]).toMatchObject({ status: "answered", option: "a" });
	});

	it("returns withdrawn when the run is canceled while the call waits", async () => {
		const { manager, client } = await startSupervisor();
		const results: { status: string }[] = [];
		fakeSdk.on("BUILD", askingScript(client, { ...ASK, wait_seconds: 20 }, results));
		const res = await dispatchRun(client, payload());
		await waitFor(() => eventsOf(new RunStore(res.dir), "needs_input").length === 1, "ask");
		await manager.cancel(res.run.id);
		await waitFor(() => results.length === 1, "af_ask result");
		expect(results[0]).toMatchObject({ status: "withdrawn" });
		await waitForStatus(manager, res.run.id, "canceled");
		expect(pendingInputs(new RunStore(res.dir).readRun())).toEqual([]);
	});

	it("refuses to ask outside a running step and validates its input", async () => {
		const { client } = await startSupervisor();
		const noRun = await call(await connect(client), "af_ask", { question: "?" });
		expect(noRun.text).toMatch(/AF_RUN_ID/);
		fakeSdk.on("BUILD", async (s, first) => {
			s.init();
			s.result(resultBlock("done", "done"), [first]);
			await s.nextUser();
		});
		const { manager } = { manager: managers[0] };
		const res = await dispatchRun(client, payload());
		await waitForStatus(manager, res.run.id, "done");
		const mcp = await connect(client, { AF_RUN_ID: res.run.id, AF_STEP: "build" });
		const ended = await call(mcp, "af_ask", { question: "Still there?" });
		expect(ended.text).toMatch(/af_ask needs a running step/);
		expect(ended.text).toMatch(/HTTP 409/);
	});
});
