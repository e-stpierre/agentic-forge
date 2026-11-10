/** Resume command handler: re-queues a supervisor run from its last completed step. */

import { exitCodeFor } from "../contract/index.js";
import { RunRegistry } from "../runs/registry.js";
import { CliExitError } from "./run.js";
import { resolveLegacyOutputDir } from "./status.js";

export async function cmdResume(options: {
	workflowId: string;
	foreground?: boolean;
}): Promise<void> {
	const entry = new RunRegistry().get(options.workflowId);
	if (!entry) {
		if (resolveLegacyOutputDir(options.workflowId)) {
			throw new CliExitError(
				`Error: ${options.workflowId} is a legacy run (pre-supervisor outputs/) and cannot be resumed.\nFinish it with the agentic-forge version that started it, or discard it.`,
			);
		}
		throw new CliExitError(`Error: Run not found: ${options.workflowId}`);
	}

	const { ensureSupervisor } = await import("../supervisor/client.js");
	const { followRun, formatEvent } = await import("../runs/client.js");
	const { getVersion } = await import("./version.js");
	const { client } = await ensureSupervisor({
		version: getVersion(),
		onWarn: (message) => process.stderr.write(`Warning: ${message}\n`),
	});
	const eventsRoute = `/v1/runs/${encodeURIComponent(entry.id)}/events`;
	let after = 0;
	try {
		after = (await client.request<{ events: { seq: number }[] }>("GET", eventsRoute)).events.length;
		await client.request("POST", `/v1/runs/${encodeURIComponent(entry.id)}/resume`);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
	process.stdout.write(`Run resumed: ${entry.id}\n`);
	if (!options.foreground) return;

	const controller = new AbortController();
	const onSigint = () => controller.abort();
	process.on("SIGINT", onSigint);
	let status: string;
	try {
		status = await followRun(client, entry.id, {
			after,
			signal: controller.signal,
			onEvent: (event) => process.stdout.write(`${formatEvent(event)}\n`),
		});
	} finally {
		process.off("SIGINT", onSigint);
	}
	if (status === "detached") {
		process.stdout.write("\nDetached. The run continues in the supervisor.\n");
		return;
	}
	process.stdout.write(`\nWorkflow ${status}: ${entry.id}\n`);
	const code = status === "done" || status === "merged" ? 0 : exitCodeFor(status);
	if (code !== 0) throw new CliExitError(`Run ${entry.id} ended with status '${status}'`, code);
}
