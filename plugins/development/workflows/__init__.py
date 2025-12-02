"""
Claude Code Workflow Orchestration Library.

This package provides tools for orchestrating Claude Code workflows
using Python, including git worktree management, parallel execution,
and templated planning.
"""

from .runner import run_claude, run_claude_with_command, ClaudeResult
from .worktree import (
    Worktree,
    get_repo_root,
    create_worktree,
    remove_worktree,
    temporary_worktree,
)

__all__ = [
    "run_claude",
    "run_claude_with_command",
    "ClaudeResult",
    "Worktree",
    "get_repo_root",
    "create_worktree",
    "remove_worktree",
    "temporary_worktree",
]

__version__ = "0.1.0"
