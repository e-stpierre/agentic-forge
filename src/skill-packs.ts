/**
 * Skill packs: plugin directories that ship agentic-forge workflows in an
 * `af-workflows/` directory (for example the esp-skills plugin).
 *
 * Sources, in order:
 * - af config `skill_packs.paths` (absolute, or relative to the repo root)
 * - with `skill_packs.auto_detect` (default true), the Claude Code plugins
 *   listed in `<claude config dir>/plugins/installed_plugins.json`: every
 *   user-scope install, and project or local installs of this repo. Only the
 *   installed version's `installPath` is used, never older copies left in the
 *   plugin cache. A plugin disabled in Claude Code (`enabledPlugins` set to
 *   false in the user, project or local `settings.json`) is skipped.
 *
 * A directory without `af-workflows/` is not a skill pack and is skipped.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Directory inside a plugin that holds its agentic-forge workflows. */
export const PACK_WORKFLOWS_DIR = "af-workflows";

export interface SkillPack {
	/** Plugin name (`.claude-plugin/plugin.json`, else the install key or directory name). */
	name: string;
	/** Plugin root directory. */
	root: string;
	/** `<root>/af-workflows`. */
	workflowsDir: string;
	/** Where it was found. */
	origin: "config" | "claude-plugin";
	/** Plugin version, when known. */
	version: string | null;
}

export interface SkillPackConfig {
	paths: string[];
	autoDetect: boolean;
}

/**
 * Reads `skill_packs` from a config: `{ paths: [...], auto_detect: bool }`,
 * or a plain array of paths (auto-detection stays on).
 */
export function getSkillPackConfig(config: Record<string, unknown>): SkillPackConfig {
	const raw = config.skill_packs;
	if (Array.isArray(raw)) {
		return { paths: raw.filter((p): p is string => typeof p === "string"), autoDetect: true };
	}
	const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const paths = Array.isArray(obj.paths)
		? obj.paths.filter((p): p is string => typeof p === "string" && p.length > 0)
		: [];
	return { paths, autoDetect: obj.auto_detect !== false };
}

/** Claude Code config directory: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function getClaudeConfigDir(): string {
	const override = process.env.CLAUDE_CONFIG_DIR;
	return override ? path.resolve(override) : path.join(homedir(), ".claude");
}

/** Path of Claude Code's installed plugin list. */
export function getInstalledPluginsPath(claudeDir = getClaudeConfigDir()): string {
	return path.join(claudeDir, "plugins", "installed_plugins.json");
}

export interface InstalledPlugin {
	/** Plugin name (the part of the install key before `@`). */
	name: string;
	root: string;
	version: string | null;
}

