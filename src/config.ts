/** Configuration management for agentic-forge. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG: Record<string, unknown> = {
	outputDirectory: "agentic",
	logging: {
		enabled: true,
		level: "Error",
	},
	git: {
		mainBranch: "main",
		autoCommit: true,
		autoPr: true,
	},
	defaults: {
		model: "sonnet",
		maxRetry: 3,
		timeoutMinutes: 60,
		trackProgress: true,
		terminalOutput: "base",
	},
	execution: {
		maxWorkers: 4,
		pollingIntervalSeconds: 5,
	},
};

export function getConfigPath(repoRoot?: string): string {
	const root = repoRoot ?? process.cwd();
	return path.join(root, "agentic", "config.json");
}

export function getDefaultConfig(): Record<string, unknown> {
	return deepCopy(DEFAULT_CONFIG);
}

export function loadConfig(repoRoot?: string): Record<string, unknown> {
	const configPath = getConfigPath(repoRoot);

	if (existsSync(configPath)) {
		const content = readFileSync(configPath, "utf-8");
		const userConfig = JSON.parse(content) as Record<string, unknown>;
		return deepMerge(getDefaultConfig(), userConfig);
	}

	return getDefaultConfig();
}

export function saveConfig(config: Record<string, unknown>, repoRoot?: string): void {
	const configPath = getConfigPath(repoRoot);
	const dir = path.dirname(configPath);
	mkdirSync(dir, { recursive: true });
	writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
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

export function setConfigValue(key: string, value: string, repoRoot?: string): void {
	const config = loadConfig(repoRoot);
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
	saveConfig(config, repoRoot);
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
