/**
 * Contract files of one run directory: `run.json`, `events.jsonl`, the
 * dispatch payload and the engine state (`progress.json`).
 *
 * Every write goes through the contract lock (`<file>.lock`) and is validated
 * against the v1 schema first. Event rule: callers write state to disk first,
 * then append the event.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { CONTRACT_VERSION, type RunStatus, validateArtifact } from "../contract/index.js";
import { withLock } from "../supervisor/lock.js";

export const RUN_FILE = "run.json";
export const EVENTS_FILE = "events.jsonl";
export const DISPATCH_FILE = "dispatch.json";
export const WORKFLOW_COPY_FILE = "workflow.yaml";
export const DECISIONS_FILE = "decisions.jsonl";

export interface RunJson {
	contract_version: 1;
	id: string;
	type: "overseer" | "workflow" | "skill";
	title?: string | null;
	workflow?: string | null;
	parent?: string | null;
	repo?: string | null;
	base?: string | null;
	branch?: string | null;
	worktree?: string | null;
	pr?: string | null;
	status: RunStatus;
	max_risk?: "low" | "medium" | "high" | null;
	started_at: string;
	updated_at?: string;
	ended_at?: string | null;
	runtime?: string | null;
	models?: Record<string, { model: string; effort?: string }>;
	budgets_used?: Record<string, number>;
	/** Number of crash recoveries of this run (af extension). */
	"x-af-recoveries"?: number;
	[key: `x-${string}`]: unknown;
}

export type EventType =
	| "run.queued"
	| "run.started"
	| "run.paused"
	| "run.resumed"
	| "run.canceled"
	| "run.halted"
	| "run.failed"
	| "run.completed"
	| "step.started"
	| "step.completed"
	| "step.failed"
	| "step.retried"
	| "message.queued"
	| "message.delivered"
	| "supervisor.restarted"
	| "run.recovered";

export interface RunEvent {
	seq: number;
	at: string;
	run: string;
	type: string;
	data?: Record<string, unknown>;
}

/** One line of `decisions.jsonl` (contract `decision.schema.json`). */
export interface DecisionEntry {
	id: string;
	at: string;
	phase: string;
	source: "agent" | "operator" | "policy";
	risk: "low" | "medium" | "high";
	decision: string;
	rationale: string;
	alternatives?: string[];
	files?: string[];
	commit?: string | null;
	refs?: string[];
	[key: `x-${string}`]: unknown;
}

export class ContractWriteError extends Error {
	constructor(file: string, errors: string[]) {
		super(`Refusing to write invalid ${path.basename(file)}: ${errors.join("; ")}`);
		this.name = "ContractWriteError";
	}
}

function writeAtomic(file: string, content: string): void {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, content, "utf-8");
	renameSync(tmp, file);
}

/** Accessor for the files of one run directory. */
export class RunStore {
	readonly id: string;

	constructor(readonly dir: string) {
		this.id = path.basename(dir);
	}

	get runFile(): string {
		return path.join(this.dir, RUN_FILE);
	}

	get eventsFile(): string {
		return path.join(this.dir, EVENTS_FILE);
	}

	get dispatchFile(): string {
		return path.join(this.dir, DISPATCH_FILE);
	}

	exists(): boolean {
		return existsSync(this.runFile);
	}

	readRun(): RunJson {
		return JSON.parse(readFileSync(this.runFile, "utf-8")) as RunJson;
	}

	/** Creates the run directory and its initial `run.json`. */
	async create(run: Omit<RunJson, "contract_version" | "id">): Promise<RunJson> {
		mkdirSync(this.dir, { recursive: true });
		const full = { contract_version: CONTRACT_VERSION, id: this.id, ...run } as RunJson;
		await this.writeRun(full);
		return full;
	}

