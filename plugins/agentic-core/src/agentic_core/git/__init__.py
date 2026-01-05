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

__all__ = [
    "GitOperations",
    "get_diff",
    "get_status",
    "get_current_branch",
    "create_branch",
    "commit",
    "push",
    "create_pr",
]
