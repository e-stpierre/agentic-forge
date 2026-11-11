/**
 * The bundled workflows (ORC-023): only the generic demos ship, they parse,
 * and they use no skill steps or slash-command skill calls.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WorkflowParser } from "../src/parser.js";
import type { StepDefinition } from "../src/types.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "workflows");

const KEPT = [
	"claude-demo",
	"codex-demo",
	"multi-demo",
	"permission-test-claude",
	"permission-test-codex",
	"plan-loop",
	"ralph-loop",
];

function flatten(steps: StepDefinition[]): StepDefinition[] {
	return steps.flatMap((step) => [
		step,
		...flatten(step.steps ?? []),
		...flatten(step.thenSteps ?? []),
		...flatten(step.elseSteps ?? []),
	]);
}

describe("bundled workflows", () => {
	const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));

	it("ships only the generic demos", () => {
		expect(files.map((f) => f.replace(/\.yaml$/, "")).sort()).toEqual(KEPT);
	});

	it.each(files)("%s parses with generic steps only", (file) => {
		const workflow = new WorkflowParser().parseFile(path.join(dir, file));
		for (const step of flatten(workflow.steps)) {
			expect(step.type).not.toBe("skill");
			expect(step.agent ?? null).toBeNull();
		}
		expect(readFileSync(path.join(dir, file), "utf-8")).not.toMatch(/\/af-[a-z]/);
	});
});
