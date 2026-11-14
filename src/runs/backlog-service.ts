/**
 * The supervisor side of the overseer backlog: the `/v1/overseer/:id/backlog`
 * operations, the dispatch of a backlog item, the discovered items of child
 * runs and the answer policy. `RunManager` owns one `BacklogService`.
 */

import { type OverseerConfig, getOverseerConfig } from "../config.js";
import type { RunStatus } from "../contract/index.js";
import {
	BacklogError,
	type BacklogFile,
	type BacklogItem,
	type BacklogView,
	type NewItemInput,
	type PolicyVerdict,
	acceptDiscovered,
	addItems,
	budgetsUsed,
	dispatchRefusal,
	evaluateAnswerPolicy,
	readBacklog,
	reconcileItems,
	scheduleBacklog,
	startItem,
	updateBacklog,
	updateItem,
} from "./backlog.js";
import { isOverseerEntry, readOverseerFile } from "./overseer.js";
import { type RegistryEntry, type RunRegistry, filterRuns } from "./registry.js";
import { RunStore } from "./run-store.js";

const OPEN_STATUSES: readonly RunStatus[] = ["running", "paused", "blocked", "awaiting-human"];
const ENDED_STATUSES: readonly RunStatus[] = ["done", "merged", "failed", "halted", "canceled"];

export interface BacklogListResult extends BacklogView {
	run: string;
	items: BacklogItem[];
}

export interface BacklogServiceDeps {
	registry: RunRegistry;
	log: (message: string) => void;
}

export class BacklogService {
	constructor(private readonly deps: BacklogServiceDeps) {}

	/** The overseer run entry (404 unknown, 400 not an overseer run). */
	private overseer(id: string): RegistryEntry {
		const entry = this.deps.registry.get(id);
		if (!entry) throw new BacklogError(`Run not found: ${id}`, 404);
		if (!isOverseerEntry(entry)) {
			throw new BacklogError(
				`Run ${id} is not an overseer run: backlogs belong to overseer runs (af overseer)`,
			);
		}
		return entry;
	}

	private openOverseer(id: string): RegistryEntry {
		const entry = this.overseer(id);
		if (!OPEN_STATUSES.includes(entry.status)) {
			throw new BacklogError(`Overseer run ${id} has ended (${entry.status})`, 409);
		}
		return entry;
	}

	/** The overseer config of an overseer run (its `overseer.json` config snapshot). */
	config(entry: RegistryEntry): OverseerConfig {
		return getOverseerConfig(readOverseerFile(entry.dir)?.config ?? {});
	}

	/** The overseer run a run was dispatched by, or null. */
	parentOverseer(runDir: string): RegistryEntry | null {
		let parent: string | null = null;
		try {
			parent = new RunStore(runDir).readRun().parent ?? null;
		} catch {
			return null;
		}
		if (!parent) return null;
		const entry = this.deps.registry.get(parent);
		return entry && isOverseerEntry(entry) ? entry : null;
	}

	/** Total minutes of the overseer's child runs (an open run counts until now). */
	runMinutes(overseer: string, now = Date.now()): number {
		let ms = 0;
		for (const child of filterRuns(this.deps.registry.list(), { parent: overseer })) {
			const start = Date.parse(child.created_at);
			const end = ENDED_STATUSES.includes(child.status) ? Date.parse(child.updated_at) : now;
			if (!Number.isNaN(start) && !Number.isNaN(end)) ms += Math.max(0, end - start);
		}
		return ms / 60_000;
	}

	private runStatus = (run: string): RunStatus | null =>
		this.deps.registry.get(run)?.status ?? null;

	/**
	 * Items follow their runs: an ended run gives its outcome, a reopened one
	 * makes its item running again. Call under the backlog lock.
	 */
	private reconcile(backlog: BacklogFile): void {
		for (const item of reconcileItems(backlog, this.runStatus)) {
			this.deps.log(`Backlog ${backlog.run}: ${item.id} ${item.status} (run ${item.run})`);
		}
	}

	private view(entry: RegistryEntry, backlog: BacklogFile): BacklogView {
		return scheduleBacklog(backlog, {
			config: this.config(entry),
			runMinutes: this.runMinutes(entry.id),
		});
	}

	/** Records the budget use in the overseer run's `run.json` (only when it changed). */
	private async recordBudgets(entry: RegistryEntry, backlog: BacklogFile): Promise<void> {
		const used = budgetsUsed(backlog, this.runMinutes(entry.id));
		const store = new RunStore(entry.dir);
		try {
			const current = store.readRun().budgets_used ?? {};
			if (JSON.stringify(current) === JSON.stringify(used)) return;
			await store.updateRun({ budgets_used: used });
		} catch (err) {
			this.deps.log(`Backlog ${entry.id}: budgets_used not recorded: ${(err as Error).message}`);
		}
	}

