/**
 * Skill inlining for runtimes that do not load skills (Codex on the `cli`
 * driver): the skill's `SKILL.md` is found on disk and sent as the prompt,
 * with its paths made absolute.
 *
 * Resolution of `<plugin>:<skill>`: the plugin is looked up in af config
 * `skill_packs.paths`, `runtimes.claude.plugins`, then (with
 * `skill_packs.auto_detect`) the Claude Code installed plugin list. Inside a
 * plugin, skills come from the `skills` paths of `.claude-plugin/plugin.json`
 * and from `<root>/skills/`. A plain `<skill>` is looked up in
 * `<repo>/.claude/skills/`, `<claude config dir>/skills/`, then in every
 * plugin above.
 *
 * Inlining: the frontmatter is dropped, `${CLAUDE_PLUGIN_ROOT}` and
 * `${CLAUDE_SKILL_DIR}` become absolute paths, `$ARGUMENTS` and
 * `$ARGUMENTS[N]` get the arguments (or an `ARGUMENTS:` line is appended, as
 * Claude Code does), and markdown links relative to the skill directory are
 * rewritten to absolute paths. With `inlineReferences`, the files linked from
 * `SKILL.md` are appended too.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { getClaudeConfigDir } from "../paths.js";
import { detectClaudePlugins, getSkillPackConfig } from "../skill-packs.js";

/** A skill found on disk. */
export interface ResolvedSkill {
	/** The invocation name (`<plugin>:<skill>` or `<skill>`). */
	id: string;
	/** Skill name (frontmatter `name`, else the directory name). */
	name: string;
	/** Directory holding `SKILL.md`. */
	dir: string;
	/** Path of `SKILL.md`. */
	file: string;
	/** Plugin root (`${CLAUDE_PLUGIN_ROOT}`), null for a standalone skill. */
	pluginRoot: string | null;
}

export interface ResolveSkillOptions {
	/** af config (`skill_packs`, `runtimes.claude.plugins`). */
	config: Record<string, unknown>;
	/** Repository root (relative pack paths, `.claude/skills/`). */
	repoRoot: string;
	/** Claude config dir (defaults to `getClaudeConfigDir()`). */
	claudeDir?: string;
}

export interface InlineSkillOptions {
	/** Append the files `SKILL.md` links to (default false: their paths are enough). */
	inlineReferences?: boolean;
}

/** Total size of the appended references, beyond which files are only listed. */
export const MAX_INLINED_REFERENCES_BYTES = 200_000;

interface PluginCandidate {
	root: string;
	/** Install key name, when it came from Claude Code. */
	name?: string;
}

