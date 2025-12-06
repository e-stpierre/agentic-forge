#!/usr/bin/env python3
"""
CLI entry points for Claude SDLC.

This module provides command-line entry points that can be invoked
directly after installing the package with pip.

Available commands:
    claude-sdlc       - Main CLI with subcommands
    claude-feature    - Full feature workflow (plan -> implement -> review -> PR)
    claude-bugfix     - Full bugfix workflow (diagnose -> fix -> test -> PR)
    claude-parallel   - Parallel editing in git worktrees (demo)
    claude-plan       - Plan then implement workflow (legacy demo)
"""

from __future__ import annotations

import argparse
import sys

# Re-export commands for backwards compatibility with entry points
from claude_sdlc.commands import parallel, plan
from claude_sdlc.workflows.feature import main as feature_main
from claude_sdlc.workflows.bugfix import main as bugfix_main


def main() -> int:
    """
    Main CLI entry point with subcommands.

    Usage:
        claude-sdlc feature "Add user authentication"
        claude-sdlc bugfix "Fix login timeout"
        claude-sdlc parallel
    """
    parser = argparse.ArgumentParser(
        prog="claude-sdlc",
        description="Software Development Lifecycle workflows for Claude Code",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
    feature     Full feature workflow: plan -> implement -> review -> PR
    bugfix      Full bugfix workflow: diagnose -> fix -> test -> PR
    parallel    Parallel editing in git worktrees (demo)
    plan        Plan then implement workflow (legacy demo)

Examples:
    claude-sdlc feature "Add user authentication"
    claude-sdlc feature --interactive "Add dark mode"
    claude-sdlc bugfix "Login timeout on Safari"
    claude-sdlc bugfix --issue 123 "Fix auth error"

Or use the direct commands:
    claude-feature "Add user authentication"
    claude-bugfix "Fix login timeout"
        """,
    )
    parser.add_argument(
        "--version",
        action="version",
        version="claude-plugins-sdlc 1.0.0",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Feature subcommand
    feature_parser = subparsers.add_parser("feature", help="Full feature workflow")
    feature_parser.add_argument("feature_description", help="Feature to implement")
    feature_parser.add_argument("--interactive", action="store_true")
    feature_parser.add_argument("--skip-review", action="store_true")
    feature_parser.add_argument("--skip-pr", action="store_true")
    feature_parser.add_argument("--dry-run", action="store_true")
    feature_parser.add_argument("--log-file", help="JSON log file path")
    feature_parser.add_argument("--timeout", type=int, default=300)

    # Bugfix subcommand
    bugfix_parser = subparsers.add_parser("bugfix", help="Full bugfix workflow")
    bugfix_parser.add_argument("bug_description", help="Bug to fix")
    bugfix_parser.add_argument("--issue", type=int, dest="issue_number")
    bugfix_parser.add_argument("--interactive", action="store_true")
    bugfix_parser.add_argument("--skip-test", action="store_true")
    bugfix_parser.add_argument("--skip-pr", action="store_true")
    bugfix_parser.add_argument("--dry-run", action="store_true")
    bugfix_parser.add_argument("--log-file", help="JSON log file path")
    bugfix_parser.add_argument("--timeout", type=int, default=300)

    # Parallel subcommand (demo)
    subparsers.add_parser("parallel", help="Parallel editing in git worktrees (demo)")

    # Plan subcommand (legacy demo)
    plan_parser = subparsers.add_parser("plan", help="Plan then implement workflow (legacy demo)")
    plan_parser.add_argument(
        "feature_name",
        nargs="?",
        default="Demo Feature",
        help="Name of the feature",
    )
    plan_parser.add_argument("--no-commit", action="store_true")
    plan_parser.add_argument("--skip-implement", action="store_true")

    args = parser.parse_args()

    if args.command == "feature":
        # Re-parse with feature's parser
        sys.argv = ["claude-feature"] + sys.argv[2:]
        return feature_main()
    elif args.command == "bugfix":
        # Re-parse with bugfix's parser
        sys.argv = ["claude-bugfix"] + sys.argv[2:]
        return bugfix_main()
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
