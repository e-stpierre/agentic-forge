"""
Claude Workflows - Python orchestration toolkit for Claude Code CLI.

This package provides utilities for running Claude Code via the CLI
from Python scripts, enabling complex orchestration workflows.

Example usage:
    from claude_workflows import run_claude, check_claude_available

    if check_claude_available():
        result = run_claude("Explain this code", print_output=True)
        print(f"Success: {result.success}")
"""

from claude_workflows.runner import (
    ClaudeResult,
    run_claude,
    run_claude_with_command,
    check_claude_available,
)
from claude_workflows.worktree import (
    Worktree,
    get_repo_root,
    get_current_branch,
    get_default_branch,
    branch_exists,
    list_worktrees,
    create_worktree,
    remove_worktree,
    get_worktree_base_path,
    temporary_worktree,
)

__version__ = "1.0.0"
__author__ = "Étienne St-Pierre"

__all__ = [
    # Version
    "__version__",
    # Runner
    "ClaudeResult",
    "run_claude",
    "run_claude_with_command",
    "check_claude_available",
    # Worktree
    "Worktree",
    "get_repo_root",
    "get_current_branch",
    "get_default_branch",
    "branch_exists",
    "list_worktrees",
    "create_worktree",
    "remove_worktree",
    "get_worktree_base_path",
    "temporary_worktree",
]
