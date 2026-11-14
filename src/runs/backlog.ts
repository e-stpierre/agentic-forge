/**
 * The overseer backlog: `backlog.json` in an overseer run directory. The
 * harness is its single writer (the `af_backlog_*` MCP tools, dispatches with
 * an `item`, discovered items of child runs); the overseer reads it through
 * `af_backlog_list`.
 *
 * Every item carries its triage (`track` and `track_reason`), its
 * dependencies and conflict zones. `scheduleBacklog()` decides which ready
 * items may start now: dependencies done, no conflict zone overlap with a
 * running item (or another item started in the same pass), at most
 * `max_parallel` running, no epic halt. A dispatch with an `item` is refused
 * unless the item is in that list, so two overlapping items never run in
 * parallel.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { HaltCondition, OverseerConfig } from "../config.js";
import type { RunStatus } from "../contract/index.js";
import { withLock } from "../supervisor/lock.js";
import { RunStore } from "./run-store.js";

export const BACKLOG_FILE = "backlog.json";

export const TRACKS = ["instruction", "light", "full"] as const;
export type Track = (typeof TRACKS)[number];

export const ITEM_STATUSES = [
	"proposed",
	"ready",
	"running",
	"done",
	"failed",
	"halted",
	"canceled",
	"logged",
	"dropped",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Statuses the overseer may set with `af_backlog_update` (running and the run outcomes are the harness's). */
export const SETTABLE_STATUSES = ["proposed", "ready", "logged", "dropped"] as const;

/** Statuses of a new item (proposed by default). */
export const NEW_STATUSES = ["proposed", "ready", "logged"] as const;

export const ITEM_SOURCES = ["epic", "user", "overseer", "discovered"] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

/** Item fields `af_backlog_add` and `af_backlog_update` accept. */
export const ITEM_FIELDS = [
	"title",
	"description",
	"status",
	"track",
	"track_reason",
	"depends_on",
	"conflict_zones",
	"priority",
	"workflow",
	"source",
	"notes",
] as const;

export interface DiscoveredFrom {
	run: string;
	step: string;
	type: string;
	severity: string | null;
	evidence: string | null;
	files: string[];
	/** Dedupe key of the backlog item (or the run without one), step, type and title. */
	key: string;
}

export interface BacklogItem {
	/** `T01`, `T02`, ... in order of creation. */
	id: string;
	title: string;
	description: string | null;
	status: ItemStatus;
	/** Triage: instruction (one step), light or full workflow. */
	track: Track | null;
	/** Why this track (required with a track). */
	track_reason: string | null;
	depends_on: string[];
	/** Paths or modules the item touches (`src/runs`, `docs/cli.md`). None: it runs alone. */
	conflict_zones: string[];
	/** Higher first. */
	priority: number;
	/** Workflow the overseer plans to dispatch for it. */
	workflow: string | null;
	source: ItemSource;
	discovered: DiscoveredFrom | null;
	/** Run of the current or last dispatch. */
	run: string | null;
	/** Every run dispatched for the item, oldest first. */
	runs: string[];
	notes: string | null;
	created_at: string;
	updated_at: string;
}

export interface BacklogFile {
	version: 1;
	/** The overseer run that owns it. */
	run: string;
	/** Number of the next item id. */
	next: number;
	items: BacklogItem[];
	updated_at: string;
}

export class BacklogError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
		this.name = "BacklogError";
	}
}

export function backlogPath(dir: string): string {
	return path.join(dir, BACKLOG_FILE);
}

export function emptyBacklog(run: string): BacklogFile {
	return { version: 1, run, next: 1, items: [], updated_at: new Date().toISOString() };
}

/** Reads `backlog.json` of an overseer run directory (an empty backlog when there is none). */
export function readBacklog(dir: string, run: string): BacklogFile {
	const file = backlogPath(dir);
	if (!existsSync(file)) return emptyBacklog(run);
	try {
		const parsed = JSON.parse(readFileSync(file, "utf-8")) as BacklogFile;
		if (!Array.isArray(parsed.items)) return emptyBacklog(run);
		return parsed;
	} catch {
		throw new BacklogError(`Unreadable ${BACKLOG_FILE} in ${dir}`, 500);
	}
}

