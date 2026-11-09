import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CONTRACT_ARTIFACTS,
	CONTRACT_VERSION,
	EXIT_CODES,
	artifactForFile,
	exitCodeFor,
	getContractSchemaDir,
	parseFrontmatter,
	schemaId,
	validateArtifact,
	validateContractFile,
} from "../src/contract/index.js";

const SCHEMA_DIR = getContractSchemaDir();
const FIXTURES = join(SCHEMA_DIR, "fixtures");

function fixtures(artifact: string, kind: "valid" | "invalid"): string[] {
	return readdirSync(join(FIXTURES, artifact, kind)).filter((f) => f.endsWith(".json"));
}

function readFixture(artifact: string, kind: "valid" | "invalid", file: string): unknown {
	return JSON.parse(readFileSync(join(FIXTURES, artifact, kind, file), "utf8"));
}

describe("contract v1 schemas", () => {
	it("has one schema per artifact plus common, each with a v1 URN id", () => {
		const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json"));
		expect(files.sort()).toEqual(
			[...CONTRACT_ARTIFACTS, "common"].map((a) => `${a}.schema.json`).sort(),
		);
		for (const file of files) {
			const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8"));
			const artifact = file.replace(".schema.json", "");
			expect(schema.$id).toBe(`urn:harness-contract:v1:${artifact}`);
			expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
			expect(schema.title).toMatch(/^Harness contract v1: /);
		}
	});

	it("names no product or local path, so any skill pack can copy the schemas", () => {
		for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json"))) {
			const text = readFileSync(join(SCHEMA_DIR, file), "utf8");
			expect(text).not.toMatch(/esp-skills|agentic-forge|plugins\//);
		}
	});

	it("exposes schema ids by artifact name", () => {
		expect(schemaId("run")).toBe("urn:harness-contract:v1:run");
	});
});

describe.each([...CONTRACT_ARTIFACTS])("fixtures: %s", (artifact) => {
	const valid = fixtures(artifact, "valid");
	const invalid = fixtures(artifact, "invalid");

	it("has valid and invalid fixtures", () => {
		expect(valid.length).toBeGreaterThan(0);
		expect(invalid.length).toBeGreaterThan(0);
	});

	it.each(valid)("accepts valid/%s", (file) => {
		const result = validateArtifact(artifact, readFixture(artifact, "valid", file));
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
	});

	it.each(invalid)("rejects invalid/%s", (file) => {
		const result = validateArtifact(artifact, readFixture(artifact, "invalid", file));
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});
});

describe("validateArtifact", () => {
	it("pins contract_version to 1", () => {
		expect(CONTRACT_VERSION).toBe(1);
		const run = readFixture("run", "valid", "minimal.json") as Record<string, unknown>;
		expect(validateArtifact("run", { ...run, contract_version: 2 }).valid).toBe(false);
	});

	it("allows x- extension fields but rejects other unknown fields", () => {
		const base = { status: "done", summary: "Done." };
		expect(validateArtifact("result", { ...base, "x-pack-note": "ok" }).valid).toBe(true);
		const result = validateArtifact("result", { ...base, note: "nope" });
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes('unknown field "note"'))).toBe(true);
	});

	it("rejects extension fields on the event envelope", () => {
		const event = { seq: 1, at: "2026-11-10T12:00:00Z", run: "r1", type: "run.started" };
		expect(validateArtifact("event", event).valid).toBe(true);
		expect(validateArtifact("event", { ...event, "x-pack": 1 }).valid).toBe(false);
	});

	it("requires status awaiting-human when needs_input is set", () => {
		const needsInput = readFixture("needs-input", "valid", "free-form.json");
		const block = { summary: "Need a decision.", needs_input: needsInput };
		expect(validateArtifact("result", { ...block, status: "awaiting-human" }).valid).toBe(true);
		expect(validateArtifact("result", { ...block, status: "done" }).valid).toBe(false);
	});
});

describe("exit codes", () => {
	it("maps result statuses to the contract exit codes", () => {
		expect(EXIT_CODES).toEqual({
			done: 0,
			merged: 0,
			"awaiting-human": 10,
			halted: 20,
			escalate: 30,
			failed: 1,
		});
		expect(exitCodeFor("awaiting-human")).toBe(10);
		expect(exitCodeFor("unknown")).toBe(1);
	});
});

