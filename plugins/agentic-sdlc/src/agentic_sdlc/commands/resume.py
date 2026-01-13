"""Resume command handler."""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def cmd_resume(args: Namespace) -> None:
    """Resume a paused or failed workflow."""
    from agentic_sdlc.progress import WorkflowStatus, load_progress, save_progress

    progress = load_progress(args.workflow_id)
    if progress is None:
        print(f"Error: Workflow not found: {args.workflow_id}", file=sys.stderr)
        sys.exit(1)

    if progress.status not in [
        WorkflowStatus.PAUSED.value,
        WorkflowStatus.FAILED.value,
        WorkflowStatus.CANCELLED.value,
    ]:
        print(
            f"Error: Cannot resume workflow in '{progress.status}' status",
            file=sys.stderr,
        )
        sys.exit(1)

    progress.status = WorkflowStatus.RUNNING.value
    if progress.current_step:
        step_name = progress.current_step.get("name")
        if step_name and step_name not in progress.pending_steps:
            progress.pending_steps.insert(0, step_name)
        progress.current_step = None

    save_progress(progress)
    print(f"Workflow {args.workflow_id} resumed. Run workflow again to continue.")