function isFile(p: string): boolean {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

function isDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function samePath(a: string, b: string): boolean {
	const ra = path.resolve(a);
	const rb = path.resolve(b);
	return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/** A path with forward slashes, usable in shells and Node on every platform. */
export function portablePath(p: string): string {
	return p.split(path.sep).join("/");
}

function readManifest(root: string): { name?: string; skills: string[] } {
	const file = path.join(root, ".claude-plugin", "plugin.json");
	if (!isFile(file)) return { skills: [] };
	try {
		const data = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
		const raw = data.skills;
		const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
		return {
			name: typeof data.name === "string" ? data.name : undefined,
			skills: list.filter((s): s is string => typeof s === "string" && s !== ""),
		};
	} catch {
		return { skills: [] };
	}
}

/** Splits `SKILL.md` into its frontmatter fields (flat `key: value` only) and body. */
export function splitFrontmatter(text: string): { fields: Record<string, string>; body: string } {
	const normalized = text.replace(/^\uFEFF/, "");
	const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalized);
	if (!match) return { fields: {}, body: normalized };
	const fields: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (kv) fields[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
	}
	return { fields, body: normalized.slice(match[0].length) };
}

function skillNameOf(dir: string): string {
	try {
		const { fields } = splitFrontmatter(readFileSync(path.join(dir, "SKILL.md"), "utf-8"));
		return fields.name || path.basename(dir);
	} catch {
		return path.basename(dir);
	}
}

/** Skill directories of a plugin: manifest `skills` paths, then `<root>/skills/`. */
export function pluginSkillDirs(root: string): string[] {
	const bases = [...readManifest(root).skills.map((s) => path.resolve(root, s))];
	bases.push(path.join(root, "skills"));
	const dirs: string[] = [];
	const add = (dir: string) => {
		if (!dirs.some((d) => samePath(d, dir))) dirs.push(dir);
	};
	for (const base of bases) {
		if (isFile(path.join(base, "SKILL.md"))) {
			add(base);
			continue;
		}
		if (!isDir(base)) continue;
		for (const entry of readdirSync(base).sort()) {
			const child = path.join(base, entry);
			if (isFile(path.join(child, "SKILL.md"))) add(child);
		}
	}
	return dirs;
}

function pluginCandidates(options: ResolveSkillOptions): PluginCandidate[] {
	const { config, repoRoot } = options;
	const packConfig = getSkillPackConfig(config);
	const runtimes = config.runtimes as
		| Record<string, Record<string, unknown> | undefined>
		| undefined;
	const claudePlugins = runtimes?.claude?.plugins;
	const roots: PluginCandidate[] = [
		...packConfig.paths.map((p) => ({ root: path.resolve(repoRoot, p) })),
		...(Array.isArray(claudePlugins) ? claudePlugins : [])
			.filter((p): p is string => typeof p === "string" && p !== "")
			.map((p) => ({ root: path.resolve(repoRoot, p) })),
	];
	if (packConfig.autoDetect) {
		for (const plugin of detectClaudePlugins(repoRoot, options.claudeDir)) {
			roots.push({ root: path.resolve(plugin.root), name: plugin.name });
		}
	}
	return roots.filter(
		(c, i) => isDir(c.root) && roots.findIndex((o) => samePath(o.root, c.root)) === i,
	);
}

function findInPlugin(root: string, skill: string): string | null {
	const dirs = pluginSkillDirs(root);
	return (
		dirs.find((d) => skillNameOf(d) === skill) ??
		dirs.find((d) => path.basename(d) === skill) ??
		null
	);
}

/**
 * Finds a skill on disk (see the module comment for the order). Throws when
 * it is not found, with the places that were searched.
 */
export function resolveSkill(id: string, options: ResolveSkillOptions): ResolvedSkill {
	const claudeDir = options.claudeDir ?? getClaudeConfigDir();
	const colon = id.indexOf(":");
	const plugin = colon >= 0 ? id.slice(0, colon) : null;
	const skill = colon >= 0 ? id.slice(colon + 1) : id;
	const candidates = pluginCandidates({ ...options, claudeDir });
	const found = (dir: string, pluginRoot: string | null): ResolvedSkill => ({
		id,
		name: skillNameOf(dir),
		dir,
		file: path.join(dir, "SKILL.md"),
		pluginRoot,
	});

	if (plugin) {
		for (const candidate of candidates) {
			const names = [
				readManifest(candidate.root).name,
				candidate.name,
				path.basename(candidate.root),
			];
			if (!names.includes(plugin)) continue;
			const dir = findInPlugin(candidate.root, skill);
			if (dir) return found(dir, candidate.root);
		}
	} else {
		for (const base of [
			path.join(options.repoRoot, ".claude", "skills"),
			path.join(claudeDir, "skills"),
		]) {
			const dir = path.join(base, skill);
			if (isFile(path.join(dir, "SKILL.md"))) return found(dir, null);
		}
		for (const candidate of candidates) {
			const dir = findInPlugin(candidate.root, skill);
			if (dir) return found(dir, candidate.root);
		}
	}
	const searched = candidates.map((c) => c.root);
	throw new Error(
		`Skill '${id}' was not found: ${
			plugin
				? `no plugin named '${plugin}' with the skill '${skill}'`
				: `no '${skill}' skill in .claude/skills, ${portablePath(path.join(claudeDir, "skills"))} or a plugin`
		}${searched.length ? ` (plugins searched: ${searched.map(portablePath).join(", ")})` : ""}. Add the plugin directory to skill_packs.paths`,
	);
}

/** Splits arguments like a shell: whitespace separated, single or double quotes group. */
export function splitArgs(args: string): string[] {
	const out: string[] = [];
	const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
	for (const m of args.matchAll(re)) {
		out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]));
	}
	return out;
}

const LINK_RE = /(!?\[[^\]\n]*\]\()([^)\s]+)(\))/g;

/**
 * Rewrites markdown links relative to `baseDir` to absolute paths, when the
 * target exists. URLs, anchors and absolute paths are left as they are.
 * Returns the text and the absolute files it links to.
 */