/**
 * Read-modify-write of `backlog.json` under the contract lock. `fn` changes
 * the backlog in place and returns a value; the file is written only when
 * `fn` returns without throwing.
 */
export async function updateBacklog<T>(
	dir: string,
	run: string,
	fn: (backlog: BacklogFile) => Promise<T> | T,
): Promise<T> {
	const file = backlogPath(dir);
	return withLock(file, async () => {
		const backlog = readBacklog(dir, run);
		const before = JSON.stringify(backlog);
		const result = await fn(backlog);
		if (JSON.stringify(backlog) !== before) {
			backlog.updated_at = new Date().toISOString();
			new RunStore(dir).writeJson(BACKLOG_FILE, backlog);
		}
		return result;
	});
}

/** Normalized conflict zone: forward slashes, no `./`, no trailing `/`, `/*` or `/**`, lowercase. */
export function normalizeZone(zone: string): string {
	let z = zone.trim().replace(/\\/g, "/").replace(/^\.\//, "");
	z = z.replace(/\/\*\*?$/, "").replace(/\/+$/, "");
	return z.toLowerCase();
}

/** Two zones overlap when they are equal or one is a parent path of the other (`*` overlaps all). */
export function zonesOverlap(a: string, b: string): boolean {
	const za = normalizeZone(a);
	const zb = normalizeZone(b);
	if (za === "*" || zb === "*" || za === "" || zb === "") return true;
	return za === zb || za.startsWith(`${zb}/`) || zb.startsWith(`${za}/`);
}

/** First overlapping zone pair of two items, or null. An item without zones overlaps every item. */
export function itemsConflict(a: BacklogItem, b: BacklogItem): string | null {
	if (a.conflict_zones.length === 0 || b.conflict_zones.length === 0) {
		return "no conflict_zones";
	}
	for (const za of a.conflict_zones) {
		for (const zb of b.conflict_zones) {
			if (zonesOverlap(za, zb)) return za === zb ? za : `${za} / ${zb}`;
		}
	}
	return null;
}

function str(value: unknown, field: string, { nullable = true } = {}): string | null {
	if (value == null) {
		if (nullable) return null;
		throw new BacklogError(`${field} is required`);
	}
	if (typeof value !== "string") throw new BacklogError(`${field} must be a string`);
	const trimmed = value.trim();
	if (!trimmed) {
		if (nullable) return null;
		throw new BacklogError(`${field} must not be empty`);
	}
	return trimmed;
}

function strList(value: unknown, field: string): string[] {
	if (value == null) return [];
	if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) {
		throw new BacklogError(`${field} must be a list of non-empty strings`);
	}
	return [...new Set((value as string[]).map((v) => v.trim()))];
}

function oneOf<T extends string>(list: readonly T[], value: unknown, field: string): T {
	if (!(list as readonly unknown[]).includes(value)) {
		throw new BacklogError(`${field} must be one of ${list.join(", ")}`);
	}
	return value as T;
}

function checkFields(fields: Record<string, unknown>, allowed: readonly string[]): void {
	const unknown = Object.keys(fields).filter((k) => !allowed.includes(k));
	if (unknown.length > 0) {
		throw new BacklogError(
			`Unknown item field(s): ${unknown.join(", ")}. Fields: ${allowed.join(", ")}`,
		);
	}
}

/** Items that count against `budgets.max_tasks`. */
export function countedTasks(items: readonly BacklogItem[]): number {
	return items.filter((i) => i.status !== "dropped" && i.status !== "logged").length;
}

function itemId(n: number): string {
	return `T${String(n).padStart(2, "0")}`;
}

/** Throws when a dependency is unknown, the item itself, or closes a cycle. */
export function checkDependencies(items: readonly BacklogItem[]): void {
	const byId = new Map(items.map((i) => [i.id, i]));
	for (const item of items) {
		for (const dep of item.depends_on) {
			if (dep === item.id) throw new BacklogError(`${item.id} cannot depend on itself`);
			if (!byId.has(dep)) {
				throw new BacklogError(`${item.id} depends on unknown item ${dep}`);
			}
		}
	}
	const state = new Map<string, 1 | 2>();
	const visit = (id: string, trail: string[]): void => {
		if (state.get(id) === 2) return;
		if (state.get(id) === 1) {
			throw new BacklogError(`Dependency cycle: ${[...trail, id].join(" -> ")}`);
		}
		state.set(id, 1);
		for (const dep of byId.get(id)?.depends_on ?? []) visit(dep, [...trail, id]);
		state.set(id, 2);
	};
	for (const item of items) visit(item.id, []);
}

