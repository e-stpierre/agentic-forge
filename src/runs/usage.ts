/**
 * Token usage of runs: `steps/<NN-step>/usage.json` (one entry per runtime
 * call: each attempt, each ralph-loop iteration), the run totals written to
 * `run.json` `budgets_used`, and the `af usage` / `af_usage` report.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RuntimeId } from "../runtimes/types.js";
import { USAGE_TOKEN_FIELDS, type Usage, addUsage, totalTokens } from "../runtimes/usage.js";
import { type RegistryEntry, RunTree, parseSince } from "./registry.js";

/** Per-step usage file in the step directory. */
export const USAGE_FILE = "usage.json";

/** Fraction of a budget at which the supervisor emits `budget.warning`. */
export const BUDGET_WARNING_RATIO = 0.8;

/** One runtime call of a step. */
export interface UsageCall {
	at: string;
	runtime: RuntimeId;
	model: string | null;
	/** Null when the runtime reported no usage. */
	usage: Usage | null;
	iteration?: number;
}

/** `steps/<NN-step>/usage.json`. */
export interface StepUsageFile {
	step: string;
	/** Sum of the calls; null when no call reported usage. */
	usage: Usage | null;
	/** Calls whose runtime reported no usage. */
	unknown_calls: number;
	calls: UsageCall[];
}

/** Appends one call to a step's `usage.json` and returns the updated file. */
export function recordStepUsage(
	stepDir: string,
	step: string,
	call: Omit<UsageCall, "at">,
): StepUsageFile {
	const file = path.join(stepDir, USAGE_FILE);
	const current = readUsageFile(file) ?? { step, usage: null, unknown_calls: 0, calls: [] };
	const entry: UsageCall = { at: new Date().toISOString(), ...call };
	const next: StepUsageFile = {
		step,
		usage: addUsage(current.usage, call.usage),
		unknown_calls: current.unknown_calls + (call.usage ? 0 : 1),
		calls: [...current.calls, entry],
	};
	mkdirSync(stepDir, { recursive: true });
	writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
	return next;
}

function readUsageFile(file: string): StepUsageFile | null {
	if (!existsSync(file)) return null;
	try {
		const data = JSON.parse(readFileSync(file, "utf-8")) as StepUsageFile;
		return Array.isArray(data?.calls) ? data : null;
	} catch {
		return null;
	}
}

/** The `usage.json` files of a run, in step directory order. */
export function readRunUsage(runDir: string): StepUsageFile[] {
	const stepsDir = path.join(runDir, "steps");
	if (!existsSync(stepsDir)) return [];
	const out: StepUsageFile[] = [];
	for (const name of readdirSync(stepsDir).sort()) {
		const file = readUsageFile(path.join(stepsDir, name, USAGE_FILE));
		if (file) out.push(file);
	}
	return out;
}

/** Sum of the step files of a run (null when no call reported usage). */
export function sumStepUsage(files: StepUsageFile[]): Usage | null {
	return files.reduce<Usage | null>((sum, f) => addUsage(sum, f.usage), null);
}

/**
 * The run totals as `run.json` `budgets_used` entries (numbers only: a run
 * with no reported usage has none, and `cost_usd` only when reported).
 */
export function usageBudgetsUsed(usage: Usage | null): Record<string, number> {
	if (!usage) return {};
	const out: Record<string, number> = { tokens: totalTokens(usage) };
	for (const k of USAGE_TOKEN_FIELDS) out[k] = usage[k];
	if (usage.cost_usd !== null) out.cost_usd = usage.cost_usd;
	return out;
}

/** The small usage object carried by `step.completed` (Rule 6: numbers only). */
export function compactUsage(usage: Usage | null): Record<string, number | null> | null {
	if (!usage) return null;
	return { tokens: totalTokens(usage), ...usage };
}

/** Grouping of `af usage` and `af_usage`. */
export const USAGE_GROUPS = ["run", "step", "runtime", "model", "workflow"] as const;
export type UsageGroup = (typeof USAGE_GROUPS)[number];

/** A run given to the report. */
export interface UsageRunInput {
	id: string;
	workflow: string | null;
	dir: string;
}

/** One line of the report. */
export interface UsageRow {
	key: string;
	calls: number;
	/** Calls whose runtime reported no usage (their tokens are unknown). */
	unknown_calls: number;
	/** Null when no call of the row reported usage (shown as unknown). */
	tokens: number | null;
	usage: Usage | null;
}