export function absolutizeLinks(text: string, baseDir: string): { text: string; files: string[] } {
	const files: string[] = [];
	const out = text.replace(LINK_RE, (whole, open: string, target: string, close: string) => {
		if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("/")) {
			return whole;
		}
		const hash = target.indexOf("#");
		const rel = hash >= 0 ? target.slice(0, hash) : target;
		const anchor = hash >= 0 ? target.slice(hash) : "";
		if (!rel || path.isAbsolute(rel)) return whole;
		let decoded = rel;
		try {
			decoded = decodeURI(rel);
		} catch {
			// A stray `%`: use the target as written
		}
		const abs = path.resolve(baseDir, decoded);
		if (!existsSync(abs)) return whole;
		if (isFile(abs) && !files.some((f) => samePath(f, abs))) files.push(abs);
		return `${open}${portablePath(abs)}${anchor}${close}`;
	});
	return { text: out, files };
}

/** Replaces the Claude Code skill variables and the argument placeholders. */
export function substituteSkillVariables(
	body: string,
	skill: ResolvedSkill,
	args: string,
): { text: string; usedArguments: boolean } {
	const skillDir = portablePath(skill.dir);
	const pluginRoot = skill.pluginRoot ? portablePath(skill.pluginRoot) : skillDir;
	const argv = splitArgs(args);
	let usedArguments = false;
	const text = body
		.replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/g, () => pluginRoot)
		.replace(/\$\{CLAUDE_SKILL_DIR\}|\$CLAUDE_SKILL_DIR\b/g, () => skillDir)
		.replace(/\$ARGUMENTS\[(\d+)\]/g, (_m, n: string) => {
			usedArguments = true;
			return argv[Number(n)] ?? "";
		})
		.replace(/\$ARGUMENTS\b/g, () => {
			usedArguments = true;
			return args;
		});
	return { text, usedArguments };
}

function referenceSection(files: string[], skill: ResolvedSkill): string {
	const roots = [skill.dir, skill.pluginRoot].filter((r): r is string => !!r);
	const inside = (f: string) =>
		roots.some((r) => {
			const rel = path.relative(r, f);
			return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
		});
	const parts: string[] = [];
	const listed: string[] = [];
	let total = 0;
	for (const file of files.filter(inside)) {
		let content: string;
		try {
			content = readFileSync(file, "utf-8");
		} catch {
			continue;
		}
		if (content.includes("\u0000") || total + content.length > MAX_INLINED_REFERENCES_BYTES) {
			listed.push(file);
			continue;
		}
		total += content.length;
		const rewritten = absolutizeLinks(content, path.dirname(file)).text;
		parts.push(`<file path="${portablePath(file)}">\n${rewritten.trimEnd()}\n</file>`);
	}
	if (!parts.length && !listed.length) return "";
	const lines = ["## Referenced Files", ""];
	if (parts.length) lines.push("The files the skill links to, as they are on disk:", "", ...parts);
	if (listed.length) {
		lines.push("", "Not inlined (too large or binary), read them when needed:", "");
		for (const file of listed) lines.push(`- ${portablePath(file)}`);
	}
	return lines.join("\n");
}

/**
 * The prompt that runs a skill on a runtime without skill loading: a short
 * preamble (skill, arguments, directories), then the skill body with
 * absolute paths. A driver that loads skills natively can still fall back to
 * it.
 */
export function inlineSkillPrompt(
	skill: ResolvedSkill,
	args: string,
	options: InlineSkillOptions = {},
): string {
	const { body } = splitFrontmatter(readFileSync(skill.file, "utf-8"));
	const substituted = substituteSkillVariables(body, skill, args);
	const linked = absolutizeLinks(substituted.text, skill.dir);
	const lines = [
		`# Skill: ${skill.id}`,
		"",
		`Run the \`${skill.id}\` skill now, in this session, as if it had been invoked as \`/${skill.id}${args ? ` ${args}` : ""}\`. This runtime does not load skills, so the skill's instructions follow after the line.`,
		"",
		`- Skill directory: ${portablePath(skill.dir)}`,
	];
	if (skill.pluginRoot) lines.push(`- Plugin root: ${portablePath(skill.pluginRoot)}`);
	lines.push(
		`- Arguments: ${args || "(none)"}`,
		"",
		"Paths in the skill are absolute: its `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` variables and its relative links were resolved. A path the skill gives relative to the plugin root is relative to the plugin root above. Read a referenced file when the skill tells you to. When the skill names a tool this session does not have (a subagent, a question tool), use the fallback the skill gives, or do that work yourself in this session.",
		"",
		"---",
		"",
		linked.text.trim(),
	);
	if (!substituted.usedArguments && args) lines.push("", `ARGUMENTS: ${args}`);
	if (options.inlineReferences) {
		const section = referenceSection(linked.files, skill);
		if (section) lines.push("", "---", "", section);
	}
	return `${lines.join("\n")}\n`;
}