/** Track and reason go together: a triaged item says why. */
function checkTriage(item: BacklogItem): void {
	if (item.track && !item.track_reason) {
		throw new BacklogError(`${item.id}: track_reason is required with a track (why ${item.track})`);
	}
	if (item.status === "ready" && !item.track) {
		throw new BacklogError(
			`${item.id}: triage it before it is ready (track instruction, light or full, and track_reason)`,
		);
	}
}

export interface NewItemInput {
	title?: unknown;
	description?: unknown;
	status?: unknown;
	track?: unknown;
	track_reason?: unknown;
	depends_on?: unknown;
	conflict_zones?: unknown;
	priority?: unknown;
	workflow?: unknown;
	source?: unknown;
	notes?: unknown;
	/** Set by the harness for discovered items only. */
	discovered?: DiscoveredFrom;
}

/**
 * Adds items (one batch: they may depend on each other by their future ids or
 * on existing items). New items are `proposed` unless they ask for `ready` or
 * `logged`. Refused past `budgets.max_tasks`.
 */
export function addItems(
	backlog: BacklogFile,
	inputs: readonly NewItemInput[],
	config: OverseerConfig,
	now = new Date().toISOString(),
): BacklogItem[] {
	if (!Array.isArray(inputs) || inputs.length === 0) {
		throw new BacklogError("items must be a non-empty list");
	}
	const added: BacklogItem[] = [];
	let next = backlog.next;
	for (const input of inputs) {
		if (typeof input !== "object" || input === null)
			throw new BacklogError("Each item must be an object");
		const { discovered, ...fields } = input;
		checkFields(fields, ITEM_FIELDS);
		const status =
			fields.status == null ? "proposed" : oneOf(NEW_STATUSES, fields.status, "status");
		const priority = fields.priority ?? 0;
		if (typeof priority !== "number" || !Number.isInteger(priority)) {
			throw new BacklogError("priority must be an integer");
		}
		const item: BacklogItem = {
			id: itemId(next++),
			title: str(fields.title, "title", { nullable: false }) as string,
			description: str(fields.description, "description"),
			status,
			track: fields.track == null ? null : oneOf(TRACKS, fields.track, "track"),
			track_reason: str(fields.track_reason, "track_reason"),
			depends_on: strList(fields.depends_on, "depends_on"),
			conflict_zones: strList(fields.conflict_zones, "conflict_zones"),
			priority,
			workflow: str(fields.workflow, "workflow"),
			source: fields.source == null ? "user" : oneOf(ITEM_SOURCES, fields.source, "source"),
			discovered: discovered ?? null,
			run: null,
			runs: [],
			notes: str(fields.notes, "notes"),
			created_at: now,
			updated_at: now,
		};
		if (item.source === "discovered" && !discovered) {
			throw new BacklogError("source discovered is set by the harness for items of child runs");
		}
		checkTriage(item);
		added.push(item);
	}
	const all = [...backlog.items, ...added];
	const counted = countedTasks(all);
	if (counted > config.budgets.maxTasks && countedTasks(added) > 0) {
		throw new BacklogError(
			`Task budget exhausted: ${counted} items for budgets.max_tasks ${config.budgets.maxTasks}. Ask the user to drop items or raise overseer.budgets.max_tasks; add the rest with status logged`,
			409,
		);
	}
	checkDependencies(all);
	backlog.items = all;
	backlog.next = next;
	return added;
}

/** Status changes `af_backlog_update` allows, from the current status. */
const MANUAL_TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
	proposed: ["ready", "logged", "dropped"],
	ready: ["proposed", "logged", "dropped"],
	logged: ["proposed", "ready", "dropped"],
	dropped: ["proposed", "logged"],
	// Retry or give up after the run ended
	failed: ["ready", "dropped"],
	halted: ["ready", "dropped"],
	canceled: ["ready", "dropped"],
	running: [],
	done: [],
};

