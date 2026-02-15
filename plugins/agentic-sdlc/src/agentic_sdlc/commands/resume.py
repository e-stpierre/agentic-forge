"""Resume command handler."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def cmd_resume(args: Namespace) -> None:
    """Resume a paused, failed, or interrupted workflow by re-executing it."""
    from agentic_sdlc.commands.run import discover_workflow
    from agentic_sdlc.executor import WorkflowExecutor
    from agentic_sdlc.parser import WorkflowParseError, WorkflowParser
    from agentic_sdlc.progress import WorkflowStatus, load_progress, prepare_for_resume, save_progress

    progress = load_progress(args.workflow_id)
    if progress is None:
        print(f"Error: Workflow not found: {args.workflow_id}", file=sys.stderr)
        sys.exit(1)

    # Only reject completed workflows
    if progress.status == WorkflowStatus.COMPLETED.value:
        print(
            f"Error: Cannot resume a completed workflow (status: '{progress.status}')",
            file=sys.stderr,
        )
        sys.exit(1)

    # Normalize state for resume
    prepare_for_resume(progress)
    save_progress(progress)

    # Resolve workflow YAML file
    workflow_path: Path | None = None

    # Try stored workflow_file first
    if progress.workflow_file:
        candidate = Path(progress.workflow_file)
        if candidate.exists():
            workflow_path = candidate

    # Fall back to discovery by workflow name
    if workflow_path is None:
        discovered, _location = discover_workflow(progress.workflow_name)
        if discovered is not None:
            workflow_path = discovered

    if workflow_path is None:
        print(
            f"Error: Cannot find workflow file for '{progress.workflow_name}'.\n"
            f"Provide the workflow YAML at one of the standard locations or re-run with 'agentic-sdlc run <path>'.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Parse workflow
    try:
        parser = WorkflowParser()
        workflow = parser.parse_file(workflow_path)
    except WorkflowParseError as e:
        print(f"Error parsing workflow: {e}", file=sys.stderr)
        sys.exit(1)

    # Execute with resume
    executor = WorkflowExecutor()
    try:
        # Resolve terminal_output: CLI override > workflow settings > default "base"
        terminal_output = "base"
        if hasattr(args, "terminal_output") and args.terminal_output is not None:
            terminal_output = args.terminal_output
        elif workflow.settings and workflow.settings.terminal_output:
            terminal_output = workflow.settings.terminal_output

        result = executor.run(
            workflow=workflow,
            terminal_output=terminal_output,
            workflow_file=str(workflow_path.resolve()),
            resume_progress=progress,
        )
        print(f"\nWorkflow {result.status}: {result.workflow_id}")
        if result.errors:
            print("\nErrors:")
            for error in result.errors:
                print(f"  - {error['step']}: {error['error']}")
    except Exception as e:
        print(f"Error running workflow: {e}", file=sys.stderr)
        sys.exit(1)
