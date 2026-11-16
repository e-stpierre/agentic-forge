/** Shortcut command handlers (input). */

import { processHumanInput } from "../orchestrator.js";

export function cmdInput(workflowId: string, response: string): void {
	if (processHumanInput(workflowId, response)) {
		process.stdout.write(`Input recorded for workflow: ${workflowId}\n`);
	} else {
		process.exit(1);
	}
}
