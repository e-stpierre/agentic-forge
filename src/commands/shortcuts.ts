/** Shortcut command handlers (input). */

import { cmdAnswer } from "./control.js";

/**
 * `af input <run> <response>`: answers the single pending `needs_input`
 * request of an awaiting-human run (a `human-input` step), like `af answer`
 * without a request id.
 */
export async function cmdInput(runId: string, response: string): Promise<void> {
	await cmdAnswer({ runId, answer: response });
}
