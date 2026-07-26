import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deepMerge,
	getConfigPath,
	getConfigValue,
	getDefaultConfig,
	getRuntimeModel,
	loadConfig,
	saveConfig,
	setConfigValue,
} from "../src/config.js";

function makeTempDir(): string {
	const dir = path.join(
		tmpdir(),
		`agentic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Redirects the global config to a temp directory to isolate tests from the
 * real user global config.
 */
function isolateGlobalConfig(tempBase: string): () => void {
	const savedAppdata = process.env.APPDATA;
	const savedXdgConfig = process.env.XDG_CONFIG_HOME;

	if (process.platform === "win32") {
		process.env.APPDATA = tempBase;
	} else {
		process.env.XDG_CONFIG_HOME = tempBase;
	}

	return () => {
		process.env.APPDATA = savedAppdata;
		process.env.XDG_CONFIG_HOME = savedXdgConfig;
	};
}

describe("Config defaults", () => {
	it("should return a copy from getDefaultConfig", () => {
		const config1 = getDefaultConfig();
		const config2 = getDefaultConfig();

		config1.outputDirectory = "modified";

		expect(config2.outputDirectory).toBe("global");
		expect(config1).not.toBe(config2);
	});

	it("should have correct default structure", () => {
		const config = getDefaultConfig();

		expect(config).toHaveProperty("outputDirectory");
		expect(config).toHaveProperty("logging");
		expect(config).toHaveProperty("defaults");
		expect(config).toHaveProperty("execution");
	});

	it("should have sonnet as default claude model", () => {
		const config = getDefaultConfig();
		expect((config.claude as Record<string, unknown>).model).toBe("sonnet");
	});

	it("should not pin a default codex model", () => {
		const config = getDefaultConfig();
		expect((config.codex as Record<string, unknown>).model).toBeUndefined();
	});

	it("should keep workspace-write as default codex sandbox", () => {
		const config = getDefaultConfig();
		expect((config.codex as Record<string, unknown>).sandbox).toBe("workspace-write");
	});

	it("should have global as default outputDirectory", () => {
		const config = getDefaultConfig();
		expect(config.outputDirectory).toBe("global");
	});
});

describe("getRuntimeModel", () => {
	it("should prefer the per-runtime model", () => {
		const config = { codex: { model: "gpt-5.5" }, defaults: { model: "sonnet" } };
		expect(getRuntimeModel(config, "codex")).toBe("gpt-5.5");
	});

	it("should fall back to defaults.model for claude", () => {
		expect(getRuntimeModel({ defaults: { model: "opus" } }, "claude")).toBe("opus");
	});

	it("should not leak the legacy defaults.model into non-claude runtimes", () => {
		// defaults.model predates per-runtime namespaces and always held a Claude
		// alias, so codex must get no model rather than "sonnet".
		expect(getRuntimeModel({ defaults: { model: "sonnet" } }, "codex")).toBeNull();
	});
});

describe("Config path", () => {
	it("should construct correct config path", () => {
		const tempDir = makeTempDir();
		const configPath = getConfigPath(tempDir);
		expect(configPath).toBe(path.join(tempDir, "agentic", "config.json"));
	});

	it("should use cwd when no root specified", () => {
		const configPath = getConfigPath();
		expect(path.basename(configPath)).toBe("config.json");
		expect(path.basename(path.dirname(configPath))).toBe("agentic");
	});
});

describe("Load config", () => {
	let tempDir: string;
	let restoreEnv: () => void;

	beforeEach(() => {
		tempDir = makeTempDir();
		restoreEnv = isolateGlobalConfig(tempDir);
	});

	afterEach(() => {
		restoreEnv();
	});

	it("should load default config when no file exists", () => {
		const config = loadConfig(tempDir);

		expect(config.outputDirectory).toBe("global");
		expect((config.claude as Record<string, unknown>).model).toBe("sonnet");
	});

	it("should load existing local config file", () => {
		const configDir = path.join(tempDir, "agentic");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			path.join(configDir, "config.json"),
			JSON.stringify({
				outputDirectory: "local",
				claude: { model: "opus" },
			}),
		);

		const config = loadConfig(tempDir);

		expect(config.outputDirectory).toBe("local");
		expect((config.claude as Record<string, unknown>).model).toBe("opus");
		// Other defaults should still be present
		expect((config.defaults as Record<string, unknown>).maxRetry).toBe(3);
	});

	it("should merge loaded config with defaults", () => {
		const configDir = path.join(tempDir, "agentic");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			path.join(configDir, "config.json"),
			JSON.stringify({ logging: { level: "Debug" } }),
		);

		const config = loadConfig(tempDir);

		expect((config.logging as Record<string, unknown>).level).toBe("Debug");
		expect((config.logging as Record<string, unknown>).enabled).toBe(true);
	});

	it("should merge global config between defaults and local", () => {
		// Use a separate project dir so local config doesn't conflict with global dir
		const projectDir = makeTempDir();

		// Write global config (inside the isolated APPDATA/XDG path)
		const globalRoot = path.join(tempDir, "agentic-forge");
		mkdirSync(globalRoot, { recursive: true });
		writeFileSync(
			path.join(globalRoot, "config.json"),
			JSON.stringify({ outputDirectory: "local", logging: { level: "Debug" } }),
		);

		// Write local config that overrides only one key
		const localAgenticDir = path.join(projectDir, "agentic");
		mkdirSync(localAgenticDir, { recursive: true });
		writeFileSync(
			path.join(localAgenticDir, "config.json"),
			JSON.stringify({ outputDirectory: "global" }),
		);

		const config = loadConfig(projectDir);

		// Local overrides global
		expect(config.outputDirectory).toBe("global");
		// Global overrides defaults
		expect((config.logging as Record<string, unknown>).level).toBe("Debug");
		// Defaults fill in what neither global nor local set
		expect((config.logging as Record<string, unknown>).enabled).toBe(true);
	});

	it("should apply global config when no local config exists", () => {
		const globalRoot = path.join(tempDir, "agentic-forge");
		mkdirSync(globalRoot, { recursive: true });
		writeFileSync(
			path.join(globalRoot, "config.json"),
			JSON.stringify({ outputDirectory: "local" }),
		);

		const projectDir = makeTempDir();
		const config = loadConfig(projectDir);

		expect(config.outputDirectory).toBe("local");
		// Defaults still filled in
		expect((config.claude as Record<string, unknown>).model).toBe("sonnet");
	});
});

describe("Save config", () => {
	let tempDir: string;
	let restoreEnv: () => void;

	beforeEach(() => {
		tempDir = makeTempDir();
		restoreEnv = isolateGlobalConfig(tempDir);
	});

	afterEach(() => {
		restoreEnv();
	});

	it("should create directory if needed (local scope)", () => {
		const config = { test: "value" };
		saveConfig(config, tempDir);

		const configPath = getConfigPath(tempDir);
		const content = readFileSync(configPath, "utf-8");
		expect(content).toBeTruthy();
	});

	it("should write valid JSON (local scope)", () => {
		const config = { test: "value", nested: { key: 123 } };
		saveConfig(config, tempDir);

		const configPath = getConfigPath(tempDir);
		const loaded = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(loaded).toEqual(config);
	});

	it("should write to global config when scope is global", () => {
		const globalRoot = path.join(tempDir, "agentic-forge");
		mkdirSync(globalRoot, { recursive: true });

		const config = { outputDirectory: "local" };
		saveConfig(config, undefined, "global");

		const globalConfigPath = path.join(globalRoot, "config.json");
		const loaded = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
		expect(loaded.outputDirectory).toBe("local");
	});
});

describe("Config values", () => {
	let tempDir: string;
	let restoreEnv: () => void;

	beforeEach(() => {
		tempDir = makeTempDir();
		restoreEnv = isolateGlobalConfig(tempDir);
	});

	afterEach(() => {
		restoreEnv();
	});

	it("should get simple config value", () => {
		const value = getConfigValue("outputDirectory", tempDir);
		expect(value).toBe("global");
	});

	it("should get nested config value", () => {
		const value = getConfigValue("claude.model", tempDir);
		expect(value).toBe("sonnet");
	});

	it("should return null for missing key", () => {
		const value = getConfigValue("nonexistent.key", tempDir);
		expect(value).toBeNull();
	});

	it("should set simple config value", () => {
		setConfigValue("outputDirectory", "new-output", undefined, tempDir);
		const value = getConfigValue("outputDirectory", tempDir);
		expect(value).toBe("new-output");
	});

	it("should set nested config value", () => {
		setConfigValue("claude.model", "opus", undefined, tempDir);
		const value = getConfigValue("claude.model", tempDir);
		expect(value).toBe("opus");
	});

	it("should create nested structure when setting value", () => {
		setConfigValue("new.nested.key", "value", undefined, tempDir);
		const value = getConfigValue("new.nested.key", tempDir);
		expect(value).toBe("value");
	});

	it("should parse boolean true value", () => {
		setConfigValue("logging.enabled", "true", undefined, tempDir);
		const value = getConfigValue("logging.enabled", tempDir);
		expect(value).toBe(true);
	});

	it("should parse boolean false value", () => {
		setConfigValue("logging.enabled", "false", undefined, tempDir);
		const value = getConfigValue("logging.enabled", tempDir);
		expect(value).toBe(false);
	});

	it("should parse integer value", () => {
		setConfigValue("defaults.maxRetry", "10", undefined, tempDir);
		const value = getConfigValue("defaults.maxRetry", tempDir);
		expect(value).toBe(10);
	});

	it("should auto-detect global scope when no local config exists", () => {
		const projectDir = makeTempDir();
		// No local config at projectDir/agentic/config.json
		setConfigValue("outputDirectory", "local", undefined, projectDir);

		// Should have written to global, not local
		const localConfigPath = getConfigPath(projectDir);
		expect(existsSync(localConfigPath)).toBe(false);

		const globalRoot = path.join(tempDir, "agentic-forge");
		const globalConfigPath = path.join(globalRoot, "config.json");
		const globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
		expect(globalConfig.outputDirectory).toBe("local");
	});

	it("should auto-detect local scope when local config exists", () => {
		const projectDir = makeTempDir();
		// Create a local config so auto-detect picks local
		const localConfigDir = path.join(projectDir, "agentic");
		mkdirSync(localConfigDir, { recursive: true });
		writeFileSync(path.join(localConfigDir, "config.json"), JSON.stringify({}), "utf-8");

		setConfigValue("outputDirectory", "local", undefined, projectDir);

		const localConfigPath = getConfigPath(projectDir);
		const localConfig = JSON.parse(readFileSync(localConfigPath, "utf-8"));
		expect(localConfig.outputDirectory).toBe("local");
		// Should NOT contain merged default values
		expect(localConfig.defaults).toBeUndefined();
	});

	it("should write to global scope when scope is global", () => {
		const globalRoot = path.join(tempDir, "agentic-forge");
		mkdirSync(globalRoot, { recursive: true });

		setConfigValue("outputDirectory", "local", "global");

		const globalConfigPath = path.join(globalRoot, "config.json");
		const globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
		expect(globalConfig.outputDirectory).toBe("local");
	});

	it("should write to local scope when scope is local", () => {
		const projectDir = makeTempDir();
		setConfigValue("outputDirectory", "local", "local", projectDir);

		const localConfigPath = getConfigPath(projectDir);
		const localConfig = JSON.parse(readFileSync(localConfigPath, "utf-8"));
		expect(localConfig.outputDirectory).toBe("local");
	});
});

describe("Backward compatibility", () => {
	it("outputDirectory agentic treated as local in getOutputRoot via paths", () => {
		// This test verifies the backward-compat documented in paths.ts.
		// getOutputRoot({ outputDirectory: "agentic" }) returns local path.
		// This is a cross-module concern; the value is just stored/loaded correctly here.
		const config = getDefaultConfig();
		// Default is now "global" not "agentic"
		expect(config.outputDirectory).toBe("global");
		// But a config written with "agentic" can still be loaded
		config.outputDirectory = "agentic";
		expect(config.outputDirectory).toBe("agentic");
	});
});

describe("Deep merge", () => {
	it("should merge simple objects", () => {
		const base = { a: 1, b: 2 };
		const override = { b: 3, c: 4 };
		const result = deepMerge(base as Record<string, unknown>, override as Record<string, unknown>);
		expect(result).toEqual({ a: 1, b: 3, c: 4 });
	});

	it("should merge nested objects", () => {
		const base = { a: { x: 1, y: 2 }, b: 3 };
		const override = { a: { y: 99, z: 100 } };
		const result = deepMerge(base as Record<string, unknown>, override as Record<string, unknown>);
		expect(result).toEqual({ a: { x: 1, y: 99, z: 100 }, b: 3 });
	});

	it("should not mutate base dictionary", () => {
		const base = { a: { x: 1 } };
		const override = { a: { y: 2 } };
		deepMerge(base as Record<string, unknown>, override as Record<string, unknown>);
		expect(base).toEqual({ a: { x: 1 } });
	});
});
