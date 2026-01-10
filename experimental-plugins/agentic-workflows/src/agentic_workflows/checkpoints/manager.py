"""Checkpoint management for workflow sessions."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from typing import Any


def get_checkpoint_path(workflow_id: str, repo_root: Path | None = None) -> Path:
    """Get path to checkpoint file for a workflow."""
    if repo_root is None:
        repo_root = Path.cwd()
    return repo_root / "agentic" / "workflows" / workflow_id / "checkpoint.md"


def create_checkpoint(
    workflow_id: str,
    step: str,
    context: str,
    progress: str,
    notes: str = "",
    issues: str = "",
    repo_root: Path | None = None,
) -> str:
    """Create a checkpoint entry.

    Args:
        workflow_id: Workflow ID
        step: Current step name
        context: Context summary
        progress: Progress details (markdown checklist)
        notes: Notes for next session
        issues: Issues discovered
        repo_root: Repository root

    Returns:
        Checkpoint ID
    """
    checkpoint_path = get_checkpoint_path(workflow_id, repo_root)
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)

    existing = read_checkpoints(workflow_id, repo_root)
    checkpoint_num = len(existing) + 1
    checkpoint_id = f"chk-{checkpoint_num:03d}"

    timestamp = datetime.now(timezone.utc).isoformat()

    frontmatter: dict[str, Any] = {
        "checkpoint_id": checkpoint_id,
        "step": step,
        "created": timestamp,
        "workflow_id": workflow_id,
        "status": "in_progress",
    }

    entry_lines = [
        "---",
        yaml.dump(frontmatter, default_flow_style=False).strip(),
        "---",
        "",
        "## Context",
        "",
        context,
        "",
        "## Progress",
        "",
        progress,
        "",
    ]

    if notes:
        entry_lines.extend(
            [
                "## Notes for Next Session",
                "",
                notes,
                "",
            ]
        )

    if issues:
        entry_lines.extend(
            [
                "## Issues Discovered",
                "",
                issues,
                "",
            ]
        )

    entry_lines.append("---\n")
    entry = "\n".join(entry_lines)

    with open(checkpoint_path, "a", encoding="utf-8") as f:
        f.write(entry)

    return checkpoint_id


def read_checkpoints(
    workflow_id: str,
    repo_root: Path | None = None,
) -> list[dict[str, Any]]:
    """Read all checkpoints for a workflow.

    Returns list of checkpoint dictionaries with frontmatter and content.
    """
    checkpoint_path = get_checkpoint_path(workflow_id, repo_root)

    if not checkpoint_path.exists():
        return []

    content = checkpoint_path.read_text(encoding="utf-8")
    checkpoints: list[dict[str, Any]] = []

    parts = content.split("---")

    i = 1
    while i < len(parts) - 1:
        frontmatter_str = parts[i].strip()
        body = parts[i + 1].strip() if i + 1 < len(parts) else ""

        if frontmatter_str:
            try:
                frontmatter = yaml.safe_load(frontmatter_str)
                if frontmatter and "checkpoint_id" in frontmatter:
                    frontmatter["content"] = body
                    checkpoints.append(frontmatter)
            except yaml.YAMLError:
                pass

        i += 2

    return checkpoints


def get_latest_checkpoint(
    workflow_id: str,
    repo_root: Path | None = None,
) -> dict[str, Any] | None:
    """Get the most recent checkpoint for a workflow."""
    checkpoints = read_checkpoints(workflow_id, repo_root)
    return checkpoints[-1] if checkpoints else None
