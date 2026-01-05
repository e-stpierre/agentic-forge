"""Git operations for workflow integration."""

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class GitResult:
    """Result of a git operation."""

    success: bool
    output: str
    error: str = ""


class GitOperations:
    """Git operations wrapper."""

    def __init__(self, working_dir: Path):
        """Initialize with working directory."""
        self.working_dir = working_dir

    def _run(self, args: list[str], timeout: int = 60) -> GitResult:
        """Run a git command."""
        try:
            result = subprocess.run(
                ["git"] + args,
                capture_output=True,
                text=True,
                cwd=str(self.working_dir),
                timeout=timeout,
            )
            return GitResult(
                success=result.returncode == 0,
                output=result.stdout.strip(),
                error=result.stderr.strip(),
            )
        except subprocess.TimeoutExpired:
            return GitResult(
                success=False,
                output="",
                error="Git command timed out",
            )
        except Exception as e:
            return GitResult(
                success=False,
                output="",
                error=str(e),
            )

    def get_diff(self, staged: bool = False) -> GitResult:
        """Get git diff.

        Args:
            staged: If True, show staged changes only

        Returns:
            GitResult with diff content
        """
        args = ["diff"]
        if staged:
            args.append("--staged")
        return self._run(args)

    def get_status(self, short: bool = True) -> GitResult:
        """Get git status.

        Args:
            short: If True, use short format

        Returns:
            GitResult with status
        """
        args = ["status"]
        if short:
            args.append("-s")
        return self._run(args)

    def get_current_branch(self) -> GitResult:
        """Get current branch name."""
        return self._run(["rev-parse", "--abbrev-ref", "HEAD"])

    def create_branch(self, name: str, checkout: bool = True) -> GitResult:
        """Create a new branch.

        Args:
            name: Branch name
            checkout: If True, also checkout the branch

        Returns:
            GitResult
        """
        if checkout:
            return self._run(["checkout", "-b", name])
        return self._run(["branch", name])

    def checkout(self, ref: str) -> GitResult:
        """Checkout a branch or commit.

        Args:
            ref: Branch name or commit hash

        Returns:
            GitResult
        """
        return self._run(["checkout", ref])

    def add(self, paths: list[str] = None) -> GitResult:
        """Stage files.

        Args:
            paths: List of paths to stage, or None for all

        Returns:
            GitResult
        """
        if paths:
            return self._run(["add"] + paths)
        return self._run(["add", "."])

    def commit(self, message: str) -> GitResult:
        """Create a commit.

        Args:
            message: Commit message

        Returns:
            GitResult
        """
        return self._run(["commit", "-m", message])

    def push(self, remote: str = "origin", branch: str = None, set_upstream: bool = True) -> GitResult:
        """Push to remote.

        Args:
            remote: Remote name
            branch: Branch name (uses current if None)
            set_upstream: If True, set upstream tracking

        Returns:
            GitResult
        """
        args = ["push"]
        if set_upstream:
            args.append("-u")
        args.append(remote)
        if branch:
            args.append(branch)
        return self._run(args)

    def create_pr(
        self,
        title: str,
        body: str,
        base: str = "main",
        draft: bool = False,
    ) -> GitResult:
        """Create a pull request using gh CLI.

        Args:
            title: PR title
            body: PR description
            base: Base branch
            draft: If True, create as draft

        Returns:
            GitResult with PR URL
        """
        args = ["pr", "create", "--title", title, "--body", body, "--base", base]
        if draft:
            args.append("--draft")

        try:
            result = subprocess.run(
                ["gh"] + args,
                capture_output=True,
                text=True,
                cwd=str(self.working_dir),
                timeout=60,
            )
            return GitResult(
                success=result.returncode == 0,
                output=result.stdout.strip(),
                error=result.stderr.strip(),
            )
        except Exception as e:
            return GitResult(
                success=False,
                output="",
                error=str(e),
            )

    def get_log(self, count: int = 10, oneline: bool = True) -> GitResult:
        """Get recent commit log.

        Args:
            count: Number of commits
            oneline: Use oneline format

        Returns:
            GitResult with log output
        """
        args = ["log", f"-{count}"]
        if oneline:
            args.append("--oneline")
        return self._run(args)

    def is_repo(self) -> bool:
        """Check if working directory is a git repository."""
        result = self._run(["rev-parse", "--git-dir"])
        return result.success


# Convenience functions


async def get_diff(working_dir: Path, staged: bool = False) -> str:
    """Get git diff."""
    git = GitOperations(working_dir)
    result = git.get_diff(staged)
    return result.output if result.success else ""


async def get_status(working_dir: Path) -> str:
    """Get git status."""
    git = GitOperations(working_dir)
    result = git.get_status()
    return result.output if result.success else ""


async def get_current_branch(working_dir: Path) -> str:
    """Get current branch name."""
    git = GitOperations(working_dir)
    result = git.get_current_branch()
    return result.output if result.success else ""


async def create_branch(name: str, working_dir: Path) -> bool:
    """Create and checkout a new branch."""
    git = GitOperations(working_dir)
    result = git.create_branch(name)
    return result.success


async def commit(message: str, working_dir: Path) -> str:
    """Stage all changes and commit."""
    git = GitOperations(working_dir)
    git.add()
    result = git.commit(message)
    return result.output if result.success else result.error


async def push(working_dir: Path) -> bool:
    """Push to remote."""
    git = GitOperations(working_dir)
    result = git.push()
    return result.success


async def create_pr(
    title: str,
    body: str,
    working_dir: Path,
    draft: bool = False,
) -> str:
    """Create a pull request and return URL."""
    git = GitOperations(working_dir)
    result = git.create_pr(title, body, draft=draft)
    return result.output if result.success else ""
