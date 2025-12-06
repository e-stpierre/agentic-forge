#!/usr/bin/env python3
"""
Structured logging for Claude workflow orchestration.

This module provides JSON-based logging for tracking command executions,
durations, and outcomes across workflow runs.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class LogEntry:
    """Represents a single log entry for a command execution."""

    command: str
    args: str
    cwd: str
    duration_ms: int
    exit_code: int
    output_summary: str
    timestamp: str = ""
    level: str = "INFO"

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

    def to_json(self) -> str:
        """Convert to JSON string."""
        return json.dumps(self.to_dict())


class StructuredLogger:
    """
    JSON-based structured logger for workflow orchestration.

    Logs command executions with timing, status, and summary information
    to a JSON file for debugging and audit purposes.

    Example usage:
        logger = StructuredLogger(Path("workflow.log.json"))
        logger.log(LogEntry(
            command="/plan-feature",
            args="add dark mode",
            cwd="/path/to/repo",
            duration_ms=45000,
            exit_code=0,
            output_summary="Plan created at docs/plans/dark-mode-plan.md"
        ))
    """

    def __init__(
        self,
        log_file: Path,
        level: str = "INFO",
        append: bool = True,
    ) -> None:
        """
        Initialize the structured logger.

        Args:
            log_file: Path to the log file
            level: Logging level (DEBUG, INFO, WARN, ERROR)
            append: Whether to append to existing file or overwrite
        """
        self.log_file = log_file
        self.level = level.upper()
        self.append = append

        # Ensure parent directory exists
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

        # Initialize file if not appending or doesn't exist
        if not append or not self.log_file.exists():
            self.log_file.write_text("")

    def _should_log(self, entry_level: str) -> bool:
        """Check if the entry level should be logged based on configured level."""
        levels = {"DEBUG": 0, "INFO": 1, "WARN": 2, "ERROR": 3}
        entry_priority = levels.get(entry_level.upper(), 1)
        configured_priority = levels.get(self.level, 1)
        return entry_priority >= configured_priority

    def log(self, entry: LogEntry) -> None:
        """
        Log a single entry.

        Args:
            entry: LogEntry to log
        """
        if not self._should_log(entry.level):
            return

        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write(entry.to_json() + "\n")

    def log_command(
        self,
        command: str,
        args: str = "",
        cwd: str = "",
        duration_ms: int = 0,
        exit_code: int = 0,
        output_summary: str = "",
        level: str = "INFO",
    ) -> None:
        """
        Convenience method to log a command execution.

        Args:
            command: The command that was executed
            args: Arguments passed to the command
            cwd: Working directory
            duration_ms: Execution duration in milliseconds
            exit_code: Command exit code
            output_summary: Summary of the output
            level: Log level
        """
        entry = LogEntry(
            command=command,
            args=args,
            cwd=cwd,
            duration_ms=duration_ms,
            exit_code=exit_code,
            output_summary=output_summary,
            level=level,
        )
        self.log(entry)

    def read_entries(self) -> list[LogEntry]:
        """
        Read all entries from the log file.

        Returns:
            List of LogEntry objects
        """
        if not self.log_file.exists():
            return []

        entries: list[LogEntry] = []
        with open(self.log_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        data = json.loads(line)
                        entries.append(LogEntry(**data))
                    except (json.JSONDecodeError, TypeError):
                        continue
        return entries

    def get_summary(self) -> dict[str, Any]:
        """
        Get a summary of all logged entries.

        Returns:
            Dictionary with summary statistics
        """
        entries = self.read_entries()

        if not entries:
            return {
                "total_entries": 0,
                "successful": 0,
                "failed": 0,
                "total_duration_ms": 0,
            }

        successful = sum(1 for e in entries if e.exit_code == 0)
        failed = len(entries) - successful
        total_duration = sum(e.duration_ms for e in entries)

        # Group by command
        commands: dict[str, int] = {}
        for entry in entries:
            cmd = entry.command
            commands[cmd] = commands.get(cmd, 0) + 1

        return {
            "total_entries": len(entries),
            "successful": successful,
            "failed": failed,
            "total_duration_ms": total_duration,
            "commands": commands,
        }

    def clear(self) -> None:
        """Clear all entries from the log file."""
        self.log_file.write_text("")


# Global logger instance cache
_loggers: dict[str, StructuredLogger] = {}


def configure_logging(
    log_file: str | Path,
    level: str = "INFO",
) -> StructuredLogger:
    """
    Configure and return a structured logger.

    Args:
        log_file: Path to the log file
        level: Logging level (DEBUG, INFO, WARN, ERROR)

    Returns:
        Configured StructuredLogger instance
    """
    log_path = Path(log_file)
    key = str(log_path.absolute())

    if key not in _loggers:
        _loggers[key] = StructuredLogger(log_path, level=level)
    else:
        # Update level if logger already exists
        _loggers[key].level = level

    return _loggers[key]


def get_logger(log_file: str | Path) -> StructuredLogger:
    """
    Get an existing logger or create a new one with defaults.

    Args:
        log_file: Path to the log file

    Returns:
        StructuredLogger instance
    """
    log_path = Path(log_file)
    key = str(log_path.absolute())

    if key not in _loggers:
        _loggers[key] = StructuredLogger(log_path)

    return _loggers[key]


if __name__ == "__main__":
    # Quick test
    import tempfile

    with tempfile.NamedTemporaryFile(mode="w", suffix=".log.json", delete=False) as f:
        log_path = Path(f.name)

    print(f"Testing logger with file: {log_path}")

    logger = configure_logging(log_path, level="DEBUG")

    # Log some entries
    logger.log_command(
        command="/plan-feature",
        args="add dark mode",
        cwd="/path/to/repo",
        duration_ms=45000,
        exit_code=0,
        output_summary="Plan created at docs/plans/dark-mode-plan.md",
    )

    logger.log_command(
        command="/git-commit",
        args="Initial commit",
        cwd="/path/to/repo",
        duration_ms=1500,
        exit_code=0,
        output_summary="Committed changes",
    )

    logger.log_command(
        command="/test",
        args="--fix",
        cwd="/path/to/repo",
        duration_ms=30000,
        exit_code=1,
        output_summary="2 tests failed",
        level="ERROR",
    )

    # Read and display entries
    print("\nLog entries:")
    for entry in logger.read_entries():
        print(f"  {entry.timestamp}: {entry.command} {entry.args} -> {entry.exit_code}")

    # Display summary
    print("\nSummary:")
    summary = logger.get_summary()
    print(json.dumps(summary, indent=2))

    # Cleanup
    log_path.unlink()
    print("\nTest completed successfully!")
