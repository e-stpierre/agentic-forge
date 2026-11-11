/**
 * The af supervisor: one long-lived process per user that owns all runs.
 *
 * IPC is HTTP on 127.0.0.1 with a random port. Every request must carry the
 * per-user token from the discovery file (`Authorization: Bearer <token>`).
 * Single instance: under the contract lock `supervisor.lock`, a starting
 * supervisor checks the pidfile and the discovery file, refuses to start when
 * a live supervisor answers, and otherwise claims both files.
 *
 * Endpoints in this version: `GET /v1/ping`, `POST /v1/shutdown`. Later
 * milestones register more routes through `Supervisor.route()`.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { CONTRACT_VERSION } from "../contract/index.js";
import { getGlobalRoot } from "../paths.js";
import { SupervisorClient } from "./client.js";
import {
	type SupervisorDiscovery,
	getSupervisorFiles,
	isPidAlive,
	readDiscovery,
	readPidfile,
	removeSupervisorFiles,
	writePrivateFile,
} from "./discovery.js";
import { withLock } from "./lock.js";

export const SUPERVISOR_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1024 * 1024;

export class SupervisorAlreadyRunningError extends Error {
	constructor(public readonly discovery: SupervisorDiscovery) {
		super(
			`A supervisor is already running (pid ${discovery.pid}, port ${discovery.port}, version ${discovery.version})`,
		);
		this.name = "SupervisorAlreadyRunningError";
	}
}

export interface RouteResult {
	status?: number;
	body?: unknown;
}

export type RouteHandler = (request: {
	body: unknown;
	query: URLSearchParams;
	params: Record<string, string>;
}) => RouteResult | Promise<RouteResult>;

export interface SupervisorOptions {
	/** af global directory (defaults to `getGlobalRoot()`). */
	root?: string;
	version: string;
	/** Fixed port, for debugging only. 0 (default) picks a random port. */
	port?: number;
	log?: (message: string) => void;
}

export class Supervisor {
	readonly root: string;
	readonly version: string;
	readonly token = randomBytes(32).toString("hex");
	readonly startedAt = new Date().toISOString();
	private readonly server: Server;
	private readonly routes = new Map<string, RouteHandler>();
	private readonly log: (message: string) => void;
	private readonly requestedPort: number;
	private stopping: Promise<void> | null = null;
	private stoppedResolve!: () => void;
	/** Resolves when the supervisor has stopped. */
	readonly stopped: Promise<void>;
	/** Number of active runs; replaced by the run registry (ORC-006). */
	activeRuns: () => number = () => 0;
	private discoveryData: SupervisorDiscovery | null = null;
	private readonly stopHooks: Array<() => Promise<void> | void> = [];

	constructor(options: SupervisorOptions) {
		this.root = options.root ?? getGlobalRoot();
		this.version = options.version;
		this.requestedPort = options.port ?? 0;
		this.log = options.log ?? (() => {});
		this.server = createServer((req, res) => {
			this.handle(req, res).catch((err: unknown) => {
				this.send(res, 500, { error: (err as Error).message });
			});
		});
		this.stopped = new Promise((resolve) => {
			this.stoppedResolve = resolve;
		});
		this.route("GET", "/v1/ping", () => ({
			body: {
				version: this.version,
				pid: process.pid,
				contract_version: CONTRACT_VERSION,
				started_at: this.startedAt,
				active_runs: this.activeRuns(),
			},
		}));
		this.route("POST", "/v1/shutdown", ({ body }) => {
			const force =
				typeof body === "object" && body !== null && (body as { force?: unknown }).force === true;
			const active = this.activeRuns();
			if (active > 0 && !force) {
				return {
					status: 409,
					body: { error: `${active} run(s) are active; pass force to stop anyway` },
				};
			}
			// Answer first, then stop.
			setImmediate(() => {
				void this.stop();
			});
			return { status: 202, body: { ok: true } };
		});
	}

	get discovery(): SupervisorDiscovery | null {
		return this.discoveryData;
	}

	/**
	 * Registers a hook that runs on stop, after the server stops listening and
	 * before the discovery file and pidfile are removed (the run manager ends
	 * its executions there, so no other supervisor can start meanwhile).
	 */
	onStop(hook: () => Promise<void> | void): void {
		this.stopHooks.push(hook);
	}

	/** Registers a route. `pattern` may contain `:name` segments. */
	route(method: "GET" | "POST", pattern: string, handler: RouteHandler): void {
		this.routes.set(`${method} ${pattern}`, handler);
	}

