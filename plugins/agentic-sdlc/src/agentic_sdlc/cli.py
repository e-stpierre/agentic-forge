"""CLI entry point for agentic-sdlc command."""

from __future__ import annotations

import argparse
import sys
from typing import TYPE_CHECKING

# Import command handlers from extracted modules
from agentic_sdlc.commands import (
    cmd_cancel,
    cmd_config,
    cmd_configure,
    cmd_init,
    cmd_input,
    cmd_list,
    cmd_release_notes,
    cmd_resume,
    cmd_run,
    cmd_status,
    cmd_update,
    cmd_version,
    cmd_workflows,
)

if TYPE_CHECKING:
    pass


def main() -> None:
    """Main entry point for the CLI."""
    parser = argparse.ArgumentParser(
        prog="agentic-sdlc",
        description="Agentic workflow orchestration for Claude Code",
    )
    parser.add_argument(
        "--version",
        action="store_true",
        help="Show version and exit",
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # run command
    run_parser = subparsers.add_parser("run", help="Run a workflow")
    run_parser.add_argument(
        "workflow",
        type=str,
        nargs="?",
        help="Workflow name or path to YAML file",
    )
    run_parser.add_argument(
        "--list",
        action="store_true",
        dest="list_workflows",
        help="List all available workflows",
    )
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

    # config get/set commands
    config_parser = subparsers.add_parser("config", help="Get or set configuration")
    config_subparsers = config_parser.add_subparsers(dest="config_command")
    config_get = config_subparsers.add_parser("get", help="Get config value")
    config_get.add_argument("key", help="Configuration key (dot notation)")
    config_set = config_subparsers.add_parser("set", help="Set config value")
    config_set.add_argument("key", help="Configuration key (dot notation)")
    config_set.add_argument("value", help="Value to set")

    # version command
    subparsers.add_parser("version", help="Show version information")

    # release-notes command
    release_notes_parser = subparsers.add_parser("release-notes", help="Show release notes from CHANGELOG")
    release_notes_parser.add_argument(
        "specific_version",
        nargs="?",
        help="Show release notes for a specific version (e.g., 0.1.0)",
    )
    release_notes_parser.add_argument(
        "--latest",
        action="store_true",
        help="Show only the most recent version's release notes",
    )

    # update command
    update_parser = subparsers.add_parser("update", help="Update agentic-sdlc to the latest version")
    update_parser.add_argument(
        "--check",
        action="store_true",
        help="Check for updates without installing",
    )

    # workflows command
    workflows_parser = subparsers.add_parser("workflows", help="List available workflows with descriptions")
    workflows_parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Show workflow variables and full descriptions",
    )

    args = parser.parse_args()

    # Handle --version flag
    if args.version:
        cmd_version()
        return

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
    elif args.command == "version":
        cmd_version(args)
    elif args.command == "release-notes":
        cmd_release_notes(args)
    elif args.command == "update":
        cmd_update(args)
    elif args.command == "workflows":
        cmd_workflows(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