/** Applies `fields` to one item; returns the updated item. */
export function updateItem(
	backlog: BacklogFile,
	id: string,
	fields: Record<string, unknown>,
	config: OverseerConfig,
	now = new Date().toISOString(),
): BacklogItem {
	const item = backlog.items.find((i) => i.id === id);
	if (!item) {
		const ids = backlog.items.map((i) => i.id).join(", ") || "none";
		throw new BacklogError(`Unknown backlog item ${id}. Items: ${ids}`, 404);
	}
	if (typeof fields !== "object" || fields === null || Object.keys(fields).length === 0) {
		throw new BacklogError("fields must name at least one item field");
	}
	checkFields(
		fields,
		ITEM_FIELDS.filter((f) => f !== "source"),
	);
	const next: BacklogItem = { ...item };
	if ("title" in fields) next.title = str(fields.title, "title", { nullable: false }) as string;
	if ("description" in fields) next.description = str(fields.description, "description");
	if ("notes" in fields) next.notes = str(fields.notes, "notes");
	if ("workflow" in fields) next.workflow = str(fields.workflow, "workflow");
	if ("priority" in fields) {
		if (typeof fields.priority !== "number" || !Number.isInteger(fields.priority)) {
			throw new BacklogError("priority must be an integer");
		}
		next.priority = fields.priority;
	}
	if ("track" in fields) {
		next.track = fields.track == null ? null : oneOf(TRACKS, fields.track, "track");
		// A new track needs its own reason
		if (!("track_reason" in fields) && next.track !== item.track) next.track_reason = null;
	}
	if ("track_reason" in fields) next.track_reason = str(fields.track_reason, "track_reason");
	if ("depends_on" in fields) next.depends_on = strList(fields.depends_on, "depends_on");
	if ("conflict_zones" in fields) {
		if (item.status === "running") {
			throw new BacklogError(
				`${id} is running: its conflict zones cannot change until its run ends`,
				409,
			);
		}
		next.conflict_zones = strList(fields.conflict_zones, "conflict_zones");
	}
	if ("status" in fields && fields.status !== item.status) {
		if (fields.status === "running") {
			throw new BacklogError(
				`Start ${id} with af_dispatch (parent: the overseer run, item: ${id}): the harness sets running`,
			);
		}
		const status = oneOf(ITEM_STATUSES, fields.status, "status");
		if (!MANUAL_TRANSITIONS[item.status].includes(status)) {
			const allowed = MANUAL_TRANSITIONS[item.status];
			throw new BacklogError(
				`${id} cannot go from ${item.status} to ${status}${
					allowed.length
						? ` (allowed: ${allowed.join(", ")})`
						: " (the harness sets it from the run)"
				}`,
				409,
			);
		}
		next.status = status;
		if (["dropped", "logged"].includes(item.status) && countedTasks([next]) > 0) {
			const counted = countedTasks(backlog.items) + 1;
			if (counted > config.budgets.maxTasks) {
				throw new BacklogError(
					`Task budget exhausted: ${counted} items for budgets.max_tasks ${config.budgets.maxTasks}`,
					409,
				);
			}
		}
	}
	checkTriage(next);
	const items = backlog.items.map((i) => (i.id === id ? next : i));
	checkDependencies(items);
	next.updated_at = now;
	backlog.items = items;
	return next;
}

export interface BacklogView {
	/** Ready items the scheduler allows to dispatch now, in order. */
	runnable: string[];
	/** Why each other ready item waits. */
	waiting: Record<string, string>;
	running: string[];
	max_parallel: number;
	/** Why the epic is halted (no dispatch until the user decides), or null. */
	halt: string | null;
	budgets: Record<string, number>;
	budgets_used: Record<string, number>;
}

export interface ScheduleInput {
	config: OverseerConfig;
	/** Total minutes of the child runs (`budgets.max_run_minutes`). */
	runMinutes: number;
}

const OPEN_FINDING_STATUSES: readonly ItemStatus[] = [
	"proposed",
	"ready",
	"running",
	"logged",
	"failed",
	"halted",
];

