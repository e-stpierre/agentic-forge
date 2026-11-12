/**
 * Notification channels: desktop toast, ntfy, Slack and Discord webhooks and
 * a GitHub pull request comment. Every channel goes through a
 * `NotificationTransport`, the test seam (`defaultTransport` makes real HTTP
 * requests, spawns the OS notifier and calls `gh`).
 */

import { execFile } from "node:child_process";
import { gh, repoFromPrUrl } from "../github/gh.js";
import type { ChannelId, NotificationsConfig } from "./config.js";
import type { Notification } from "./message.js";

export interface NotificationTransport {
	/** HTTP POST; resolves with the response status. */
	post(url: string, body: string, headers: Record<string, string>): Promise<number>;
	/** Runs a command without a shell; rejects when it fails. */
	exec(command: string, args: string[], env: Record<string, string>): Promise<void>;
	/** Comments on a pull request (`owner/repo` and number). */
	comment(repo: string, number: number, body: string): Promise<void>;
}

const HTTP_TIMEOUT_MS = 10_000;
const EXEC_TIMEOUT_MS = 20_000;

export const defaultTransport: NotificationTransport = {
	async post(url, body, headers) {
		const res = await fetch(url, {
			method: "POST",
			body,
			headers,
			signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
		});
		return res.status;
	},
	exec(command, args, env) {
		return new Promise((resolve, reject) => {
			execFile(
				command,
				args,
				{ env: { ...process.env, ...env }, windowsHide: true, timeout: EXEC_TIMEOUT_MS },
				(err, _stdout, stderr) => {
					if (err) reject(new Error(stderr.trim() || err.message));
					else resolve();
				},
			);
		});
	},
	async comment(repo, number, body) {
		await gh(["pr", "comment", String(number), "--repo", repo, "--body", body]);
	},
};

/** Environment variables that carry the toast text (never put on a command line). */
export const TOAST_TITLE_ENV = "AF_NOTIFY_TITLE";
export const TOAST_BODY_ENV = "AF_NOTIFY_BODY";

/** AppUserModelID of Windows PowerShell: a registered app id lets the toast show without an installer. */
const POWERSHELL_APP_ID =
	"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

const WINDOWS_TOAST_SCRIPT = [
	"$ErrorActionPreference = 'Stop'",
	"[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]",
	"$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
	"$texts = $xml.GetElementsByTagName('text')",
	`[void]$texts.Item(0).AppendChild($xml.CreateTextNode($env:${TOAST_TITLE_ENV}))`,
	`[void]$texts.Item(1).AppendChild($xml.CreateTextNode($env:${TOAST_BODY_ENV}))`,
	"$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
	`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${POWERSHELL_APP_ID}').Show($toast)`,
].join("; ");

/** The OS command that shows a desktop notification (text in environment variables). */
export function desktopCommand(platform: NodeJS.Platform = process.platform): {
	command: string;
	args: string[];
} {
	if (platform === "win32") {
		const encoded = Buffer.from(WINDOWS_TOAST_SCRIPT, "utf16le").toString("base64");
		return {
			command: "powershell.exe",
			args: [
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-EncodedCommand",
				encoded,
			],
		};
	}
	if (platform === "darwin") {
		return {
			command: "osascript",
			args: [
				"-e",
				`display notification (system attribute "${TOAST_BODY_ENV}") with title (system attribute "${TOAST_TITLE_ENV}")`,
			],
		};
	}
	// notify-send reads its arguments; the placeholders are replaced by sendDesktop
	return { command: "notify-send", args: [`$${TOAST_TITLE_ENV}`, `$${TOAST_BODY_ENV}`] };
}

const NTFY_PRIORITY: Record<Notification["level"], string> = {
	info: "default",
	warning: "high",
	error: "urgent",
};

const NTFY_TAGS: Record<Notification["level"], string> = {
	info: "robot",
	warning: "warning",
	error: "rotating_light",
};

/** HTTP header values must be Latin-1: anything else is replaced. */
function headerSafe(value: string): string {
	return value.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

function requireString(settings: Record<string, unknown>, key: string, channel: string): string {
	const value = settings[key];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`notifications.channels.${channel}.${key} is not set`);
	}
	return value.trim();
}