describe("contract files", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "af-contract-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("infers the artifact from the file name", () => {
		expect(artifactForFile("run/run.json")).toBe("run");
		expect(artifactForFile("run/steps/01-plan/result.json")).toBe("result");
		expect(artifactForFile("run/events.jsonl")).toBe("event");
		expect(artifactForFile("run/decisions.jsonl")).toBe("decision");
		expect(artifactForFile("run/amendments.jsonl")).toBe("amendment");
		expect(artifactForFile("run/inbox/20261110T120000000Z-m001.json")).toBe("inbox-message");
		expect(artifactForFile("run/summary.md")).toBe("summary-frontmatter");
		expect(artifactForFile("run/plan.md")).toBeNull();
	});

	it("validates summary.md frontmatter and keeps dates as strings", () => {
		const text = readFileSync(join(FIXTURES, "summary-frontmatter", "valid", "summary.md"), "utf8");
		const frontmatter = parseFrontmatter(text) as Record<string, unknown>;
		expect(frontmatter.task).toBe("2026-11-10-fix-login-timeout");
		expect(frontmatter.duration_minutes).toBe(38);
		writeFileSync(join(dir, "summary.md"), text);
		expect(validateContractFile(join(dir, "summary.md")).valid).toBe(true);

		writeFileSync(join(dir, "summary.md"), "# No frontmatter\n");
		const missing = validateContractFile(join(dir, "summary.md"));
		expect(missing.valid).toBe(false);
		expect(missing.errors[0].message).toBe("missing YAML frontmatter");
	});

	it("checks jsonl line by line and event seq continuity", () => {
		const event = (seq: number) =>
			JSON.stringify({ seq, at: "2026-11-10T12:00:00Z", run: "r1", type: "step.started" });
		writeFileSync(join(dir, "events.jsonl"), `${event(1)}\n${event(2)}\n`);
		expect(validateContractFile(join(dir, "events.jsonl")).valid).toBe(true);

		writeFileSync(join(dir, "events.jsonl"), `${event(1)}\n${event(3)}\nnot json\n`);
		const result = validateContractFile(join(dir, "events.jsonl"));
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual({ line: 2, path: "/seq", message: "expected 2, got 3" });
		expect(result.errors.some((e) => e.line === 3 && e.message.startsWith("invalid JSON"))).toBe(
			true,
		);
	});

	it("compares event seq to the physical line and rejects interior blank lines", () => {
		const event = (seq: number) =>
			JSON.stringify({ seq, at: "2026-11-10T12:00:00Z", run: "r1", type: "step.started" });
		writeFileSync(join(dir, "events.jsonl"), `${event(1)}\n\n${event(2)}\n`);
		const result = validateContractFile(join(dir, "events.jsonl"));
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual({
			line: 2,
			path: "(root)",
			message: "blank line inside a jsonl file",
		});
		expect(result.errors).toContainEqual({ line: 3, path: "/seq", message: "expected 3, got 2" });

		writeFileSync(join(dir, "events.jsonl"), `${event(1)}\r\n${event(2)}\r\n\r\n`);
		expect(validateContractFile(join(dir, "events.jsonl")).valid).toBe(true);
	});

	it("requires a step name on step-targeted inbox messages", () => {
		const base = {
			id: "m1",
			at: "2026-11-10T12:00:00Z",
			from: "user",
			mode: "next",
			text: "Hi.",
		};
		expect(validateArtifact("inbox-message", { ...base, target: "run" }).valid).toBe(true);
		expect(validateArtifact("inbox-message", { ...base, target: "run", step: null }).valid).toBe(
			true,
		);
		expect(validateArtifact("inbox-message", { ...base, target: "step" }).valid).toBe(false);
		expect(validateArtifact("inbox-message", { ...base, target: "step", step: "" }).valid).toBe(
			false,
		);
		expect(
			validateArtifact("inbox-message", { ...base, target: "step", step: "02-build-M1" }).valid,
		).toBe(true);
	});

	it("validates inbox messages and run.json files", () => {
		mkdirSync(join(dir, "inbox"));
		const message = readFixture("inbox-message", "valid", "delivered.json");
		writeFileSync(join(dir, "inbox", "20261110T120000000Z-m001.json"), JSON.stringify(message));
		expect(validateContractFile(join(dir, "inbox", "20261110T120000000Z-m001.json")).valid).toBe(
			true,
		);

		writeFileSync(join(dir, "run.json"), JSON.stringify({ contract_version: 1 }));
		expect(validateContractFile(join(dir, "run.json")).valid).toBe(false);
	});

	it("throws on files it cannot classify", () => {
		writeFileSync(join(dir, "plan.md"), "# Plan\n");
		expect(() => validateContractFile(join(dir, "plan.md"))).toThrow(/Cannot infer/);
	});
});

describe("packaging", () => {
	it("ships the schemas in the npm package", () => {
		const pkg = JSON.parse(readFileSync(join(SCHEMA_DIR, "..", "..", "package.json"), "utf8"));
		expect(pkg.files).toContain("schemas");
	});
});
