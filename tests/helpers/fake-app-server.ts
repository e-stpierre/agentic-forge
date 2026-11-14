/**
 * Test helper: a fake `codex app-server`, so Codex session driver tests never
 * start a real Codex session. It speaks the same JSON-RPC lines as the real
 * server (handshake, `skills/list`, threads, turns, steer, interrupt, item
 * notifications, approval and user input requests).
 *
 * Usage:
 *
 *   codexAppServer.spawn = fakeCodex.spawn;   // in beforeEach
 *   fakeCodex.reset();                        // in afterEach
 *
 * Every spawn creates a `FakeAppServer` (`fakeCodex.servers`). Each
 * `turn/start` runs a script on a `FakeTurn`. The default script answers
 * every turn with one agent message ending in a `done` result block.
 * `fakeCodex.on(match, script)` picks another script for turns whose text
 * contains `match`.
 */

import type {
	AppServerSpawnOptions,
	AppServerTransport,
} from "../../src/runtimes/codex-session.js";

export function resultBlock(status = "done", summary = "done", extra = {}): string {
	return JSON.stringify({ contract_version: 1, status, summary, ...extra });
}

type Json = Record<string, unknown>;

export type FakeTurnScript = (turn: FakeTurn) => Promise<void>;

/** Text of a `turn/start` or `turn/steer` input list. */
export function inputText(input: unknown): string {
	if (!Array.isArray(input)) return "";
	return input
		.map((i: Json) => (i.type === "text" ? String(i.text) : ""))
		.filter(Boolean)
		.join("\n");
}

export class FakeTurn {
	readonly steers: Json[] = [];
	interrupted = false;
	private seq = 0;
	private steerWaiters: (() => void)[] = [];
	private interruptWaiters: (() => void)[] = [];
	completed = false;

	constructor(
		readonly server: FakeAppServer,
		readonly id: string,
		readonly params: Json,
	) {}

	get text(): string {
		return inputText(this.params.input);
	}

	get input(): Json[] {
		return (this.params.input as Json[]) ?? [];
	}

	private item(method: "item/started" | "item/completed", item: Json): void {
		this.server.notify(method, { item, threadId: this.server.threadId, turnId: this.id });
	}

	private nextId(prefix: string): string {
		this.seq += 1;
		return `${prefix}-${this.id}-${this.seq}`;
	}

	/** An agent message item (started and completed). */
	message(text: string): void {
		const id = this.nextId("msg");
		this.item("item/started", {
			type: "agentMessage",
			id,
			text: "",
			phase: null,
			memoryCitation: null,
		});
		this.item("item/completed", {
			type: "agentMessage",
			id,
			text,
			phase: null,
			memoryCitation: null,
		});
	}

	/**
	 * A command: `approval` asks the client first (like a command outside
	 * the sandbox). Returns the client's decision ("accept" without approval).
	 */
	async command(command: string, options: { approval?: boolean; output?: string } = {}) {
		const id = this.nextId("cmd");
		const base = {
			type: "commandExecution",
			id,
			command,
			cwd: "/repo",
			processId: null,
			source: "agent",
			commandActions: [],
			durationMs: null,
		};
		this.item("item/started", {
			...base,
			status: "inProgress",
			aggregatedOutput: null,
			exitCode: null,
		});
		let decision: unknown = "accept";
		if (options.approval) {
			const response = (await this.server.request("item/commandExecution/requestApproval", {
				threadId: this.server.threadId,
				turnId: this.id,
				itemId: id,
				command,
				reason: "needs to run outside the sandbox",
			})) as Json;
			decision = response.decision;
		}
		const ran = decision === "accept" || decision === "acceptForSession";
		this.item("item/completed", {
			...base,
			status: ran ? "completed" : "declined",
			aggregatedOutput: ran ? (options.output ?? "ok") : null,
			exitCode: ran ? 0 : null,
		});
		return decision;
	}

	/** A file change that asks for approval; returns the decision. */
	async fileChange(file: string, diff = "+line") {
		const id = this.nextId("patch");
		const changes = [{ path: file, kind: { type: "add" }, diff }];
		this.item("item/started", { type: "fileChange", id, changes, status: "inProgress" });
		const response = (await this.server.request("item/fileChange/requestApproval", {
			threadId: this.server.threadId,
			turnId: this.id,
			itemId: id,
			reason: "write outside the workspace",
			grantRoot: null,
		})) as Json;
		const ok = response.decision === "accept" || response.decision === "acceptForSession";
		this.item("item/completed", {
			type: "fileChange",
			id,
			changes,
			status: ok ? "completed" : "declined",
		});
		return response.decision;
	}

