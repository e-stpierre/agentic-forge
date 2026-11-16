/**
 * The supervisor's notifier. It tails the `events.jsonl` of every active run,
 * matches each event against the run's `notifications` config (from its
 * dispatch config snapshot), delivers the message to the matching channels
 * and appends `notification.sent` to the run. Tailing the files (instead of
 * hooking the writers) also covers the events a skill appends itself.
 *
 * Its read positions persist in `<global dir>/notifications/positions.json`,
 * so a restarted supervisor continues where the last one stopped. Events
 * replayed after a crash are not sent twice: a `notification.sent` with the
 * same `event_seq` already in the run skips them.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TERMINAL_RUN_STATUSES } from "../contract/index.js";
import type { DispatchPayload } from "../runs/dispatch.js";
import { OVERSEER_FILE } from "../runs/overseer.js";
import type { RegistryEntry, RunRegistry } from "../runs/registry.js";
import { type RunEvent, RunStore } from "../runs/run-store.js";
import {
	type DeliveryReport,
	type NotificationTransport,
	defaultTransport,
	deliver,
} from "./channels.js";
import {
	type ChannelId,
	type NotificationLevel,
	type NotificationsConfig,
	channelsFor,
	getNotificationsConfig,
	hasEnabledChannel,
} from "./config.js";
import {
	type Notification,
	type RunFacts,
	buildNotification,
	manualNotification,
} from "./message.js";

export const DEFAULT_NOTIFY_POLL_MS = 2000;
/** A terminal run is still read for this long after its last registry update. */
const TERMINAL_GRACE_MS = 5 * 60_000;
const POSITIONS_FILE = "positions.json";

export interface NotifierOptions {
	root: string;
	registry: RunRegistry;
	/** Config of the supervisor's af dir (for `af notify` without a run). */
	globalConfig: () => Record<string, unknown>;
	log?: (message: string) => void;
	transport?: NotificationTransport;
	/** Poll interval in ms (0: no timer, tests call `poll()`). */
	pollMs?: number;
}

export interface NotifyInput {
	text?: unknown;
	title?: unknown;
	level?: unknown;
	run?: unknown;
}

export interface NotifyResult extends DeliveryReport {
	/** `seq` of the `notification.sent` event, or null (nothing sent, or no run). */
	event: number | null;
	/** Set when no channel is enabled. */
	hint?: string;
}

export class NotifyError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
		this.name = "NotifyError";
	}
}

export class Notifier {
	private readonly log: (message: string) => void;
	private readonly transport: NotificationTransport;
	private readonly pollMs: number;
	private readonly startedAt = Date.now();
	private positions: Record<string, number> = {};
	private timer: ReturnType<typeof setInterval> | null = null;
	private polling: Promise<void> | null = null;
	/** First poll after start: events may have been handled by the previous supervisor. */
	private replay = true;
	private readonly configs = new Map<string, NotificationsConfig>();

	constructor(private readonly options: NotifierOptions) {
		this.log = options.log ?? (() => {});
		this.transport = options.transport ?? defaultTransport;
		this.pollMs = options.pollMs ?? DEFAULT_NOTIFY_POLL_MS;
	}

	private get positionsFile(): string {
		return path.join(this.options.root, "notifications", POSITIONS_FILE);
	}

	/** Loads the read positions (or starts at the end of every run) and starts polling. */
	start(): void {
		const saved = this.loadPositions();
		if (saved) this.positions = saved;
		else {
			for (const entry of this.options.registry.list()) {
				this.positions[entry.id] = this.lastSeq(entry);
			}
			this.savePositions();
		}
		if (this.pollMs > 0 && !this.timer) {
			this.timer = setInterval(() => void this.poll(), this.pollMs);
			this.timer.unref?.();
		}
	}

	/** Stops polling; resolves when a poll in flight ended. */
	async stop(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		await this.polling;
	}

	/** Reads new events and sends their notifications. Overlapping calls share one poll. */
	poll(): Promise<void> {
		if (!this.polling) {
			this.polling = this.pollOnce()
				.catch((err: Error) => this.log(`Notifications: ${err.message}`))
				.finally(() => {
					this.polling = null;
				});
		}
		return this.polling;
	}

	private async pollOnce(): Promise<void> {
		const now = Date.now();
		const pending: { entry: RegistryEntry; event: RunEvent }[] = [];
		let moved = false;
		for (const entry of this.options.registry.list()) {
			if (!(entry.id in this.positions)) {
				// A run created before this notifier started and never read: start at its end
				if (Date.parse(entry.created_at) < this.startedAt) {
					this.positions[entry.id] = this.lastSeq(entry);
					moved = true;
					continue;
				}
				this.positions[entry.id] = 0;
			}
			if (
				TERMINAL_RUN_STATUSES.includes(entry.status) &&
				now - Date.parse(entry.updated_at) > TERMINAL_GRACE_MS
			) {
				continue;
			}
			const events = new RunStore(entry.dir).readEvents(this.positions[entry.id]);
			if (events.length === 0) continue;
			this.positions[entry.id] = events[events.length - 1].seq;
			moved = true;
			for (const event of events) pending.push({ entry, event });
		}
		pending.sort((a, b) => a.event.at.localeCompare(b.event.at) || a.event.seq - b.event.seq);
		for (const { entry, event } of pending) {
			try {
				await this.handle(entry, event);
			} catch (err) {
				this.log(`Notifications: run ${entry.id} event ${event.seq}: ${(err as Error).message}`);
			}
		}
		this.replay = false;
		if (moved) this.savePositions();
	}

