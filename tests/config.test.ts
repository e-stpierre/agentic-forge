import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	deepMerge,
	getConfigPath,
	getConfigValue,
	getDefaultConfig,
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

describe("Config defaults", () => {
	it("should return a copy from getDefaultConfig", () => {
		const config1 = getDefaultConfig();
		const config2 = getDefaultConfig();

		config1.outputDirectory = "modified";

		expect(config2.outputDirectory).toBe("agentic");
		expect(config1).not.toBe(config2);
	});

	it("should have correct default structure", () => {
		const config = getDefaultConfig();

		expect(config).toHaveProperty("outputDirectory");
		expect(config).toHaveProperty("logging");
		expect(config).toHaveProperty("git");
		expect(config).toHaveProperty("defaults");
		expect(config).toHaveProperty("execution");
	});

	it("should have sonnet as default model", () => {
		const config = getDefaultConfig();
		expect((config.defaults as Record<string, unknown>).model).toBe("sonnet");
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

	beforeEach(() => {
		tempDir = makeTempDir();
	});

	it("should load default config when no file exists", () => {
		const config = loadConfig(tempDir);

		expect(config.outputDirectory).toBe("agentic");
		expect((config.defaults as Record<string, unknown>).model).toBe("sonnet");
	});

	it("should load existing config file", () => {
		const configDir = path.join(tempDir, "agentic");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			path.join(configDir, "config.json"),
			JSON.stringify({
				outputDirectory: "custom-output",
				defaults: { model: "opus" },
			}),
		);

		const config = loadConfig(tempDir);

		expect(config.outputDirectory).toBe("custom-output");
		expect((config.defaults as Record<string, unknown>).model).toBe("opus");
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
});

describe("Save config", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = makeTempDir();
	});

	it("should create directory if needed", () => {
		const config = { test: "value" };
		saveConfig(config, tempDir);

		const configPath = getConfigPath(tempDir);
		const content = readFileSync(configPath, "utf-8");
		expect(content).toBeTruthy();
	});

	it("should write valid JSON", () => {
		const config = { test: "value", nested: { key: 123 } };
		saveConfig(config, tempDir);

		const configPath = getConfigPath(tempDir);
		const loaded = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(loaded).toEqual(config);
	});
});

describe("Config values", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = makeTempDir();
	});

	it("should get simple config value", () => {
		const value = getConfigValue("outputDirectory", tempDir);
		expect(value).toBe("agentic");
	});

	it("should get nested config value", () => {
		const value = getConfigValue("defaults.model", tempDir);
		expect(value).toBe("sonnet");
	});

	it("should return null for missing key", () => {
		const value = getConfigValue("nonexistent.key", tempDir);
		expect(value).toBeNull();
	});

	it("should set simple config value", () => {
		setConfigValue("outputDirectory", "new-output", tempDir);
		const value = getConfigValue("outputDirectory", tempDir);
		expect(value).toBe("new-output");
	});

	it("should set nested config value", () => {
		setConfigValue("defaults.model", "opus", tempDir);
		const value = getConfigValue("defaults.model", tempDir);
		expect(value).toBe("opus");
	});

	it("should create nested structure when setting value", () => {
		setConfigValue("new.nested.key", "value", tempDir);
		const value = getConfigValue("new.nested.key", tempDir);
		expect(value).toBe("value");
	});

	it("should parse boolean true value", () => {
		setConfigValue("logging.enabled", "true", tempDir);
		const value = getConfigValue("logging.enabled", tempDir);
		expect(value).toBe(true);
	});

	it("should parse boolean false value", () => {
		setConfigValue("logging.enabled", "false", tempDir);
		const value = getConfigValue("logging.enabled", tempDir);
		expect(value).toBe(false);
	});

	it("should parse integer value", () => {
		setConfigValue("defaults.maxRetry", "10", tempDir);
		const value = getConfigValue("defaults.maxRetry", tempDir);
		expect(value).toBe(10);
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
