import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkflowParseError, WorkflowParser } from "../src/parser.js";

// --- Fixtures ---

const sampleWorkflowYaml = `
name: test-workflow
version: "1.0"
description: A test workflow
steps:
  - name: test-step
    type: prompt
    prompt: "Test prompt"
`;

const sampleParallelWorkflowYaml = `
name: parallel-workflow
version: "1.0"
description: A workflow with parallel steps
steps:
  - name: parallel-step
    type: parallel
    steps:
      - name: branch-a
        type: serial
        steps:
          - name: task-a1
            type: prompt
            prompt: "Task A1"
      - name: branch-b
        type: serial
        steps:
          - name: task-b1
            type: prompt
            prompt: "Task B1"
`;

const sampleConditionalWorkflowYaml = `
name: conditional-workflow
version: "1.0"
description: A workflow with conditional steps
variables:
  - name: run_tests
    type: boolean
    default: true
steps:
  - name: check-tests
    type: conditional
    condition: "variables.run_tests"
    then:
      - name: run-tests
        type: prompt
        prompt: "Run tests"
    else:
      - name: skip-tests
        type: prompt
        prompt: "Tests skipped"
`;

function makeTempDir(): string {
	const dir = path.join(
		tmpdir(),
		`agentic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("WorkflowParser", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = makeTempDir();
	});

	it("should parse a minimal workflow from file", () => {
		const filePath = path.join(tempDir, "workflow.yaml");
		writeFileSync(filePath, sampleWorkflowYaml);

		const parser = new WorkflowParser();
		const workflow = parser.parseFile(filePath);

		expect(workflow.name).toBe("test-workflow");
		expect(workflow.version).toBe("1.0");
		expect(workflow.description).toBe("A test workflow");
		expect(workflow.steps).toHaveLength(1);
		expect(workflow.steps[0].name).toBe("test-step");
		expect(workflow.steps[0].type).toBe("prompt");
		expect(workflow.steps[0].prompt).toBe("Test prompt");
	});

	it("should parse workflow from string", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(sampleWorkflowYaml);

		expect(workflow.name).toBe("test-workflow");
		expect(workflow.steps).toHaveLength(1);
	});

	it("should throw on missing name field", () => {
		const filePath = path.join(tempDir, "workflow.yaml");
		writeFileSync(filePath, "steps: []");

		const parser = new WorkflowParser();
		expect(() => parser.parseFile(filePath)).toThrow(WorkflowParseError);
		expect(() => parser.parseFile(filePath)).toThrow("Missing required field: name");
	});

	it("should throw on invalid YAML syntax", () => {
		const filePath = path.join(tempDir, "workflow.yaml");
		writeFileSync(filePath, "name: [invalid yaml");

		const parser = new WorkflowParser();
		expect(() => parser.parseFile(filePath)).toThrow(WorkflowParseError);
		expect(() => parser.parseFile(filePath)).toThrow("Invalid YAML");
	});

	it("should throw on nonexistent file", () => {
		const filePath = path.join(tempDir, "nonexistent.yaml");

		const parser = new WorkflowParser();
		expect(() => parser.parseFile(filePath)).toThrow(WorkflowParseError);
		expect(() => parser.parseFile(filePath)).toThrow("Workflow file not found");
	});

	it("should throw on invalid step type", () => {
		const filePath = path.join(tempDir, "workflow.yaml");
		writeFileSync(
			filePath,
			`
name: test
steps:
  - name: bad-step
    type: invalid-type
`,
		);

		const parser = new WorkflowParser();
		expect(() => parser.parseFile(filePath)).toThrow(WorkflowParseError);
		expect(() => parser.parseFile(filePath)).toThrow("Invalid step type");
	});

	it("should parse workflow with parallel steps", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(sampleParallelWorkflowYaml);

		expect(workflow.name).toBe("parallel-workflow");
		expect(workflow.steps).toHaveLength(1);

		const parallelStep = workflow.steps[0];
		expect(parallelStep.type).toBe("parallel");
		expect(parallelStep.steps).toHaveLength(2);
		expect(parallelStep.steps[0].name).toBe("branch-a");
		expect(parallelStep.steps[0].type).toBe("serial");
	});

	it("should parse workflow with conditional steps", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(sampleConditionalWorkflowYaml);

		expect(workflow.name).toBe("conditional-workflow");
		expect(workflow.variables).toHaveLength(1);
		expect(workflow.variables[0].name).toBe("run_tests");
		expect(workflow.variables[0].type).toBe("boolean");
		expect(workflow.variables[0].default).toBe(true);

		const conditionalStep = workflow.steps[0];
		expect(conditionalStep.type).toBe("conditional");
		expect(conditionalStep.condition).toBe("variables.run_tests");
		expect(conditionalStep.thenSteps).toHaveLength(1);
		expect(conditionalStep.elseSteps).toHaveLength(1);
	});

	it("should throw on non-dict workflow", () => {
		const parser = new WorkflowParser();
		expect(() => parser.parseString("- item1\n- item2")).toThrow("must be a dictionary");
	});

	it("should throw on nested parallel steps", () => {
		const filePath = path.join(tempDir, "workflow.yaml");
		writeFileSync(
			filePath,
			`
name: nested-parallel
steps:
  - name: outer-parallel
    type: parallel
    steps:
      - name: inner-parallel
        type: parallel
        steps: []
`,
		);

		const parser = new WorkflowParser();
		expect(() => parser.parseFile(filePath)).toThrow("Nested parallel steps");
	});
});

describe("WorkflowParser settings", () => {
	it("should apply default settings", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString("name: test\nsteps: []");

		expect(workflow.settings.maxRetry).toBe(3);
		expect(workflow.settings.timeoutMinutes).toBe(60);
		expect(workflow.settings.trackProgress).toBe(true);
	});

	it("should parse custom settings", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
settings:
  max-retry: 5
  timeout-minutes: 120
  track-progress: false
steps: []
`);

		expect(workflow.settings.maxRetry).toBe(5);
		expect(workflow.settings.timeoutMinutes).toBe(120);
		expect(workflow.settings.trackProgress).toBe(false);
	});

	it("should parse workflow-level model setting", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
settings:
  model: opus
steps: []
`);

		expect(workflow.settings.model).toBe("opus");
	});

	it("should default model to null when not specified", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString("name: test\nsteps: []");

		expect(workflow.settings.model).toBeNull();
	});

	it("should parse workflow-level runtime setting", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
settings:
  runtime: codex
steps: []
`);

		expect(workflow.settings.runtime).toBe("codex");
	});

	it("should default runtime to null when not specified", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString("name: test\nsteps: []");

		expect(workflow.settings.runtime).toBeNull();
	});
});

