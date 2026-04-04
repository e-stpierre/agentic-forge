import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cmdInit } from "../src/commands/init.js";

function makeTempDir(): string {
	const dir = path.join(
		tmpdir(),
		`agentic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("cmdInit", () => {
	let tempDir: string;
	let originalCwd: string;

	beforeEach(() => {
		tempDir = makeTempDir();
		originalCwd = process.cwd();
		process.chdir(tempDir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
	});

	it("should create config.json", () => {
		cmdInit({ force: false, listOnly: false });

		const configPath = path.join(tempDir, "agentic", "config.json");
		expect(existsSync(configPath)).toBe(true);

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config).toHaveProperty("outputDirectory");
		expect(config).toHaveProperty("defaults");
		expect(config.defaults.model).toBe("sonnet");
	});

	it("should copy workflows", () => {
		cmdInit({ force: false, listOnly: false });

		const workflowsDir = path.join(tempDir, "agentic", "workflows");
		expect(existsSync(workflowsDir)).toBe(true);

		const files = require("node:fs")
			.readdirSync(workflowsDir)
			.filter((f: string) => f.endsWith(".yaml"));
		expect(files.length).toBeGreaterThan(0);
	});

	it("should not overwrite config without --force", () => {
		const configDir = path.join(tempDir, "agentic");
		mkdirSync(configDir, { recursive: true });
		const configPath = path.join(configDir, "config.json");
		const customConfig = { outputDirectory: "custom", defaults: { model: "opus" } };
		writeFileSync(configPath, JSON.stringify(customConfig));

		cmdInit({ force: false, listOnly: false });

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config.defaults.model).toBe("opus");
	});

	it("should overwrite config with --force", () => {
		const configDir = path.join(tempDir, "agentic");
		mkdirSync(configDir, { recursive: true });
		const configPath = path.join(configDir, "config.json");
		const customConfig = { outputDirectory: "custom", defaults: { model: "opus" } };
		writeFileSync(configPath, JSON.stringify(customConfig));

		cmdInit({ force: true, listOnly: false });

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config.defaults.model).toBe("sonnet");
	});

	it("should not create config with --list", () => {
		cmdInit({ force: false, listOnly: true });

		const configPath = path.join(tempDir, "agentic", "config.json");
		expect(existsSync(configPath)).toBe(false);
	});
});
