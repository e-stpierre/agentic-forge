"""
Claude SDLC - Software Development Lifecycle workflows for Claude Code.

This package provides SDLC workflow utilities that build on claude_core
for planning, implementation, review, and testing workflows.

Example usage:
    from claude_sdlc import feature_workflow, FeatureWorkflowConfig

    config = FeatureWorkflowConfig(
        feature_description="Add user authentication",
        interactive=True,
    )
    state = feature_workflow(config)

    # Or for bugfixes:
    from claude_sdlc import bugfix_workflow, BugfixWorkflowConfig

    config = BugfixWorkflowConfig(
        bug_description="Fix login timeout",
        issue_number=123,
    )
    state = bugfix_workflow(config)

For core functionality (runner, orchestrator, logging), import from claude_core:
    from claude_core import run_claude, Orchestrator, Task
"""

# Re-export core functionality for convenience
from claude_core import (
    # Runner
    ClaudeResult,
    run_claude,
    run_claude_with_command,
    check_claude_available,
    # Orchestrator
    Orchestrator,
    Task,
    TaskResult,
    # Logging
    LogEntry,
    StructuredLogger,
    configure_logging,
    get_logger,
    # Worktree
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

# SDLC Workflows
from claude_sdlc.workflows import (
    feature_workflow,
    FeatureWorkflowConfig,
    bugfix_workflow,
    BugfixWorkflowConfig,
)

__version__ = "1.0.0"
__author__ = "Etienne St-Pierre"

__all__ = [
    # Version
    "__version__",
    # SDLC Workflows
    "feature_workflow",
    "FeatureWorkflowConfig",
    "bugfix_workflow",
    "BugfixWorkflowConfig",
    # Re-exported from claude_core
    "ClaudeResult",
    "run_claude",
    "run_claude_with_command",
    "check_claude_available",
    "Orchestrator",
    "Task",
    "TaskResult",
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
