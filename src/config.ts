/** Configuration management for agentic-forge. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_CONFIG: Record<string, unknown> = {
	outputDirectory: "global",
	logging: {
		enabled: true,
		level: "Error",
	},
	defaults: {
		runtime: "claude",
		maxRetry: 3,
		timeoutMinutes: 60,
		trackProgress: true,
		terminalOutput: "base",
	},
	claude: {
		model: "sonnet",
	},
	codex: {
		model: "gpt-5.5",
		sandbox: "workspace-write",
	},
	execution: {
		maxWorkers: 4,
		pollingIntervalSeconds: 5,
	},
	worktree: {
		location: "sibling",
		directory: null,
		cleanup: "on-success",
	},
};

/**
 * Returns the platform-native global config file path.
 * Inlined here to avoid a circular dependency with paths.ts.
 */
function getGlobalConfigPath(): string {
	const platform = process.platform;
	let base: string;
	if (platform === "win32") {
		base = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming");
	} else if (platform === "darwin") {
		base = path.join(homedir(), "Library", "Application Support");
	} else {
		base = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
	}
	return path.join(base, "agentic-forge", "config.json");
}

export function getConfigPath(repoRoot?: string): string {
	const root = repoRoot ?? process.cwd();
	return path.join(root, "agentic", "config.json");
}

export function getDefaultConfig(): Record<string, unknown> {
	return deepCopy(DEFAULT_CONFIG);
}

/**
 * Loads configuration with 3-layer merge: defaults -> global -> local.
 * @param repoRoot - project root (for local config path)
 */
export function loadConfig(repoRoot?: string): Record<string, unknown> {
	let config = getDefaultConfig();

	// Layer 2: global config
	const globalConfigPath = getGlobalConfigPath();
	if (existsSync(globalConfigPath)) {
		const globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8")) as Record<
			string,
			unknown
		>;
		config = deepMerge(config, globalConfig);
	}

	// Layer 3: local config
	const localConfigPath = getConfigPath(repoRoot);
	if (existsSync(localConfigPath)) {
		const localConfig = JSON.parse(readFileSync(localConfigPath, "utf-8")) as Record<
			string,
			unknown
		>;
		config = deepMerge(config, localConfig);
	}

	return config;
}

/**
 * Saves configuration to the specified scope.
 * @param config - config object to write
 * @param repoRoot - project root (for local writes)
 * @param scope - "global" writes to global config; "local" or omitted writes locally
 */
export function saveConfig(
	config: Record<string, unknown>,
	repoRoot?: string,
	scope?: "global" | "local",
): void {
	if (scope === "global") {
		const globalConfigPath = getGlobalConfigPath();
		mkdirSync(path.dirname(globalConfigPath), { recursive: true });
		writeFileSync(globalConfigPath, JSON.stringify(config, null, 2), "utf-8");
	} else {
		const configPath = getConfigPath(repoRoot);
		mkdirSync(path.dirname(configPath), { recursive: true });
		writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
	}
}

export function getConfigValue(key: string, repoRoot?: string): unknown {
	const config = loadConfig(repoRoot);
	const parts = key.split(".");
	let value: unknown = config;
	for (const part of parts) {
		if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			part in (value as Record<string, unknown>)
		) {
			value = (value as Record<string, unknown>)[part];
		} else {
			return null;
		}
	}
	return value;
}

/**
 * Sets a configuration value in the specified scope.
 * Reads only the target scope's config file, sets the key, and writes it back.
 * This avoids writing merged values from other layers into a single scope.
 *
 * When no scope is specified: writes to local config if it exists, otherwise global.
 */
export function setConfigValue(
	key: string,
	value: string,
	scope?: "global" | "local",
	repoRoot?: string,
): void {
	// Auto-detect scope: local if local config exists, otherwise global
	const effectiveScope = scope ?? (existsSync(getConfigPath(repoRoot)) ? "local" : "global");

	// Load only the target scope's config (not the full merged config)
	let config: Record<string, unknown>;
	if (effectiveScope === "global") {
		const globalConfigPath = getGlobalConfigPath();
		config = existsSync(globalConfigPath)
			? (JSON.parse(readFileSync(globalConfigPath, "utf-8")) as Record<string, unknown>)
			: {};
	} else {
		const localConfigPath = getConfigPath(repoRoot);
		config = existsSync(localConfigPath)
			? (JSON.parse(readFileSync(localConfigPath, "utf-8")) as Record<string, unknown>)
			: {};
	}

	const parts = key.split(".");
	let target = config;
	for (const part of parts.slice(0, -1)) {
		if (!(part in target)) {
			target[part] = {};
		}
		target = target[part] as Record<string, unknown>;
	}

	let parsedValue: unknown = value;
	if (value.toLowerCase() === "true") {
		parsedValue = true;
	} else if (value.toLowerCase() === "false") {
		parsedValue = false;
	} else if (/^\d+$/.test(value)) {
		parsedValue = Number.parseInt(value, 10);
	}

	target[parts[parts.length - 1]] = parsedValue;
	saveConfig(config, repoRoot, effectiveScope);
}

export function deepMerge(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...base };
	for (const key of Object.keys(override)) {
		if (
			key in result &&
			typeof result[key] === "object" &&
			result[key] !== null &&
			!Array.isArray(result[key]) &&
			typeof override[key] === "object" &&
			override[key] !== null &&
			!Array.isArray(override[key])
		) {
			result[key] = deepMerge(
				result[key] as Record<string, unknown>,
				override[key] as Record<string, unknown>,
			);
		} else {
			result[key] = override[key];
		}
	}
	return result;
}

function deepCopy(obj: Record<string, unknown>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
}

/** Resolve the default model for a given runtime from config, with backward compatibility. */
export function getRuntimeModel(config: Record<string, unknown>, runtimeId: string): string | null {
	// Per-runtime config: config[runtimeId].model
	const runtimeConfig = config[runtimeId] as Record<string, unknown> | undefined;
	if (runtimeConfig?.model) {
		return runtimeConfig.model as string;
	}
	// Backward compat: config.defaults.model
	const defaults = config.defaults as Record<string, unknown> | undefined;
	if (defaults?.model) {
		return defaults.model as string;
	}
	return null;
}

/** Extract the Codex sandbox mode from config. */
export function getSandboxMode(config: Record<string, unknown>): string | null {
	const codexConfig = config.codex as Record<string, unknown> | undefined;
	return (codexConfig?.sandbox as string) ?? null;
}
