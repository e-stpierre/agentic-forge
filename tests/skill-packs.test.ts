/**
 * Tests for skill pack discovery (ORC-024): `skill_packs` config, Claude
 * plugin auto-detection through `installed_plugins.json`, and the workflow
 * search order project > user > skill packs > bundled in `af workflows`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	discoverWorkflow,
	getWorkflowSearchLocations,
	listAvailableWorkflows,
} from "../src/commands/run.js";
import { cmdWorkflows } from "../src/commands/workflows.js";
import { getWorkflowDirs } from "../src/paths.js";
import { detectClaudePlugins, findSkillPacks, getSkillPackConfig } from "../src/skill-packs.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

const home = useTempGlobalRoot();
let base: string;
let repo: string;
let claudeDir: string;
let previousClaudeDir: string | undefined;

function write(file: string, text: string): string {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
	return file;
}

function workflow(dir: string, name: string, description = `${name} workflow`): string {
	return write(
		path.join(dir, `${name}.yaml`),
		`name: ${name}\ndescription: ${description}\nsteps: []\n`,
	);
}

/** A plugin directory with a manifest and, optionally, af-workflows. */
function plugin(root: string, name: string, workflows: string[] = []): string {
	write(
		path.join(root, ".claude-plugin", "plugin.json"),
		JSON.stringify({ name, version: "1.2.3" }),
	);
	for (const w of workflows) workflow(path.join(root, "af-workflows"), w);
	return root;
}

function installed(plugins: Record<string, Record<string, unknown>[]>): void {
	write(
		path.join(claudeDir, "plugins", "installed_plugins.json"),
		JSON.stringify({ version: 2, plugins }),
	);
}

beforeEach(() => {
	base = mkdtempSync(path.join(tmpdir(), "af-packs-"));
	repo = path.join(base, "repo");
	mkdirSync(repo, { recursive: true });
	claudeDir = path.join(base, "claude");
	previousClaudeDir = process.env.CLAUDE_CONFIG_DIR;
	process.env.CLAUDE_CONFIG_DIR = claudeDir;
});

