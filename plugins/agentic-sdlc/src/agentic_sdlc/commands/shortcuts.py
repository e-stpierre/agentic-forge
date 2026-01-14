"""Shortcut command handlers (one-shot, analyse, input)."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def get_bundled_workflows_dir() -> Path:
    """Get the directory containing bundled workflow templates."""
    return Path(__file__).parent.parent / "workflows"


def cmd_input(args: Namespace) -> None:
    """Provide human input for a wait-for-human step."""
    from agentic_sdlc.orchestrator import process_human_input

    if process_human_input(args.workflow_id, args.response):
        print(f"Input recorded for workflow: {args.workflow_id}")
    else:
        sys.exit(1)


def cmd_oneshot(args: Namespace) -> None:
    """Execute a single task end-to-end using the one-shot workflow."""
    from agentic_sdlc.executor import WorkflowExecutor
    from agentic_sdlc.parser import WorkflowParseError, WorkflowParser

    # Find the one-shot workflow
    workflow_path = get_bundled_workflows_dir() / "one-shot.yaml"

    if not workflow_path.exists():
        print(f"Error: one-shot workflow not found at {workflow_path}", file=sys.stderr)
        sys.exit(1)

    # Build variables
    variables = {
        "task": args.prompt,
        "create_pr": args.pr,
    }

    try:
        parser = WorkflowParser()
        workflow = parser.parse_file(workflow_path)
    except WorkflowParseError as e:
        print(f"Error parsing workflow: {e}", file=sys.stderr)
        sys.exit(1)

    executor = WorkflowExecutor()
    try:
        progress = executor.run(
            workflow=workflow,
            variables=variables,
            terminal_output=args.terminal_output,
        )
        print(f"\nWorkflow {progress.status}: {progress.workflow_id}")
        if progress.errors:
            print("\nErrors:")
            for error in progress.errors:
                print(f"  - {error['step']}: {error['error']}")
    except Exception as e:
        print(f"Error running workflow: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_analyse(args: Namespace) -> None:
    """Analyze codebase using the analyse-codebase workflow."""
    from agentic_sdlc.executor import WorkflowExecutor
    from agentic_sdlc.parser import WorkflowParseError, WorkflowParser

    bundled_dir = get_bundled_workflows_dir()

    if args.type != "all":
        workflow_path = bundled_dir / "analyse-single.yaml"
        variables = {
            "analysis_type": args.type,
            "autofix": args.autofix,
        }
        print(f"Running {args.type} analysis...")
    else:
        workflow_path = bundled_dir / "analyse-codebase.yaml"
        variables = {
            "autofix": args.autofix,
        }
        print("Running comprehensive analysis (all types)...")

    if not workflow_path.exists():
        print(f"Error: workflow not found at {workflow_path}", file=sys.stderr)
        sys.exit(1)

    try:
        parser = WorkflowParser()
        workflow = parser.parse_file(workflow_path)
    except WorkflowParseError as e:
        print(f"Error parsing workflow: {e}", file=sys.stderr)
        sys.exit(1)

    executor = WorkflowExecutor()
    try:
        progress = executor.run(
            workflow=workflow,
            variables=variables,
            terminal_output=args.terminal_output,
        )
        print(f"\nAnalysis {progress.status}: {progress.workflow_id}")
        if progress.errors:
            print("\nErrors:")
            for error in progress.errors:
                print(f"  - {error['step']}: {error['error']}")
    except Exception as e:
        print(f"Error running analysis: {e}", file=sys.stderr)
        sys.exit(1)
