/** Tests for resolveRuntime resolution logic. */

import { describe, expect, it } from "vitest";
import { resolveRuntime } from "../../src/runtimes/index.js";
import type { StepDefinition } from "../../src/types.js";

function makeStep(runtime?: string | null): StepDefinition {
	return {
		name: "test-step",
		type: "prompt",
		prompt: "test",
		runtime: runtime ?? null,
		steps: [],
		mergeStrategy: "wait-all",
		mergeMode: "merge",
		thenSteps: [],
		elseSteps: [],
		maxIterations: 5,
		pollingInterval: 30,
		onTimeout: "fail",
		onError: "fail",
		checkpoint: false,
	};
}

function makeConfig(defaultRuntime?: string): Record<string, unknown> {
	return {
		defaults: defaultRuntime ? { runtime: defaultRuntime } : {},
	};
}

describe("resolveRuntime", () => {
	it("step.runtime overrides everything", () => {
		const result = resolveRuntime(
			makeStep("codex"),
			{ runtime: "claude" },
			makeConfig("claude"),
			"claude",
		);
		expect(result).toBe("codex");
	});

	it("CLI override takes precedence over workflow settings", () => {
		const result = resolveRuntime(
			makeStep(null),
			{ runtime: "claude" },
			makeConfig("claude"),
			"codex",
		);
		expect(result).toBe("codex");
	});

	it("workflow settings override config default", () => {
		const result = resolveRuntime(makeStep(null), { runtime: "codex" }, makeConfig("claude"), null);
		expect(result).toBe("codex");
	});

	it("config default overrides hardcoded fallback", () => {
		const result = resolveRuntime(makeStep(null), { runtime: null }, makeConfig("codex"), null);
		expect(result).toBe("codex");
	});

	it("falls back to claude when all sources are null/absent", () => {
		const result = resolveRuntime(makeStep(null), {}, {}, null);
		expect(result).toBe("claude");
	});

	it("step.runtime beats CLI override", () => {
		const result = resolveRuntime(makeStep("claude"), {}, {}, "codex");
		expect(result).toBe("claude");
	});

	it("step.runtime beats workflow settings", () => {
		const result = resolveRuntime(makeStep("claude"), { runtime: "codex" }, {}, null);
		expect(result).toBe("claude");
	});

	it("CLI override beats config default", () => {
		const result = resolveRuntime(makeStep(null), {}, makeConfig("claude"), "codex");
		expect(result).toBe("codex");
	});

	it("throws on unknown runtime IDs", () => {
		expect(() => resolveRuntime(makeStep("future-agent"), {}, {}, null)).toThrow(
			'Unknown runtime "future-agent"',
		);
	});

	it("ignores empty string as falsy (falls to next level)", () => {
		const result = resolveRuntime(makeStep(""), {}, makeConfig("codex"), null);
		// Empty string is falsy, so falls through to config default
		expect(result).toBe("codex");
	});

	it("workflow settings.runtime is used when step is empty object (orchestrator pattern)", () => {
		// The orchestrator calls resolveRuntime({}, workflow.settings, config, override)
		// with an empty step object. settings.runtime must still be honored.
		const result = resolveRuntime({}, { runtime: "codex" }, makeConfig("claude"), null);
		expect(result).toBe("codex");
	});

	it("workflow settings.runtime is used when step is null", () => {
		const result = resolveRuntime(null, { runtime: "codex" }, makeConfig("claude"), null);
		expect(result).toBe("codex");
	});
});
