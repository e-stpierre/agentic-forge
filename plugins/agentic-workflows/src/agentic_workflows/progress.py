"""Workflow progress tracking."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from filelock import FileLock


class WorkflowStatus(Enum):
    """Workflow execution status."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"
    CANCELLED = "cancelled"


class StepStatus(Enum):
    """Step execution status."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class StepProgress:
    """Progress information for a single step."""

    name: str
    status: str
    started_at: str | None = None
    completed_at: str | None = None
    retry_count: int = 0
    output_summary: str = ""
    error: str | None = None
    human_input: str | None = None


@dataclass
class ParallelBranch:
    """Information about a parallel branch execution."""

    branch_id: str
    status: str
    worktree_path: str
    progress_file: str


@dataclass
class WorkflowProgress:
    """Complete workflow progress state."""

    schema_version: str = "1.0"
    workflow_id: str = ""
    workflow_name: str = ""
    status: str = "pending"
    started_at: str | None = None
    completed_at: str | None = None
    current_step: dict[str, Any] | None = None
    completed_steps: list[StepProgress] = field(default_factory=list)
    pending_steps: list[str] = field(default_factory=list)
    running_steps: list[str] = field(default_factory=list)
    parallel_branches: list[ParallelBranch] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)
    variables: dict[str, Any] = field(default_factory=dict)
    step_outputs: dict[str, Any] = field(default_factory=dict)


def get_progress_path(workflow_id: str, repo_root: Path | None = None) -> Path:
    """Get path to progress file for a workflow."""
    if repo_root is None:
        repo_root = Path.cwd()
    return repo_root / "agentic" / "workflows" / workflow_id / "progress.json"


def load_progress(workflow_id: str, repo_root: Path | None = None) -> WorkflowProgress | None:
    """Load workflow progress from file."""
    progress_path = get_progress_path(workflow_id, repo_root)
    if not progress_path.exists():
        return None

    with open(progress_path, encoding="utf-8") as f:
        data = json.load(f)

    return _dict_to_progress(data)


def save_progress(progress: WorkflowProgress, repo_root: Path | None = None) -> None:
    """Save workflow progress to file with file locking."""
    progress_path = get_progress_path(progress.workflow_id, repo_root)
    progress_path.parent.mkdir(parents=True, exist_ok=True)

    lock_path = progress_path.with_suffix(".lock")
    lock = FileLock(str(lock_path))

    with lock, open(progress_path, "w", encoding="utf-8") as f:
        json.dump(_progress_to_dict(progress), f, indent=2)


def create_progress(
    workflow_id: str,
    workflow_name: str,
    step_names: list[str],
    variables: dict[str, Any],
) -> WorkflowProgress:
    """Create initial progress document."""
    return WorkflowProgress(
        workflow_id=workflow_id,
        workflow_name=workflow_name,
        status=WorkflowStatus.RUNNING.value,
        started_at=datetime.now(timezone.utc).isoformat(),
        pending_steps=step_names.copy(),
        variables=variables.copy(),
    )


def update_step_started(progress: WorkflowProgress, step_name: str) -> None:
    """Mark a step as started."""
    if step_name in progress.pending_steps:
        progress.pending_steps.remove(step_name)
    if step_name not in progress.running_steps:
        progress.running_steps.append(step_name)
    progress.current_step = {
        "name": step_name,
        "retry_count": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }


def update_step_completed(
    progress: WorkflowProgress,
    step_name: str,
    output_summary: str = "",
    output: Any = None,
) -> None:
    """Mark a step as completed."""
    if step_name in progress.running_steps:
        progress.running_steps.remove(step_name)

    started_at = None
    retry_count = 0
    if progress.current_step:
        started_at = progress.current_step.get("started_at")
        retry_count = progress.current_step.get("retry_count", 0)

    step = StepProgress(
        name=step_name,
        status=StepStatus.COMPLETED.value,
        started_at=started_at,
        completed_at=datetime.now(timezone.utc).isoformat(),
        retry_count=retry_count,
        output_summary=output_summary,
    )
    progress.completed_steps.append(step)

    if output is not None:
        progress.step_outputs[step_name] = output

    progress.current_step = None


def update_step_failed(
    progress: WorkflowProgress,
    step_name: str,
    error: str,
) -> None:
    """Mark a step as failed."""
    if step_name in progress.running_steps:
        progress.running_steps.remove(step_name)

    started_at = None
    retry_count = 0
    if progress.current_step:
        started_at = progress.current_step.get("started_at")
        retry_count = progress.current_step.get("retry_count", 0)

    step = StepProgress(
        name=step_name,
        status=StepStatus.FAILED.value,
        started_at=started_at,
        completed_at=datetime.now(timezone.utc).isoformat(),
        retry_count=retry_count,
        error=error,
    )
    progress.completed_steps.append(step)
    progress.errors.append({"step": step_name, "error": error})
    progress.current_step = None


def update_step_skipped(progress: WorkflowProgress, step_name: str) -> None:
    """Mark a step as skipped."""
    if step_name in progress.pending_steps:
        progress.pending_steps.remove(step_name)
    if step_name in progress.running_steps:
        progress.running_steps.remove(step_name)

    step = StepProgress(
        name=step_name,
        status=StepStatus.SKIPPED.value,
        completed_at=datetime.now(timezone.utc).isoformat(),
    )
    progress.completed_steps.append(step)
    progress.current_step = None


def _progress_to_dict(progress: WorkflowProgress) -> dict[str, Any]:
    """Convert progress to dictionary for JSON serialization."""
    data = asdict(progress)
    data["completed_steps"] = [asdict(s) if isinstance(s, StepProgress) else s for s in progress.completed_steps]
    data["parallel_branches"] = [asdict(b) if isinstance(b, ParallelBranch) else b for b in progress.parallel_branches]
    return data


def _dict_to_progress(data: dict[str, Any]) -> WorkflowProgress:
    """Convert dictionary to WorkflowProgress."""
    completed = [StepProgress(**s) if isinstance(s, dict) else s for s in data.get("completed_steps", [])]
    branches = [ParallelBranch(**b) if isinstance(b, dict) else b for b in data.get("parallel_branches", [])]

    return WorkflowProgress(
        schema_version=data.get("schema_version", "1.0"),
        workflow_id=data.get("workflow_id", ""),
        workflow_name=data.get("workflow_name", ""),
        status=data.get("status", "pending"),
        started_at=data.get("started_at"),
        completed_at=data.get("completed_at"),
        current_step=data.get("current_step"),
        completed_steps=completed,
        pending_steps=data.get("pending_steps", []),
        running_steps=data.get("running_steps", []),
        parallel_branches=branches,
        errors=data.get("errors", []),
        variables=data.get("variables", {}),
        step_outputs=data.get("step_outputs", {}),
    )
