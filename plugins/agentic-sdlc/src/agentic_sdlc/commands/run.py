"""Run command handler."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def get_bundled_workflows_dir() -> Path:
    """Get the directory containing bundled workflow templates."""
    return Path(__file__).parent.parent / "workflows"


def resolve_workflow_path(workflow_arg: Path) -> tuple[Path, bool]:
    """Resolve workflow path, checking local then bundled locations.

    Returns:
        Tuple of (resolved_path, is_bundled)
    """
    # First check if it's an absolute path or exists locally
    if workflow_arg.is_absolute():
        return workflow_arg, False

    local_path = Path.cwd() / workflow_arg
    if local_path.exists():
        return local_path.resolve(), False

    # Check in agentic/workflows/ directory
    agentic_path = Path.cwd() / "agentic" / "workflows" / workflow_arg.name
    if agentic_path.exists():
        return agentic_path.resolve(), False

    # Check bundled workflows
    bundled_path = get_bundled_workflows_dir() / workflow_arg.name
    if bundled_path.exists():
        return bundled_path.resolve(), True

    # Return original path (will fail with appropriate error)
    return workflow_arg.resolve(), False


def cmd_run(args: Namespace) -> None:
    """Run a workflow."""
    from agentic_sdlc.executor import WorkflowExecutor
    from agentic_sdlc.parser import WorkflowParseError, WorkflowParser

    workflow_path, is_bundled = resolve_workflow_path(args.workflow)
    if not workflow_path.exists():
        print(f"Error: Workflow file not found: {args.workflow}", file=sys.stderr)
        print("\nAvailable bundled workflows:", file=sys.stderr)
        bundled_dir = get_bundled_workflows_dir()
        if bundled_dir.exists():
            for wf in sorted(bundled_dir.glob("*.yaml")):
                print(f"  - {wf.name}", file=sys.stderr)
        print("\nUse 'agentic-sdlc init' to copy them locally.", file=sys.stderr)
        sys.exit(1)

    if is_bundled:
        print(f"Using bundled workflow: {workflow_path.name}")

    # Parse variables
    variables: dict[str, str] = {}
    if args.vars:
        for var in args.vars:
            if "=" not in var:
                print(f"Error: Invalid variable format: {var}", file=sys.stderr)
                print("Expected format: KEY=VALUE", file=sys.stderr)
                sys.exit(1)
            key, value = var.split("=", 1)
            variables[key] = value

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
            from_step=args.from_step,
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
