"""Status, cancel, and list command handlers."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def cmd_status(args: Namespace) -> None:
    """Show workflow status."""
    from agentic_sdlc.progress import load_progress

    progress = load_progress(args.workflow_id)
    if progress is None:
        print(f"Error: Workflow not found: {args.workflow_id}", file=sys.stderr)
        sys.exit(1)

    print(f"Workflow: {progress.workflow_name}")
    print(f"ID: {progress.workflow_id}")
    print(f"Status: {progress.status}")
    print(f"Started: {progress.started_at}")
    if progress.completed_at:
        print(f"Completed: {progress.completed_at}")

    if progress.current_step:
        print(f"\nCurrent Step: {progress.current_step['name']}")
        print(f"  Retry Count: {progress.current_step.get('retry_count', 0)}")

    if progress.completed_steps:
        print("\nCompleted Steps:")
        for step in progress.completed_steps:
            status_icon = "+" if step.status == "completed" else "x"
            print(f"  [{status_icon}] {step.name}")

    if progress.pending_steps:
        print("\nPending Steps:")
        for step_name in progress.pending_steps:
            print(f"  [ ] {step_name}")

    if progress.errors:
        print("\nErrors:")
        for error in progress.errors:
            print(f"  - {error['step']}: {error['error']}")


def cmd_cancel(args: Namespace) -> None:
    """Cancel a running workflow."""
    from datetime import datetime, timezone

    from agentic_sdlc.progress import WorkflowStatus, load_progress, save_progress

    progress = load_progress(args.workflow_id)
    if progress is None:
        print(f"Error: Workflow not found: {args.workflow_id}", file=sys.stderr)
        sys.exit(1)

    if progress.status not in [WorkflowStatus.RUNNING.value, WorkflowStatus.PAUSED.value]:
        print(
            f"Error: Cannot cancel workflow in '{progress.status}' status",
            file=sys.stderr,
        )
        sys.exit(1)

    progress.status = WorkflowStatus.CANCELLED.value
    progress.completed_at = datetime.now(timezone.utc).isoformat()
    save_progress(progress)

    print(f"Workflow cancelled: {args.workflow_id}")


def cmd_list(args: Namespace) -> None:
    """List workflows."""
    workflows_dir = Path.cwd() / "agentic" / "workflows"
    if not workflows_dir.exists():
        print("No workflows found.")
        return

    workflows = []
    for workflow_dir in workflows_dir.iterdir():
        if workflow_dir.is_dir():
            progress_file = workflow_dir / "progress.json"
            if progress_file.exists():
                with open(progress_file) as f:
                    data = json.load(f)
                    if args.status is None or data.get("status") == args.status:
                        workflows.append(data)

    if not workflows:
        print("No workflows found." + (f" (status={args.status})" if args.status else ""))
        return

    print(f"{'ID':<12} {'Name':<25} {'Status':<12} {'Started':<20}")
    print("-" * 70)
    for wf in workflows:
        started = wf.get("started_at", "")[:19] if wf.get("started_at") else ""
        print(f"{wf.get('workflow_id', ''):<12} {wf.get('workflow_name', '')[:25]:<25} {wf.get('status', ''):<12} {started:<20}")