	/** Applies `patch` to `run.json` under the contract lock and returns the result. */
	async updateRun(patch: Partial<RunJson>): Promise<RunJson> {
		return withLock(this.runFile, async () => {
			const next = { ...this.readRun(), ...patch, updated_at: new Date().toISOString() };
			this.writeValidated(next);
			return next;
		});
	}

	private async writeRun(run: RunJson): Promise<void> {
		await withLock(this.runFile, async () => {
			this.writeValidated({ ...run, updated_at: run.updated_at ?? new Date().toISOString() });
		});
	}

	private writeValidated(run: RunJson): void {
		const result = validateArtifact("run", run);
		if (!result.valid) {
			throw new ContractWriteError(
				this.runFile,
				result.errors.map((e) => `${e.path} ${e.message}`),
			);
		}
		writeAtomic(this.runFile, `${JSON.stringify(run, null, 2)}\n`);
	}

	/** Appends one event with the next `seq` under the contract lock. */
	async appendEvent(type: EventType, data: Record<string, unknown> = {}): Promise<RunEvent> {
		return withLock(this.eventsFile, async () => {
			const seq = this.readEvents().length + 1;
			const event: RunEvent = { seq, at: new Date().toISOString(), run: this.id, type, data };
			const result = validateArtifact("event", event);
			if (!result.valid) {
				throw new ContractWriteError(
					this.eventsFile,
					result.errors.map((e) => `${e.path} ${e.message}`),
				);
			}
			appendFileSync(this.eventsFile, `${JSON.stringify(event)}\n`, "utf-8");
			return event;
		});
	}

	/**
	 * Appends an event unless one of the same type matching `match` exists.
	 * Used by crash recovery so that no event is ever emitted twice.
	 */
	async appendEventOnce(
		type: EventType,
		data: Record<string, unknown>,
		match: (event: RunEvent) => boolean,
	): Promise<RunEvent | null> {
		if (this.readEvents().some((e) => e.type === type && match(e))) return null;
		return this.appendEvent(type, data);
	}

	get decisionsFile(): string {
		return path.join(this.dir, DECISIONS_FILE);
	}

	/** Appends one validated entry to `decisions.jsonl` under the contract lock. */
	async appendDecision(entry: DecisionEntry): Promise<void> {
		const result = validateArtifact("decision", entry);
		if (!result.valid) {
			throw new ContractWriteError(
				this.decisionsFile,
				result.errors.map((e) => `${e.path} ${e.message}`),
			);
		}
		await withLock(this.decisionsFile, async () => {
			appendFileSync(this.decisionsFile, `${JSON.stringify(entry)}\n`, "utf-8");
		});
	}

	/** Entries of `decisions.jsonl` (torn lines skipped). */
	readDecisions(): DecisionEntry[] {
		if (!existsSync(this.decisionsFile)) return [];
		const out: DecisionEntry[] = [];
		for (const line of readFileSync(this.decisionsFile, "utf-8").split("\n")) {
			if (!line.trim()) continue;
			try {
				out.push(JSON.parse(line) as DecisionEntry);
			} catch {
				// torn line
			}
		}
		return out;
	}

	/** Returns the events with `seq > after`. */
	readEvents(after = 0): RunEvent[] {
		if (!existsSync(this.eventsFile)) return [];
		const events: RunEvent[] = [];
		for (const line of readFileSync(this.eventsFile, "utf-8").split("\n")) {
			if (line.trim().length === 0) continue;
			try {
				const event = JSON.parse(line) as RunEvent;
				if (event.seq > after) events.push(event);
			} catch {
				// A torn last line (crash mid-append) is ignored.
			}
		}
		return events;
	}

	writeJson(name: string, value: unknown): void {
		mkdirSync(this.dir, { recursive: true });
		writeAtomic(path.join(this.dir, name), `${JSON.stringify(value, null, 2)}\n`);
	}

	readJson<T>(name: string): T {
		return JSON.parse(readFileSync(path.join(this.dir, name), "utf-8")) as T;
	}
}