afterEach(() => {
	if (previousClaudeDir === undefined) Reflect.deleteProperty(process.env, "CLAUDE_CONFIG_DIR");
	else process.env.CLAUDE_CONFIG_DIR = previousClaudeDir;
	vi.restoreAllMocks();
	rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("getSkillPackConfig", () => {
	it("reads the object form, the array shorthand and the defaults", () => {
		expect(getSkillPackConfig({})).toEqual({ paths: [], autoDetect: true });
		expect(getSkillPackConfig({ skill_packs: ["a", 3] })).toEqual({
			paths: ["a"],
			autoDetect: true,
		});
		expect(getSkillPackConfig({ skill_packs: { paths: ["b"], auto_detect: false } })).toEqual({
			paths: ["b"],
			autoDetect: false,
		});
	});
});

describe("detectClaudePlugins", () => {
	it("returns user installs and project installs of this repo only", () => {
		installed({
			"esp-skills@esp": [
				{ scope: "user", installPath: "/cache/esp/esp-skills/0.7.0", version: "0.7.0" },
			],
			"here@m": [{ scope: "project", projectPath: repo, installPath: "/cache/m/here/1" }],
			"elsewhere@m": [{ scope: "local", projectPath: "/other", installPath: "/cache/m/else/1" }],
			"broken@m": [{ scope: "user" }],
		});
		const found = detectClaudePlugins(repo);
		expect(found.map((p) => p.name)).toEqual(["esp-skills", "here"]);
		expect(found[0]).toMatchObject({ root: "/cache/esp/esp-skills/0.7.0", version: "0.7.0" });
	});

	it("returns nothing without an installed plugin list, or with a corrupt one", () => {
		expect(detectClaudePlugins(repo)).toEqual([]);
		write(path.join(claudeDir, "plugins", "installed_plugins.json"), "{not json");
		expect(detectClaudePlugins(repo)).toEqual([]);
	});
});

describe("findSkillPacks", () => {
	it("lists configured paths, then detected plugins with af-workflows, once each", () => {
		const configured = plugin(path.join(base, "packs", "mine"), "my-pack", ["mine"]);
		const cached = plugin(path.join(base, "cache", "esp", "esp-skills", "0.8.0"), "esp-skills", [
			"esp-go",
		]);
		const noWorkflows = plugin(path.join(base, "cache", "x", "plain", "1.0.0"), "plain");
		installed({
			"esp-skills@esp": [{ scope: "user", installPath: cached }],
			"plain@x": [{ scope: "user", installPath: noWorkflows }],
			"dup@x": [{ scope: "user", installPath: configured }],
		});
		const packs = findSkillPacks({ skill_packs: { paths: ["../packs/mine"] } }, repo);
		expect(packs.map((p) => [p.name, p.origin, p.version])).toEqual([
			["my-pack", "config", "1.2.3"],
			["esp-skills", "claude-plugin", "1.2.3"],
		]);
		expect(packs[1].workflowsDir).toBe(path.join(cached, "af-workflows"));
	});

	it("skips detection when auto_detect is false", () => {
		const cached = plugin(path.join(base, "cache", "p"), "p", ["w"]);
		installed({ "p@m": [{ scope: "user", installPath: cached }] });
		expect(findSkillPacks({ skill_packs: { auto_detect: false } }, repo)).toEqual([]);
		expect(findSkillPacks({}, repo)).toHaveLength(1);
	});
});

describe("workflow search order", () => {
	it("is project, user, skill packs, bundled", () => {
		const pack = plugin(path.join(base, "cache", "esp"), "esp-skills", ["esp-go", "shared"]);
		installed({ "esp-skills@esp": [{ scope: "user", installPath: pack }] });
		workflow(path.join(repo, "agentic", "workflows"), "shared");
		workflow(path.join(home.root, "workflows"), "mine");

		const locations = getWorkflowSearchLocations(repo);
		expect(locations.map((l) => l.location)).toEqual([
			"project-local",
			"user-global",
			"skill-pack",
			"bundled",
		]);
		expect(locations[2]).toMatchObject({
			pack: "esp-skills",
			dir: path.join(pack, "af-workflows"),
		});

		const listed = listAvailableWorkflows(repo).map(([name, , location, packName]) => [
			name,
			location,
			packName,
		]);
		expect(listed.slice(0, 4)).toEqual([
			["shared", "project-local", undefined],
			["mine", "user-global", undefined],
			["esp-go", "skill-pack", "esp-skills"],
			["shared", "skill-pack", "esp-skills"],
		]);
		expect(listed.some(([, location]) => location === "bundled")).toBe(true);

		expect(discoverWorkflow("esp-go", repo)).toEqual([
			path.join(pack, "af-workflows", "esp-go.yaml"),
			"skill-pack",
		]);
		expect(discoverWorkflow("shared", repo)[1]).toBe("project-local");
		expect(discoverWorkflow("claude-demo", repo)[1]).toBe("bundled");
	});

	it("getWorkflowDirs puts pack dirs before the bundled dir", () => {
		const dirs = getWorkflowDirs("/bundled", repo, ["/pack/af-workflows"]);
		expect(dirs.slice(2)).toEqual(["/pack/af-workflows", path.join("/bundled", "workflows")]);
	});

	it("af workflows prints every source with its origin and marks shadowed names", () => {
		const pack = plugin(path.join(base, "cache", "esp"), "esp-skills", ["esp-go", "shared"]);
		installed({ "esp-skills@esp": [{ scope: "user", installPath: pack }] });
		workflow(path.join(repo, "agentic", "workflows"), "shared");
		workflow(path.join(home.root, "workflows"), "mine");

		let out = "";
		vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
			out += String(chunk);
			return true;
		});
		cmdWorkflows({ cwd: repo });

		const project = out.indexOf("Project (");
		const user = out.indexOf("User (");
		const packHeading = out.indexOf("Skill pack: esp-skills (");
		const bundled = out.indexOf("Bundled (");
		expect(project).toBeGreaterThanOrEqual(0);
		expect(project).toBeLessThan(user);
		expect(user).toBeLessThan(packHeading);
		expect(packHeading).toBeLessThan(bundled);
		expect(out).toMatch(/shared\s+shared workflow \[shadowed\]/);
		expect(out).toContain("esp-go");
	});
});