/** Why the epic halts per `halt_epic_on`, or null. */
export function epicHalt(items: readonly BacklogItem[], input: ScheduleInput): string | null {
	const on = new Set<HaltCondition>(input.config.haltEpicOn);
	for (const status of ["failed", "halted"] as const) {
		if (!on.has(status)) continue;
		const stuck = items.filter((i) => i.status === status).map((i) => i.id);
		if (stuck.length > 0) {
			return `${stuck.join(", ")} ${status}: retry (status ready) or drop it with the user`;
		}
	}
	if (on.has("critical")) {
		const critical = items
			.filter(
				(i) => i.discovered?.severity === "critical" && OPEN_FINDING_STATUSES.includes(i.status),
			)
			.map((i) => i.id);
		if (critical.length > 0) {
			return `critical finding ${critical.join(", ")} is open: ask the user (fix it first, or drop it)`;
		}
	}
	if (on.has("budget") && input.runMinutes >= input.config.budgets.maxRunMinutes) {
		return `budget: ${Math.round(input.runMinutes)} run minutes for budgets.max_run_minutes ${input.config.budgets.maxRunMinutes}`;
	}
	return null;
}

/**
 * Which ready items may be dispatched now. Ready items are taken by priority
 * (then id); each one needs a track, its dependencies done, retries left, and
 * no conflict zone overlap with a running item or one picked before it in
 * this pass. At most `max_parallel` items run.
 */
export function scheduleBacklog(backlog: BacklogFile, input: ScheduleInput): BacklogView {
	const { config } = input;
	const items = backlog.items;
	const byId = new Map(items.map((i) => [i.id, i]));
	const running = items.filter((i) => i.status === "running");
	const halt = epicHalt(items, input);
	const occupied = [...running];
	const runnable: string[] = [];
	const waiting: Record<string, string> = {};
	const ready = items
		.filter((i) => i.status === "ready")
		.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
	for (const item of ready) {
		if (halt) {
			waiting[item.id] = "epic halted";
			continue;
		}
		if (!item.track) {
			waiting[item.id] = "not triaged";
			continue;
		}
		const deps = item.depends_on
			.map((d) => byId.get(d))
			.filter((d): d is BacklogItem => Boolean(d) && d?.status !== "done");
		if (deps.length > 0) {
			waiting[item.id] = `depends on ${deps.map((d) => `${d.id} (${d.status})`).join(", ")}`;
			continue;
		}
		if (item.runs.length > config.budgets.maxRetries) {
			waiting[item.id] =
				`retries exhausted (${item.runs.length} runs, budgets.max_retries ${config.budgets.maxRetries})`;
			continue;
		}
		const conflict = occupied
			.map((o) => ({ o, zone: itemsConflict(item, o) }))
			.find((c) => c.zone !== null);
		if (conflict) {
			waiting[item.id] =
				`conflicts with ${conflict.o.id} (${conflict.o.status === "running" ? "running" : "starts first"}): ${conflict.zone}`;
			continue;
		}
		if (occupied.length >= config.maxParallel) {
			waiting[item.id] = `max_parallel ${config.maxParallel} reached`;
			continue;
		}
		runnable.push(item.id);
		occupied.push(item);
	}
	return {
		runnable,
		waiting,
		running: running.map((i) => i.id),
		max_parallel: config.maxParallel,
		halt,
		budgets: {
			max_tasks: config.budgets.maxTasks,
			max_retries: config.budgets.maxRetries,
			max_run_minutes: config.budgets.maxRunMinutes,
		},
		budgets_used: budgetsUsed(backlog, input.runMinutes),
	};
}

/** Budget consumption recorded in the overseer run's `run.json` `budgets_used`. */
export function budgetsUsed(backlog: BacklogFile, runMinutes: number): Record<string, number> {
	const dispatches = backlog.items.reduce((n, i) => n + i.runs.length, 0);
	const retries = backlog.items.reduce((n, i) => n + Math.max(0, i.runs.length - 1), 0);
	return {
		tasks: countedTasks(backlog.items),
		dispatches,
		retries,
		run_minutes: Math.round(runMinutes),
	};
}

/** Item status for the final status of its run (null while the run has not ended). */
export function itemStatusForRun(status: RunStatus): ItemStatus | null {
	switch (status) {
		case "done":
		case "merged":
			return "done";
		case "failed":
			return "failed";
		case "halted":
			return "halted";
		case "canceled":
			return "canceled";
		default:
			return null;
	}
}

