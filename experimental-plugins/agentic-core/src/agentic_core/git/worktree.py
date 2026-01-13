"""
Git worktree management for isolated workflow execution.

This module provides utilities for creating and managing git worktrees,
enabling parallel work on different branches with separate agent instances.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path


def get_executable(name: str) -> str:
    """Resolve executable path for cross-platform subprocess calls.

    Uses shutil.which() to find the full path, allowing shell=False
    in subprocess calls while maintaining Windows compatibility.

    Args:
        name: Executable name (e.g., "claude", "git")

    Returns:
        Full path to the executable

    Raises:
        FileNotFoundError: If executable not found in PATH
    """
    path = shutil.which(name)
    if not path:
        raise FileNotFoundError(f"Executable not found in PATH: {name}")
    return path


@dataclass
class Worktree:
    """Represents a git worktree."""

    path: Path
    branch: str
    base_branch: str

    def exists(self) -> bool:
        """Check if the worktree directory exists."""
        return self.path.exists()

    def __str__(self) -> str:
        return f"Worktree({self.branch} at {self.path})"


def _run_git(
    args: list[str],
    cwd: Path | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    """
    Run a git command.

    Args:
        args: Git command arguments (without 'git')
        cwd: Working directory
        check: Whether to raise on non-zero return

    Returns:
        CompletedProcess result
    """
    git_path = get_executable("git")
    cmd = [git_path] + args
    cwd_str = str(cwd) if cwd else None

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=cwd_str,
        shell=False,
    )

    if check and result.returncode != 0:
        raise RuntimeError(f"Git command failed: {' '.join(cmd)}\n{result.stderr}")

    return result


def get_repo_root(cwd: Path | None = None) -> Path:
    """
    Get the root of the current git repository.

    Args:
        cwd: Directory to start from (defaults to current directory)

    Returns:
        Path to repository root

    Raises:
        RuntimeError: If not in a git repository
    """
    result = _run_git(["rev-parse", "--show-toplevel"], cwd=cwd)
    return Path(result.stdout.strip())


def get_current_branch(cwd: Path | None = None) -> str:
    """
    Get the current branch name.

    Args:
        cwd: Working directory

    Returns:
        Current branch name
    """
    result = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=cwd)
    return result.stdout.strip()


def get_default_branch(cwd: Path | None = None) -> str:
    """
    Get the default branch (main or master).

    Args:
        cwd: Working directory

    Returns:
        Default branch name
    """
    # Try to get from remote
    result = _run_git(
        ["symbolic-ref", "refs/remotes/origin/HEAD"],
        cwd=cwd,
        check=False,
    )

    if result.returncode == 0:
        # Format: refs/remotes/origin/main
        return result.stdout.strip().split("/")[-1]

    # Fallback: check if main or master exists
    for branch in ["main", "master"]:
        result = _run_git(
            ["rev-parse", "--verify", branch],
            cwd=cwd,
            check=False,
        )
        if result.returncode == 0:
            return branch

    return "main"  # Default assumption


def branch_exists(branch_name: str, cwd: Path | None = None) -> bool:
    """
    Check if a branch exists.

    Args:
        branch_name: Name of the branch
        cwd: Working directory

    Returns:
        True if branch exists
    """
    result = _run_git(
        ["rev-parse", "--verify", branch_name],
        cwd=cwd,
        check=False,
    )
    return result.returncode == 0


def list_worktrees(cwd: Path | None = None) -> list[Worktree]:
    """
    List all worktrees in the repository.

    Args:
        cwd: Working directory

    Returns:
        List of Worktree objects
    """
    result = _run_git(["worktree", "list", "--porcelain"], cwd=cwd)

    worktrees: list[Worktree] = []
    current_path: Path | None = None
    current_branch: str = ""

    for line in result.stdout.strip().split("\n"):
        if line.startswith("worktree "):
            current_path = Path(line[9:])
        elif line.startswith("branch "):
            # Format: branch refs/heads/branch-name
            current_branch = line.replace("branch refs/heads/", "")
        elif line == "" and current_path:
            worktrees.append(
                Worktree(
                    path=current_path,
                    branch=current_branch,
                    base_branch="",  # Not tracked in list
                )
            )
            current_path = None
            current_branch = ""

    # Don't forget the last one
    if current_path:
        worktrees.append(
            Worktree(
                path=current_path,
                branch=current_branch,
                base_branch="",
            )
        )

    return worktrees


def create_worktree(
    branch_name: str,
    worktree_path: Path,
    base_branch: str | None = None,
    cwd: Path | None = None,
) -> Worktree:
    """
    Create a new git worktree with a new branch.

    Args:
        branch_name: Name for the new branch
        worktree_path: Path where the worktree will be created
        base_branch: Branch to base the new branch on (defaults to default branch)
        cwd: Working directory (repository root)

    Returns:
        Worktree object

    Raises:
        RuntimeError: If worktree creation fails
    """
    # Resolve base branch
    if base_branch is None:
        base_branch = get_default_branch(cwd)

    # Ensure worktree path doesn't exist
    if worktree_path.exists():
        raise RuntimeError(f"Worktree path already exists: {worktree_path}")

    # Ensure parent directory exists
    worktree_path.parent.mkdir(parents=True, exist_ok=True)

    # Check if branch already exists
    if branch_exists(branch_name, cwd):
        # Use existing branch
        _run_git(
            ["worktree", "add", str(worktree_path), branch_name],
            cwd=cwd,
        )
    else:
        # Create worktree with new branch
        _run_git(
            ["worktree", "add", "-b", branch_name, str(worktree_path), base_branch],
            cwd=cwd,
        )

    return Worktree(
        path=worktree_path,
        branch=branch_name,
        base_branch=base_branch,
    )


def remove_worktree(
    worktree: Worktree,
    cwd: Path | None = None,
    force: bool = False,
    delete_branch: bool = False,
) -> None:
    """
    Remove a git worktree and optionally delete the branch.

    Args:
        worktree: Worktree to remove
        cwd: Working directory (main repository)
        force: Force removal even with uncommitted changes
        delete_branch: Also delete the branch after removing worktree
    """
    # Remove the worktree
    cmd = ["worktree", "remove"]
    if force:
        cmd.append("--force")
    cmd.append(str(worktree.path))

    result = _run_git(cmd, cwd=cwd, check=False)

    if result.returncode != 0:
        # Fallback: manually remove directory and prune
        if worktree.path.exists():
            shutil.rmtree(worktree.path, ignore_errors=True)
        _run_git(["worktree", "prune"], cwd=cwd, check=False)

    # Optionally delete the branch
    if delete_branch and worktree.branch:
        _run_git(
            ["branch", "-D" if force else "-d", worktree.branch],
            cwd=cwd,
            check=False,
        )


def get_worktree_base_path(cwd: Path | None = None) -> Path:
    """
    Get the default base path for worktrees.

    Creates a .worktrees directory next to the repository root.

    Args:
        cwd: Working directory

    Returns:
        Path to worktrees base directory
    """
    repo_root = get_repo_root(cwd)
    worktree_base = repo_root.parent / ".worktrees"
    worktree_base.mkdir(exist_ok=True)
    return worktree_base


@contextmanager
def temporary_worktree(
    branch_name: str,
    base_branch: str | None = None,
    cwd: Path | None = None,
    cleanup: bool = True,
    delete_branch: bool = True,
) -> Generator[Worktree, None, None]:
    """
    Context manager for temporary worktrees.

    Creates a worktree on entry, removes it on exit.

    Args:
        branch_name: Name for the new branch
        base_branch: Branch to base on (defaults to default branch)
        cwd: Working directory
        cleanup: Whether to remove worktree on exit (default True)
        delete_branch: Whether to delete branch on cleanup (default True)

    Yields:
        Worktree object

    Usage:
        with temporary_worktree("feature/my-branch") as wt:
            # Work in wt.path
            pass
        # Worktree is automatically cleaned up
    """
    repo_root = get_repo_root(cwd)
    worktree_base = get_worktree_base_path(cwd)

    # Create safe path from branch name
    safe_name = branch_name.replace("/", "-").replace("\\", "-")
    worktree_path = worktree_base / safe_name

    # Clean up if exists from previous run
    if worktree_path.exists():
        shutil.rmtree(worktree_path, ignore_errors=True)
        _run_git(["worktree", "prune"], cwd=repo_root, check=False)

    worktree = create_worktree(
        branch_name=branch_name,
        worktree_path=worktree_path,
        base_branch=base_branch,
        cwd=repo_root,
    )

    try:
        yield worktree
    finally:
        if cleanup:
            remove_worktree(
                worktree,
                cwd=repo_root,
                force=True,
                delete_branch=delete_branch,
            )
