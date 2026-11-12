/**
 * Tests for skill inlining (runtimes without skill loading): skill resolution
 * in plugins and skill directories, variable and argument substitution, link
 * rewriting and the referenced files.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	MAX_INLINED_REFERENCES_BYTES,
	absolutizeLinks,
	inlineSkillPrompt,
	pluginSkillDirs,
	portablePath,
	resolveSkill,
	splitArgs,
	splitFrontmatter,
} from "../src/runtimes/skill-inline.js";

let base: string;
let repo: string;
let claudeDir: string;

function write(file: string, content: string): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
}

function skillFile(name: string, body: string): string {
	return `---\nname: ${name}\ndescription: "A skill"\n---\n\n${body}`;
}

/** A plugin with a category folder skill listed in plugin.json and a default one. */
function makePlugin(root: string, name = "esp-skills"): void {
	write(
		path.join(root, ".claude-plugin", "plugin.json"),
		JSON.stringify({ name, skills: ["./skills/review/esp-review"] }),
	);
	write(
		path.join(root, "skills", "review", "esp-review", "SKILL.md"),
		skillFile(
			"esp-review",
			[
				"# ESP Review",
				"",
				"Arguments: $ARGUMENTS",
				"First: $ARGUMENTS[0]",
				"",
				"- See [esp-reviewer.md](../../../agents/esp-reviewer.md#method)",
				"- See [policy](../../../references/decision-policy.md)",
				"- See [missing](references/missing.md), [web](https://example.com/x.md) and [top](#top)",
				"",
				'Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" target` and `ls ${CLAUDE_SKILL_DIR}`.',
				"",
			].join("\n"),
		),
	);
	write(
		path.join(root, "agents", "esp-reviewer.md"),
		"# Reviewer\n\nSee [policy](../references/decision-policy.md).\n",
	);
	write(path.join(root, "references", "decision-policy.md"), "# Decision policy\n");
	write(
		path.join(root, "skills", "esp-qna", "SKILL.md"),
		skillFile("esp-qna", "Answer: $ARGUMENTS\n"),
	);
}

function options(config: Record<string, unknown> = {}) {
	return { config, repoRoot: repo, claudeDir };
}

beforeEach(() => {
	base = mkdtempSync(path.join(tmpdir(), "af-skill-inline-"));
	repo = path.join(base, "repo");
	claudeDir = path.join(base, "claude");
	mkdirSync(repo, { recursive: true });
	mkdirSync(claudeDir, { recursive: true });
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

describe("helpers", () => {
	it("splits the frontmatter", () => {
		const { fields, body } = splitFrontmatter(skillFile("x", "Body\n"));
		expect(fields).toEqual({ name: "x", description: "A skill" });
		expect(body).toBe("\nBody\n");
		expect(splitFrontmatter("No frontmatter").body).toBe("No frontmatter");
	});

	it("splits arguments like a shell", () => {
		expect(splitArgs(`-t "PR 42" --run-dir 'C:/a b' x`)).toEqual([
			"-t",
			"PR 42",
			"--run-dir",
			"C:/a b",
			"x",
		]);
	});

	it("rewrites only relative links to existing files", () => {
		const dir = path.join(base, "d");
		write(path.join(dir, "a.md"), "A");
		const { text, files } = absolutizeLinks(
			"[a](a.md#x) [b](b.md) [u](http://x/a.md) [h](#a)",
			dir,
		);
		expect(text).toBe(
			`[a](${portablePath(path.join(dir, "a.md"))}#x) [b](b.md) [u](http://x/a.md) [h](#a)`,
		);
		expect(files).toEqual([path.join(dir, "a.md")]);
	});
});

describe("resolveSkill", () => {
	it("finds a plugin skill from skill_packs.paths, through plugin.json and skills/", () => {
		const root = path.join(repo, "plugins", "esp");
		makePlugin(root);
		const config = { skill_packs: { paths: ["plugins/esp"], auto_detect: false } };
		const review = resolveSkill("esp-skills:esp-review", options(config));
		expect(review).toMatchObject({
			id: "esp-skills:esp-review",
			name: "esp-review",
			dir: path.join(root, "skills", "review", "esp-review"),
			pluginRoot: root,
		});
		expect(resolveSkill("esp-skills:esp-qna", options(config)).dir).toBe(
			path.join(root, "skills", "esp-qna"),
		);
		expect(pluginSkillDirs(root)).toHaveLength(2);
	});

	it("finds a plugin through runtimes.claude.plugins and the installed plugin list", () => {
		const local = path.join(base, "local-plugin");
		makePlugin(local, "local");
		expect(
			resolveSkill("local:esp-qna", options({ runtimes: { claude: { plugins: [local] } } }))
				.pluginRoot,
		).toBe(local);

		const installed = path.join(base, "cache", "esp-skills", "0.7.0");
		makePlugin(installed);
		write(
			path.join(claudeDir, "plugins", "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: {
					"esp-skills@market": [{ scope: "user", installPath: installed, version: "0.7.0" }],
				},
			}),
		);
		expect(resolveSkill("esp-skills:esp-review", options()).pluginRoot).toBe(
			path.resolve(installed),
		);
	});

	it("finds a plain skill in the repo, then the user skills, then plugins", () => {
		write(path.join(claudeDir, "skills", "tidy", "SKILL.md"), skillFile("tidy", "User tidy"));
		expect(resolveSkill("tidy", options()).pluginRoot).toBeNull();
		expect(resolveSkill("tidy", options()).dir).toBe(path.join(claudeDir, "skills", "tidy"));
		write(path.join(repo, ".claude", "skills", "tidy", "SKILL.md"), skillFile("tidy", "Repo tidy"));
		expect(resolveSkill("tidy", options()).dir).toBe(path.join(repo, ".claude", "skills", "tidy"));

		const root = path.join(base, "p");
		makePlugin(root);
		expect(
			resolveSkill("esp-qna", options({ skill_packs: { paths: [root], auto_detect: false } }))
				.pluginRoot,
		).toBe(root);
	});

	it("names the searched plugins when the skill is missing", () => {
		const root = path.join(base, "p");
		makePlugin(root);
		const config = { skill_packs: { paths: [root], auto_detect: false } };
		expect(() => resolveSkill("esp-skills:nope", options(config))).toThrow(
			/Skill 'esp-skills:nope' was not found: no plugin named 'esp-skills' with the skill 'nope' \(plugins searched: .*\/p\)/,
		);
		expect(() => resolveSkill("other:esp-qna", options(config))).toThrow(/skill_packs\.paths/);
		expect(() => resolveSkill("nope", options())).toThrow(/no 'nope' skill/);
	});
});