describe("WorkflowParser runtime field on steps", () => {
	it("should parse runtime field on prompt step", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
steps:
  - name: my-step
    type: prompt
    runtime: codex
    prompt: "Hello"
`);

		expect(workflow.steps[0].runtime).toBe("codex");
	});

	it("should default step runtime to null when not specified", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
steps:
  - name: my-step
    type: prompt
    prompt: "Hello"
`);

		expect(workflow.steps[0].runtime).toBeNull();
	});

	it("should parse runtime field on parallel step branches", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
steps:
  - name: parallel-step
    type: parallel
    steps:
      - name: branch-a
        type: prompt
        runtime: claude
        prompt: "Branch A"
      - name: branch-b
        type: prompt
        runtime: codex
        prompt: "Branch B"
`);

		expect(workflow.steps[0].steps[0].runtime).toBe("claude");
		expect(workflow.steps[0].steps[1].runtime).toBe("codex");
	});
});

describe("WorkflowParser outputs", () => {
	it("should parse workflow outputs", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
steps: []
outputs:
  - name: summary
    template: summary.md.j2
    path: output/summary.md
    when: completed
`);

		expect(workflow.outputs).toHaveLength(1);
		const output = workflow.outputs[0];
		expect(output.name).toBe("summary");
		expect(output.template).toBe("summary.md.j2");
		expect(output.path).toBe("output/summary.md");
		expect(output.when).toBe("completed");
	});

	it("should throw on missing required output fields", () => {
		const parser = new WorkflowParser();
		expect(() =>
			parser.parseString(`
name: test
steps: []
outputs:
  - name: summary
    template: summary.md.j2
`),
		).toThrow("Missing required field");
	});
});

describe("WorkflowParser worktree settings", () => {
	it("should apply default worktree settings when not specified", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString("name: test\nsteps: []");

		expect(workflow.settings.worktree.enabled).toBe(false);
		// Fields not specified in YAML are left undefined for config merge
		expect(workflow.settings.worktree.location).toBeUndefined();
		expect(workflow.settings.worktree.directory).toBeUndefined();
		expect(workflow.settings.worktree.cleanup).toBeUndefined();
	});

	it("should parse worktree enabled as boolean true", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
settings:
  worktree:
    enabled: true
steps: []
`);
		expect(workflow.settings.worktree.enabled).toBe(true);
	});

	it("should parse worktree enabled as template string", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
settings:
  worktree:
    enabled: "{{ variables.use_worktree }}"
steps: []
`);
		// Template string should be preserved at parse time, not resolved
		expect(workflow.settings.worktree.enabled).toBe("{{ variables.use_worktree }}");
	});

	it("should parse all worktree fields", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
settings:
  worktree:
    enabled: true
    location: nested
    cleanup: on-complete
steps: []
`);
		expect(workflow.settings.worktree.location).toBe("nested");
		expect(workflow.settings.worktree.cleanup).toBe("on-complete");
	});

	it("should parse worktree absolute location with directory", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
settings:
  worktree:
    enabled: true
    location: absolute
    directory: /tmp/my-worktrees
steps: []
`);
		expect(workflow.settings.worktree.location).toBe("absolute");
		expect(workflow.settings.worktree.directory).toBe("/tmp/my-worktrees");
	});

	it("should throw when absolute location is set without directory", () => {
		const parser = new WorkflowParser();
		expect(() =>
			parser.parseString(`
name: test
settings:
  worktree:
    location: absolute
steps: []
`),
		).toThrow("absolute");
	});

	it("should parse step.worktree as boolean", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
steps:
  - name: par
    type: parallel
    worktree: true
    steps:
      - name: branch-a
        type: prompt
        prompt: "Task A"
`);
		expect(workflow.steps[0].worktree).toBe(true);
	});

	it("should parse step.worktree as string template", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
steps:
  - name: par
    type: parallel
    worktree: "{{ variables.isolate }}"
    steps:
      - name: branch-a
        type: prompt
        prompt: "Task A"
`);
		expect(workflow.steps[0].worktree).toBe("{{ variables.isolate }}");
	});

	it("should default step.worktree to null when not specified", () => {
		const parser = new WorkflowParser();
		const workflow = parser.parseString(`
name: test
steps:
  - name: par
    type: parallel
    steps:
      - name: branch-a
        type: prompt
        prompt: "Task A"
`);
		expect(workflow.steps[0].worktree).toBeNull();
	});
});
