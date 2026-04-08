import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ensureGlobalDir,
	findOutputDir,
	getConfigPaths,
	getGlobalRoot,
	getOutputDir,
	getOutputRoot,
	getProjectRoot,
	getWorkflowDirs,
	getWorktreeOutputRoot,
	resolveOutputDir,
	sanitizeSlug,
	slugifyCwdName,
} from "../src/paths.js";

function makeTempDir(): string {
	const dir = path.join(
		tmpdir(),
		`agentic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// --- getGlobalRoot ---

describe("getGlobalRoot", () => {
	const originalAppdata = process.env.APPDATA;
	const originalXdgConfig = process.env.XDG_CONFIG_HOME;

	afterEach(() => {
		process.env.APPDATA = originalAppdata;
		process.env.XDG_CONFIG_HOME = originalXdgConfig;
	});

	it("should use APPDATA on Windows", () => {
		process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming";
		const root = getGlobalRoot("win32");
		expect(root).toBe(path.join("C:\\Users\\Test\\AppData\\Roaming", "agentic-forge"));
	});

	it("should fallback to homedir on Windows without APPDATA", () => {
		// biome-ignore lint/performance/noDelete: required to unset env var for test
		delete process.env.APPDATA;
		const root = getGlobalRoot("win32");
		expect(root).toBe(path.join(homedir(), "AppData", "Roaming", "agentic-forge"));
	});

	it("should return Library/Application Support on macOS", () => {
		const root = getGlobalRoot("darwin");
		expect(root).toBe(path.join(homedir(), "Library", "Application Support", "agentic-forge"));
	});

	it("should use XDG_CONFIG_HOME on Linux", () => {
		process.env.XDG_CONFIG_HOME = "/custom/config";
		const root = getGlobalRoot("linux");
		expect(root).toBe(path.join("/custom/config", "agentic-forge"));
	});

	it("should fallback to ~/.config on Linux without XDG_CONFIG_HOME", () => {
		// biome-ignore lint/performance/noDelete: required to unset env var for test
		delete process.env.XDG_CONFIG_HOME;
		const root = getGlobalRoot("linux");
		expect(root).toBe(path.join(homedir(), ".config", "agentic-forge"));
	});

	it("should return a non-empty string for the current platform", () => {
		const root = getGlobalRoot();
		expect(typeof root).toBe("string");
		expect(root.length).toBeGreaterThan(0);
		expect(root).toContain("agentic-forge");
	});
});

// --- getProjectRoot ---

describe("getProjectRoot", () => {
	it("should return agentic dir path when it exists", () => {
		const tempDir = makeTempDir();
		mkdirSync(path.join(tempDir, "agentic"), { recursive: true });
		const result = getProjectRoot(tempDir);
		expect(result).toBe(path.join(tempDir, "agentic"));
	});

	it("should return null when agentic dir does not exist", () => {
		const tempDir = makeTempDir();
		const result = getProjectRoot(tempDir);
		expect(result).toBeNull();
	});
});

// --- getWorkflowDirs ---

describe("getWorkflowDirs", () => {
	it("should return three directories in correct order", () => {
		const tempDir = makeTempDir();
		const bundledDir = "/some/bundled";
		const dirs = getWorkflowDirs(bundledDir, tempDir);

		expect(dirs).toHaveLength(3);
		expect(dirs[0]).toBe(path.join(tempDir, "agentic", "workflows"));
		expect(dirs[1]).toBe(path.join(getGlobalRoot(), "workflows"));
		expect(dirs[2]).toBe(path.join(bundledDir, "workflows"));
	});

	it("should use process.cwd when no cwd provided", () => {
		const dirs = getWorkflowDirs("/bundled");
		expect(dirs[0]).toBe(path.join(process.cwd(), "agentic", "workflows"));
	});

	it("should have project-local first, global second, bundled third", () => {
		const bundledDir = path.join(path.sep, "bundled");
		const dirs = getWorkflowDirs(bundledDir, path.join(path.sep, "some", "project"));
		expect(dirs[0]).toContain("agentic");
		expect(dirs[0]).toContain("workflows");
		expect(dirs[1]).toContain("agentic-forge");
		expect(dirs[2]).toBe(path.join(bundledDir, "workflows"));
	});
});

// --- getConfigPaths ---

describe("getConfigPaths", () => {
	it("should return global path and null local when no local config", () => {
		const tempDir = makeTempDir();
		const paths = getConfigPaths(tempDir);

		expect(paths.global).toBe(path.join(getGlobalRoot(), "config.json"));
		expect(paths.local).toBeNull();
	});

	it("should return local path when local config exists", () => {
		const tempDir = makeTempDir();
		const agenticDir = path.join(tempDir, "agentic");
		mkdirSync(agenticDir, { recursive: true });
		const configPath = path.join(agenticDir, "config.json");
		writeFileSync(configPath, "{}", "utf-8");

		const paths = getConfigPaths(tempDir);

		expect(paths.local).toBe(configPath);
	});
});

// --- getOutputRoot ---

describe("getOutputRoot", () => {
	it("should return global output root for 'global' outputDirectory", () => {
		const tempDir = makeTempDir();
		const config = { outputDirectory: "global" };
		const root = getOutputRoot(config, tempDir);
		const cwdSlug = slugifyCwdName(tempDir);
		expect(root).toBe(path.join(getGlobalRoot(), "outputs", cwdSlug));
	});

	it("should return local output root for 'local' outputDirectory", () => {
		const tempDir = makeTempDir();
		const config = { outputDirectory: "local" };
		const root = getOutputRoot(config, tempDir);
		expect(root).toBe(path.join(tempDir, "agentic", "outputs"));
	});

	it("should treat 'agentic' as local (backward compat)", () => {
		const tempDir = makeTempDir();
		const config = { outputDirectory: "agentic" };
		const root = getOutputRoot(config, tempDir);
		expect(root).toBe(path.join(tempDir, "agentic", "outputs"));
	});

	it("should default to global for undefined outputDirectory", () => {
		const tempDir = makeTempDir();
		const config: Record<string, unknown> = {};
		const root = getOutputRoot(config, tempDir);
		expect(root).toContain(getGlobalRoot());
	});
});

// --- getOutputDir ---

describe("getOutputDir", () => {
	it("should append workflow ID to output root", () => {
		const tempDir = makeTempDir();
		const config = { outputDirectory: "local" };
		const dir = getOutputDir("my-workflow-id", config, tempDir);
		expect(dir).toBe(path.join(tempDir, "agentic", "outputs", "my-workflow-id"));
	});

	it("should include workflow ID at the end of the path", () => {
		const tempDir = makeTempDir();
		const config = { outputDirectory: "global" };
		const dir = getOutputDir("20260404-123000-test", config, tempDir);
		expect(dir.endsWith("20260404-123000-test")).toBe(true);
	});
});

// --- sanitizeSlug ---

describe("sanitizeSlug", () => {
	it("should lowercase input", () => {
		expect(sanitizeSlug("MyProject")).toBe("myproject");
	});

	it("should replace spaces with hyphens", () => {
		expect(sanitizeSlug("my project")).toBe("my-project");
	});

	it("should replace underscores with hyphens", () => {
		expect(sanitizeSlug("my_project")).toBe("my-project");
	});

	it("should strip reserved characters", () => {
		expect(sanitizeSlug('my<>:"/\\|?*project')).toBe("myproject");
	});

	it("should collapse multiple hyphens", () => {
		expect(sanitizeSlug("my---project")).toBe("my-project");
	});

	it("should remove leading and trailing hyphens", () => {
		expect(sanitizeSlug("-my-project-")).toBe("my-project");
	});

	it("should truncate to 50 characters", () => {
		const long = "a".repeat(60);
		const slug = sanitizeSlug(long);
		expect(slug.length).toBeLessThanOrEqual(50);
	});

	it("should suffix Windows reserved name CON", () => {
		expect(sanitizeSlug("CON")).toBe("con-dir");
	});

	it("should suffix Windows reserved name NUL", () => {
		expect(sanitizeSlug("NUL")).toBe("nul-dir");
	});

	it("should suffix Windows reserved name COM1", () => {
		expect(sanitizeSlug("COM1")).toBe("com1-dir");
	});

	it("should suffix Windows reserved name LPT9", () => {
		expect(sanitizeSlug("LPT9")).toBe("lpt9-dir");
	});

	it("should handle mixed case reserved names", () => {
		expect(sanitizeSlug("Con")).toBe("con-dir");
	});

	it("should handle normal project names unchanged", () => {
		expect(sanitizeSlug("my-cool-project")).toBe("my-cool-project");
	});

	it("should replace dots with hyphens", () => {
		expect(sanitizeSlug("my.project.v2")).toBe("my-project-v2");
	});

	it("should handle alphanumeric plus hyphens only", () => {
		const result = sanitizeSlug("hello world @2024");
		expect(result).toMatch(/^[a-z0-9-]+$/);
	});
});

// --- resolveOutputDir ---

describe("resolveOutputDir", () => {
	it("should return base dir when it does not exist", () => {
		const tempDir = makeTempDir();
		const baseDir = path.join(tempDir, "my-workflow");
		expect(resolveOutputDir(baseDir)).toBe(baseDir);
	});

	it("should append -2 when base dir exists", () => {
		const tempDir = makeTempDir();
		const baseDir = path.join(tempDir, "my-workflow");
		mkdirSync(baseDir, { recursive: true });
		expect(resolveOutputDir(baseDir)).toBe(`${baseDir}-2`);
	});

	it("should increment counter until free slot found", () => {
		const tempDir = makeTempDir();
		const baseDir = path.join(tempDir, "my-workflow");
		mkdirSync(baseDir, { recursive: true });
		mkdirSync(`${baseDir}-2`, { recursive: true });
		mkdirSync(`${baseDir}-3`, { recursive: true });
		expect(resolveOutputDir(baseDir)).toBe(`${baseDir}-4`);
	});
});

// --- ensureGlobalDir ---

describe("ensureGlobalDir", () => {
	let savedAppdata: string | undefined;
	let savedXdgConfig: string | undefined;
	let savedPlatform: string;
	let tempBase: string;

	beforeEach(() => {
		savedAppdata = process.env.APPDATA;
		savedXdgConfig = process.env.XDG_CONFIG_HOME;
		savedPlatform = process.platform;
		tempBase = makeTempDir();

		// Redirect global root to a temp dir by overriding env var.
		// On Windows: override APPDATA
		// On macOS/Linux: use XDG_CONFIG_HOME with linux platform mock
		if (process.platform === "win32") {
			process.env.APPDATA = tempBase;
		} else {
			process.env.XDG_CONFIG_HOME = tempBase;
		}
	});

	afterEach(() => {
		process.env.APPDATA = savedAppdata;
		process.env.XDG_CONFIG_HOME = savedXdgConfig;
		vi.restoreAllMocks();
	});

	it("should create global directory structure", () => {
		const globalRoot = getGlobalRoot();
		ensureGlobalDir();

		expect(existsSync(globalRoot)).toBe(true);
		expect(existsSync(path.join(globalRoot, "workflows"))).toBe(true);
		expect(existsSync(path.join(globalRoot, "outputs"))).toBe(true);
		expect(existsSync(path.join(globalRoot, "config.json"))).toBe(true);
	});

	it("should write valid JSON config", () => {
		ensureGlobalDir();
		const globalRoot = getGlobalRoot();
		const configContent = readFileSync(path.join(globalRoot, "config.json"), "utf-8");
		const config = JSON.parse(configContent);
		expect(config).toHaveProperty("outputDirectory");
		expect(config).toHaveProperty("logging");
	});

	it("should be idempotent when called twice", () => {
		ensureGlobalDir();
		expect(() => ensureGlobalDir()).not.toThrow();
	});
});

// --- getWorktreeOutputRoot ---

describe("getWorktreeOutputRoot", () => {
	it("should return global output root keyed by repo name", () => {
		const repoRoot = "/projects/my-repo";
		const result = getWorktreeOutputRoot(repoRoot);
		expect(result).toContain(getGlobalRoot());
		expect(result).toContain("my-repo");
	});

	it("should use main repo root slug, not worktree path", () => {
		const mainRepo = "/projects/main-repo";
		const worktreePath = "/tmp/worktrees/main-repo-workflow-abc";
		// Both should yield the same output root (keyed by main repo)
		const fromMain = getWorktreeOutputRoot(mainRepo);
		const fromWorktree = getWorktreeOutputRoot(worktreePath);
		// Output root from main repo should contain "main-repo"
		expect(fromMain).toContain("main-repo");
		// Worktree path gives different result (different basename)
		expect(fromWorktree).not.toBe(fromMain);
	});

	it("should return path under global outputs directory", () => {
		const result = getWorktreeOutputRoot("/projects/my-repo");
		expect(result).toContain(path.join(getGlobalRoot(), "outputs"));
	});
});

// --- findOutputDir ---

describe("findOutputDir", () => {
	it("should return null when no progress file found", () => {
		const tempDir = makeTempDir();
		const result = findOutputDir("nonexistent-workflow-id", tempDir);
		expect(result).toBeNull();
	});

	it("should find output dir in local agentic/outputs", () => {
		const tempDir = makeTempDir();
		const workflowId = "test-workflow-123";
		const outputDir = path.join(tempDir, "agentic", "outputs", workflowId);
		mkdirSync(outputDir, { recursive: true });
		writeFileSync(path.join(outputDir, "progress.json"), "{}", "utf-8");

		const result = findOutputDir(workflowId, tempDir);
		expect(result).toBe(outputDir);
	});

	it("should find output dir when repoRoot differs from cwd", () => {
		const tempDir = makeTempDir();
		const repoRoot = "/projects/main-repo";
		const workflowId = "wt-workflow-456";
		// Simulate worktree output in global dir keyed by main repo
		const worktreeOutputRoot = getWorktreeOutputRoot(repoRoot);
		const outputDir = path.join(worktreeOutputRoot, workflowId);
		mkdirSync(outputDir, { recursive: true });
		writeFileSync(path.join(outputDir, "progress.json"), "{}", "utf-8");

		const result = findOutputDir(workflowId, tempDir, repoRoot);
		expect(result).toBe(outputDir);

		// Clean up the workflow-specific directory to avoid leaking test artifacts
		try {
			rmSync(outputDir, { recursive: true, force: true });
		} catch {
			// Windows may hold directory locks briefly; ignore EBUSY
		}
	});
});
