/** Git worktree management for parallel workflow execution. */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { getExecutable } from "../runtimes/utils.js";
import type { WorktreeCleanup, WorktreeLocation } from "../types.js";

// --- Worktree data ---

export interface Worktree {
	path: string;
	branch: string;
	baseBranch: string;
}

// --- Git command helper ---

export function runGit(
	args: string[],
	cwd?: string | null,
	check = true,
): { stdout: string; stderr: string; returncode: number } {
	const gitPath = getExecutable("git");
	const cmd = [gitPath, ...args];
	try {
		const stdout = execFileSync(gitPath, args, {
			encoding: "utf-8",
			cwd: cwd ?? undefined,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { stdout, stderr: "", returncode: 0 };
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; status?: number };
		if (check) {
			throw new Error(`Git command failed: ${cmd.join(" ")}\n${err.stderr ?? ""}`);
		}
		return {
			stdout: (err.stdout as string) ?? "",
			stderr: (err.stderr as string) ?? "",
			returncode: (err.status as number) ?? 1,
		};
	}
}

// --- Name helpers ---

function truncate(name: string, maxLen = 30): string {
	return name.length > maxLen ? name.slice(0, maxLen) : name;
}

function generateSuffix(): string {
	return randomBytes(3).toString("hex");
}

function sanitizeName(name: string): string {
	return name.replace(/\//g, "-").replace(/ /g, "-").replace(/_/g, "-").toLowerCase();
}

// --- Repository helpers ---

export function getRepoRoot(cwd?: string | null): string {
	const result = runGit(["rev-parse", "--show-toplevel"], cwd);
	return result.stdout.trim();
}

export function getDefaultBranch(cwd?: string | null): string {
	const result = runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd, false);
	if (result.returncode === 0) {
		const parts = result.stdout.trim().split("/");
		return parts[parts.length - 1] ?? "main";
	}
	for (const branch of ["main", "master"]) {
		const check = runGit(["rev-parse", "--verify", branch], cwd, false);
		if (check.returncode === 0) {
			return branch;
		}
	}
	return "main";
}

export function getCurrentBranch(cwd?: string | null): string {
	const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
	return result.stdout.trim();
}

// --- Worktree path resolution ---

function resolveWorktreePath(
	repoRoot: string,
	dirName: string,
	location: WorktreeLocation,
	directory: string | null,
): string {
	switch (location) {
		case "sibling":
			return path.join(path.dirname(repoRoot), ".worktrees", dirName);
		case "nested":
			return path.join(repoRoot, ".worktrees", dirName);
		case "absolute": {
			if (!directory) {
				throw new Error("Worktree location 'absolute' requires a 'directory' to be specified");
			}
			return path.join(directory, dirName);
		}
	}
}

function buildDirName(
	repoRoot: string,
	wfName: string,
	stName: string,
	suffix: string,
	location: WorktreeLocation,
): string {
	if (location === "nested") {
		return `agentic-${wfName}-${stName}-${suffix}`;
	}
	const repoName = sanitizeName(path.basename(repoRoot));
	return `${repoName}-${wfName}-${stName}-${suffix}`;
}

// --- .gitignore helper ---

function ensureGitignoreEntry(repoRoot: string, entry: string): void {
	const gitignorePath = path.join(repoRoot, ".gitignore");
	let content = "";
	if (existsSync(gitignorePath)) {
		content = readFileSync(gitignorePath, "utf-8");
	}
	const lines = content.split("\n");
	if (!lines.some((line) => line.trim() === entry)) {
		const updated = content.endsWith("\n") ? `${content}${entry}\n` : `${content}\n${entry}\n`;
		writeFileSync(gitignorePath, updated, "utf-8");
	}
}

// --- Worktree operations ---

export interface CreateWorktreeOptions {
	workflowName: string;
	stepName: string;
	/** When provided, used as the worktree directory and branch name instead of
	 *  generating from workflowName + stepName + random suffix. */
	workflowId?: string | null;
	baseBranch?: string | null;
	repoRoot?: string | null;
	location: WorktreeLocation;
	directory?: string | null;
}

/** Resolve worktree path with incremental suffix when the path already exists. */
function resolveWorktreePath_incremental(
	repoRoot: string,
	baseDirName: string,
	location: WorktreeLocation,
	directory: string | null,
): string {
	let worktreePath = resolveWorktreePath(repoRoot, baseDirName, location, directory);
	if (!existsSync(worktreePath)) {
		return worktreePath;
	}
	let counter = 2;
	while (existsSync(resolveWorktreePath(repoRoot, `${baseDirName}-${counter}`, location, directory))) {
		counter++;
	}
	return resolveWorktreePath(repoRoot, `${baseDirName}-${counter}`, location, directory);
}

export function createWorktree(options: CreateWorktreeOptions): Worktree {
	const {
		workflowName,
		stepName,
		workflowId,
		baseBranch,
		repoRoot: repoRootOpt,
		location,
		directory = null,
	} = options;

	const root = repoRootOpt || getRepoRoot();
	const base = baseBranch || getDefaultBranch(root);

	let dirName: string;
	let branchName: string;

	if (workflowId) {
		// Workflow-level worktree: use workflowId for consistent naming with output dir
		const safeId = sanitizeName(workflowId);
		if (location === "nested") {
			dirName = safeId;
		} else {
			const repoName = sanitizeName(path.basename(root));
			dirName = `${repoName}-${safeId}`;
		}
		branchName = `agentic/${safeId}`;
	} else {
		// Step-level worktree: use workflowName + stepName + random suffix
		const suffix = generateSuffix();
		const wfName = truncate(sanitizeName(workflowName));
		const stName = truncate(sanitizeName(stepName));
		dirName = buildDirName(root, wfName, stName, suffix, location);
		branchName = `agentic/${wfName}-${stName}-${suffix}`;
	}

	const worktreePath = resolveWorktreePath_incremental(root, dirName, location, directory);
	const parentDir = path.dirname(worktreePath);
	mkdirSync(parentDir, { recursive: true });

	// Derive the actual dirName for branch naming if incremented
	const actualDirName = path.basename(worktreePath);
	if (actualDirName !== dirName) {
		branchName = `agentic/${sanitizeName(actualDirName)}`;
	}

	// Add .worktrees/ to .gitignore for nested mode only
	if (location === "nested") {
		ensureGitignoreEntry(root, ".worktrees/");
	}

	runGit(["worktree", "add", "-b", branchName, worktreePath, base], root);

	return { path: worktreePath, branch: branchName, baseBranch: base };
}

export function removeWorktree(
	worktree: Worktree,
	repoRoot?: string | null,
	deleteBranch = true,
): void {
	const root = repoRoot || getRepoRoot();

	const result = runGit(["worktree", "remove", "--force", worktree.path], root, false);

	if (result.returncode !== 0 && existsSync(worktree.path)) {
		rmSync(worktree.path, { recursive: true, force: true });
		runGit(["worktree", "prune"], root, false);
	}

	if (deleteBranch && worktree.branch) {
		runGit(["branch", "-D", worktree.branch], root, false);
	}
}

// --- Safety commit ---

export interface SafetyCommitResult {
	committed: boolean;
	failed: boolean;
	error?: string;
}

/**
 * Commits uncommitted changes in a worktree before cleanup to prevent data loss.
 * Returns whether a commit was made, and whether the commit failed.
 * If the commit fails, callers should preserve the worktree rather than deleting it.
 */
export function safetyCommit(
	worktreePath: string,
	logger?: {
		info: (step: string, message: string) => void;
		warning: (step: string, message: string) => void;
	},
): SafetyCommitResult {
	const status = runGit(["status", "--porcelain"], worktreePath, false);
	if (!status.stdout.trim()) {
		return { committed: false, failed: false };
	}

	try {
		runGit(["add", "-A"], worktreePath);
		runGit(
			["commit", "-m", "chore: auto-save uncommitted changes before worktree cleanup"],
			worktreePath,
		);
		logger?.info("worktree", `Safety commit created in worktree: ${worktreePath}`);
		return { committed: true, failed: false };
	} catch (e: unknown) {
		const error = e instanceof Error ? e.message : String(e);
		logger?.warning(
			"worktree",
			`Safety commit failed in worktree ${worktreePath}: ${error}. Preserving worktree to prevent data loss.`,
		);
		return { committed: false, failed: true, error };
	}
}

// --- Pruning ---

export interface PruneLocation {
	location: WorktreeLocation;
	repoRoot: string;
	directory?: string | null;
}

export function listWorktrees(repoRoot?: string | null): Worktree[] {
	const root = repoRoot || getRepoRoot();

	const result = runGit(["worktree", "list", "--porcelain"], root);

	const worktrees: Worktree[] = [];
	let currentPath: string | null = null;
	let currentBranch = "";

	for (const line of result.stdout.trim().split("\n")) {
		if (line.startsWith("worktree ")) {
			currentPath = line.slice(9);
		} else if (line.startsWith("branch ")) {
			currentBranch = line.replace("branch refs/heads/", "");
		} else if (line === "" && currentPath) {
			worktrees.push({ path: currentPath, branch: currentBranch, baseBranch: "" });
			currentPath = null;
			currentBranch = "";
		}
	}

	if (currentPath) {
		worktrees.push({ path: currentPath, branch: currentBranch, baseBranch: "" });
	}

	return worktrees;
}

export function listAgenticWorktrees(repoRoot?: string | null): Worktree[] {
	return listWorktrees(repoRoot).filter((wt) => wt.branch.startsWith("agentic/"));
}

function pruneWorktreesDir(worktreesDir: string, prefix: string): number {
	let cleaned = 0;
	if (existsSync(worktreesDir)) {
		for (const entry of readdirSync(worktreesDir)) {
			if (!entry.startsWith(prefix)) continue;
			const wtDir = path.join(worktreesDir, entry);
			if (!statSync(wtDir).isDirectory()) continue;
			const gitFile = path.join(wtDir, ".git");
			if (!existsSync(gitFile)) {
				rmSync(wtDir, { recursive: true, force: true });
				cleaned++;
			}
		}
	}
	return cleaned;
}

export function pruneOrphaned(repoRoot?: string | null, prune?: PruneLocation): number {
	const root = repoRoot || getRepoRoot();

	runGit(["worktree", "prune"], root, false);

	if (prune) {
		const { location, directory } = prune;
		const pRoot = prune.repoRoot;
		let worktreesDir: string;
		let prefix: string;

		if (location === "nested") {
			worktreesDir = path.join(pRoot, ".worktrees");
			prefix = "agentic-";
		} else if (location === "sibling") {
			worktreesDir = path.join(path.dirname(pRoot), ".worktrees");
			const repoName = sanitizeName(path.basename(pRoot));
			prefix = `${repoName}-`;
		} else if (location === "absolute" && directory) {
			worktreesDir = directory;
			const repoName = sanitizeName(path.basename(pRoot));
			prefix = `${repoName}-`;
		} else {
			// Fallback to nested scan
			worktreesDir = path.join(pRoot, ".worktrees");
			prefix = "agentic-";
		}

		return pruneWorktreesDir(worktreesDir, prefix);
	}

	// Default: scan both nested (backward compat) and sibling (new default) locations
	let cleaned = 0;
	cleaned += pruneWorktreesDir(path.join(root, ".worktrees"), "agentic-");
	const siblingWorktreesDir = path.join(path.dirname(root), ".worktrees");
	const repoName = sanitizeName(path.basename(root));
	cleaned += pruneWorktreesDir(siblingWorktreesDir, `${repoName}-`);

	return cleaned;
}

// --- Branch operations ---

export function createBranch(
	branchName: string,
	baseBranch?: string | null,
	cwd?: string | null,
): string {
	const base = baseBranch || getDefaultBranch(cwd);
	runGit(["checkout", "-b", branchName, base], cwd);
	return branchName;
}

export function checkoutBranch(branchName: string, cwd?: string | null): void {
	runGit(["checkout", branchName], cwd);
}

export function commitChanges(message: string, cwd?: string | null, addAll = true): boolean {
	if (addAll) {
		runGit(["add", "-A"], cwd);
	}

	const result = runGit(["status", "--porcelain"], cwd);
	if (!result.stdout.trim()) {
		return false;
	}

	runGit(["commit", "-m", message], cwd);
	return true;
}

export function pushBranch(
	branchName: string,
	remote = "origin",
	cwd?: string | null,
	setUpstream = true,
): void {
	const args = ["push"];
	if (setUpstream) {
		args.push("-u", remote, branchName);
	} else {
		args.push(remote, branchName);
	}
	runGit(args, cwd);
}
