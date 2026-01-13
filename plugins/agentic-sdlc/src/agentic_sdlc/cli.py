"""CLI entry point for agentic-sdlc command."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import TYPE_CHECKING

# Import command handlers from extracted modules
from agentic_sdlc.commands import (
    cmd_analyse,
    cmd_cancel,
    cmd_config,
    cmd_configure,
    cmd_init,
    cmd_input,
    cmd_list,
    cmd_memory,
    cmd_oneshot,
    cmd_resume,
    cmd_run,
    cmd_status,
)

if TYPE_CHECKING:
    pass


def main() -> None:
    """Main entry point for the CLI."""
    parser = argparse.ArgumentParser(
        prog="agentic-sdlc",
        description="Agentic workflow orchestration for Claude Code",
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # run command
    run_parser = subparsers.add_parser("run", help="Run a workflow")
    run_parser.add_argument("workflow", type=Path, help="Path to workflow YAML file")
    run_parser.add_argument(
        "--var",
        action="append",
        dest="vars",
        metavar="KEY=VALUE",
        help="Set workflow variable (can be used multiple times)",
    )
    run_parser.add_argument("--from-step", help="Resume from a specific step")
    run_parser.add_argument(
        "--terminal-output",
        choices=["base", "all"],
        default="base",
        help="Terminal output granularity",
    )
    run_parser.add_argument("--dry-run", action="store_true", help="Validate without executing")

    # resume command
    resume_parser = subparsers.add_parser("resume", help="Resume a workflow")
    resume_parser.add_argument("workflow_id", help="Workflow ID to resume")

    # status command
    status_parser = subparsers.add_parser("status", help="Show workflow status")
    status_parser.add_argument("workflow_id", help="Workflow ID")

    # cancel command
    cancel_parser = subparsers.add_parser("cancel", help="Cancel a workflow")
    cancel_parser.add_argument("workflow_id", help="Workflow ID to cancel")

    # list command
    list_parser = subparsers.add_parser("list", help="List workflows")
    list_parser.add_argument(
        "--status",
        choices=["running", "completed", "failed", "paused"],
        help="Filter by status",
    )

    # input command (for wait-for-human steps)
    input_parser = subparsers.add_parser("input", help="Provide human input")
    input_parser.add_argument("workflow_id", help="Workflow ID")
    input_parser.add_argument("response", help="Response to provide")

    # configure command
    subparsers.add_parser("configure", help="Configure plugin settings")

    # init command
    init_parser = subparsers.add_parser("init", help="Copy bundled workflow templates to local project")
    init_parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing workflow files",
    )
    init_parser.add_argument(
        "--list",
        action="store_true",
        dest="list_only",
        help="List available bundled workflows without copying",
    )

    # memory commands
    memory_parser = subparsers.add_parser("memory", help="Memory management")
    memory_subparsers = memory_parser.add_subparsers(dest="memory_command")
    memory_list = memory_subparsers.add_parser("list", help="List memories")
    memory_list.add_argument(
        "--category",
        choices=["pattern", "lesson", "error", "decision", "context"],
        help="Filter by category",
    )
    memory_search = memory_subparsers.add_parser("search", help="Search memories")
    memory_search.add_argument("query", help="Search query")
    memory_prune = memory_subparsers.add_parser("prune", help="Prune old memories")
    memory_prune.add_argument("--older-than", default="30d", help="Age threshold (e.g., 30d)")

    # config get/set commands
    config_parser = subparsers.add_parser("config", help="Get or set configuration")
    config_subparsers = config_parser.add_subparsers(dest="config_command")
    config_get = config_subparsers.add_parser("get", help="Get config value")
    config_get.add_argument("key", help="Configuration key (dot notation)")
    config_set = config_subparsers.add_parser("set", help="Set config value")
    config_set.add_argument("key", help="Configuration key (dot notation)")
    config_set.add_argument("value", help="Value to set")

    # one-shot convenience command
    oneshot_parser = subparsers.add_parser("one-shot", help="Execute a single task end-to-end")
    oneshot_parser.add_argument("prompt", help="Task description")
    oneshot_parser.add_argument("--git", action="store_true", help="Enable git integration")
    oneshot_parser.add_argument("--pr", action="store_true", help="Create PR on completion")
    oneshot_parser.add_argument(
        "--terminal-output",
        choices=["base", "all"],
        default="base",
        help="Terminal output granularity",
    )

    # analyse convenience command
    analyse_parser = subparsers.add_parser("analyse", help="Analyze codebase")
    analyse_parser.add_argument(
        "--type",
        choices=["bug", "debt", "doc", "security", "style", "all"],
        default="all",
        help="Analysis type",
    )
    analyse_parser.add_argument(
        "--autofix",
        choices=["none", "minor", "major", "critical"],
        default="none",
        help="Auto-fix severity level",
    )
    analyse_parser.add_argument(
        "--terminal-output",
        choices=["base", "all"],
        default="base",
        help="Terminal output granularity",
    )

    args = parser.parse_args()

    # Dispatch to appropriate command handler
    if args.command == "run":
        cmd_run(args)
    elif args.command == "resume":
        cmd_resume(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "cancel":
        cmd_cancel(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "input":
        cmd_input(args)
    elif args.command == "configure":
        cmd_configure(args)
    elif args.command == "init":
        cmd_init(args)
    elif args.command == "config":
        cmd_config(args)
    elif args.command == "memory":
        cmd_memory(args)
    elif args.command == "one-shot":
        cmd_oneshot(args)
    elif args.command == "analyse":
        cmd_analyse(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
