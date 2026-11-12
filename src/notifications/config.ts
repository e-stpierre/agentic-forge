/**
 * The `notifications` config section: triggers, templates and channels,
 * merged over the defaults of `src/config.ts`.
 */

import { deepMerge, getDefaultConfig } from "../config.js";
import { matchesTypes } from "../runs/events.js";

export const CHANNEL_IDS = ["desktop", "ntfy", "slack", "discord", "github"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export type NotificationLevel = "info" | "warning" | "error";
export const NOTIFICATION_LEVELS: readonly NotificationLevel[] = ["info", "warning", "error"];

/** One trigger: an event type pattern, optionally limited to one run type. */
export interface Trigger {
	event: string;
	/** `run.json` `type` (`overseer`, `workflow`, `skill`), or null for every run. */
	runType: string | null;
}

export interface ChannelConfig {
	enabled: boolean;
	/** Overrides the section triggers for this channel. */
	triggers: Trigger[] | null;
	/** Channel settings (`server`, `topic`, `token`, `webhook_url`). */
	settings: Record<string, unknown>;
}

export interface Template {
	title?: string;
	body?: string;
}

export interface NotificationsConfig {
	enabled: boolean;
	triggers: Trigger[];
	templates: Record<string, Template>;
	channels: Record<ChannelId, ChannelConfig>;
}

/** Parses a trigger list entry (`"needs_input"` or `{ event, run_type }`); null when invalid. */
export function parseTrigger(value: unknown): Trigger | null {
	if (typeof value === "string" && value.trim()) return { event: value.trim(), runType: null };
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const raw = value as Record<string, unknown>;
		if (typeof raw.event !== "string" || !raw.event.trim()) return null;
		const runType = typeof raw.run_type === "string" && raw.run_type ? raw.run_type : null;
		return { event: raw.event.trim(), runType };
	}
	return null;
}

function parseTriggers(value: unknown): Trigger[] | null {
	if (!Array.isArray(value)) return null;
	return value.map(parseTrigger).filter((t): t is Trigger => t !== null);
}

/** The `notifications` section of a config merged over its defaults. */
export function getNotificationsConfig(config: Record<string, unknown>): NotificationsConfig {
	const defaults = getDefaultConfig().notifications as Record<string, unknown>;
	const raw = (config.notifications as Record<string, unknown> | undefined) ?? {};
	const merged = deepMerge(defaults, raw);
	const channelsRaw = (merged.channels as Record<string, unknown> | undefined) ?? {};
	const channels = {} as Record<ChannelId, ChannelConfig>;
	for (const id of CHANNEL_IDS) {
		const { enabled, triggers, ...settings } =
			(channelsRaw[id] as Record<string, unknown> | undefined) ?? {};
		channels[id] = { enabled: enabled === true, triggers: parseTriggers(triggers), settings };
	}
	const templates: Record<string, Template> = {};
	const templatesRaw = merged.templates as Record<string, unknown> | undefined;
	for (const [event, value] of Object.entries(templatesRaw ?? {})) {
		if (!value || typeof value !== "object") continue;
		const t = value as Record<string, unknown>;
		templates[event] = {
			...(typeof t.title === "string" ? { title: t.title } : {}),
			...(typeof t.body === "string" ? { body: t.body } : {}),
		};
	}
	return {
		enabled: merged.enabled !== false,
		triggers: parseTriggers(merged.triggers) ?? [],
		templates,
		channels,
	};
}

/** True when an event of `type` in a run of `runType` matches one of the triggers. */
export function matchesTrigger(
	triggers: readonly Trigger[],
	type: string,
	runType: string | null,
): boolean {
	return triggers.some(
		(t) => matchesTypes(type, [t.event]) && (t.runType === null || t.runType === runType),
	);
}

/** Channels that deliver an event (every enabled channel for `af notify`, `type` null). */
export function channelsFor(
	config: NotificationsConfig,
	type: string | null,
	runType: string | null,
): ChannelId[] {
	if (!config.enabled) return [];
	return CHANNEL_IDS.filter((id) => {
		const channel = config.channels[id];
		if (!channel.enabled) return false;
		if (type === null) return true;
		return matchesTrigger(channel.triggers ?? config.triggers, type, runType);
	});
}

/** True when any channel is enabled (the notifier skips runs without one). */
export function hasEnabledChannel(config: NotificationsConfig): boolean {
	return config.enabled && CHANNEL_IDS.some((id) => config.channels[id].enabled);
}
