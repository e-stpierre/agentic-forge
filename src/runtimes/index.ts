/** Runtime registry and resolution. */

import type { StepDefinition } from "../types.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import type { RuntimeAdapter, RuntimeId } from "./types.js";

/** Get the adapter for a given runtime ID. */
export function getAdapter(runtimeId: RuntimeId): RuntimeAdapter {
	switch (runtimeId) {
		case "claude":
			return new ClaudeAdapter();
		case "codex":
			return new CodexAdapter();
	}
}

/** Resolve which runtime to use based on configuration hierarchy. */
export function resolveRuntime(
	step: StepDefinition,
	workflowSettings: { runtime?: string | null },
	config: Record<string, unknown>,
	cliRuntimeOverride?: string | null,
): RuntimeId {
	// Resolution order:
	// 1. Explicit step.runtime (most specific)
	// 2. CLI --runtime override
	// 3. Workflow settings.runtime
	// 4. Config defaults.runtime
	// 5. Hardcoded "claude" (fallback)

	if (step.runtime) {
		return step.runtime as RuntimeId;
	}

	if (cliRuntimeOverride) {
		return cliRuntimeOverride as RuntimeId;
	}

	if (workflowSettings.runtime) {
		return workflowSettings.runtime as RuntimeId;
	}

	const configDefaults = config.defaults as Record<string, unknown> | undefined;
	if (configDefaults?.runtime) {
		return configDefaults.runtime as RuntimeId;
	}

	return "claude";
}

export { ClaudeAdapter } from "./claude.js";
export { CodexAdapter } from "./codex.js";
export type {
	RuntimeAdapter,
	RuntimeId,
	RuntimeRunOptions,
	RuntimeResult,
	StreamEvent,
} from "./types.js";
export { SessionOutput } from "./types.js";
