#!/usr/bin/env python3
"""
CLI entry points for Claude Workflows.

This module provides command-line entry points that can be invoked
directly after installing the package with pip.

Available commands:
    claude-hello      - Basic hello world demo
    claude-bye        - Basic bye demo
    claude-parallel   - Parallel editing in git worktrees
    claude-plan       - Plan then implement workflow
    claude-workflows  - Main CLI with subcommands
"""

from __future__ import annotations

import argparse
import sys

# Re-export commands for backwards compatibility with entry points
from claude_workflows.commands import hello, bye, parallel, plan


def main() -> int:
    """
    Main CLI entry point with subcommands.

    Usage:
        claude-workflows hello
        claude-workflows bye
        claude-workflows parallel
        claude-workflows plan "Feature Name"
    """
    parser = argparse.ArgumentParser(
        prog="claude-workflows",
        description="Python orchestration toolkit for Claude Code CLI workflows",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
    hello       Basic hello world demo
    bye         Basic bye demo
    parallel    Parallel editing in git worktrees
    plan        Plan then implement workflow

Examples:
    claude-workflows hello
    claude-workflows bye
    claude-workflows parallel
    claude-workflows plan "Add authentication"

Or use the direct commands:
    claude-hello
    claude-bye
    claude-parallel
    claude-plan "Feature Name"
        """,
    )
    parser.add_argument(
        "--version",
        action="version",
        version="claude-workflows 1.0.0",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Hello subcommand
    subparsers.add_parser("hello", help="Basic hello world demo")

    # Bye subcommand
    subparsers.add_parser("bye", help="Basic bye demo")

    # Parallel subcommand
    subparsers.add_parser("parallel", help="Parallel editing in git worktrees")

    # Plan subcommand
    plan_parser = subparsers.add_parser("plan", help="Plan then implement workflow")
    plan_parser.add_argument(
        "feature_name",
        nargs="?",
        default="Demo Feature",
        help="Name of the feature",
    )
    plan_parser.add_argument("--no-commit", action="store_true")
    plan_parser.add_argument("--skip-implement", action="store_true")

    args = parser.parse_args()

    if args.command == "hello":
        return hello()
    elif args.command == "bye":
        return bye()
    elif args.command == "parallel":
        return parallel()
    elif args.command == "plan":
        # Re-parse with plan's parser
        sys.argv = ["claude-plan"] + sys.argv[2:]
        return plan()
    else:
        parser.print_help()
        return 0


if __name__ == "__main__":
    sys.exit(main())