	/** `item/tool/requestUserInput`; returns the answers. */
	async ask(questions: Json[]) {
		const response = (await this.server.request("item/tool/requestUserInput", {
			threadId: this.server.threadId,
			turnId: this.id,
			itemId: this.nextId("ask"),
			questions,
		})) as Json;
		return response.answers as Record<string, { answers: string[] }>;
	}

	/** Resolves when `count` steers reached this turn. */
	async waitForSteers(count: number): Promise<void> {
		while (this.steers.length < count) {
			await new Promise<void>((r) => this.steerWaiters.push(r));
		}
	}

	/** Resolves when the client interrupts this turn. */
	async waitForInterrupt(): Promise<void> {
		while (!this.interrupted) {
			await new Promise<void>((r) => this.interruptWaiters.push(r));
		}
	}

	steered(params: Json): void {
		this.steers.push(params);
		for (const w of this.steerWaiters.splice(0)) w();
	}

	interrupt(): void {
		this.interrupted = true;
		for (const w of this.interruptWaiters.splice(0)) w();
	}

	/** Ends the turn (`completed`, `failed` or `interrupted`). */
	complete(status = "completed", error: string | null = null): void {
		if (this.completed) return;
		this.completed = true;
		this.server.endTurn(this);
		this.server.notify("turn/completed", {
			threadId: this.server.threadId,
			turn: {
				id: this.id,
				items: [],
				status,
				error: error ? { message: error, codexErrorInfo: null, additionalDetails: null } : null,
				startedAt: 0,
				completedAt: 1,
				durationMs: 1,
			},
		});
	}
}

/** Default script: one `done` message per turn. */
export const echoScript: FakeTurnScript = async (turn) => {
	turn.message(`Work log\n${resultBlock()}`);
	turn.complete();
};

export class FakeAppServer implements AppServerTransport {
	/** Every message the client sent, in order. */
	readonly received: Json[] = [];
	readonly turns: FakeTurn[] = [];
	threadId: string | null = null;
	threadParams: Json | null = null;
	threadMethod: string | null = null;
	closed = false;
	killed = false;
	/** `turn/steer` requests held while `fakeCodex.holdSteers` is set. */
	readonly heldSteers: Json[] = [];
	private lineListeners: ((line: string) => void)[] = [];
	private exitListeners: ((code: number | null, stderr: string) => void)[] = [];
	private requests = new Map<string, (result: unknown) => void>();
	private requestSeq = 0;
	private turnSeq = 0;
	private active: FakeTurn | null = null;
	private exited = false;

	constructor(
		readonly fake: FakeCodex,
		readonly options: AppServerSpawnOptions,
		readonly index: number,
	) {}

	/** Messages with a given method. */
	sent(method: string): Json[] {
		return this.received.filter((m) => m.method === method);
	}

	write(line: string): void {
		const message = JSON.parse(line) as Json;
		this.received.push(message);
		// Async like a real pipe, so the client never sees a reply before it returns
		setTimeout(() => this.handle(message), 0);
	}

	onLine(listener: (line: string) => void): void {
		this.lineListeners.push(listener);
	}

	onExit(listener: (code: number | null, stderr: string) => void): void {
		this.exitListeners.push(listener);
	}

	close(): void {
		this.closed = true;
		this.exit(0);
	}

	kill(): void {
		this.killed = true;
		this.exit(null);
	}

	/** Simulates a crash of the server. */
	crash(stderr = "boom"): void {
		this.exit(1, stderr);
	}

	private exit(code: number | null, stderr = ""): void {
		if (this.exited) return;
		this.exited = true;
		setTimeout(() => {
			for (const l of this.exitListeners) l(code, stderr);
		}, 0);
	}

	private send(message: Json): void {
		if (this.exited) return;
		const line = JSON.stringify(message);
		for (const l of this.lineListeners) l(line);
	}

	notify(method: string, params: Json): void {
		this.send({ method, params });
	}

	request(method: string, params: Json): Promise<unknown> {
		this.requestSeq += 1;
		const id = `srv-${this.requestSeq}`;
		return new Promise((resolve) => {
			this.requests.set(id, resolve);
			this.send({ id, method, params });
		});
	}

	endTurn(turn: FakeTurn): void {
		if (this.active === turn) this.active = null;
	}

	/** Resolves when `count` steers are held. */
	async waitForHeldSteers(count: number): Promise<void> {
		while (this.heldSteers.length < count) await new Promise((r) => setTimeout(r, 2));
	}

	/** Answers the held steers now (an error when their turn ended meanwhile). */
	releaseSteers(): void {
		for (const message of this.heldSteers.splice(0)) this.steer(message);
	}

	private steer(message: Json): void {
		const params = (message.params ?? {}) as Json;
		const turn = this.active;
		if (!turn || turn.id !== params.expectedTurnId) {
			this.send({ id: message.id, error: { code: -32600, message: "no active turn" } });
			return;
		}
		turn.steered(params);
		this.reply(message.id, { turnId: turn.id });
	}

