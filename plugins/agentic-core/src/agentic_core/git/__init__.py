"""Git integration module."""

from agentic_core.git.operations import (
    GitOperations,
    commit,
    create_branch,
    create_pr,
    get_current_branch,
    get_diff,
    get_status,
    push,
)
from agentic_core.git.worktree import (
    Worktree,
    branch_exists,
    create_worktree,
    get_current_branch as worktree_get_current_branch,
    get_default_branch,
    get_repo_root,
    get_worktree_base_path,
    list_worktrees,
    remove_worktree,
    temporary_worktree,
)

__all__ = [
    # Operations
    "GitOperations",
    "get_diff",
    "get_status",
    "get_current_branch",
    "create_branch",
    "commit",
    "push",
    "create_pr",
    # Worktree
    "Worktree",
    "branch_exists",
    "create_worktree",
    "get_default_branch",
    "get_repo_root",
    "get_worktree_base_path",
    "list_worktrees",
    "remove_worktree",
    "temporary_worktree",
]
