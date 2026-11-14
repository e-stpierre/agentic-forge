/** Skill step executor: invokes a skill by namespace with the contract options. */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getInlineReferences } from "../config.js";
import { getClaudeConfigDir } from "../paths.js";
import { inlineSkillPrompt, resolveSkill } from "../runtimes/skill-inline.js";
import type { StepDefinition } from "../types.js";
import { type StepContext, buildTemplateContext } from "./base.js";
import { PromptStepExecutor } from "./prompt-step.js";

/**
 * Runtimes that load skills natively (`/<plugin>:<skill>`). Every other
 * runtime gets the skill's `SKILL.md` inline (`inlineSkillPrompt()`).
 */
export const NATIVE_SKILL_RUNTIMES = new Set(["claude"]);

/** Quotes an argument that contains whitespace or quotes. */
function quoteArg(value: string): string {
	return /[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Writes the config snapshot of a skill pack for this run and returns its
 * path: `<run dir>/skill-config/<pack>.json`, holding af config
 * `skill_config.<pack>` (`{}` when unset). `<pack>` is the plugin of
 * `<plugin>:<skill>`, or the skill name for a skill without a plugin. The
 * contract only lets the snapshot's values win over the pack's own config
 * files, so an empty snapshot changes nothing.
 */
export function writeConfigSnapshot(
	runDir: string,
	config: Record<string, unknown>,
	skill: string,
): string {
	const pack = skill.includes(":") ? skill.slice(0, skill.indexOf(":")) : skill;
	const all = config.skill_config as Record<string, unknown> | undefined;
	const value = all && typeof all === "object" ? all[pack] : undefined;
	const snapshot = value && typeof value === "object" && !Array.isArray(value) ? value : {};
	const dir = path.join(runDir, "skill-config");
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${pack.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
	writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
	return file;
}

/** The skill arguments: `<args> --run-dir <dir> --config-snapshot <file>`. */
export function skillArgs(args: string | null, runDir: string, configSnapshot: string): string {
	const parts: string[] = [];
	if (args?.trim()) parts.push(args.trim());
	parts.push("--run-dir", quoteArg(runDir), "--config-snapshot", quoteArg(configSnapshot));
	return parts.join(" ");
}

/** The skill invocation: `/<skill> <args> --run-dir <dir> --config-snapshot <file>`. */
export function skillPrompt(
	skill: string,
	args: string | null,
	runDir: string,
	configSnapshot: string,
): string {
	return `/${skill} ${skillArgs(args, runDir, configSnapshot)}`;
}

/**
 * Runs `/<skill>` like a prompt step (same drivers, retries, result block and
 * steering). `skill` and `args` are templates. The result block's `outputs`
 * become `{{ outputs.<step>.<key> }}` for later steps. On a runtime that does
 * not load skills (Codex), the prompt is the skill's `SKILL.md`, inlined.
 */
export class SkillStepExecutor extends PromptStepExecutor {
	/** The slash command must start the message: operator messages follow it. */
	protected override withMessages(section: string, prompt: string): string {
		return section ? `${prompt}\n\n${section.trimEnd()}\n` : prompt;
	}

	protected override buildPrompt(step: StepDefinition, context: StepContext): string {
		const runtime = context.runtimeAdapter.id;
		const templateContext = buildTemplateContext(context);
		const render = (value: string): string =>
			context.renderer.hasVariables(value)
				? context.renderer.renderString(value, templateContext)
				: value;
		const skill = render(step.skill ?? "")
			.trim()
			.replace(/^\//, "");
		if (!skill) throw new Error(`Skill step '${step.name}' has no skill to run`);
		const runDir = context.outputDir ?? context.repoRoot;
		const snapshot = writeConfigSnapshot(runDir, context.config, skill);
		const args = step.args ? render(step.args) : null;
		if (!NATIVE_SKILL_RUNTIMES.has(runtime)) {
			// Found on disk where Claude Code would load it (the dispatch env's config dir)
			const claudeDir = context.env?.CLAUDE_CONFIG_DIR
				? path.resolve(context.env.CLAUDE_CONFIG_DIR)
				: getClaudeConfigDir();
			const resolved = resolveSkill(skill, {
				config: context.config,
				repoRoot: context.repoRoot,
				claudeDir,
			});
			return inlineSkillPrompt(resolved, skillArgs(args, runDir, snapshot), {
				inlineReferences: getInlineReferences(context.config, runtime),
			});
		}
		// The slash command must start the prompt: no `agent:` file here
		return skillPrompt(skill, args, runDir, snapshot);
	}
}
