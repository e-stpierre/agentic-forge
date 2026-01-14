"""Git worktree management for parallel workflow execution."""

from __future__ import annotations

import secrets
import shutil
import subprocess
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
    """Git worktree information."""

    path: Path
    branch: str
    base_branch: str

    def exists(self) -> bool:
        """Check if the worktree directory exists."""
        return self.path.exists()


def _run_git(
    args: list[str],
    cwd: Path | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Run a git command."""
    git_path = get_executable("git")
    cmd = [git_path] + args
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=str(cwd) if cwd else None,
        shell=False,
    )
    if check and result.returncode != 0:
        raise RuntimeError(f"Git command failed: {' '.join(cmd)}\n{result.stderr}")
    return result


def _truncate(name: str, max_len: int = 30) -> str:
    """Truncate name to max length for Windows path safety."""
    return name[:max_len] if len(name) > max_len else name


def _generate_suffix() -> str:
    """Generate 6 character random suffix."""
    return secrets.token_hex(3)


def _sanitize_name(name: str) -> str:
    """Sanitize a name for use in file paths and branch names."""
    return name.replace("/", "-").replace(" ", "-").replace("_", "-").lower()


def get_repo_root(cwd: Path | None = None) -> Path:
    """Get the root directory of the git repository."""
    result = _run_git(["rev-parse", "--show-toplevel"], cwd=cwd)
    return Path(result.stdout.strip())


def get_default_branch(cwd: Path | None = None) -> str:
    """Get the default branch name for the repository."""
    result = _run_git(
        ["symbolic-ref", "refs/remotes/origin/HEAD"],
        cwd=cwd,
        check=False,
    )
    if result.returncode == 0:
        return result.stdout.strip().split("/")[-1]
    for branch in ["main", "master"]:
        result = _run_git(["rev-parse", "--verify", branch], cwd=cwd, check=False)
        if result.returncode == 0:
            return branch
    return "main"


def get_current_branch(cwd: Path | None = None) -> str:
    """Get the current branch name."""
    result = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=cwd)
    return result.stdout.strip()


def create_worktree(
    workflow_name: str,
    step_name: str,
    base_branch: str | None = None,
    repo_root: Path | None = None,
) -> Worktree:
    """Create a new worktree for a workflow step.

    Naming convention:
    - Path: .worktrees/agentic-{workflow}-{step}-{random}
    - Branch: agentic/{workflow}-{step}-{random}
    """
    if repo_root is None:
        repo_root = get_repo_root()

    if base_branch is None:
        base_branch = get_default_branch(repo_root)

    suffix = _generate_suffix()
    wf_name = _truncate(_sanitize_name(workflow_name))
    st_name = _truncate(_sanitize_name(step_name))

    dir_name = f"agentic-{wf_name}-{st_name}-{suffix}"
    branch_name = f"agentic/{wf_name}-{st_name}-{suffix}"

    worktree_path = repo_root / ".worktrees" / dir_name
    worktree_path.parent.mkdir(parents=True, exist_ok=True)

    if worktree_path.exists():
        shutil.rmtree(worktree_path, ignore_errors=True)
        _run_git(["worktree", "prune"], cwd=repo_root, check=False)

    _run_git(
        ["worktree", "add", "-b", branch_name, str(worktree_path), base_branch],
        cwd=repo_root,
    )

    return Worktree(path=worktree_path, branch=branch_name, base_branch=base_branch)


def remove_worktree(
    worktree: Worktree,
    repo_root: Path | None = None,
    delete_branch: bool = True,
) -> None:
    """Remove a worktree and optionally delete the branch."""
    if repo_root is None:
        repo_root = get_repo_root()

    result = _run_git(
        ["worktree", "remove", "--force", str(worktree.path)],
        cwd=repo_root,
        check=False,
    )

    if result.returncode != 0 and worktree.path.exists():
        shutil.rmtree(worktree.path, ignore_errors=True)
        _run_git(["worktree", "prune"], cwd=repo_root, check=False)

    if delete_branch and worktree.branch:
        _run_git(["branch", "-D", worktree.branch], cwd=repo_root, check=False)


def list_worktrees(repo_root: Path | None = None) -> list[Worktree]:
    """List all worktrees in the repository."""
    if repo_root is None:
        repo_root = get_repo_root()

    result = _run_git(["worktree", "list", "--porcelain"], cwd=repo_root)

    worktrees = []
    current_path: Path | None = None
    current_branch = ""

    for line in result.stdout.strip().split("\n"):
        if line.startswith("worktree "):
            current_path = Path(line[9:])
        elif line.startswith("branch "):
            current_branch = line.replace("branch refs/heads/", "")
        elif line == "" and current_path:
            worktrees.append(Worktree(path=current_path, branch=current_branch, base_branch=""))
            current_path = None
            current_branch = ""

    if current_path:
        worktrees.append(Worktree(path=current_path, branch=current_branch, base_branch=""))

    return worktrees


def list_agentic_worktrees(repo_root: Path | None = None) -> list[Worktree]:
    """List only agentic worktrees."""
    worktrees = list_worktrees(repo_root)
    return [wt for wt in worktrees if wt.branch.startswith("agentic/")]


def prune_orphaned(repo_root: Path | None = None) -> int:
    """Prune orphaned worktrees and stale agentic worktrees.

    Returns number of worktrees cleaned up.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    _run_git(["worktree", "prune"], cwd=repo_root, check=False)

    cleaned = 0
    worktrees_dir = repo_root / ".worktrees"
    if worktrees_dir.exists():
        for wt_dir in worktrees_dir.iterdir():
            if wt_dir.is_dir() and wt_dir.name.startswith("agentic-"):
                git_file = wt_dir / ".git"
                if not git_file.exists():
                    shutil.rmtree(wt_dir, ignore_errors=True)
                    cleaned += 1

    return cleaned


def create_branch(
    branch_name: str,
    base_branch: str | None = None,
    cwd: Path | None = None,
) -> str:
    """Create a new branch from the specified base."""
    if base_branch is None:
        base_branch = get_default_branch(cwd)

    _run_git(["checkout", "-b", branch_name, base_branch], cwd=cwd)
    return branch_name


def checkout_branch(branch_name: str, cwd: Path | None = None) -> None:
    """Checkout an existing branch."""
    _run_git(["checkout", branch_name], cwd=cwd)


def commit_changes(
    message: str,
    cwd: Path | None = None,
    add_all: bool = True,
) -> bool:
    """Commit staged changes.

    Returns True if a commit was made, False if nothing to commit.
    """
    if add_all:
        _run_git(["add", "-A"], cwd=cwd)

    result = _run_git(["status", "--porcelain"], cwd=cwd)
    if not result.stdout.strip():
        return False

    _run_git(["commit", "-m", message], cwd=cwd)
    return True


def push_branch(
    branch_name: str,
    remote: str = "origin",
    cwd: Path | None = None,
    set_upstream: bool = True,
) -> None:
    """Push a branch to remote."""
    args = ["push"]
    if set_upstream:
        args.extend(["-u", remote, branch_name])
    else:
        args.extend([remote, branch_name])
    _run_git(args, cwd=cwd)