function samePath(a: string, b: string): boolean {
	const ra = path.resolve(a);
	const rb = path.resolve(b);
	return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

function readEnabledMap(file: string): Record<string, unknown> {
	if (!existsSync(file)) return {};
	try {
		const data = JSON.parse(readFileSync(file, "utf-8")) as { enabledPlugins?: unknown } | null;
		const map = data?.enabledPlugins;
		return map && typeof map === "object" && !Array.isArray(map)
			? (map as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/**
 * Install keys (`<plugin>@<marketplace>`) Claude Code has disabled for
 * `repoRoot`: `enabledPlugins` of the user `settings.json`, then the
 * project `.claude/settings.json`, then `.claude/settings.local.json`
 * (each overrides the previous one).
 */
export function disabledClaudePlugins(
	repoRoot: string,
	claudeDir = getClaudeConfigDir(),
): Set<string> {
	const merged: Record<string, unknown> = {
		...readEnabledMap(path.join(claudeDir, "settings.json")),
		...readEnabledMap(path.join(repoRoot, ".claude", "settings.json")),
		...readEnabledMap(path.join(repoRoot, ".claude", "settings.local.json")),
	};
	return new Set(
		Object.entries(merged)
			.filter(([, enabled]) => enabled === false)
			.map(([key]) => key),
	);
}

/**
 * Installed Claude Code plugins that apply to `repoRoot`, from
 * `installed_plugins.json` (format version 2: `plugins` maps
 * `<plugin>@<marketplace>` to install entries with `scope`, `installPath`,
 * `version` and, for project or local scope, `projectPath`). Plugins disabled
 * in Claude Code are left out (see `disabledClaudePlugins()`). Returns an
 * empty list when the file is missing or unreadable.
 */
export function detectClaudePlugins(
	repoRoot: string,
	claudeDir = getClaudeConfigDir(),
): InstalledPlugin[] {
	const file = getInstalledPluginsPath(claudeDir);
	if (!existsSync(file)) return [];
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(file, "utf-8"));
	} catch {
		return [];
	}
	const plugins = (data as { plugins?: unknown } | null)?.plugins;
	if (!plugins || typeof plugins !== "object") return [];
	const disabled = disabledClaudePlugins(repoRoot, claudeDir);
	const found: InstalledPlugin[] = [];
	for (const [key, entries] of Object.entries(plugins as Record<string, unknown>)) {
		if (disabled.has(key)) continue;
		const list = Array.isArray(entries) ? entries : [entries];
		for (const entry of list) {
			if (!entry || typeof entry !== "object") continue;
			const e = entry as Record<string, unknown>;
			if (typeof e.installPath !== "string" || e.installPath.length === 0) continue;
			const scope = typeof e.scope === "string" ? e.scope : "user";
			if (scope !== "user") {
				if (typeof e.projectPath !== "string" || !samePath(e.projectPath, repoRoot)) continue;
			}
			found.push({
				name: key.split("@")[0] || key,
				root: e.installPath,
				version: typeof e.version === "string" ? e.version : null,
			});
		}
	}
	return found;
}

function readPluginManifest(root: string): { name?: string; version?: string } {
	const manifest = path.join(root, ".claude-plugin", "plugin.json");
	if (!existsSync(manifest)) return {};
	try {
		const data = JSON.parse(readFileSync(manifest, "utf-8")) as Record<string, unknown>;
		return {
			name: typeof data.name === "string" ? data.name : undefined,
			version: typeof data.version === "string" ? data.version : undefined,
		};
	} catch {
		return {};
	}
}

function isDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

export interface FindSkillPacksOptions {
	/** Claude config dir for auto-detection (defaults to `getClaudeConfigDir()`). */
	claudeDir?: string;
}

/**
 * Skill packs for `repoRoot`: configured paths first, then auto-detected
 * Claude plugins. Directories without `af-workflows/` are skipped, and a
 * directory found twice is listed once.
 */
export function findSkillPacks(
	config: Record<string, unknown>,
	repoRoot: string,
	options: FindSkillPacksOptions = {},
): SkillPack[] {
	const packConfig = getSkillPackConfig(config);
	const candidates: {
		root: string;
		origin: SkillPack["origin"];
		name?: string;
		version?: string | null;
	}[] = packConfig.paths.map((p) => ({ root: path.resolve(repoRoot, p), origin: "config" }));
	if (packConfig.autoDetect) {
		for (const plugin of detectClaudePlugins(repoRoot, options.claudeDir)) {
			candidates.push({
				root: path.resolve(plugin.root),
				origin: "claude-plugin",
				name: plugin.name,
				version: plugin.version,
			});
		}
	}
	const packs: SkillPack[] = [];
	for (const candidate of candidates) {
		const workflowsDir = path.join(candidate.root, PACK_WORKFLOWS_DIR);
		if (!isDir(workflowsDir)) continue;
		if (packs.some((p) => samePath(p.root, candidate.root))) continue;
		const manifest = readPluginManifest(candidate.root);
		packs.push({
			name: manifest.name ?? candidate.name ?? path.basename(candidate.root),
			root: candidate.root,
			workflowsDir,
			origin: candidate.origin,
			version: manifest.version ?? candidate.version ?? null,
		});
	}
	return packs;
}