	private reply(id: unknown, result: unknown): void {
		this.send({ id, result });
	}

	private handle(message: Json): void {
		if (this.exited) return;
		const { id, method } = message;
		const params = (message.params ?? {}) as Json;
		if (method === undefined && id !== undefined) {
			const resolve = this.requests.get(String(id));
			this.requests.delete(String(id));
			resolve?.(message.result ?? { error: message.error });
			return;
		}
		switch (method) {
			case "initialize":
				this.reply(id, {
					userAgent: "fake/0.128.0",
					codexHome: "/home/.codex",
					platformFamily: "unix",
					platformOs: "linux",
				});
				return;
			case "initialized":
				return;
			case "skills/list":
				this.reply(id, {
					data: [
						{
							cwd: (params.cwds as string[] | undefined)?.[0] ?? "/repo",
							skills: this.fake.skills.map((s) => ({
								name: s.name,
								description: "",
								path: s.path,
								scope: "repo",
								enabled: true,
							})),
							errors: [],
						},
					],
				});
				return;
			case "thread/start":
			case "thread/resume": {
				if (this.fake.failThread) {
					this.send({ id, error: { code: -32600, message: this.fake.failThread } });
					return;
				}
				this.threadMethod = method;
				this.threadParams = params;
				this.threadId =
					method === "thread/resume" ? String(params.threadId) : `thread-${this.index}`;
				this.reply(id, {
					thread: { id: this.threadId, turns: [], status: { type: "idle" } },
					model: (params.model as string | null) ?? "gpt-fake",
					modelProvider: "openai",
					cwd: params.cwd ?? "/repo",
				});
				return;
			}
			case "turn/start": {
				this.turnSeq += 1;
				const turn = new FakeTurn(this, `turn-${this.index}-${this.turnSeq}`, params);
				this.turns.push(turn);
				this.active = turn;
				this.reply(id, {
					turn: { id: turn.id, items: [], status: "inProgress", error: null },
				});
				this.notify("turn/started", {
					threadId: this.threadId,
					turn: { id: turn.id, items: [], status: "inProgress", error: null },
				});
				this.fake.started(turn);
				const script = this.fake.scriptFor(turn.text);
				void script(turn).catch(() => turn.complete("failed", "script error"));
				return;
			}
			case "turn/steer":
				if (this.fake.holdSteers) this.heldSteers.push(message);
				else this.steer(message);
				return;
			case "turn/interrupt": {
				const turn = this.turns.find((t) => t.id === params.turnId);
				turn?.interrupt();
				this.reply(id, {});
				return;
			}
			default:
				this.send({ id, error: { code: -32601, message: `unknown method ${method}` } });
		}
	}
}

export class FakeCodex {
	servers: FakeAppServer[] = [];
	/** Skills returned by `skills/list`. */
	skills: { name: string; path: string }[] = [];
	/** When set, `thread/start` and `thread/resume` fail with this message. */
	failThread: string | null = null;
	/** When set, `turn/steer` waits for `server.releaseSteers()` before its answer. */
	holdSteers = false;
	private scripts: [string, FakeTurnScript][] = [];
	private waiters: { match: string; resolve: (t: FakeTurn) => void }[] = [];

	reset(): void {
		for (const s of this.servers) if (!s.closed && !s.killed) s.kill();
		this.servers = [];
		this.skills = [];
		this.failThread = null;
		this.holdSteers = false;
		this.scripts = [];
		this.waiters = [];
	}

	/** Script for turns whose text contains `match` (last registration wins). */
	on(match: string, script: FakeTurnScript): void {
		this.scripts.unshift([match, script]);
	}

	scriptFor(text: string): FakeTurnScript {
		return this.scripts.find(([m]) => text.includes(m))?.[1] ?? echoScript;
	}

	/** Resolves with the first turn whose text contains `match`. */
	waitFor(match: string): Promise<FakeTurn> {
		const found = this.servers.flatMap((s) => s.turns).find((t) => t.text.includes(match));
		if (found) return Promise.resolve(found);
		return new Promise((resolve) => this.waiters.push({ match, resolve }));
	}

	started(turn: FakeTurn): void {
		const text = turn.text;
		for (const w of this.waiters.filter((x) => text.includes(x.match))) w.resolve(turn);
		this.waiters = this.waiters.filter((x) => !text.includes(x.match));
	}

	spawn = (options: AppServerSpawnOptions): AppServerTransport => {
		const server = new FakeAppServer(this, options, this.servers.length + 1);
		this.servers.push(server);
		return server;
	};
}

export const fakeCodex = new FakeCodex();
