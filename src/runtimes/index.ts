/** Runtime registry and resolution. */

import type { StepDefinition } from "../types.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import type { RuntimeAdapter, RuntimeId } from "./types.js";

/** Singleton adapter cache. */
const adapterCache = new Map<RuntimeId, RuntimeAdapter>();

/** Get the adapter for a given runtime ID (cached singleton). */
export function getAdapter(runtimeId: RuntimeId): RuntimeAdapter {
	const cached = adapterCache.get(runtimeId);
	if (cached) return cached;

	let adapter: RuntimeAdapter;
	switch (runtimeId) {
		case "claude":
			adapter = new ClaudeAdapter();
			break;
		case "codex":
			adapter = new CodexAdapter();
			break;
		default: {
			const _exhaustive: never = runtimeId;
			throw new Error(`Unknown runtime: ${_exhaustive}`);
		}
	}

	adapterCache.set(runtimeId, adapter);
	return adapter;
}

/** Resolve which runtime to use based on configuration hierarchy. */
export function resolveRuntime(
	step: Pick<StepDefinition, "runtime"> | null | undefined,
	workflowSettings: { runtime?: string | null } | null | undefined,
	config: Record<string, unknown>,
	cliRuntimeOverride?: string | null,
): RuntimeId {
	// Resolution order:
	// 1. Explicit step.runtime (most specific)
	// 2. CLI --runtime override
	// 3. Workflow settings.runtime
	// 4. Config defaults.runtime
	// 5. Hardcoded "claude" (fallback)

	const VALID_RUNTIMES = new Set<string>(["claude", "codex"]);

	function toRuntimeId(value: string, source: string): RuntimeId {
		if (!VALID_RUNTIMES.has(value)) {
			throw new Error(`Unknown runtime "${value}" (from ${source}). Valid values: claude, codex`);
		}
		return value as RuntimeId;
	}

	if (step?.runtime) {
		return toRuntimeId(step.runtime, "step.runtime");
	}

	if (cliRuntimeOverride) {
		return toRuntimeId(cliRuntimeOverride, "--runtime flag");
	}

	if (workflowSettings?.runtime) {
		return toRuntimeId(workflowSettings.runtime, "workflow settings.runtime");
	}

	const configDefaults = config.defaults as Record<string, unknown> | undefined;
	if (configDefaults?.runtime) {
		return toRuntimeId(String(configDefaults.runtime), "config defaults.runtime");
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