	private async handle(entry: RegistryEntry, event: RunEvent): Promise<void> {
		if (event.type === "notification.sent") return;
		const config = this.runConfig(entry);
		if (!hasEnabledChannel(config)) return;
		const store = new RunStore(entry.dir);
		const facts = runFacts(entry, store);
		const channels = withoutGithub(channelsFor(config, event.type, facts.type), facts);
		if (channels.length === 0) return;
		if (this.replay && alreadySent(store, event.seq)) return;
		const notification = buildNotification(event, facts, config.templates);
		const report = await deliver(notification, channels, config, this.transport);
		await this.record(store, notification, report, { event_seq: event.seq, event: event.type });
	}

	/** `af notify` / `af_notify`: sends to every enabled channel of the run's config (or the global one). */
	async notify(input: NotifyInput): Promise<NotifyResult> {
		const text = typeof input.text === "string" ? input.text.trim() : "";
		if (!text) throw new NotifyError("text is required");
		const level = input.level ?? "info";
		if (level !== "info" && level !== "warning" && level !== "error") {
			throw new NotifyError(`Invalid level '${String(level)}': expected info, warning or error`);
		}
		let entry: RegistryEntry | null = null;
		if (input.run != null && input.run !== "") {
			entry = this.options.registry.get(String(input.run)) ?? null;
			if (!entry) throw new NotifyError(`Run not found: ${String(input.run)}`, 404);
		}
		const store = entry ? new RunStore(entry.dir) : null;
		const facts = entry && store ? runFacts(entry, store) : null;
		const config = entry
			? this.runConfig(entry)
			: getNotificationsConfig(this.options.globalConfig());
		const channels = withoutGithub(channelsFor(config, null, facts?.type ?? null), facts);
		const notification = manualNotification({
			text,
			title: typeof input.title === "string" ? input.title : null,
			level: level as NotificationLevel,
			run: facts,
		});
		if (channels.length === 0) {
			return {
				sent: [],
				errors: [],
				event: null,
				hint: "No notification channel is enabled: set notifications.channels.<desktop|ntfy|slack|discord|github>.enabled in the af config",
			};
		}
		const report = await deliver(notification, channels, config, this.transport);
		const seq = store
			? await this.record(store, notification, report, { event: "af_notify" })
			: null;
		return { ...report, event: seq };
	}

	/** Appends `notification.sent` when at least one channel delivered; logs the failures. */
	private async record(
		store: RunStore,
		n: Notification,
		report: DeliveryReport,
		data: Record<string, unknown>,
	): Promise<number | null> {
		for (const e of report.errors) {
			this.log(`Notifications: run ${store.id}: ${e.channel} failed: ${e.error}`);
		}
		if (report.sent.length === 0) return null;
		const event = await store.appendEvent("notification.sent", {
			...data,
			trigger: n.trigger,
			level: n.level,
			title: n.title,
			channels: report.sent,
			...(report.errors.length > 0 ? { errors: report.errors } : {}),
		});
		return event.seq;
	}

	private runConfig(entry: RegistryEntry): NotificationsConfig {
		// Overseer runs keep their config snapshot in overseer.json, rewritten
		// each time a session opens the run: read it on every call
		const overseer = entry.type === "overseer";
		const cached = overseer ? undefined : this.configs.get(entry.id);
		if (cached) return cached;
		let snapshot: Record<string, unknown> = {};
		try {
			const file = overseer ? OVERSEER_FILE : "dispatch.json";
			snapshot = new RunStore(entry.dir).readJson<DispatchPayload>(file).config ?? {};
		} catch {
			// No snapshot: defaults (every channel off)
		}
		const config = getNotificationsConfig(snapshot);
		if (!overseer) this.configs.set(entry.id, config);
		return config;
	}

	private lastSeq(entry: RegistryEntry): number {
		try {
			return new RunStore(entry.dir).readEvents().at(-1)?.seq ?? 0;
		} catch {
			return 0;
		}
	}

	private loadPositions(): Record<string, number> | null {
		if (!existsSync(this.positionsFile)) return null;
		try {
			const value = JSON.parse(readFileSync(this.positionsFile, "utf-8")) as unknown;
			if (!value || typeof value !== "object" || Array.isArray(value)) return null;
			const positions: Record<string, number> = {};
			for (const [id, seq] of Object.entries(value)) {
				if (typeof seq === "number" && Number.isInteger(seq) && seq >= 0) positions[id] = seq;
			}
			return positions;
		} catch {
			return null;
		}
	}

	private savePositions(): void {
		const known = new Set(this.options.registry.list().map((e) => e.id));
		for (const id of Object.keys(this.positions)) if (!known.has(id)) delete this.positions[id];
		mkdirSync(path.dirname(this.positionsFile), { recursive: true });
		writeFileSync(this.positionsFile, `${JSON.stringify(this.positions)}\n`, "utf-8");
	}
}

function runFacts(entry: RegistryEntry, store: RunStore): RunFacts {
	let run: Record<string, unknown> = {};
	try {
		run = store.readRun() as unknown as Record<string, unknown>;
	} catch {
		// Unreadable run.json: registry facts only
	}
	const str = (v: unknown) => (typeof v === "string" && v ? v : null);
	return {
		id: entry.id,
		workflow: str(run.workflow) ?? str(entry.workflow),
		repo: entry.repo ? path.basename(entry.repo) : null,
		status: str(run.status) ?? entry.status,
		type: str(run.type),
		pr: str(run.pr),
	};
}

/** The GitHub channel only applies to a run with a pull request. */
function withoutGithub(channels: ChannelId[], facts: RunFacts | null): ChannelId[] {
	return facts?.pr ? channels : channels.filter((c) => c !== "github");
}

function alreadySent(store: RunStore, seq: number): boolean {
	return store
		.readEvents(seq)
		.some((e) => e.type === "notification.sent" && e.data?.event_seq === seq);
}