describe("inlineSkillPrompt", () => {
	const ARGS = `-t "PR 42" --run-dir C:/runs/r1 --config-snapshot C:/runs/r1/skill-config/esp-skills.json`;

	function review() {
		const root = path.join(base, "p");
		makePlugin(root);
		return {
			root,
			skill: resolveSkill(
				"esp-skills:esp-review",
				options({ skill_packs: { paths: [root], auto_detect: false } }),
			),
		};
	}

	it("inlines the body with absolute paths and the arguments", () => {
		const { root, skill } = review();
		const prompt = inlineSkillPrompt(skill, ARGS);
		const r = portablePath(root);
		const dir = portablePath(skill.dir);
		expect(prompt.startsWith("# Skill: esp-skills:esp-review\n")).toBe(true);
		expect(prompt).toContain(`/esp-skills:esp-review ${ARGS}`);
		expect(prompt).toContain(`- Skill directory: ${dir}`);
		expect(prompt).toContain(`- Plugin root: ${r}`);
		expect(prompt).not.toContain("description:");
		expect(prompt).toContain(`Arguments: ${ARGS}`);
		expect(prompt).toContain("First: -t");
		expect(prompt).toContain(`[esp-reviewer.md](${r}/agents/esp-reviewer.md#method)`);
		expect(prompt).toContain(`[policy](${r}/references/decision-policy.md)`);
		expect(prompt).toContain("[missing](references/missing.md)");
		expect(prompt).toContain("[web](https://example.com/x.md)");
		expect(prompt).toContain(`node "${r}/scripts/review.mjs" target`);
		expect(prompt).toContain(`ls ${dir}`);
		expect(prompt.slice(prompt.indexOf("\n---\n"))).not.toContain("${CLAUDE_");
		expect(prompt).not.toContain("ARGUMENTS:");
		expect(prompt).not.toContain("## Referenced Files");
	});

	it("appends the arguments when the skill has no placeholder", () => {
		const root = path.join(base, "q");
		write(path.join(root, "skills", "plain", "SKILL.md"), skillFile("plain", "Do it.\n"));
		const skill = resolveSkill(
			"plain",
			options({ skill_packs: { paths: [root], auto_detect: false } }),
		);
		expect(inlineSkillPrompt(skill, "--x 1").trimEnd().endsWith("ARGUMENTS: --x 1")).toBe(true);
		expect(inlineSkillPrompt(skill, "")).not.toContain("ARGUMENTS:");
	});

	it("appends the linked files with their own links resolved", () => {
		const { root, skill } = review();
		const prompt = inlineSkillPrompt(skill, ARGS, { inlineReferences: true });
		const r = portablePath(root);
		expect(prompt).toContain("## Referenced Files");
		expect(prompt).toContain(`<file path="${r}/agents/esp-reviewer.md">`);
		expect(prompt).toContain(`See [policy](${r}/references/decision-policy.md).`);
		expect(prompt).toContain(
			`<file path="${r}/references/decision-policy.md">\n# Decision policy\n</file>`,
		);
	});

	it("only lists the linked files beyond the size cap", () => {
		const { root, skill } = review();
		write(
			path.join(root, "agents", "esp-reviewer.md"),
			"x".repeat(MAX_INLINED_REFERENCES_BYTES + 1),
		);
		const prompt = inlineSkillPrompt(skill, ARGS, { inlineReferences: true });
		expect(prompt).toContain(`- ${portablePath(path.join(root, "agents", "esp-reviewer.md"))}`);
		expect(prompt).toContain("<file path=");
	});
});