export interface UsageReport {
	by: UsageGroup;
	runs: number;
	rows: UsageRow[];
	total: UsageRow;
}

/**
 * Usage of runs grouped by run, step, runtime, model or workflow. Steps of
 * several runs are keyed `<run>/<step>`. Rows keep the order they first
 * appear in.
 */
export function buildUsageReport(runs: UsageRunInput[], by: UsageGroup): UsageReport {
	const rows = new Map<string, UsageRow>();
	const total: UsageRow = { key: "total", calls: 0, unknown_calls: 0, tokens: null, usage: null };
	const add = (row: UsageRow, call: UsageCall) => {
		row.calls += 1;
		if (!call.usage) row.unknown_calls += 1;
		row.usage = addUsage(row.usage, call.usage);
		row.tokens = row.usage ? totalTokens(row.usage) : null;
	};
	for (const run of runs) {
		for (const file of readRunUsage(run.dir)) {
			for (const call of file.calls) {
				let key: string;
				switch (by) {
					case "run":
						key = run.id;
						break;
					case "step":
						key = runs.length > 1 ? `${run.id}/${file.step}` : file.step;
						break;
					case "runtime":
						key = call.runtime;
						break;
					case "model":
						key = call.model ?? `${call.runtime} (default model)`;
						break;
					default:
						key = run.workflow ?? "unknown";
				}
				let row = rows.get(key);
				if (!row) {
					row = { key, calls: 0, unknown_calls: 0, tokens: null, usage: null };
					rows.set(key, row);
				}
				add(row, call);
				add(total, call);
			}
		}
	}
	return { by, runs: runs.length, rows: [...rows.values()], total };
}

/**
 * The runs `af usage` and `af_usage` report on: one run and every run below
 * it (child runs through `parent`, so a run's usage includes the runs it
 * dispatched), else every run created since `since` (all runs without it).
 * Throws on an unknown run or an invalid `since`.
 */
export function selectUsageRuns(
	entries: readonly RegistryEntry[],
	options: { run?: string | null; since?: string | null } = {},
): UsageRunInput[] {
	const since = parseSince(options.since);
	let selected: RegistryEntry[];
	if (options.run) {
		const tree = new RunTree(entries);
		if (!tree.get(options.run)) throw new Error(`Run not found: ${options.run}`);
		selected = tree.walk(options.run).map((w) => w.entry);
	} else {
		selected = [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at));
	}
	if (since !== null) selected = selected.filter((e) => Date.parse(e.created_at) >= since);
	return selected.map((e) => ({ id: e.id, workflow: e.workflow ?? null, dir: e.dir }));
}

/** Human-readable report (`af usage` without `--json`). */
export function formatUsageReport(report: UsageReport): string {
	const header = [
		report.by,
		"calls",
		"tokens",
		"input",
		"cached",
		"cache_write",
		"output",
		"cost_usd",
	];
	const line = (r: UsageRow) => {
		const u = r.usage;
		const unknown = r.unknown_calls > 0 ? ` (${r.unknown_calls} unknown)` : "";
		return [
			r.key,
			`${r.calls}${unknown}`,
			r.tokens === null ? "unknown" : String(r.tokens),
			u ? String(u.input_tokens) : "-",
			u ? String(u.cached_input_tokens) : "-",
			u ? String(u.cache_creation_tokens) : "-",
			u ? String(u.output_tokens) : "-",
			u?.cost_usd != null ? `~${u.cost_usd.toFixed(4)}` : "-",
		];
	};
	const table = [header, ...report.rows.map(line), line(report.total)];
	const widths = header.map((_, i) => Math.max(...table.map((r) => r[i].length)));
	const out = table.map((r) =>
		r
			.map((c, i) => c.padEnd(widths[i]))
			.join("  ")
			.trimEnd(),
	);
	out.splice(1, 0, widths.map((w) => "-".repeat(w)).join("  "));
	const notes = [`${report.runs} run(s).`];
	if (report.total.usage?.cost_usd != null) {
		notes.push("Costs are runtime estimates (notional on a subscription login).");
	}
	if (report.total.unknown_calls > 0) {
		notes.push("unknown: the runtime reported no usage for some calls.");
	}
	return `${out.join("\n")}\n\n${notes.join(" ")}\n`;
}
