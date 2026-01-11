"""NDJSON structured logging for workflows."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any


class LogLevel(Enum):
    """Log severity levels."""

    CRITICAL = "Critical"
    ERROR = "Error"
    WARNING = "Warning"
    INFORMATION = "Information"


@dataclass
class LogEntry:
    """A single log entry."""

    timestamp: str
    level: str
    step: str
    message: str
    context: dict[str, Any] | None = None


class WorkflowLogger:
    """NDJSON logger for workflow execution."""

    def __init__(self, workflow_id: str, repo_root: Path | None = None):
        self.workflow_id = workflow_id
        if repo_root is None:
            repo_root = Path.cwd()
        self.log_path = repo_root / "agentic" / "workflows" / workflow_id / "logs.ndjson"
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def log(
        self,
        level: LogLevel,
        step: str,
        message: str,
        context: dict[str, Any] | None = None,
    ) -> None:
        """Write a log entry."""
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=level.value,
            step=step,
            message=message,
            context=context,
        )

        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(entry)) + "\n")

    def critical(self, step: str, message: str, **context: Any) -> None:
        """Log a critical message."""
        self.log(LogLevel.CRITICAL, step, message, context or None)

    def error(self, step: str, message: str, **context: Any) -> None:
        """Log an error message."""
        self.log(LogLevel.ERROR, step, message, context or None)

    def warning(self, step: str, message: str, **context: Any) -> None:
        """Log a warning message."""
        self.log(LogLevel.WARNING, step, message, context or None)

    def info(self, step: str, message: str, **context: Any) -> None:
        """Log an informational message."""
        self.log(LogLevel.INFORMATION, step, message, context or None)


def read_logs(workflow_id: str, repo_root: Path | None = None) -> list[LogEntry]:
    """Read all log entries for a workflow."""
    if repo_root is None:
        repo_root = Path.cwd()
    log_path = repo_root / "agentic" / "workflows" / workflow_id / "logs.ndjson"

    if not log_path.exists():
        return []

    entries = []
    with open(log_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                data = json.loads(line)
                entries.append(LogEntry(**data))
    return entries


def get_log_path(workflow_id: str, repo_root: Path | None = None) -> Path:
    """Get the path to the log file for a workflow."""
    if repo_root is None:
        repo_root = Path.cwd()
    return repo_root / "agentic" / "workflows" / workflow_id / "logs.ndjson"
