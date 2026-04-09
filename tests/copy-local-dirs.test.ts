/** Tests for copyLocalDirs worktree helper. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyLocalDirs } from "../src/git/worktree.js";

function makeTempDir(): string {
	return mkdtempSync(path.join(os.tmpdir(), "copy-local-dirs-"));
}

describe("copyLocalDirs", () => {
	const dirs: string[] = [];
	afterEach(() => {
		// No cleanup needed — OS tmp is ephemeral
	});

	function setup() {
		const repoRoot = makeTempDir();
		const worktree = makeTempDir();
		dirs.push(repoRoot, worktree);
		return { repoRoot, worktree };
	}

	it("copies .claude and .agents directories into worktree", () => {
		const { repoRoot, worktree } = setup();

		// Create source dirs with files
		mkdirSync(path.join(repoRoot, ".claude"), { recursive: true });
		writeFileSync(path.join(repoRoot, ".claude", "settings.local.json"), '{"key":"val"}');
		mkdirSync(path.join(repoRoot, ".agents"), { recursive: true });
		writeFileSync(path.join(repoRoot, ".agents", "explorer.md"), "# Explorer");

		copyLocalDirs(repoRoot, worktree);

		expect(existsSync(path.join(worktree, ".claude", "settings.local.json"))).toBe(true);
		expect(readFileSync(path.join(worktree, ".claude", "settings.local.json"), "utf-8")).toBe(
			'{"key":"val"}',
		);
		expect(existsSync(path.join(worktree, ".agents", "explorer.md"))).toBe(true);
		expect(readFileSync(path.join(worktree, ".agents", "explorer.md"), "utf-8")).toBe("# Explorer");
	});

	it("skips directories that don't exist in repo root", () => {
		const { repoRoot, worktree } = setup();

		// No .claude or .agents in repoRoot
		copyLocalDirs(repoRoot, worktree);

		expect(existsSync(path.join(worktree, ".claude"))).toBe(false);
		expect(existsSync(path.join(worktree, ".agents"))).toBe(false);
	});

	it("does not overwrite existing directories in worktree", () => {
		const { repoRoot, worktree } = setup();

		// Create source
		mkdirSync(path.join(repoRoot, ".claude"), { recursive: true });
		writeFileSync(path.join(repoRoot, ".claude", "settings.local.json"), "new-content");

		// Pre-existing dir in worktree with different content
		mkdirSync(path.join(worktree, ".claude"), { recursive: true });
		writeFileSync(path.join(worktree, ".claude", "settings.local.json"), "existing-content");

		copyLocalDirs(repoRoot, worktree);

		// Should keep the existing content
		expect(readFileSync(path.join(worktree, ".claude", "settings.local.json"), "utf-8")).toBe(
			"existing-content",
		);
	});

	it("copies nested subdirectories recursively", () => {
		const { repoRoot, worktree } = setup();

		mkdirSync(path.join(repoRoot, ".claude", "skills", "my-skill"), { recursive: true });
		writeFileSync(path.join(repoRoot, ".claude", "skills", "my-skill", "SKILL.md"), "# Skill");

		copyLocalDirs(repoRoot, worktree);

		expect(
			readFileSync(path.join(worktree, ".claude", "skills", "my-skill", "SKILL.md"), "utf-8"),
		).toBe("# Skill");
	});
});