	/** `af_backlog_list`: the items (optionally of some statuses) and what may start now. */
	async list(id: string, statuses: readonly string[] = []): Promise<BacklogListResult> {
		const entry = this.overseer(id);
		const backlog = OPEN_STATUSES.includes(entry.status)
			? await updateBacklog(entry.dir, id, (b) => {
					this.reconcile(b);
					return b;
				})
			: readBacklog(entry.dir, id);
		await this.recordBudgets(entry, backlog);
		const view = this.view(entry, backlog);
		const items =
			statuses.length > 0
				? backlog.items.filter((i) => statuses.includes(i.status))
				: backlog.items;
		return { run: id, items, ...view };
	}

	/** `af_backlog_add`: adds items (proposed by default); returns them with the new schedule. */
	async add(
		id: string,
		items: unknown,
	): Promise<{ run: string; added: BacklogItem[]; runnable: string[] }> {
		const entry = this.openOverseer(id);
		const config = this.config(entry);
		const { added, backlog } = await updateBacklog(entry.dir, id, (b) => {
			this.reconcile(b);
			return { added: addItems(b, items as NewItemInput[], config), backlog: b };
		});
		await this.recordBudgets(entry, backlog);
		return { run: id, added, runnable: this.view(entry, backlog).runnable };
	}

	/** `af_backlog_update`: changes one item; returns it with the new schedule. */
	async update(
		id: string,
		itemId: unknown,
		fields: unknown,
	): Promise<{ run: string; item: BacklogItem; runnable: string[] }> {
		const entry = this.openOverseer(id);
		if (typeof itemId !== "string" || !itemId) throw new BacklogError("item id is required");
		if (typeof fields !== "object" || fields === null)
			throw new BacklogError("fields must be an object");
		const config = this.config(entry);
		const { item, backlog } = await updateBacklog(entry.dir, id, (b) => {
			this.reconcile(b);
			return {
				item: updateItem(b, itemId, fields as Record<string, unknown>, config),
				backlog: b,
			};
		});
		await this.recordBudgets(entry, backlog);
		return { run: id, item, runnable: this.view(entry, backlog).runnable };
	}

	/**
	 * Dispatch of a backlog item: under the backlog lock, refuses the item
	 * unless the scheduler allows it now, runs `create` (which queues the run)
	 * and marks the item running with the new run.
	 */
	async dispatchItem<T extends { run: { id: string } }>(
		overseer: string,
		itemId: string,
		create: () => Promise<T>,
	): Promise<T> {
		const entry = this.openOverseer(overseer);
		const { result, backlog } = await updateBacklog(entry.dir, overseer, async (b) => {
			this.reconcile(b);
			const refusal = dispatchRefusal(b, itemId, this.view(entry, b), this.runStatus);
			if (refusal)
				throw new BacklogError(refusal, b.items.some((i) => i.id === itemId) ? 409 : 404);
			const created = await create();
			startItem(b, itemId, created.run.id);
			return { result: created, backlog: b };
		});
		this.deps.log(`Backlog ${overseer}: ${itemId} running (run ${result.run.id})`);
		await this.recordBudgets(entry, backlog);
		return result;
	}

	/**
	 * Discovered items of a child run's result block join its overseer's
	 * backlog per `accept_discovered_items`; each one is logged as a policy
	 * decision of the overseer run.
	 */
	async acceptDiscovered(
		runDir: string,
		run: string,
		step: string,
		discovered: readonly Record<string, unknown>[] | undefined,
	): Promise<void> {
		if (!discovered || discovered.length === 0) return;
		const overseer = this.parentOverseer(runDir);
		if (!overseer || !OPEN_STATUSES.includes(overseer.status)) return;
		const config = this.config(overseer);
		const outcomes = await updateBacklog(overseer.dir, overseer.id, (b) =>
			acceptDiscovered(b, { run, step }, discovered, config),
		);
		const store = new RunStore(overseer.dir);
		for (const { item, status, reason } of outcomes) {
			await store.appendDecision({
				id: `d-backlog-${item.id}`,
				at: item.created_at,
				phase: "backlog",
				source: "policy",
				risk: severityRisk(item.discovered?.severity ?? null),
				decision: `Discovered item ${item.id} (${item.discovered?.type}: ${item.title}) from ${run}/${step} added as ${status}`,
				rationale: reason,
				refs: [item.id, run],
			});
			this.deps.log(`Backlog ${overseer.id}: discovered ${item.id} (${status}) from ${run}`);
		}
	}

	/**
	 * Answer policy verdict for a request of a child run of an overseer, or
	 * null when the run has no overseer parent.
	 */
	policyFor(
		runDir: string,
		request: { recommended?: string | null; blocking?: boolean },
		context: { risk: string | null; kind: string },
	): PolicyVerdict | null {
		const overseer = this.parentOverseer(runDir);
		if (!overseer) return null;
		return evaluateAnswerPolicy(request, context, this.config(overseer));
	}
}

/** Decision risk for a discovered item's severity (the decision schema has low, medium and high). */
function severityRisk(severity: string | null): "low" | "medium" | "high" {
	if (severity === "high" || severity === "critical") return "high";
	if (severity === "medium") return "medium";
	return "low";
}
