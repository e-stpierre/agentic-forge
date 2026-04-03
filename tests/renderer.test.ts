import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	TemplateRenderer,
	buildTemplateContext,
	extractAnalysisSteps,
	extractFixSteps,
	renderWorkflowOutput,
} from "../src/renderer.js";

let tempDir: string;

beforeEach(() => {
	tempDir = path.join(
		tmpdir(),
		`renderer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	// Best-effort cleanup
	try {
		const { rmSync } = require("node:fs");
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// Ignore cleanup errors on Windows
	}
});

describe("TemplateRenderer", () => {
	it("initializes with default template directory", () => {
		const renderer = new TemplateRenderer();
		expect(renderer.templateDirs.length).toBe(1);
		expect(renderer.templateDirs[0]).toContain("templates");
	});

	it("initializes with custom template directories", () => {
		const templatesDir = path.join(tempDir, "templates");
		mkdirSync(templatesDir, { recursive: true });

		const renderer = new TemplateRenderer([templatesDir]);
		expect(renderer.templateDirs).toContain(templatesDir);
	});

	it("renders basic template string", () => {
		const renderer = new TemplateRenderer();
		const result = renderer.renderString("Hello, {{ name }}!", { name: "World" });
		expect(result).toBe("Hello, World!");
	});

	it("renders template with loop", () => {
		const renderer = new TemplateRenderer();
		const template = "{% for item in items %}{{ item }}{% endfor %}";
		const result = renderer.renderString(template, { items: ["a", "b", "c"] });
		expect(result).toBe("abc");
	});

	it("renders template with conditionals", () => {
		const renderer = new TemplateRenderer();
		const template = "{% if enabled %}ON{% else %}OFF{% endif %}";

		expect(renderer.renderString(template, { enabled: true })).toBe("ON");
		expect(renderer.renderString(template, { enabled: false })).toBe("OFF");
	});

	it("handles undefined variables in lenient mode (default)", () => {
		const renderer = new TemplateRenderer();
		// In nunjucks lenient mode, undefined variables render as empty string
		const result = renderer.renderString("{{ undefined_var }}", {});
		expect(result).toBe("");
	});

	it("raises error for undefined variables in strict mode", () => {
		const renderer = new TemplateRenderer(undefined, true);
		expect(() => renderer.renderString("{{ undefined_var }}", {})).toThrow();
	});

	it("handles undefined vars in loops (returns empty)", () => {
		const renderer = new TemplateRenderer();
		const result = renderer.renderString("{% for x in undefined_list %}{{ x }}{% endfor %}", {});
		expect(result).toBe("");
	});

	it("renders nested variable access", () => {
		const renderer = new TemplateRenderer();
		const template = "{{ user.name }} - {{ user.email }}";
		const context = { user: { name: "Alice", email: "alice@example.com" } };
		const result = renderer.renderString(template, context);
		expect(result).toBe("Alice - alice@example.com");
	});

	it("renders from template file", () => {
		const templatesDir = path.join(tempDir, "templates");
		mkdirSync(templatesDir, { recursive: true });
		writeFileSync(path.join(templatesDir, "test.j2"), "Name: {{ name }}");

		const renderer = new TemplateRenderer([templatesDir]);
		const result = renderer.render("test.j2", { name: "Test" });
		expect(result).toBe("Name: Test");
	});

	it("has_variables returns true for templates", () => {
		const renderer = new TemplateRenderer();
		expect(renderer.hasVariables("{{ variable }}")).toBe(true);
		expect(renderer.hasVariables("{% if x %}{% endif %}")).toBe(true);
	});

	it("has_variables returns false for plain text", () => {
		const renderer = new TemplateRenderer();
		expect(renderer.hasVariables("plain text")).toBe(false);
		expect(renderer.hasVariables("no templates here")).toBe(false);
	});

	it("adds template directory", () => {
		const newDir = path.join(tempDir, "new_templates");
		mkdirSync(newDir, { recursive: true });

		const renderer = new TemplateRenderer();
		const originalCount = renderer.templateDirs.length;

		renderer.addTemplateDir(newDir);

		expect(renderer.templateDirs.length).toBe(originalCount + 1);
		expect(renderer.templateDirs).toContain(newDir);
	});

	it("ignores nonexistent template directory", () => {
		const nonexistent = path.join(tempDir, "nonexistent");
		const renderer = new TemplateRenderer();
		const originalCount = renderer.templateDirs.length;

		renderer.addTemplateDir(nonexistent);

		expect(renderer.templateDirs.length).toBe(originalCount);
	});

	it("ignores duplicate template directory", () => {
		const newDir = path.join(tempDir, "templates");
		mkdirSync(newDir, { recursive: true });

		const renderer = new TemplateRenderer([newDir]);
		renderer.addTemplateDir(newDir);

		expect(renderer.templateDirs.filter((d) => d === newDir).length).toBe(1);
	});
});

describe("sandboxed environment", () => {
	it("allows normal operations", () => {
		const renderer = new TemplateRenderer();

		const result = renderer.renderString("{{ name | upper }}", { name: "test" });
		expect(result).toBe("TEST");

		const result2 = renderer.renderString("{{ items | length }}", { items: [1, 2, 3] });
		expect(result2).toBe("3");
	});

	it("allows standard filters", () => {
		const renderer = new TemplateRenderer();

		expect(renderer.renderString("{{ x | default('N/A') }}", {})).toBe("N/A");
		expect(renderer.renderString("{{ 'test' | capitalize }}", {})).toBe("Test");
		expect(renderer.renderString("{{ [1,2,3] | join('-') }}", {})).toBe("1-2-3");
	});
});

describe("extractAnalysisSteps", () => {
	it("extracts analysis steps from outputs", () => {
		const stepOutputs = {
			"analyze-bug": { issues: 5 },
			"analyze-debt": { issues: 3 },
			"analyze-security": { issues: 2 },
			"other-step": { data: "ignored" },
		};

		const result = extractAnalysisSteps(stepOutputs);

		expect(result["analyze-bug"]).toBeDefined();
		expect(result["analyze-debt"]).toBeDefined();
		expect(result["analyze-security"]).toBeDefined();
		expect(result["other-step"]).toBeUndefined();
	});

	it("filters invalid analysis types", () => {
		const stepOutputs = {
			"analyze-bug": { issues: 5 },
			"analyze-invalid": { issues: 3 },
			"analyze-and-fix-all": { container: true },
		};

		const result = extractAnalysisSteps(stepOutputs);

		expect(result["analyze-bug"]).toBeDefined();
		expect(result["analyze-invalid"]).toBeUndefined();
		expect(result["analyze-and-fix-all"]).toBeUndefined();
	});

	it("returns empty for empty outputs", () => {
		expect(extractAnalysisSteps({})).toEqual({});
	});

	it("recognizes all analysis types", () => {
		const stepOutputs = {
			"analyze-bug": { type: "bug" },
			"analyze-debt": { type: "debt" },
			"analyze-doc": { type: "doc" },
			"analyze-security": { type: "security" },
			"analyze-style": { type: "style" },
		};

		const result = extractAnalysisSteps(stepOutputs);
		expect(Object.keys(result).length).toBe(5);
	});
});

describe("extractFixSteps", () => {
	it("extracts fix steps from outputs", () => {
		const stepOutputs = {
			"fix-bugs": { fixed: 3 },
			"apply-fixes": { applied: 5 },
			"other-step": { ignored: true },
		};

		const result = extractFixSteps(stepOutputs);

		expect(result["fix-bugs"]).toBeDefined();
		expect(result["apply-fixes"]).toBeDefined();
		expect(result["other-step"]).toBeUndefined();
	});

	it("returns empty for empty outputs", () => {
		expect(extractFixSteps({})).toEqual({});
	});
});

describe("buildTemplateContext", () => {
	it("builds basic template context", () => {
		const context = buildTemplateContext(
			"test-workflow",
			"test-workflow-20260111-143000",
			"2026-01-11T14:30:00Z",
			"2026-01-11T15:00:00Z",
			{ step1: { result: "ok" } },
			["file1.py", "file2.py"],
			["feature/test"],
			[{ number: 123, url: "https://github.com/test" }],
			{ var: "value" },
		);

		expect(context.workflow).toEqual({
			name: "test-workflow",
			id: "test-workflow-20260111-143000",
			started_at: "2026-01-11T14:30:00Z",
			completed_at: "2026-01-11T15:00:00Z",
		});
		expect(context.workflow_id).toBe("test-workflow-20260111-143000");
		expect(context.steps).toEqual({ step1: { result: "ok" } });
		expect(context.files_changed).toEqual(["file1.py", "file2.py"]);
		expect(context.branches).toEqual(["feature/test"]);
		expect((context.pull_requests as unknown[]).length).toBe(1);
		expect(context.inputs).toEqual({ var: "value" });
	});

	it("extracts analysis steps into context", () => {
		const context = buildTemplateContext(
			"test",
			"test-123",
			"",
			null,
			{
				"analyze-bug": { issues: 5 },
				"other-step": { data: "ignored" },
			},
			[],
			[],
			[],
			{},
		);

		const analysisSteps = context.analysis_steps as Record<string, unknown>;
		expect(analysisSteps["analyze-bug"]).toBeDefined();
		expect(analysisSteps["other-step"]).toBeUndefined();
	});

	it("extracts fix steps into context", () => {
		const context = buildTemplateContext(
			"test",
			"test-123",
			"",
			null,
			{
				"fix-bugs": { fixed: 3 },
				"apply-fixes": { applied: 2 },
			},
			[],
			[],
			[],
			{},
		);

		const fixSteps = context.fix_steps as Record<string, unknown>;
		expect(fixSteps["fix-bugs"]).toBeDefined();
		expect(fixSteps["apply-fixes"]).toBeDefined();
	});
});

describe("renderWorkflowOutput", () => {
	it("creates output file from template", () => {
		const templatesDir = path.join(tempDir, "templates");
		mkdirSync(templatesDir, { recursive: true });
		writeFileSync(path.join(templatesDir, "output.j2"), "Workflow: {{ workflow.name }}");

		const outputPath = path.join(tempDir, "output", "result.md");
		const context = { workflow: { name: "test-workflow" } };

		renderWorkflowOutput("output.j2", outputPath, context, [templatesDir]);

		expect(existsSync(outputPath)).toBe(true);
		expect(readFileSync(outputPath, "utf-8")).toBe("Workflow: test-workflow");
	});

	it("creates necessary directories", () => {
		const templatesDir = path.join(tempDir, "templates");
		mkdirSync(templatesDir, { recursive: true });
		writeFileSync(path.join(templatesDir, "output.j2"), "Content");

		const outputPath = path.join(tempDir, "deep", "nested", "output.md");

		renderWorkflowOutput("output.j2", outputPath, {}, [templatesDir]);

		expect(existsSync(outputPath)).toBe(true);
	});

	it("renders with absolute template path", () => {
		const templateFile = path.join(tempDir, "absolute_template.j2");
		writeFileSync(templateFile, "Value: {{ value }}");

		const outputPath = path.join(tempDir, "output.md");
		const context = { value: "test" };

		renderWorkflowOutput(templateFile, outputPath, context);

		expect(existsSync(outputPath)).toBe(true);
		expect(readFileSync(outputPath, "utf-8")).toBe("Value: test");
	});
});
