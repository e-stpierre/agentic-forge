/** Git worktree management for parallel workflow execution. */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { getExecutable } from "../runner.js";

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

// --- Worktree operations ---

export function createWorktree(
	workflowName: string,
	stepName: string,
	baseBranch?: string | null,
	repoRoot?: string | null,
): Worktree {
	const root = repoRoot || getRepoRoot();
	const base = baseBranch || getDefaultBranch(root);

	const suffix = generateSuffix();
	const wfName = truncate(sanitizeName(workflowName));
	const stName = truncate(sanitizeName(stepName));

	const dirName = `agentic-${wfName}-${stName}-${suffix}`;
	const branchName = `agentic/${wfName}-${stName}-${suffix}`;

	const worktreePath = path.join(root, ".worktrees", dirName);
	const parentDir = path.dirname(worktreePath);
	mkdirSync(parentDir, { recursive: true });

	if (existsSync(worktreePath)) {
		rmSync(worktreePath, { recursive: true, force: true });
		runGit(["worktree", "prune"], root, false);
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

export function pruneOrphaned(repoRoot?: string | null): number {
	const root = repoRoot || getRepoRoot();

	runGit(["worktree", "prune"], root, false);

	let cleaned = 0;
	const worktreesDir = path.join(root, ".worktrees");
	if (existsSync(worktreesDir)) {
		for (const entry of readdirSync(worktreesDir)) {
			const wtDir = path.join(worktreesDir, entry);
			if (statSync(wtDir).isDirectory() && entry.startsWith("agentic-")) {
				const gitFile = path.join(wtDir, ".git");
				if (!existsSync(gitFile)) {
					rmSync(wtDir, { recursive: true, force: true });
					cleaned++;
				}
			}
		}
	}

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
