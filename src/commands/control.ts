/** Run control command handlers: send and pause (cancel and resume live in status.ts and resume.ts). */

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
		const res = await client.request<{ message: { id: string; target: string; step?: string } }>(
			"POST",
			`/v1/runs/${encodeURIComponent(options.runId)}/messages`,
			{
				text: options.text,
				step: options.step ?? null,
				from: options.from ?? "user",
				mode: options.mode ?? "next",
			},
		);
		const target = res.message.step ? `step '${res.message.step}'` : "the next step";
		process.stdout.write(
			`Message queued: ${res.message.id} (delivered to ${target} of ${options.runId})\n`,
		);
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
