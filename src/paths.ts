/** Path resolution for agentic-forge global and project-local directories. */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getDefaultConfig } from "./config.js";

// --- Global root ---

/**
 * Returns the platform-native global directory for agentic-forge.
 * @param platform - override process.platform (used for testing)
 */
export function getGlobalRoot(platform = process.platform): string {
	if (platform === "win32") {
		const base = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming");
		return path.join(base, "agentic-forge");
	}
	if (platform === "darwin") {
		return path.join(homedir(), "Library", "Application Support", "agentic-forge");
	}
	// Linux and other Unix-like systems
	const base = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
	return path.join(base, "agentic-forge");
}

// --- Project root ---

/**
 * Returns the path to the project-local agentic directory, or null if it does not exist.
 */
export function getProjectRoot(cwd?: string): string | null {
	const root = cwd ?? process.cwd();
	const agenticDir = path.join(root, "agentic");
	return existsSync(agenticDir) ? agenticDir : null;
}

// --- Workflow directories ---

/**
 * Returns workflow search directories in priority order:
 * project-local > user-global > bundled
 */
export function getWorkflowDirs(bundledDir: string, cwd?: string): string[] {
	const cWd = cwd ?? process.cwd();
	return [
		path.join(cWd, "agentic", "workflows"),
		path.join(getGlobalRoot(), "workflows"),
		path.join(bundledDir, "workflows"),
	];
}

// --- Config paths ---

export interface ConfigPaths {
	global: string;
	local: string | null;
}

/**
 * Returns resolved config file paths.
 * local is null if the project-local config file does not exist.
 */
export function getConfigPaths(cwd?: string): ConfigPaths {
	const globalConfigPath = path.join(getGlobalRoot(), "config.json");
	const localConfigPath = path.join(cwd ?? process.cwd(), "agentic", "config.json");
	return {
		global: globalConfigPath,
		local: existsSync(localConfigPath) ? localConfigPath : null,
	};
}

// --- Output directories ---

/**
 * Converts a directory base name into a URL-safe slug for use in output paths.
 */
export function slugifyCwdName(cwd?: string): string {
	const name = path.basename(cwd ?? process.cwd());
	return sanitizeSlug(name);
}

/**
 * Returns the output root directory for a given config.
 * - "local" or "agentic" (legacy): cwd/agentic/outputs
 * - "global" (default): globalRoot/outputs/<cwd-slug>
 */
export function getOutputRoot(config: Record<string, unknown>, cwd?: string): string {
	const cWd = cwd ?? process.cwd();
	const outputDir = config.outputDirectory as string | undefined;
	if (outputDir === "local" || outputDir === "agentic") {
		return path.join(cWd, "agentic", "outputs");
	}
	// global (new default)
	return path.join(getGlobalRoot(), "outputs", slugifyCwdName(cWd));
}

/**
 * Returns the output directory for a specific workflow run.
 */
export function getOutputDir(
	workflowId: string,
	config: Record<string, unknown>,
	cwd?: string,
): string {
	return path.join(getOutputRoot(config, cwd), workflowId);
}

// --- Lazy initialization ---

/**
 * Lazily initializes the global directory structure.
 * Creates workflows/, outputs/, and a default config.json if they do not exist.
 * Idempotent: no-op if the global directory already exists.
 */
export function ensureGlobalDir(): string {
	const globalRoot = getGlobalRoot();
	if (!existsSync(globalRoot)) {
		mkdirSync(path.join(globalRoot, "workflows"), { recursive: true });
		mkdirSync(path.join(globalRoot, "outputs"), { recursive: true });
		const defaultConfig = getDefaultConfig();
		writeFileSync(
			path.join(globalRoot, "config.json"),
			JSON.stringify(defaultConfig, null, 2),
			"utf-8",
		);
		console.log(`Initialized global config at ${globalRoot}`);
	}
	return globalRoot;
}

// --- Slug sanitization ---

const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Sanitizes a string into a safe directory slug:
 * - Lowercased
 * - Reserved characters stripped
 * - Spaces and special characters replaced with hyphens
 * - Windows reserved filenames suffixed with "-dir"
 * - Truncated to 50 characters
 * - Leading/trailing hyphens removed
 */
export function sanitizeSlug(input: string): string {
	let slug = input.toLowerCase();
	// Strip reserved path characters: <>:"/\|?*
	slug = slug.replace(/[<>:"/\\|?*]/g, "");
	// Replace spaces, underscores, dots, and other non-alphanumeric chars with hyphens
	slug = slug.replace(/[\s_.]+/g, "-");
	// Replace any remaining non-alphanumeric characters (except hyphens) with hyphens
	slug = slug.replace(/[^a-z0-9-]/g, "-");
	// Collapse multiple hyphens
	slug = slug.replace(/-+/g, "-");
	// Remove leading/trailing hyphens
	slug = slug.replace(/^-+|-+$/g, "");
	// Truncate to 50 characters
	if (slug.length > 50) {
		slug = slug.slice(0, 50).replace(/-+$/, "");
	}
	// Suffix Windows reserved names to avoid conflicts
	if (WINDOWS_RESERVED_NAMES.test(slug)) {
		slug = `${slug}-dir`;
	}
	return slug;
}

/**
 * Returns a non-colliding output directory path.
 * If baseDir exists, appends -2, -3, etc. until a free path is found.
 */
export function resolveOutputDir(baseDir: string): string {
	if (!existsSync(baseDir)) {
		return baseDir;
	}
	let counter = 2;
	while (existsSync(`${baseDir}-${counter}`)) {
		counter++;
	}
	return `${baseDir}-${counter}`;
}
