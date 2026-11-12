/**
 * Notification messages: a title and a plain-text body built from a run event
 * and its run, with the CLI and MCP commands that act on it. Templates (from
 * `notifications.templates.<event>`) use `{{name}}` placeholders over the same
 * variables as the defaults.
 */

import type { RunEvent } from "../runs/run-store.js";
import type { NotificationLevel, Template } from "./config.js";

/** What a notification says about its run. */
export interface RunFacts {
	id: string;
	workflow: string | null;
	repo: string | null;
	status: string | null;
	type: string | null;
	pr: string | null;
}

export interface Notification {
	title: string;
	body: string;
	level: NotificationLevel;
	/** Run id, or null for an `af notify` without a run. */
	run: string | null;
	/** Event type that triggered it, or `af_notify`. */
	trigger: string;
	/** Link opened from the notification (the run's pull request), or null. */
	url: string | null;
}

/** Longest body sent to any channel (Discord allows 2000 characters per message). */
export const MAX_BODY_CHARS = 1800;

const DEFAULT_TEMPLATES: Record<string, Required<Template>> = {
	needs_input: {
		title: "af: {{run}} needs input",
		body: [
			"{{run_line}}",
			"Question ({{request_id}}): {{question}}",
			"{{context}}",
			"{{options}}",
			"Answer: {{answer_cli}}",
			"MCP: {{answer_mcp}}",
		].join("\n"),
	},
	"run.failed": {
		title: "af: {{run}} failed",
		body: [
			"{{run_line}}",
			"{{reason}}",
			"Inspect: af status {{run}} (MCP: af_status(run: {{run_json}}))",
			"Resume: af resume {{run}} (MCP: af_resume(run: {{run_json}}))",
		].join("\n"),
	},
	"run.halted": {
		title: "af: {{run}} halted",
		body: [
			"{{run_line}}",
			"{{reason}}",
			"Inspect: af status {{run}} (MCP: af_status(run: {{run_json}}))",
			"Retry a step: af retry-step {{run}} <step> (MCP: af_retry_step(run: {{run_json}}, step: ...))",
		].join("\n"),
	},
	"run.completed": {
		title: "af: {{run}} completed",
		body: ["{{run_line}}", "{{pr_line}}", "Summary: af artifacts {{run}} --kind summary"].join(
			"\n",
		),
	},
	default: {
		title: "af: {{run}} {{event}}",
		body: ["{{run_line}}", "{{reason}}", "Events: af events --run {{run}}"].join("\n"),
	},
};

/** Replaces `{{ name }}` placeholders; unknown names become empty strings. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) => vars[name] ?? "");
}

/** Drops empty lines left by empty placeholders and caps the length. */
function tidy(text: string, max: number): string {
	const lines = text
		.split("\n")
		.map((l) => l.trimEnd())
		.filter((l) => l.trim().length > 0);
	const joined = lines.join("\n");
	return joined.length > max ? `${joined.slice(0, max - 3)}...` : joined;
}

function str(value: unknown): string {
	return typeof value === "string" ? value : value == null ? "" : String(value);
}

function levelFor(type: string, data: Record<string, unknown>): NotificationLevel {
	if (type === "run.failed" || type === "step.failed") return "error";
	if (type === "needs_input") return data.blocking === false ? "info" : "warning";
	if (type === "run.halted") return "warning";
	return "info";
}

function optionLines(data: Record<string, unknown>): string {
	const options = Array.isArray(data.options) ? data.options : [];
	const recommended = str(data.recommended);
	return options
		.map((o) => {
			const opt = (o ?? {}) as Record<string, unknown>;
			const id = str(opt.id);
			const mark = id && id === recommended ? " (recommended)" : "";
			return `  ${id}: ${str(opt.label)}${mark}`;
		})
		.join("\n");
}

/** Variables shared by the default templates and the configured ones. */
export function templateVars(event: RunEvent, run: RunFacts): Record<string, string> {
	const data = event.data ?? {};
	const requestId = str(data.id);
	const options = Array.isArray(data.options) ? data.options : [];
	const recommended = str(data.recommended);
	const firstOption = str((options[0] as Record<string, unknown> | undefined)?.id);
	const example = recommended || firstOption || "<answer>";
	const where = [run.workflow ? `workflow ${run.workflow}` : "", run.repo ? `repo ${run.repo}` : ""]
		.filter(Boolean)
		.join(", ");
	const step = str(data.step);
	const runLine = `Run ${run.id}${where ? ` (${where})` : ""}${step ? `, step ${step}` : ""}`;
	const reason = str(data.error) || str(data.reason) || str(data.summary);
	return {
		run: run.id,
		run_json: JSON.stringify(run.id),
		run_line: `${runLine}.`,
		workflow: run.workflow ?? "",
		repo: run.repo ?? "",
		status: str(data.status) || (run.status ?? ""),
		run_type: run.type ?? "",
		pr: run.pr ?? "",
		pr_line: run.pr ? `PR: ${run.pr}` : "",
		event: event.type,
		step,
		reason,
		request_id: requestId,
		question: str(data.question),
		context: str(data.context),
		options: optionLines(data),
		recommended,
		answer_cli: requestId ? `af answer ${run.id} ${requestId} ${example}` : "",
		answer_mcp: requestId
			? `af_answer(run: ${JSON.stringify(run.id)}, request_id: ${JSON.stringify(requestId)}, answer: ${JSON.stringify(example)})`
			: "",
	};
}

/** Builds the notification for a run event, with the configured template when there is one. */
export function buildNotification(
	event: RunEvent,
	run: RunFacts,
	templates: Record<string, Template> = {},
): Notification {
	const vars = templateVars(event, run);
	const base = DEFAULT_TEMPLATES[event.type] ?? DEFAULT_TEMPLATES.default;
	const own = templates[event.type] ?? {};
	return {
		title: tidy(renderTemplate(own.title ?? base.title, vars), 200),
		body: tidy(renderTemplate(own.body ?? base.body, vars), MAX_BODY_CHARS),
		level: levelFor(event.type, event.data ?? {}),
		run: run.id,
		trigger: event.type,
		url: run.pr,
	};
}

/** The notification of an `af notify` / `af_notify` call. */
export function manualNotification(input: {
	text: string;
	title?: string | null;
	level?: NotificationLevel;
	run?: RunFacts | null;
}): Notification {
	const run = input.run ?? null;
	return {
		title: tidy(input.title || (run ? `af: ${run.id}` : "agentic-forge"), 200),
		body: tidy(input.text, MAX_BODY_CHARS),
		level: input.level ?? "info",
		run: run?.id ?? null,
		trigger: "af_notify",
		url: run?.pr ?? null,
	};
}