async function postOk(
	transport: NotificationTransport,
	url: string,
	body: string,
	headers: Record<string, string>,
): Promise<void> {
	const status = await transport.post(url, body, headers);
	if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
}

async function sendDesktop(n: Notification, transport: NotificationTransport): Promise<void> {
	const { command, args } = desktopCommand();
	const env = { [TOAST_TITLE_ENV]: n.title, [TOAST_BODY_ENV]: n.body };
	const resolved = args.map((a) =>
		a === `$${TOAST_TITLE_ENV}` ? n.title : a === `$${TOAST_BODY_ENV}` ? n.body : a,
	);
	await transport.exec(command, resolved, env);
}

async function sendNtfy(
	n: Notification,
	settings: Record<string, unknown>,
	transport: NotificationTransport,
): Promise<void> {
	const topic = requireString(settings, "topic", "ntfy");
	const server =
		typeof settings.server === "string" && settings.server ? settings.server : "https://ntfy.sh";
	const headers: Record<string, string> = {
		"Content-Type": "text/plain; charset=utf-8",
		Title: headerSafe(n.title),
		Priority: NTFY_PRIORITY[n.level],
		Tags: NTFY_TAGS[n.level],
	};
	if (n.url) headers.Click = headerSafe(n.url);
	if (typeof settings.token === "string" && settings.token) {
		headers.Authorization = `Bearer ${settings.token}`;
	}
	await postOk(
		transport,
		`${server.replace(/\/+$/, "")}/${encodeURIComponent(topic)}`,
		n.body,
		headers,
	);
}

async function sendSlack(
	n: Notification,
	settings: Record<string, unknown>,
	transport: NotificationTransport,
): Promise<void> {
	const url = requireString(settings, "webhook_url", "slack");
	await postOk(transport, url, JSON.stringify({ text: `*${n.title}*\n${n.body}` }), {
		"Content-Type": "application/json",
	});
}

async function sendDiscord(
	n: Notification,
	settings: Record<string, unknown>,
	transport: NotificationTransport,
): Promise<void> {
	const url = requireString(settings, "webhook_url", "discord");
	const content = `**${n.title}**\n${n.body}`.slice(0, 2000);
	await postOk(transport, url, JSON.stringify({ content, allowed_mentions: { parse: [] } }), {
		"Content-Type": "application/json",
	});
}

async function sendGithub(n: Notification, transport: NotificationTransport): Promise<void> {
	const repo = n.url ? repoFromPrUrl(n.url) : null;
	const number = n.url ? Number.parseInt(/\/pull\/(\d+)/.exec(n.url)?.[1] ?? "", 10) : Number.NaN;
	if (!repo || !Number.isInteger(number)) throw new Error("the run has no pull request");
	await transport.comment(
		repo,
		number,
		`**${n.title}**\n\n${n.body}\n\n<!-- agentic-forge:notification -->`,
	);
}

export interface DeliveryReport {
	sent: ChannelId[];
	errors: { channel: ChannelId; error: string }[];
}

/** Sends a notification to the given channels, in parallel; a failing channel never stops the others. */
export async function deliver(
	n: Notification,
	channels: readonly ChannelId[],
	config: NotificationsConfig,
	transport: NotificationTransport = defaultTransport,
): Promise<DeliveryReport> {
	const report: DeliveryReport = { sent: [], errors: [] };
	await Promise.all(
		channels.map(async (channel) => {
			const settings = config.channels[channel].settings;
			try {
				if (channel === "desktop") await sendDesktop(n, transport);
				else if (channel === "ntfy") await sendNtfy(n, settings, transport);
				else if (channel === "slack") await sendSlack(n, settings, transport);
				else if (channel === "discord") await sendDiscord(n, settings, transport);
				else await sendGithub(n, transport);
				report.sent.push(channel);
			} catch (err) {
				report.errors.push({ channel, error: (err as Error).message });
			}
		}),
	);
	// Stable order for events and tests
	const order = (c: ChannelId) => ["desktop", "ntfy", "slack", "discord", "github"].indexOf(c);
	report.sent.sort((a, b) => order(a) - order(b));
	report.errors.sort((a, b) => order(a.channel) - order(b.channel));
	return report;
}
