/**
 * Run control command handlers: send, pause, answer, amend, retry-step and
 * reprioritize (cancel and resume live in status.ts and resume.ts).
 */

import { RunRegistry } from "../runs/registry.js";
import { CliExitError } from "./run.js";
import { resolveLegacyOutputDir } from "./status.js";

function requireRun(runId: string): void {
	if (new RunRegistry().get(runId)) return;
	if (resolveLegacyOutputDir(runId)) {
		throw new CliExitError(
			`Error: ${runId} is a legacy run (pre-supervisor) and is read-only. Finish or discard it manually.`,
		);
	}
	throw new CliExitError(`Error: Run not found: ${runId}`);
}

async function supervisorClient() {
	const { ensureSupervisor } = await import("../supervisor/client.js");
	const { getVersion } = await import("./version.js");
	const found = await ensureSupervisor({
		version: getVersion(),
		onWarn: (message) => process.stderr.write(`Warning: ${message}\n`),
	});
	return found.client;
}

export async function cmdSend(options: {
	runId: string;
	text: string;
	step?: string;
	from?: string;
	mode?: string;
}): Promise<void> {
	requireRun(options.runId);
	const client = await supervisorClient();
	try {
		const res = await client.request<{
			message: { id: string; target: string; step?: string };
			steered?: boolean;
		}>("POST", `/v1/runs/${encodeURIComponent(options.runId)}/messages`, {
			text: options.text,
			step: options.step ?? null,
			from: options.from ?? "user",
			mode: options.mode ?? "next",
		});
		const target = res.message.step ? `step '${res.message.step}'` : "the next step";
		if (options.mode === "now" && res.steered) {
			process.stdout.write(
				`Message sent: ${res.message.id} (delivered into the live session of ${options.runId})\n`,
			);
		} else if (options.mode === "now") {
			process.stdout.write(
				`Message sent: ${res.message.id} (a running step of ${options.runId} restarts with it now)\n`,
			);
		} else {
			process.stdout.write(
				`Message queued: ${res.message.id} (delivered to ${target} of ${options.runId})\n`,
			);
		}
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
}

export async function cmdPause(options: { runId: string; now?: boolean }): Promise<void> {
	requireRun(options.runId);
	const client = await supervisorClient();
	try {
		const res = await client.request<{ status: string }>(
			"POST",
			`/v1/runs/${encodeURIComponent(options.runId)}/pause`,
			{ now: options.now === true },
		);
		if (res.status === "paused") {
			process.stdout.write(`Run paused: ${options.runId}\n`);
		} else if (options.now) {
			process.stdout.write(`Pause requested: ${options.runId} stops its current step now\n`);
		} else {
			process.stdout.write(
				`Pause requested: ${options.runId} stops at its next step or iteration boundary\n`,
			);
		}
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
}

export async function cmdAnswer(options: {
	runId: string;
	/** Optional when the run has a single pending request. */
	requestId?: string;
	answer: string;
	from?: string;
}): Promise<void> {
	requireRun(options.runId);
	const client = await supervisorClient();
	try {
		const res = await client.request<{ request?: string; message: string | null }>(
			"POST",
			`/v1/runs/${encodeURIComponent(options.runId)}/answer`,
			{
				...(options.requestId ? { request_id: options.requestId } : {}),
				answer: options.answer,
				from: options.from ?? "user",
			},
		);
		const id = res.request ?? options.requestId;
		process.stdout.write(
			res.message === null
				? `Answered ${id}: the live session of ${options.runId} continues with the answer\n`
				: `Answered ${id}: ${options.runId} resumes and the step runs again with the answer\n`,
		);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
}

export async function cmdAmend(options: {
	runId: string;
	text: string;
	affects?: string;
	from?: string;
}): Promise<void> {
	requireRun(options.runId);
	const client = await supervisorClient();
	const affects = (options.affects ?? "")
		.split(",")
		.map((a) => a.trim())
		.filter(Boolean);
	try {
		const res = await client.request<{ amendment: string; delivery: string; step: string | null }>(
			"POST",
			`/v1/runs/${encodeURIComponent(options.runId)}/amend`,
			{ text: options.text, affects, from: options.from ?? "user" },
		);
		const how =
			res.delivery === "amend-step"
				? `the amend step '${res.step}' runs at the next step boundary`
				: "delivered as an operator message at the next boundary";
		process.stdout.write(`Amendment recorded: ${res.amendment} (${how})\n`);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
}

export async function cmdRetryStep(options: {
	runId: string;
	step: string;
	context?: string;
	from?: string;
}): Promise<void> {
	requireRun(options.runId);
	const client = await supervisorClient();
	try {
		await client.request<{ status: string }>(
			"POST",
			`/v1/runs/${encodeURIComponent(options.runId)}/retry`,
			{ step: options.step, context: options.context ?? null, from: options.from ?? "user" },
		);
		process.stdout.write(
			`Run queued: ${options.runId} reruns '${options.step}' and every later step\n`,
		);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
}

export async function cmdReprioritize(options: { runId: string; priority: string }): Promise<void> {
	requireRun(options.runId);
	const priority = Number(options.priority);
	if (!Number.isInteger(priority)) {
		throw new CliExitError(`Error: priority must be an integer, got '${options.priority}'`);
	}
	const client = await supervisorClient();
	try {
		await client.request("POST", `/v1/runs/${encodeURIComponent(options.runId)}/priority`, {
			priority,
		});
		process.stdout.write(`Priority of ${options.runId}: ${priority}\n`);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
}
