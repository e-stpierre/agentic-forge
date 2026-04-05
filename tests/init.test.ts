import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cmdInit } from "../src/commands/init.js";
import { getGlobalRoot } from "../src/paths.js";

function makeTempDir(): string {
	const dir = path.join(
		tmpdir(),
		`agentic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// --- Local init tests (--local flag) ---

describe("cmdInit --local", () => {
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

	it("should create config.json in local agentic dir", () => {
		cmdInit({ force: false, listOnly: false, local: true });

		const configPath = path.join(tempDir, "agentic", "config.json");
		expect(existsSync(configPath)).toBe(true);

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config).toHaveProperty("outputDirectory");
		expect(config).toHaveProperty("defaults");
		expect(config.claude.model).toBe("sonnet");
	});

	it("should copy workflows to local directory", () => {
		cmdInit({ force: false, listOnly: false, local: true });

		const workflowsDir = path.join(tempDir, "agentic", "workflows");
		expect(existsSync(workflowsDir)).toBe(true);

		const files = readdirSync(workflowsDir).filter((f: string) => f.endsWith(".yaml"));
		expect(files.length).toBeGreaterThan(0);
	});

	it("should not overwrite config without --force", () => {
		const configDir = path.join(tempDir, "agentic");
		mkdirSync(configDir, { recursive: true });
		const configPath = path.join(configDir, "config.json");
		const customConfig = { outputDirectory: "custom", claude: { model: "opus" } };
		writeFileSync(configPath, JSON.stringify(customConfig));

		cmdInit({ force: false, listOnly: false, local: true });

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config.claude.model).toBe("opus");
	});

	it("should overwrite config with --force", () => {
		const configDir = path.join(tempDir, "agentic");
		mkdirSync(configDir, { recursive: true });
		const configPath = path.join(configDir, "config.json");
		const customConfig = { outputDirectory: "custom", claude: { model: "opus" } };
		writeFileSync(configPath, JSON.stringify(customConfig));

		cmdInit({ force: true, listOnly: false, local: true });

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config.claude.model).toBe("sonnet");
	});

	it("should not create config with --list", () => {
		cmdInit({ force: false, listOnly: true });

		const configPath = path.join(tempDir, "agentic", "config.json");
		expect(existsSync(configPath)).toBe(false);
	});

	it("--config-only should not copy workflows", () => {
		cmdInit({ force: false, listOnly: false, local: true, configOnly: true });

		const workflowsDir = path.join(tempDir, "agentic", "workflows");
		// workflows dir may exist but should be empty or not created
		const hasWorkflows =
			existsSync(workflowsDir) &&
			readdirSync(workflowsDir).filter((f) => f.endsWith(".yaml")).length > 0;
		expect(hasWorkflows).toBe(false);

		const configPath = path.join(tempDir, "agentic", "config.json");
		expect(existsSync(configPath)).toBe(true);
	});

	it("--workflows-only should not create config", () => {
		cmdInit({ force: false, listOnly: false, local: true, workflowsOnly: true });

		const configPath = path.join(tempDir, "agentic", "config.json");
		expect(existsSync(configPath)).toBe(false);

		const workflowsDir = path.join(tempDir, "agentic", "workflows");
		expect(existsSync(workflowsDir)).toBe(true);
	});

	it("--workflow <name> should copy only the named workflow", () => {
		cmdInit({ force: false, listOnly: false, local: true, workflow: "claude-demo" });

		const workflowsDir = path.join(tempDir, "agentic", "workflows");
		expect(existsSync(workflowsDir)).toBe(true);

		const files = readdirSync(workflowsDir).filter((f: string) => f.endsWith(".yaml"));
		expect(files).toHaveLength(1);
		expect(files[0]).toBe("claude-demo.yaml");
	});
});

// --- Global init tests (default / --global flag) ---

describe("cmdInit global (default)", () => {
	let tempDir: string;
	let originalCwd: string;
	let originalAppData: string | undefined;

	beforeEach(() => {
		tempDir = makeTempDir();
		originalCwd = process.cwd();
		process.chdir(tempDir);
		// Override APPDATA on Windows so global dir goes to temp
		originalAppData = process.env.APPDATA;
		process.env.APPDATA = tempDir;
	});

	afterEach(() => {
		process.chdir(originalCwd);
		if (originalAppData === undefined) {
			process.env.APPDATA = undefined;
		} else {
			process.env.APPDATA = originalAppData;
		}
	});

	it("should create config in global dir by default", () => {
		cmdInit({ force: false, listOnly: false });

		const globalRoot = getGlobalRoot();
		const configPath = path.join(globalRoot, "config.json");
		expect(existsSync(configPath)).toBe(true);

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config).toHaveProperty("defaults");
	});

	it("should copy workflows to global dir by default", () => {
		cmdInit({ force: false, listOnly: false });

		const globalRoot = getGlobalRoot();
		const workflowsDir = path.join(globalRoot, "workflows");
		expect(existsSync(workflowsDir)).toBe(true);

		const files = readdirSync(workflowsDir).filter((f: string) => f.endsWith(".yaml"));
		expect(files.length).toBeGreaterThan(0);
	});

	it("should NOT create files in local agentic dir when using default (global) mode", () => {
		cmdInit({ force: false, listOnly: false });

		const localConfigPath = path.join(tempDir, "agentic", "config.json");
		expect(existsSync(localConfigPath)).toBe(false);
	});
});

// --- --workflow <unknown> error ---

describe("cmdInit --workflow error", () => {
	let tempDir: string;
	let originalCwd: string;
	let exitCode: number | undefined;

	beforeEach(() => {
		tempDir = makeTempDir();
		originalCwd = process.cwd();
		process.chdir(tempDir);
		exitCode = undefined;
	});

	afterEach(() => {
		process.chdir(originalCwd);
	});

	it("should exit with error for unknown --workflow name", () => {
		// Override process.exit to capture exit code
		const origExit = process.exit.bind(process);
		let exited = false;
		(process as NodeJS.Process & { exit: (code?: number) => never }).exit = (
			code?: number,
		): never => {
			exitCode = code;
			exited = true;
			throw new Error(`process.exit(${code})`);
		};

		try {
			cmdInit({ force: false, listOnly: false, local: true, workflow: "nonexistent-workflow" });
		} catch {
			// expected
		} finally {
			(process as NodeJS.Process & { exit: (code?: number) => never }).exit = origExit;
		}

		expect(exited).toBe(true);
		expect(exitCode).toBe(1);
	});
});
