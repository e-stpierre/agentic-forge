/** Tests for checkpoint manager. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createCheckpoint,
	getCheckpointPath,
	getLatestCheckpoint,
	readCheckpoints,
} from "../src/checkpoints/manager.js";

function makeTempDir(): string {
	const dir = path.join(
		tmpdir(),
		`agentic-chk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

let tempDir: string;

beforeEach(() => {
	tempDir = makeTempDir();
});

// --- getCheckpointPath ---

describe("getCheckpointPath", () => {
	it("should return path under agentic/outputs/<id>/checkpoint.md", () => {
		const result = getCheckpointPath("wf-001", tempDir);
		expect(result).toBe(path.join(tempDir, "agentic", "outputs", "wf-001", "checkpoint.md"));
	});

	it("should default to process.cwd() when no repoRoot provided", () => {
		const result = getCheckpointPath("wf-001");
		expect(result).toBe(path.join(process.cwd(), "agentic", "outputs", "wf-001", "checkpoint.md"));
	});
});

// --- readCheckpoints ---

describe("readCheckpoints", () => {
	it("should return empty array when checkpoint file does not exist", () => {
		const result = readCheckpoints("nonexistent", tempDir);
		expect(result).toEqual([]);
	});

	it("should return empty array for empty file", () => {
		const chkPath = getCheckpointPath("wf-empty", tempDir);
		mkdirSync(path.dirname(chkPath), { recursive: true });
		writeFileSync(chkPath, "", "utf-8");
		const result = readCheckpoints("wf-empty", tempDir);
		expect(result).toEqual([]);
	});

	it("should skip entries with invalid YAML frontmatter", () => {
		const chkPath = getCheckpointPath("wf-bad", tempDir);
		mkdirSync(path.dirname(chkPath), { recursive: true });
		writeFileSync(chkPath, "---\n: : : invalid\n---\nbody\n---\n", "utf-8");
		const result = readCheckpoints("wf-bad", tempDir);
		expect(result).toEqual([]);
	});

	it("should skip entries without checkpoint_id in frontmatter", () => {
		const chkPath = getCheckpointPath("wf-noid", tempDir);
		mkdirSync(path.dirname(chkPath), { recursive: true });
		writeFileSync(chkPath, "---\nstep: build\nstatus: done\n---\nbody\n---\n", "utf-8");
		const result = readCheckpoints("wf-noid", tempDir);
		expect(result).toEqual([]);
	});
});

// --- createCheckpoint ---

describe("createCheckpoint", () => {
	it("should create checkpoint file and return checkpoint id", () => {
		const id = createCheckpoint("wf-001", "build", "some context", "50%", "", "", tempDir);
		expect(id).toBe("chk-001");
		const chkPath = getCheckpointPath("wf-001", tempDir);
		expect(existsSync(chkPath)).toBe(true);
	});

	it("should increment checkpoint number for subsequent checkpoints", () => {
		const id1 = createCheckpoint("wf-002", "step1", "ctx1", "25%", "", "", tempDir);
		const id2 = createCheckpoint("wf-002", "step2", "ctx2", "75%", "", "", tempDir);
		expect(id1).toBe("chk-001");
		expect(id2).toBe("chk-002");
	});

	it("should include context and progress sections", () => {
		createCheckpoint(
			"wf-003",
			"build",
			"Build context here",
			"Build progress here",
			"",
			"",
			tempDir,
		);
		const content = readFileSync(getCheckpointPath("wf-003", tempDir), "utf-8");
		expect(content).toContain("## Context");
		expect(content).toContain("Build context here");
		expect(content).toContain("## Progress");
		expect(content).toContain("Build progress here");
	});

	it("should include notes section when provided", () => {
		createCheckpoint("wf-004", "build", "ctx", "prog", "Some notes", "", tempDir);
		const content = readFileSync(getCheckpointPath("wf-004", tempDir), "utf-8");
		expect(content).toContain("## Notes for Next Session");
		expect(content).toContain("Some notes");
	});

	it("should not include notes section when empty", () => {
		createCheckpoint("wf-005", "build", "ctx", "prog", "", "", tempDir);
		const content = readFileSync(getCheckpointPath("wf-005", tempDir), "utf-8");
		expect(content).not.toContain("## Notes for Next Session");
	});

	it("should include issues section when provided", () => {
		createCheckpoint("wf-006", "build", "ctx", "prog", "", "Bug found", tempDir);
		const content = readFileSync(getCheckpointPath("wf-006", tempDir), "utf-8");
		expect(content).toContain("## Issues Discovered");
		expect(content).toContain("Bug found");
	});

	it("should not include issues section when empty", () => {
		createCheckpoint("wf-007", "build", "ctx", "prog", "", "", tempDir);
		const content = readFileSync(getCheckpointPath("wf-007", tempDir), "utf-8");
		expect(content).not.toContain("## Issues Discovered");
	});

	it("should include frontmatter with step and workflow_id", () => {
		createCheckpoint("wf-008", "deploy", "ctx", "prog", "", "", tempDir);
		const content = readFileSync(getCheckpointPath("wf-008", tempDir), "utf-8");
		expect(content).toContain("step: deploy");
		expect(content).toContain("workflow_id: wf-008");
		expect(content).toContain("checkpoint_id: chk-001");
		expect(content).toContain("status: in_progress");
	});

	it("should create intermediate directories", () => {
		const deepDir = path.join(tempDir, "deep", "nested");
		// Don't create deepDir — let createCheckpoint handle it
		const id = createCheckpoint("wf-009", "build", "ctx", "prog", "", "", deepDir);
		expect(id).toBe("chk-001");
		expect(existsSync(getCheckpointPath("wf-009", deepDir))).toBe(true);
	});
});

// --- readCheckpoints with created data ---

describe("readCheckpoints with created data", () => {
	it("should parse back a created checkpoint", () => {
		createCheckpoint("wf-read", "build", "my context", "my progress", "", "", tempDir);
		const checkpoints = readCheckpoints("wf-read", tempDir);
		expect(checkpoints).toHaveLength(1);
		expect(checkpoints[0].checkpoint_id).toBe("chk-001");
		expect(checkpoints[0].step).toBe("build");
		expect(checkpoints[0].workflow_id).toBe("wf-read");
		expect(checkpoints[0].status).toBe("in_progress");
		expect(typeof checkpoints[0].content).toBe("string");
	});

	it("should parse multiple checkpoints in order", () => {
		createCheckpoint("wf-multi", "step1", "ctx1", "prog1", "", "", tempDir);
		createCheckpoint("wf-multi", "step2", "ctx2", "prog2", "", "", tempDir);
		createCheckpoint("wf-multi", "step3", "ctx3", "prog3", "", "", tempDir);
		const checkpoints = readCheckpoints("wf-multi", tempDir);
		expect(checkpoints).toHaveLength(3);
		expect(checkpoints[0].checkpoint_id).toBe("chk-001");
		expect(checkpoints[1].checkpoint_id).toBe("chk-002");
		expect(checkpoints[2].checkpoint_id).toBe("chk-003");
		expect(checkpoints[0].step).toBe("step1");
		expect(checkpoints[1].step).toBe("step2");
		expect(checkpoints[2].step).toBe("step3");
	});
});

// --- getLatestCheckpoint ---

describe("getLatestCheckpoint", () => {
	it("should return null when no checkpoints exist", () => {
		const result = getLatestCheckpoint("nonexistent", tempDir);
		expect(result).toBeNull();
	});

	it("should return the last checkpoint", () => {
		createCheckpoint("wf-latest", "step1", "ctx1", "prog1", "", "", tempDir);
		createCheckpoint("wf-latest", "step2", "ctx2", "prog2", "", "", tempDir);
		const latest = getLatestCheckpoint("wf-latest", tempDir);
		expect(latest).not.toBeNull();
		expect(latest?.checkpoint_id).toBe("chk-002");
		expect(latest?.step).toBe("step2");
	});

	it("should return the only checkpoint when there is one", () => {
		createCheckpoint("wf-single", "only-step", "ctx", "prog", "", "", tempDir);
		const latest = getLatestCheckpoint("wf-single", tempDir);
		expect(latest).not.toBeNull();
		expect(latest?.checkpoint_id).toBe("chk-001");
		expect(latest?.step).toBe("only-step");
	});
});
