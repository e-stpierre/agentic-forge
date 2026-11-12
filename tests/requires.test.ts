/**
 * Tests for workflow `requires` (ORC-024): version range parsing, the check
 * against the running harness, and the refusal at dispatch, before any run
 * or step exists. `--ignore-requires` overrides only the version.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "../src/config.js";
import { WorkflowParseError, WorkflowParser } from "../src/parser.js";
import { checkRequires, isValidRange, parseRequires, satisfies } from "../src/requires.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunError, RunManager } from "../src/runs/manager.js";
import { fakeRuntime } from "./helpers/fake-runtime.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const { fakeRuntime: fake } = await import("./helpers/fake-runtime.js");
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return { ...original, runRuntime: fake.run };
});

describe("satisfies", () => {
	it.each([
		["0.12.0", ">=0.12", true],
		["0.11.0", ">=0.12", false],
		["0.12.3", ">=0.12 <1", true],
		["1.0.0", ">=0.12 <1", false],
		["0.12.5", "^0.12.0", true],
		["0.13.0", "^0.12.0", false],
		["1.4.0", "^1.2", true],
		["2.0.0", "^1.2", false],
		["0.12.9", "~0.12.1", true],
		["0.13.0", "~0.12.1", false],
		["0.12.4", "0.12", true],
		["0.13.0", "0.12", false],
		["0.12.0", "=0.12.0", true],
		["0.12.0", "<0.12 || >=0.12.0", true],
		["0.12.0", ">= 0.12", true],
		["0.12.0", "*", true],
		["0.12.0-beta.1", ">=0.12", true],
		["unknown", ">=0.12", false],
	])("%s against %s is %s", (version, range, expected) => {
		expect(satisfies(version, range)).toBe(expected);
	});

	it("rejects malformed ranges", () => {
		expect(isValidRange(">=abc")).toBe(false);
		expect(isValidRange(">=0.12 <1")).toBe(true);
	});
});

describe("parseRequires", () => {
	it("returns null when absent and reads both keys", () => {
		expect(parseRequires(undefined)).toBeNull();
		expect(parseRequires({ "agentic-forge": ">=0.12", contract: 1 })).toEqual({
			agenticForge: ">=0.12",
			contract: 1,
		});
	});

	it("refuses an unquoted number range (YAML drops trailing zeros)", () => {
		expect(() => parseRequires({ "agentic-forge": 0.1 })).toThrow(/must be a quoted string/);
	});

	it("rejects invalid blocks", () => {
		expect(() => parseRequires("0.12")).toThrow(/must be an object/);
		expect(() => parseRequires({ node: ">=22" })).toThrow(/unknown key/);
		expect(() => parseRequires({ "agentic-forge": "latest" })).toThrow(/not a valid version range/);
		expect(() => parseRequires({ contract: "1" })).toThrow(/positive integer/);
	});

	it("is parsed by the workflow parser, with errors as parse errors", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(
			'name: pack\nrequires: { agentic-forge: ">=0.12", contract: 1 }\nsteps: []\n',
		);
		expect(workflow.requires).toEqual({ agenticForge: ">=0.12", contract: 1 });
		expect(parser.parseString("name: plain\nsteps: []\n").requires).toBeNull();
		expect(() => parser.parseString("name: bad\nrequires: { contract: 0 }\nsteps: []\n")).toThrow(
			WorkflowParseError,
		);
	});
});

describe("checkRequires", () => {
	const requires = { agenticForge: ">=0.12", contract: 1 };

	it("passes when met and when there is no requires block", () => {
		expect(checkRequires("w", requires, { version: "0.12.0", contract: 1 })).toEqual({
			errors: [],
			warnings: [],
		});
		expect(checkRequires("w", null, { version: "0.1.0" }).errors).toEqual([]);
	});

	it("names the required and installed versions", () => {
		const result = checkRequires("esp-go", requires, { version: "0.11.0", contract: 1 });
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("requires agentic-forge >=0.12");
		expect(result.errors[0]).toContain("0.11.0 is installed");
		expect(result.errors[0]).toContain("--ignore-requires");
	});

	it("turns an unmet version into a warning with ignoreRequires", () => {
		const result = checkRequires("esp-go", requires, {
			version: "0.11.0",
			contract: 1,
			ignoreRequires: true,
		});
		expect(result.errors).toEqual([]);
		expect(result.warnings[0]).toContain("running anyway (--ignore-requires)");
	});

	it("never ignores a contract mismatch", () => {
		const result = checkRequires(
			"future",
			{ agenticForge: null, contract: 2 },
			{ version: "0.12.0", contract: 1, ignoreRequires: true },
		);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("requires harness contract 2");
		expect(result.errors[0]).toContain("implements contract 1");
		expect(result.errors[0]).toContain("upgrade agentic-forge");
	});
});

describe("dispatch", () => {
	const home = useTempGlobalRoot();
	let repo: string;
	const managers: RunManager[] = [];

	beforeEach(() => {
		fakeRuntime.reset();
		repo = mkdtempSync(path.join(tmpdir(), "af-requires-"));
	});

	afterEach(() => {
		for (const m of managers.splice(0)) m.close();
		rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	});

	function payload(requires: string, ignore = false): DispatchPayload {
		return {
			repo_root: repo,
			workflow: {
				path: path.join(repo, "pack.yaml"),
				contents: `name: pack\nrequires: ${requires}\nsteps:\n  - name: hello\n    type: prompt\n    prompt: Say hello\n`,
			},
			config: getDefaultConfig(),
			env: {},
			variables: {},
			...(ignore ? { ignore_requires: true } : {}),
		};
	}

	function manager(): RunManager {
		const m = new RunManager({ root: home.root, version: "0.11.0" });
		managers.push(m);
		return m;
	}

	it("refuses an unmet version before the run exists", async () => {
		const m = manager();
		const error = await m
			.dispatch(payload('{ agentic-forge: ">=0.12", contract: 1 }'))
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RunError);
		expect((error as RunError).status).toBe(400);
		expect((error as Error).message).toContain("requires agentic-forge >=0.12");
		expect((error as Error).message).toContain("0.11.0 is installed");
		expect(m.registry.list()).toHaveLength(0);
		expect(fakeRuntime.calls).toHaveLength(0);
	});

	it("runs with ignore_requires and returns the warning", async () => {
		const m = manager();
		const result = await m.dispatch(payload('{ agentic-forge: ">=0.12", contract: 1 }', true));
		expect(result.warnings.some((w) => w.includes("--ignore-requires"))).toBe(true);
		expect(m.registry.list()).toHaveLength(1);
	});

	it("refuses a contract mismatch even with ignore_requires", async () => {
		const m = manager();
		await expect(m.dispatch(payload("{ contract: 2 }", true))).rejects.toThrow(
			/requires harness contract 2/,
		);
		expect(m.registry.list()).toHaveLength(0);
	});
});
