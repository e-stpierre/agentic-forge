"""
Agentic SDLC - Fully autonomous SDLC workflows for Claude Code.

This package provides autonomous SDLC workflow utilities with JSON-based
agent communication for CI/CD integration.

Example usage (agentic workflows):
    from claude_sdlc import agentic_workflow, agentic_plan, agentic_build

    # Full workflow
    state = agentic_workflow(
        task_type="feature",
        spec={"title": "User auth", "description": "Add OAuth"},
        auto_pr=True,
    )

    # Or individual phases:
    plan = agentic_plan("feature", {"title": "Add caching"})
    build = agentic_build(plan_file=plan["plan_file"])

Legacy interactive workflows (for backward compatibility):
    from claude_sdlc import feature_workflow, FeatureWorkflowConfig

    config = FeatureWorkflowConfig(
        feature_description="Add user authentication",
        interactive=True,
    )
    state = feature_workflow(config)

For core functionality (runner, orchestrator, logging), import from claude_core:
    from claude_core import run_claude, Orchestrator, Task
"""

# Re-export core functionality for convenience
from claude_core import (
    # Runner
    ClaudeResult,
    # Logging
    LogEntry,
    # Orchestrator
    Orchestrator,
    StructuredLogger,
    Task,
    TaskResult,
    # Worktree
    Worktree,
    branch_exists,
    check_claude_available,
    configure_logging,
    create_worktree,
    get_current_branch,
    get_default_branch,
    get_logger,
    get_repo_root,
    get_worktree_base_path,
    list_worktrees,
    remove_worktree,
    run_claude,
    run_claude_with_command,
    temporary_worktree,
)

# Agentic Orchestrator (autonomous)
from claude_sdlc.orchestrator import (
    AgentMessage,
    WorkflowState,
    agentic_build,
    agentic_plan,
    agentic_validate,
    agentic_workflow,
    run_agentic_command,
)

# SDLC Workflows (legacy interactive)
from claude_sdlc.workflows import (
    BugfixWorkflowConfig,
    FeatureWorkflowConfig,
    bugfix_workflow,
    feature_workflow,
)

__version__ = "2.0.0"
__author__ = "Etienne St-Pierre"

__all__ = [
    # Version
    "__version__",
    # Agentic Orchestrator
    "agentic_workflow",
    "agentic_plan",
    "agentic_build",
    "agentic_validate",
    "run_agentic_command",
    "AgentMessage",
    "WorkflowState",
    # SDLC Workflows (legacy)
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
