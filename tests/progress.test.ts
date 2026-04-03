import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	STEP_STATUS,
	WORKFLOW_STATUS,
	createProgress,
	dictToProgress,
	generateWorkflowId,
	getProgressPath,
	loadProgress,
	prepareForResume,
	progressToDict,
	saveProgress,
	updateStepCompleted,
	updateStepFailed,
	updateStepSkipped,
	updateStepStarted,
} from "../src/progress.js";
import type { StepProgress, WorkflowProgress } from "../src/types.js";

function makeTempDir(): string {
	const dir = path.join(
		tmpdir(),
		`agentic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("WorkflowStatus constants", () => {
	it("should have all expected values", () => {
		expect(WORKFLOW_STATUS.PENDING).toBe("pending");
		expect(WORKFLOW_STATUS.RUNNING).toBe("running");
		expect(WORKFLOW_STATUS.COMPLETED).toBe("completed");
		expect(WORKFLOW_STATUS.FAILED).toBe("failed");
		expect(WORKFLOW_STATUS.PAUSED).toBe("paused");
		expect(WORKFLOW_STATUS.CANCELED).toBe("canceled");
	});
});

describe("StepStatus constants", () => {
	it("should have all expected values", () => {
		expect(STEP_STATUS.PENDING).toBe("pending");
		expect(STEP_STATUS.RUNNING).toBe("running");
		expect(STEP_STATUS.COMPLETED).toBe("completed");
		expect(STEP_STATUS.FAILED).toBe("failed");
		expect(STEP_STATUS.SKIPPED).toBe("skipped");
	});
});

describe("generateWorkflowId", () => {
	it("should follow expected format", () => {
		const id = generateWorkflowId("test-workflow");
		const parts = id.split("-");
		expect(parts.length).toBeGreaterThanOrEqual(4);
		expect(parts[0]).toHaveLength(8); // Date
		expect(parts[1]).toHaveLength(6); // Time
		expect(id).toContain("test");
		expect(id).toContain("workflow");
	});

	it("should sanitize spaces", () => {
		const id = generateWorkflowId("my test workflow");
		expect(id).not.toContain(" ");
		expect(id).toContain("my-test-workflow");
	});

	it("should sanitize underscores", () => {
		const id = generateWorkflowId("my_test_workflow");
		expect(id).not.toContain("_");
		expect(id).toContain("my-test-workflow");
	});

	it("should remove special characters", () => {
		const id = generateWorkflowId("test@workflow#name!");
		expect(id).not.toContain("@");
		expect(id).not.toContain("#");
		expect(id).not.toContain("!");
	});

	it("should produce valid IDs ending with workflow name", () => {
		const id1 = generateWorkflowId("test");
		const id2 = generateWorkflowId("test");
		expect(id1).toMatch(/-test$/);
		expect(id2).toMatch(/-test$/);
	});
});

describe("getProgressPath", () => {
	it("should return correct path", () => {
		const tempDir = makeTempDir();
		const p = getProgressPath("20260111-143052-test-workflow", tempDir);
		const expected = path.join(
			tempDir,
			"agentic",
			"outputs",
			"20260111-143052-test-workflow",
			"progress.json",
		);
		expect(p).toBe(expected);
	});

	it("should use cwd when no root specified", () => {
		const p = getProgressPath("test-workflow");
		expect(p).toContain("test-workflow");
		expect(p).toMatch(/progress\.json$/);
	});
});

describe("createProgress", () => {
	it("should create basic progress document", () => {
		const progress = createProgress("test-id", "test-workflow", ["step1", "step2", "step3"], {
			var1: "value1",
		});

		expect(progress.workflowId).toBe("test-id");
		expect(progress.workflowName).toBe("test-workflow");
		expect(progress.status).toBe(WORKFLOW_STATUS.RUNNING);
		expect(progress.pendingSteps).toEqual(["step1", "step2", "step3"]);
		expect(progress.variables).toEqual({ var1: "value1" });
		expect(progress.startedAt).toBeTruthy();
		expect(progress.completedSteps).toEqual([]);
		expect(progress.runningSteps).toEqual([]);
	});

	it("should make copies of lists and objects", () => {
		const stepNames = ["step1", "step2"];
		const variables = { key: "value" };

		const progress = createProgress("id", "name", stepNames, variables);

		stepNames.push("step3");
		(variables as Record<string, string>).newKey = "new_value";

		expect(progress.pendingSteps).toEqual(["step1", "step2"]);
		expect(progress.variables).toEqual({ key: "value" });
	});
});

describe("saveProgress and loadProgress", () => {
	it("should round-trip save and load", () => {
		const tempDir = makeTempDir();
		const progress = createProgress("test-save-load", "test-workflow", ["step1"], { var: "value" });

		saveProgress(progress, tempDir);
		const loaded = loadProgress("test-save-load", tempDir);

		expect(loaded).not.toBeNull();
		expect(loaded?.workflowId).toBe(progress.workflowId);
		expect(loaded?.workflowName).toBe(progress.workflowName);
		expect(loaded?.status).toBe(progress.status);
		expect(loaded?.variables).toEqual(progress.variables);
	});

	it("should return null for nonexistent progress", () => {
		const tempDir = makeTempDir();
		const loaded = loadProgress("nonexistent-workflow", tempDir);
		expect(loaded).toBeNull();
	});

	it("should create directories when saving", () => {
		const tempDir = makeTempDir();
		const progress = createProgress("new-workflow", "test", [], {});
		saveProgress(progress, tempDir);

		const expectedPath = path.join(tempDir, "agentic", "outputs", "new-workflow", "progress.json");
		expect(existsSync(expectedPath)).toBe(true);
	});

	it("should write valid JSON", () => {
		const tempDir = makeTempDir();
		const progress = createProgress("json-test", "test", ["step1"], {
			var: "value",
		});
		saveProgress(progress, tempDir);

		const progressPath = getProgressPath("json-test", tempDir);
		const data = JSON.parse(readFileSync(progressPath, "utf-8"));

		expect(data.workflow_id).toBe("json-test");
		expect(Array.isArray(data.pending_steps)).toBe(true);
	});
});

describe("Step updates", () => {
	it("should mark a step as started", () => {
		const progress = createProgress("test", "workflow", ["step1", "step2"], {});
		updateStepStarted(progress, "step1");

		expect(progress.pendingSteps).not.toContain("step1");
		expect(progress.runningSteps).toContain("step1");
		expect(progress.currentStep).not.toBeNull();
		expect(progress.currentStep?.name).toBe("step1");
	});

	it("should mark a step as completed", () => {
		const progress = createProgress("test", "workflow", ["step1"], {});
		updateStepStarted(progress, "step1");
		updateStepCompleted(progress, "step1", "Done", { result: "success" });

		expect(progress.runningSteps).not.toContain("step1");
		expect(progress.completedSteps).toHaveLength(1);
		expect(progress.completedSteps[0].name).toBe("step1");
		expect(progress.completedSteps[0].status).toBe(STEP_STATUS.COMPLETED);
		expect(progress.completedSteps[0].outputSummary).toBe("Done");
		expect(progress.stepOutputs.step1).toEqual({ result: "success" });
		expect(progress.currentStep).toBeNull();
	});

	it("should mark a step as failed", () => {
		const progress = createProgress("test", "workflow", ["step1"], {});
		updateStepStarted(progress, "step1");
		updateStepFailed(progress, "step1", "Something went wrong");

		expect(progress.runningSteps).not.toContain("step1");
		expect(progress.completedSteps).toHaveLength(1);
		expect(progress.completedSteps[0].status).toBe(STEP_STATUS.FAILED);
		expect(progress.completedSteps[0].error).toBe("Something went wrong");
		expect(progress.errors).toHaveLength(1);
		expect(progress.errors[0].step).toBe("step1");
	});

	it("should mark a step as skipped", () => {
		const progress = createProgress("test", "workflow", ["step1", "step2"], {});
		updateStepSkipped(progress, "step2");

		expect(progress.pendingSteps).not.toContain("step2");
		expect(progress.completedSteps).toHaveLength(1);
		expect(progress.completedSteps[0].status).toBe(STEP_STATUS.SKIPPED);
	});

	it("should preserve retry count", () => {
		const progress = createProgress("test", "workflow", ["step1"], {});
		updateStepStarted(progress, "step1");
		(progress.currentStep as Record<string, unknown>).retry_count = 3;

		updateStepCompleted(progress, "step1");

		expect(progress.completedSteps[0].retryCount).toBe(3);
	});
});

describe("Progress conversion", () => {
	it("should round-trip through dict", () => {
		const progress: WorkflowProgress = {
			schemaVersion: "1.0",
			workflowId: "test-id",
			workflowName: "test-workflow",
			status: "running",
			startedAt: "2026-01-11T14:30:00Z",
			completedAt: null,
			currentStep: null,
			completedSteps: [
				{
					name: "step1",
					status: "completed",
					startedAt: "2026-01-11T14:30:00Z",
					completedAt: "2026-01-11T14:31:00Z",
					retryCount: 0,
					outputSummary: "",
					error: null,
					humanInput: null,
				},
			],
			pendingSteps: ["step2"],
			runningSteps: [],
			parallelBranches: [],
			errors: [],
			variables: { var: "value" },
			stepOutputs: { step1: { result: "ok" } },
			workflowFile: "",
		};

		const data = progressToDict(progress);
		const restored = dictToProgress(data);

		expect(restored.workflowId).toBe(progress.workflowId);
		expect(restored.workflowName).toBe(progress.workflowName);
		expect(restored.status).toBe(progress.status);
		expect(restored.completedSteps).toHaveLength(1);
		expect(restored.completedSteps[0].name).toBe("step1");
		expect(restored.stepOutputs).toEqual(progress.stepOutputs);
	});

	it("should handle minimal dict", () => {
		const data = {
			workflow_id: "minimal",
			workflow_name: "test",
		};
		const progress = dictToProgress(data);

		expect(progress.workflowId).toBe("minimal");
		expect(progress.workflowName).toBe("test");
		expect(progress.status).toBe("pending");
		expect(progress.completedSteps).toEqual([]);
		expect(progress.pendingSteps).toEqual([]);
	});
});

describe("StepProgress defaults", () => {
	it("should use correct defaults when created via createProgress flow", () => {
		const progress = createProgress("test", "workflow", ["test"], {});
		updateStepStarted(progress, "test");
		updateStepCompleted(progress, "test");

		const step = progress.completedSteps[0];
		expect(step.name).toBe("test");
		expect(step.status).toBe("completed");
		expect(step.startedAt).toBeTruthy();
		expect(step.completedAt).toBeTruthy();
		expect(step.retryCount).toBe(0);
		expect(step.outputSummary).toBe("");
		expect(step.error).toBeNull();
		expect(step.humanInput).toBeNull();
	});
});

describe("prepareForResume", () => {
	it("should move running steps to pending", () => {
		const progress = createProgress("test", "workflow", ["step1", "step2"], {});
		updateStepStarted(progress, "step1");

		prepareForResume(progress);

		expect(progress.runningSteps).toEqual([]);
		expect(progress.pendingSteps).toContain("step1");
		expect(progress.currentStep).toBeNull();
		expect(progress.status).toBe(WORKFLOW_STATUS.RUNNING);
		expect(progress.completedAt).toBeNull();
	});

	it("should move current step to front of pending", () => {
		const progress = createProgress("test", "workflow", ["step1", "step2"], {});
		updateStepStarted(progress, "step1");
		// Manually clear running (simulate partial state)
		progress.runningSteps = [];

		prepareForResume(progress);

		expect(progress.pendingSteps[0]).toBe("step1");
		expect(progress.currentStep).toBeNull();
	});
});