/** Item statuses taken from a run that ended, which the run can leave again (resume, retry-step). */
const REOPENABLE_ITEM_STATUSES: readonly ItemStatus[] = ["failed", "halted", "canceled"];

/** True when a run status is known and the run has not ended. */
export function runIsOpen(status: RunStatus | null): boolean {
	return status !== null && itemStatusForRun(status) === null;
}

/**
 * Brings items in line with their runs: a running item whose run ended takes
 * the run outcome, and a failed, halted, canceled (or ready again) item whose
 * run was reopened (resume, retry-step) follows it again: running while the
 * run is open, then its new outcome. Returns the items that changed.
 */
export function reconcileItems(
	backlog: BacklogFile,
	runStatus: (run: string) => RunStatus | null,
	now = new Date().toISOString(),
): BacklogItem[] {
	const changed: BacklogItem[] = [];
	for (const item of backlog.items) {
		if (!item.run) continue;
		let next: ItemStatus | null = null;
		if (item.status === "running") {
			const status = runStatus(item.run);
			// A run that left the registry cannot finish any more
			next = status === null ? "failed" : itemStatusForRun(status);
		} else if (REOPENABLE_ITEM_STATUSES.includes(item.status)) {
			const status = runStatus(item.run);
			if (status === null) continue;
			next = itemStatusForRun(status) ?? "running";
		} else if (item.status === "ready" && runIsOpen(runStatus(item.run))) {
			// Set ready for a retry, then its last run was reopened instead
			next = "running";
		}
		if (!next || next === item.status) continue;
		item.status = next;
		item.updated_at = now;
		changed.push(item);
	}
	return changed;
}

/** Marks an item running for a new dispatch (after `scheduleBacklog()` allowed it). */
export function startItem(
	backlog: BacklogFile,
	id: string,
	run: string,
	now = new Date().toISOString(),
): BacklogItem {
	const item = backlog.items.find((i) => i.id === id);
	if (!item) throw new BacklogError(`Unknown backlog item ${id}`, 404);
	item.status = "running";
	item.run = run;
	item.runs = [...item.runs, run];
	item.updated_at = now;
	return item;
}

/** Why an item cannot be dispatched now, or null when the scheduler allows it. */
export function dispatchRefusal(
	backlog: BacklogFile,
	id: string,
	view: BacklogView,
	runStatus: (run: string) => RunStatus | null = () => null,
): string | null {
	const item = backlog.items.find((i) => i.id === id);
	if (!item) {
		const ids = backlog.items.map((i) => i.id).join(", ") || "none";
		return `Unknown backlog item ${id}. Items: ${ids}`;
	}
	if (item.run && runIsOpen(runStatus(item.run))) {
		return `${id} still has an open run ${item.run} (${runStatus(item.run)}): wait for it, or cancel it before a new dispatch`;
	}
	if (view.runnable.includes(id)) return null;
	if (item.status !== "ready") {
		return `${id} is ${item.status}: only ready items are dispatched (af_backlog_update status ready first)`;
	}
	return `${id} cannot start now: ${view.waiting[id] ?? "not runnable"}${view.halt ? ` (halt: ${view.halt})` : ""}`;
}

/**
 * Dedupe key of a discovered item. `owner` is the backlog item the run was
 * dispatched for (so a retry in a new run adds nothing twice), or the run for
 * a dispatch without an item.
 */
export function discoveredKey(owner: string, step: string, type: string, title: string): string {
	return createHash("sha256")
		.update(`${owner}\n${step}\n${type}\n${title}`)
		.digest("hex")
		.slice(0, 16);
}

export interface DiscoveredOutcome {
	item: BacklogItem;
	/** What the policy did: ready (auto), proposed (ask), logged (log, or the task budget is spent). */
	status: ItemStatus;
	reason: string;
}

/**
 * Adds the `discovered_items` of a child run's result block per
 * `accept_discovered_items`: `auto` -> ready (untriaged: the overseer triages
 * it before dispatch), `ask` -> proposed (the user approves), `log` -> logged.
 * When the task budget is spent, auto and ask items are logged instead. An
 * item already added for the same backlog item (or, for a run dispatched
 * without one, the same run), step, type and title is skipped.
 */
