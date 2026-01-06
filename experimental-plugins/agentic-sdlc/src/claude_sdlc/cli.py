#!/usr/bin/env python3
"""
CLI entry points for Claude SDLC.

This module provides command-line entry points that can be invoked
directly after installing the package with pip.

Available commands:
    claude-sdlc       - Main CLI with subcommands (legacy interactive workflows)
    claude-feature    - Full feature workflow (worktree -> plan -> implement -> review -> PR)
    claude-bugfix     - Full bugfix workflow (worktree -> diagnose -> fix -> test -> PR)

    agentic-sdlc      - Autonomous workflow orchestration CLI
    agentic-workflow  - Full end-to-end autonomous workflow
    agentic-plan      - Invoke planning agent with JSON input
    agentic-build     - Invoke build agent with plan JSON
    agentic-validate  - Invoke validation agents (review + test)

All agentic commands use JSON I/O for CI/CD integration.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from claude_sdlc.orchestrator import (
    agentic_build,
    agentic_plan,
    agentic_validate,
    agentic_workflow,
)
from claude_sdlc.workflows.bugfix import main as bugfix_main
from claude_sdlc.workflows.feature import main as feature_main


def main() -> int:
    """
    Main CLI entry point with subcommands.

    Usage:
        claude-sdlc feature "Add user authentication"
        claude-sdlc bugfix "Fix login timeout"
    """
    parser = argparse.ArgumentParser(
        prog="claude-sdlc",
        description="Software Development Lifecycle workflows for Claude Code with parallel development support",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
    feature     Full feature workflow: worktree -> plan -> implement -> review -> PR
    bugfix      Full bugfix workflow: worktree -> diagnose -> fix -> test -> PR

Parallelism:
    By default, workflows run in isolated git worktrees, enabling multiple
    features/fixes to be developed in parallel without conflicts.
    Use --no-worktree to work directly in the main repository.

Examples:
    claude-sdlc feature "Add user authentication"
    claude-sdlc feature --interactive "Add dark mode"
    claude-sdlc feature --no-worktree "Simple change"
    claude-sdlc bugfix "Login timeout on Safari"
    claude-sdlc bugfix --issue 123 "Fix auth error"
    claude-sdlc bugfix --cleanup "Fix with auto-cleanup"

Or use the direct commands:
    claude-feature "Add user authentication"
    claude-bugfix "Fix login timeout"
        """,
    )
    parser.add_argument(
        "--version",
        action="version",
        version="agentic-forge-agentic-sdlc 2.0.0",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Feature subcommand
    feature_parser = subparsers.add_parser(
        "feature",
        help="Full feature workflow with worktree isolation",
    )
    feature_parser.add_argument("feature_description", help="Feature to implement")
    feature_parser.add_argument("--interactive", action="store_true", help="Interactive planning mode")
    feature_parser.add_argument("--skip-review", action="store_true", help="Skip code review step")
    feature_parser.add_argument("--skip-pr", action="store_true", help="Skip PR creation")
    feature_parser.add_argument("--dry-run", action="store_true", help="Show steps without executing")
    feature_parser.add_argument("--log-file", help="JSON log file path")
    feature_parser.add_argument("--timeout", type=int, default=300, help="Timeout per step (seconds)")
    feature_parser.add_argument("--no-worktree", action="store_true", help="Work in main repo (no worktree)")
    feature_parser.add_argument("--cleanup", action="store_true", help="Remove worktree after completion")
    feature_parser.add_argument("--base-branch", help="Base branch for feature (default: main/master)")

    # Bugfix subcommand
    bugfix_parser = subparsers.add_parser(
        "bugfix",
        help="Full bugfix workflow with worktree isolation",
    )
    bugfix_parser.add_argument("bug_description", help="Bug to fix")
    bugfix_parser.add_argument("--issue", type=int, dest="issue_number", help="GitHub issue number")
    bugfix_parser.add_argument("--interactive", action="store_true", help="Interactive planning mode")
    bugfix_parser.add_argument("--skip-test", action="store_true", help="Skip running tests")
    bugfix_parser.add_argument("--skip-pr", action="store_true", help="Skip PR creation")
    bugfix_parser.add_argument("--dry-run", action="store_true", help="Show steps without executing")
    bugfix_parser.add_argument("--log-file", help="JSON log file path")
    bugfix_parser.add_argument("--timeout", type=int, default=300, help="Timeout per step (seconds)")
    bugfix_parser.add_argument("--no-worktree", action="store_true", help="Work in main repo (no worktree)")
    bugfix_parser.add_argument("--cleanup", action="store_true", help="Remove worktree after completion")
    bugfix_parser.add_argument("--base-branch", help="Base branch for fix (default: main/master)")

    args = parser.parse_args()

    if args.command == "feature":
        # Re-parse with feature's parser
        sys.argv = ["claude-feature"] + sys.argv[2:]
        return feature_main()
    elif args.command == "bugfix":
        # Re-parse with bugfix's parser
        sys.argv = ["claude-bugfix"] + sys.argv[2:]
        return bugfix_main()
    else:
        parser.print_help()
        return 0


def _load_json_input(json_file: str | None, json_stdin: bool) -> dict:
    """Load JSON input from file or stdin."""
    if json_stdin:
        return json.load(sys.stdin)
    elif json_file:
        with open(json_file) as f:
            return json.load(f)
    return {}


def agentic_main() -> int:
    """
    Main CLI entry point for agentic workflows.

    Usage:
        agentic-sdlc workflow --type feature --spec spec.json
        agentic-sdlc plan --type feature --spec spec.json
        agentic-sdlc build --plan plan.json
        agentic-sdlc validate --files file1.py file2.py
    """
    parser = argparse.ArgumentParser(
        prog="agentic-sdlc",
        description="Autonomous SDLC workflow orchestration with JSON I/O",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
    workflow    Full end-to-end autonomous workflow (plan -> build -> validate)
    plan        Invoke planning agent with JSON input
    build       Invoke build agent with plan JSON
    validate    Invoke validation agents (review + test)

All commands use JSON for input/output, suitable for CI/CD integration.

Examples:
    agentic-sdlc workflow --type feature --spec spec.json
    agentic-sdlc plan --type feature --json-file spec.json
    agentic-sdlc build --plan-file /specs/feature-auth.md
    agentic-sdlc validate --plan-file /specs/feature-auth.md

Or use direct commands:
    agentic-workflow --type feature --spec spec.json
    agentic-plan --type bug --json-file bug-spec.json
    agentic-build --plan-file plan.md
    agentic-validate --files src/*.py
        """,
    )
    parser.add_argument(
        "--version",
        action="version",
        version="agentic-forge-agentic-sdlc 2.0.0",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Workflow subcommand
    workflow_parser = subparsers.add_parser(
        "workflow",
        help="Full end-to-end autonomous workflow",
    )
    workflow_parser.add_argument(
        "--type",
        "-t",
        choices=["feature", "bug", "chore"],
        required=True,
        help="Task type",
    )
    workflow_parser.add_argument("--spec", help="JSON spec file path")
    workflow_parser.add_argument("--json-stdin", action="store_true", help="Read spec from stdin")
    workflow_parser.add_argument("--auto-pr", action="store_true", help="Create PR on completion")
    workflow_parser.add_argument("--cwd", help="Working directory")
    workflow_parser.add_argument("--output", "-o", help="Output JSON file path")

    # Plan subcommand
    plan_parser = subparsers.add_parser(
        "plan",
        help="Invoke planning agent with JSON input",
    )
    plan_parser.add_argument(
        "--type",
        "-t",
        choices=["feature", "bug", "chore"],
        required=True,
        help="Task type",
    )
    plan_parser.add_argument("--json-file", help="JSON input file path")
    plan_parser.add_argument("--json-stdin", action="store_true", help="Read input from stdin")
    plan_parser.add_argument("--cwd", help="Working directory")
    plan_parser.add_argument("--output", "-o", help="Output JSON file path")

    # Build subcommand
    build_parser = subparsers.add_parser(
        "build",
        help="Invoke build agent with plan JSON",
    )
    build_parser.add_argument("--plan-file", help="Path to plan file")
    build_parser.add_argument("--json-file", help="JSON input file with plan_data")
    build_parser.add_argument("--json-stdin", action="store_true", help="Read plan from stdin")
    build_parser.add_argument("--checkpoint", help="Resume from checkpoint")
    build_parser.add_argument("--no-commit", action="store_true", help="Skip git commits")
    build_parser.add_argument("--cwd", help="Working directory")
    build_parser.add_argument("--output", "-o", help="Output JSON file path")

    # Validate subcommand
    validate_parser = subparsers.add_parser(
        "validate",
        help="Invoke validation agents (review + test)",
    )
    validate_parser.add_argument("--files", nargs="+", help="Files to review")
    validate_parser.add_argument("--plan-file", help="Plan file for compliance checking")
    validate_parser.add_argument("--cwd", help="Working directory")
    validate_parser.add_argument("--output", "-o", help="Output JSON file path")

    args = parser.parse_args()

    result = {}

    if args.command == "workflow":
        spec = _load_json_input(args.spec, args.json_stdin)
        state = agentic_workflow(
            task_type=args.type,
            spec=spec,
            auto_pr=args.auto_pr,
            cwd=args.cwd,
        )
        result = state.to_dict()

    elif args.command == "plan":
        spec = _load_json_input(args.json_file, args.json_stdin)
        result = agentic_plan(
            task_type=args.type,
            spec=spec,
            cwd=args.cwd,
        )

    elif args.command == "build":
        input_data = _load_json_input(args.json_file, args.json_stdin)
        result = agentic_build(
            plan_file=args.plan_file or input_data.get("plan_file"),
            plan_data=input_data.get("plan_data"),
            checkpoint=args.checkpoint,
            git_commit=not args.no_commit,
            cwd=args.cwd,
        )

    elif args.command == "validate":
        result = agentic_validate(
            files=args.files,
            plan_file=args.plan_file,
            cwd=args.cwd,
        )

    else:
        parser.print_help()
        return 0

    # Output result
    output_json = json.dumps(result, indent=2)
    if hasattr(args, "output") and args.output:
        Path(args.output).write_text(output_json)
    else:
        print(output_json)

    return 0 if result.get("success", result.get("status") == "completed") else 1


def agentic_workflow_main() -> int:
    """Direct entry point for agentic-workflow command."""
    sys.argv = ["agentic-sdlc", "workflow"] + sys.argv[1:]
    return agentic_main()


def agentic_plan_main() -> int:
    """Direct entry point for agentic-plan command."""
    sys.argv = ["agentic-sdlc", "plan"] + sys.argv[1:]
    return agentic_main()


def agentic_build_main() -> int:
    """Direct entry point for agentic-build command."""
    sys.argv = ["agentic-sdlc", "build"] + sys.argv[1:]
    return agentic_main()


def agentic_validate_main() -> int:
    """Direct entry point for agentic-validate command."""
    sys.argv = ["agentic-sdlc", "validate"] + sys.argv[1:]
    return agentic_main()


if __name__ == "__main__":
    sys.exit(main())
