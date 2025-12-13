"""
Claude Core - Foundation Python package for Claude Code plugins.

This package provides the core utilities for running Claude Code via the CLI
from Python scripts, enabling complex orchestration workflows.

Example usage:
    from claude_core import run_claude, check_claude_available

    if check_claude_available():
        result = run_claude("Explain this code", print_output=True)
        print(f"Success: {result.success}")

For parallel execution:
    from claude_core import Orchestrator, Task

    orchestrator = Orchestrator()
    orchestrator.add_task(Task(prompt="/plan-feature auth system", cwd=worktree_a))
    orchestrator.add_task(Task(prompt="/plan-feature api docs", cwd=worktree_b))
    results = orchestrator.run_parallel()

For structured logging:
    from claude_core import configure_logging

    logger = configure_logging("workflow.log.json", level="INFO")
"""

from claude_core.logging import (
    LogEntry,
    StructuredLogger,
    configure_logging,
    get_logger,
)
from claude_core.orchestrator import (
    Orchestrator,
    Task,
    TaskResult,
)
from claude_core.runner import (
    ClaudeResult,
    check_claude_available,
    run_claude,
    run_claude_with_command,
)
from claude_core.worktree import (
    Worktree,
    branch_exists,
    create_worktree,
    get_current_branch,
    get_default_branch,
    get_repo_root,
    get_worktree_base_path,
    list_worktrees,
    remove_worktree,
    temporary_worktree,
)

__version__ = "1.0.0"
__author__ = "Etienne St-Pierre"

__all__ = [
    # Version
    "__version__",
    # Runner
    "ClaudeResult",
    "run_claude",
    "run_claude_with_command",
    "check_claude_available",
    # Orchestrator
    "Orchestrator",
    "Task",
    "TaskResult",
    # Logging
    "LogEntry",
    "StructuredLogger",
    "configure_logging",
    "get_logger",
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