export function acceptDiscovered(
	backlog: BacklogFile,
	source: { run: string; step: string; item?: string | null },
	discovered: readonly Record<string, unknown>[],
	config: OverseerConfig,
	now = new Date().toISOString(),
): DiscoveredOutcome[] {
	const outcomes: DiscoveredOutcome[] = [];
	const known = new Set(backlog.items.map((i) => i.discovered?.key).filter(Boolean));
	const policy = config.acceptDiscoveredItems;
	// The backlog item the run was dispatched for: every one of its runs shares the key
	const owner =
		source.item ?? backlog.items.find((i) => i.runs.includes(source.run))?.id ?? source.run;
	for (const raw of discovered) {
		const title = typeof raw.title === "string" ? raw.title.trim() : "";
		const type = typeof raw.type === "string" ? raw.type : "other";
		if (!title) continue;
		const key = discoveredKey(owner, source.step, type, title);
		if (known.has(key)) continue;
		known.add(key);
		let status: ItemStatus = policy === "auto" ? "ready" : policy === "ask" ? "proposed" : "logged";
		let reason = `accept_discovered_items: ${policy}`;
		if (status !== "logged" && countedTasks(backlog.items) >= config.budgets.maxTasks) {
			status = "logged";
			reason = `${reason}, logged: task budget spent (budgets.max_tasks ${config.budgets.maxTasks})`;
		}
		const files = Array.isArray(raw.files)
			? raw.files.filter((f): f is string => typeof f === "string")
			: [];
		const item: BacklogItem = {
			id: itemId(backlog.next++),
			title,
			description: typeof raw.evidence === "string" ? raw.evidence : null,
			// auto items join ready, but wait untriaged until the overseer sets a track
			status,
			track: null,
			track_reason: null,
			depends_on: [],
			conflict_zones: files,
			priority: 0,
			workflow: null,
			source: "discovered",
			discovered: {
				run: source.run,
				step: source.step,
				type,
				severity: typeof raw.severity === "string" ? raw.severity : null,
				evidence: typeof raw.evidence === "string" ? raw.evidence : null,
				files,
				key,
			},
			run: null,
			runs: [],
			notes: null,
			created_at: now,
			updated_at: now,
		};
		backlog.items.push(item);
		outcomes.push({ item, status, reason });
	}
	return outcomes;
}

/** Result of the answer policy for one needs_input request of a child run. */
export interface PolicyVerdict {
	/** The overseer may answer it itself. */
	within: boolean;
	/** The option it may answer with (the recommended one), or null. */
	answer: string | null;
	reason: string;
}

const RISK_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3 };

/**
 * Decides whether the overseer may answer a request itself: the policy is
 * enabled, the request is not of kind `permission`, its risk (the request's
 * own `risk`, else the asking step's `max_risk`) is at or below `max_risk`,
 * the request has a recommended option (with `recommended_only`), and it is
 * not blocking unless `blocking` allows it.
 */
export function evaluateAnswerPolicy(
	request: { recommended?: string | null; blocking?: boolean; options?: { id: string }[] },
	context: { risk: string | null; kind: string },
	config: OverseerConfig,
): PolicyVerdict {
	const policy = config.answerPolicy;
	const ask = (reason: string): PolicyVerdict => ({ within: false, answer: null, reason });
	if (!policy.enabled) return ask("answer_policy disabled");
	if (context.kind === "permission") return ask("permission request: always asked");
	if (!context.risk) return ask("no risk reported (request risk or step max_risk)");
	if ((RISK_ORDER[context.risk] ?? 99) > RISK_ORDER[policy.maxRisk]) {
		return ask(`risk ${context.risk} above answer_policy.max_risk ${policy.maxRisk}`);
	}
	if (request.blocking !== false && !policy.blocking) return ask("blocking request");
	const recommended = request.recommended ?? null;
	if (policy.recommendedOnly && !recommended) return ask("no recommended option");
	return {
		within: true,
		// recommended_only: the overseer may only answer with the recommended option
		answer: policy.recommendedOnly ? recommended : null,
		reason: `risk ${context.risk} <= ${policy.maxRisk}${recommended ? `, recommended option ${recommended}` : ""}`,
	};
}
