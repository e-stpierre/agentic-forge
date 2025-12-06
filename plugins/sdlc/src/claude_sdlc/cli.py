#!/usr/bin/env python3
"""
CLI entry points for Claude SDLC.

This module provides command-line entry points that can be invoked
directly after installing the package with pip.

Available commands:
    claude-parallel   - Parallel editing in git worktrees
    claude-plan       - Plan then implement workflow
    claude-sdlc       - Main CLI with subcommands
"""

from __future__ import annotations

import argparse
import sys

# Re-export commands for backwards compatibility with entry points
from claude_sdlc.commands import parallel, plan


def main() -> int:
    """
    Main CLI entry point with subcommands.

    Usage:
        claude-sdlc parallel
        claude-sdlc plan "Feature Name"
    """
    parser = argparse.ArgumentParser(
        prog="claude-sdlc",
        description="Software Development Lifecycle workflows for Claude Code",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
    parallel    Parallel editing in git worktrees
    plan        Plan then implement workflow

Examples:
    claude-sdlc parallel
    claude-sdlc plan "Add authentication"

Or use the direct commands:
    claude-parallel
    claude-plan "Feature Name"
        """,
    )
    parser.add_argument(
        "--version",
        action="version",
        version="claude-plugins-sdlc 2.0.0",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

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

    if args.command == "parallel":
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