	/**
	 * Listens on 127.0.0.1 and claims the single-instance slot.
	 * Throws SupervisorAlreadyRunningError when another supervisor answers.
	 */
	async start(): Promise<SupervisorDiscovery> {
		mkdirSync(this.root, { recursive: true });
		await new Promise<void>((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(this.requestedPort, SUPERVISOR_HOST, () => {
				this.server.off("error", reject);
				resolve();
			});
		});
		const port = (this.server.address() as AddressInfo).port;
		const files = getSupervisorFiles(this.root);
		try {
			await withLock(files.lockTarget, async () => {
				const existing = await this.findLiveInstance();
				if (existing) throw new SupervisorAlreadyRunningError(existing);
				const discovery: SupervisorDiscovery = {
					pid: process.pid,
					host: SUPERVISOR_HOST,
					port,
					token: this.token,
					version: this.version,
					contract_version: CONTRACT_VERSION,
					started_at: this.startedAt,
				};
				writePrivateFile(files.pidfile, `${process.pid}\n`);
				writePrivateFile(files.discovery, `${JSON.stringify(discovery, null, 2)}\n`);
				this.discoveryData = discovery;
			});
		} catch (err) {
			await new Promise<void>((resolve) => this.server.close(() => resolve()));
			this.stoppedResolve();
			throw err;
		}
		this.log(
			`Supervisor ${this.version} listening on ${SUPERVISOR_HOST}:${port} (pid ${process.pid})`,
		);
		return this.discoveryData as SupervisorDiscovery;
	}

	/**
	 * Returns the discovery of another live supervisor, or null. A pidfile whose
	 * process is gone, or whose supervisor does not answer, is stale.
	 */
	private async findLiveInstance(): Promise<SupervisorDiscovery | null> {
		const pid = readPidfile(this.root);
		const discovery = readDiscovery(this.root);
		if (discovery && isPidAlive(discovery.pid)) {
			try {
				await new SupervisorClient(discovery).ping(2_000);
				return discovery;
			} catch {
				// Not answering: stale.
			}
		}
		if (pid !== null || discovery !== null) {
			this.log("Removing stale supervisor pidfile and discovery file");
		}
		return null;
	}

	/** Stops listening, runs the stop hooks, then removes the discovery file and pidfile. Idempotent. */
	stop(): Promise<void> {
		if (this.stopping) return this.stopping;
		this.stopping = (async () => {
			this.server.closeAllConnections?.();
			await new Promise<void>((resolve) => this.server.close(() => resolve()));
			for (const hook of this.stopHooks) {
				try {
					await hook();
				} catch (err) {
					this.log(`Stop hook failed: ${(err as Error).message}`);
				}
			}
			if (this.discoveryData) removeSupervisorFiles(process.pid, this.root);
			this.log("Supervisor stopped");
			this.stoppedResolve();
		})();
		return this.stopping;
	}

	private isAuthorized(req: IncomingMessage): boolean {
		const header = req.headers.authorization;
		if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
		const given = Buffer.from(header.slice("Bearer ".length));
		const expected = Buffer.from(this.token);
		return given.length === expected.length && timingSafeEqual(given, expected);
	}

	private send(res: ServerResponse, status: number, body: unknown): void {
		if (res.headersSent) return;
		res.writeHead(status, { "content-type": "application/json" });
		res.end(body === undefined ? "" : JSON.stringify(body));
	}

	private matchRoute(
		method: string,
		pathname: string,
	): { handler: RouteHandler; params: Record<string, string> } | null {
		const parts = pathname.split("/").filter(Boolean);
		for (const [key, handler] of this.routes) {
			const [routeMethod, pattern] = key.split(" ");
			if (routeMethod !== method) continue;
			const patternParts = pattern.split("/").filter(Boolean);
			if (patternParts.length !== parts.length) continue;
			const params: Record<string, string> = {};
			let ok = true;
			for (let i = 0; i < parts.length; i++) {
				if (patternParts[i].startsWith(":")) {
					params[patternParts[i].slice(1)] = decodeURIComponent(parts[i]);
				} else if (patternParts[i] !== parts[i]) {
					ok = false;
					break;
				}
			}
			if (ok) return { handler, params };
		}
		return null;
	}

	private async readBody(req: IncomingMessage): Promise<unknown> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of req) {
			size += (chunk as Buffer).length;
			if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
			chunks.push(chunk as Buffer);
		}
		if (size === 0) return undefined;
		return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (!this.isAuthorized(req)) {
			this.send(res, 401, { error: "Missing or invalid supervisor token" });
			return;
		}
		const url = new URL(req.url ?? "/", `http://${SUPERVISOR_HOST}`);
		const match = this.matchRoute(req.method ?? "GET", url.pathname);
		if (!match) {
			this.send(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
			return;
		}
		let body: unknown;
		try {
			body = await this.readBody(req);
		} catch (err) {
			this.send(res, 400, { error: `Invalid request body: ${(err as Error).message}` });
			return;
		}
		const result = await match.handler({ body, query: url.searchParams, params: match.params });
		this.send(res, result.status ?? 200, result.body);
	}
}
