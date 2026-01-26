"""Console output utilities for workflow execution.

Provides structured, colored terminal output for workflow progress,
step results, errors, and summaries.
"""

from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass
from enum import Enum
from typing import TextIO


class OutputLevel(Enum):
    """Output verbosity levels."""

    BASE = "base"  # Show step progress, summaries, and errors
    ALL = "all"  # Stream all Claude output in real-time


class Color(Enum):
    """ANSI color codes for terminal output."""

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    # Colors
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"

    # Bright colors
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_CYAN = "\033[96m"


def _supports_color() -> bool:
    """Check if the terminal supports color output."""
    if not hasattr(sys.stdout, "isatty"):
        return False
    return sys.stdout.isatty()


def _colorize(text: str, *colors: Color) -> str:
    """Apply color codes to text if supported."""
    if not _supports_color():
        return text
    color_codes = "".join(c.value for c in colors)
    return f"{color_codes}{text}{Color.RESET.value}"


@dataclass
class ConsoleOutput:
    """Handles structured console output for workflows."""

    level: OutputLevel = OutputLevel.BASE
    stream: TextIO = sys.stdout
    _last_base_line_len: int = 0  # Track length of last BASE mode line for clearing

    def _print(self, message: str, end: str = "\n") -> None:
        """Print message to stream."""
        print(message, end=end, flush=True, file=self.stream)

    # Workflow-level messages

    def workflow_start(self, workflow_name: str, workflow_id: str) -> None:
        """Print workflow start message."""
        header = _colorize(f"Workflow: {workflow_name}", Color.BOLD, Color.BRIGHT_CYAN)
        id_str = _colorize(f"[{workflow_id}]", Color.DIM)
        self._print(f"\n{header} {id_str}")
        self._print(_colorize("-" * 50, Color.DIM))

    def workflow_complete(self, workflow_name: str, status: str) -> None:
        """Print workflow completion message."""
        self._print(_colorize("-" * 50, Color.DIM))
        if status == "completed":
            status_str = _colorize("COMPLETED", Color.BOLD, Color.BRIGHT_GREEN)
        else:
            status_str = _colorize(status.upper(), Color.BOLD, Color.BRIGHT_RED)
        self._print(f"Workflow {workflow_name}: {status_str}\n")

    # Step-level messages

    def step_start(self, step_name: str, step_type: str | None = None) -> None:
        """Print step start message."""
        step_str = _colorize(f"Step: {step_name}", Color.BOLD)
        type_str = _colorize(f"[{step_type}]", Color.DIM) if step_type else ""
        self._print(f"\n{step_str} {type_str}")

    def step_complete(self, step_name: str, summary: str | None = None) -> None:
        """Print step completion with optional summary."""
        check = _colorize("[OK]", Color.BRIGHT_GREEN)
        name = _colorize(step_name, Color.GREEN)
        self._print(f"{check} {name} completed")

        if summary:
            # Indent and dim the summary
            summary_lines = summary.strip().split("\n")
            for line in summary_lines[:5]:  # Limit to 5 lines
                truncated = line[:200] + "..." if len(line) > 200 else line
                self._print(_colorize(f"    {truncated}", Color.DIM))
            if len(summary_lines) > 5:
                self._print(_colorize(f"    ... ({len(summary_lines) - 5} more lines)", Color.DIM))

    def step_failed(self, step_name: str, error: str | None = None) -> None:
        """Print step failure with error details."""
        cross = _colorize("[FAIL]", Color.BRIGHT_RED)
        name = _colorize(step_name, Color.RED)
        self._print(f"{cross} {name} failed")

        if error:
            error_lines = error.strip().split("\n")
            for line in error_lines[:10]:  # Show more lines for errors
                truncated = line[:200] + "..." if len(line) > 200 else line
                self._print(_colorize(f"    {truncated}", Color.RED))
            if len(error_lines) > 10:
                self._print(_colorize(f"    ... ({len(error_lines) - 10} more lines)", Color.DIM))

    def step_retry(self, step_name: str, attempt: int, max_attempts: int, error: str | None = None) -> None:
        """Print retry message."""
        retry = _colorize(f"[RETRY {attempt}/{max_attempts}]", Color.YELLOW)
        name = _colorize(step_name, Color.YELLOW)
        self._print(f"{retry} {name}")

        if error:
            # Show brief error on retry
            first_line = error.strip().split("\n")[0][:100]
            self._print(_colorize(f"    Reason: {first_line}", Color.DIM))

    # Ralph loop messages

    def ralph_iteration(self, step_name: str, iteration: int, max_iterations: int, summary: str | None = None) -> None:
        """Print Ralph loop iteration progress."""
        progress = _colorize(f"[{iteration}/{max_iterations}]", Color.CYAN)
        name = _colorize(step_name, Color.CYAN)
        self._print(f"{progress} {name} iteration")

        if summary:
            summary_lines = summary.strip().split("\n")
            for line in summary_lines[:3]:  # Brief summary for iterations
                truncated = line[:150] + "..." if len(line) > 150 else line
                self._print(_colorize(f"    {truncated}", Color.DIM))

    def ralph_complete(self, step_name: str, iteration: int, max_iterations: int) -> None:
        """Print Ralph loop completion."""
        check = _colorize("[OK]", Color.BRIGHT_GREEN)
        name = _colorize(step_name, Color.GREEN)
        self._print(f"{check} {name} completed at iteration {iteration}/{max_iterations}")

    def ralph_max_iterations(self, step_name: str, max_iterations: int) -> None:
        """Print Ralph loop max iterations reached."""
        warn = _colorize("[WARN]", Color.YELLOW)
        name = _colorize(step_name, Color.YELLOW)
        self._print(f"{warn} {name} reached max iterations ({max_iterations})")

    # Generic messages

    def info(self, message: str) -> None:
        """Print info message."""
        info = _colorize("[INFO]", Color.BLUE)
        self._print(f"{info} {message}")

    def warning(self, message: str) -> None:
        """Print warning message."""
        warn = _colorize("[WARN]", Color.YELLOW)
        self._print(f"{warn} {message}")

    def error(self, message: str) -> None:
        """Print error message."""
        err = _colorize("[ERROR]", Color.BRIGHT_RED)
        self._print(f"{err} {message}")

    def stream_text(self, text: str, role: str = "assistant") -> None:
        """Stream text content from Claude's messages.

        In ALL mode: prints all text with visual indicators by role.
        In BASE mode: shows only the last line, overwriting previous output.

        Args:
            text: Text content extracted from stream-json message (delta only)
            role: Message role - "user" or "assistant"
        """
        if self.level == OutputLevel.ALL:
            # Skip empty text
            if not text or not text.strip():
                return

            # Format with role indicator
            if role == "user":
                prefix = _colorize(">", Color.BRIGHT_CYAN, Color.BOLD)
                label = _colorize(" [user]", Color.DIM)
                # Print user message with prefix on first line
                self._print("")  # Blank line before
                self._print(f"{prefix}{label}")
                for line in text.split("\n"):
                    self._print(f"  {line}")
            else:
                # Assistant message - green bullet prefix
                bullet = _colorize("*", Color.BRIGHT_GREEN, Color.BOLD)
                lines = text.split("\n")
                # Always start with blank line to separate from previous output
                self._print("")
                # First line gets the bullet
                self._print(f"{bullet} {lines[0]}")
                # Subsequent lines are indented to align
                for line in lines[1:]:
                    self._print(f"  {line}")
        elif self.level == OutputLevel.BASE:
            # Show only the last meaningful line, overwriting previous
            # Split by newlines and get the last non-empty line
            lines = text.strip().split("\n")
            last_line = ""
            for line in reversed(lines):
                if line.strip():
                    last_line = line.strip()
                    break
            if last_line:
                # Truncate to terminal width to prevent wrapping
                # (wrapping breaks the \r carriage return behavior)
                term_width = shutil.get_terminal_size().columns
                if len(last_line) > term_width - 1:
                    last_line = last_line[: term_width - 4] + "..."
                # Clear entire line first, then write new content
                # \033[2K clears the entire line, \r moves cursor to start
                self._print(f"\033[2K\r{last_line}", end="")
                self._last_base_line_len = len(last_line)

    def stream_complete(self) -> None:
        """Called when streaming is complete to finalize output.

        In BASE mode: prints a newline to move past the overwritten line.
        In ALL mode: no action needed (already printing newlines).
        """
        if self.level == OutputLevel.BASE:
            self._print("")  # Print newline to move past the last streamed line


def extract_json(output: str) -> dict | None:
    """Extract and parse JSON from Claude's output.

    Looks for the last JSON code block (```json ... ```) in the output
    and parses it. Skills are expected to output a JSON block as their
    final structured output.

    Args:
        output: Full output text from Claude

    Returns:
        Parsed JSON as dict, or None if no valid JSON found
    """
    import json
    import re

    if not output:
        return None

    # Find all JSON code blocks
    pattern = r"```json\s*([\s\S]*?)```"
    matches = re.findall(pattern, output)

    if not matches:
        return None

    # Use the last JSON block (skills output their final JSON at the end)
    json_str = matches[-1].strip()

    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        return None


def extract_summary(output: str, max_lines: int = 5, max_chars: int = 500) -> str:
    """Extract a concise summary from Claude's output.

    Looks for key patterns like conclusions, results, or the last meaningful content.

    Args:
        output: Full output text
        max_lines: Maximum lines to include
        max_chars: Maximum characters to include

    Returns:
        Extracted summary string
    """
    if not output:
        return ""

    output = output.strip()

    # Look for explicit summary markers
    summary_markers = [
        "## Summary",
        "### Summary",
        "Summary:",
        "Result:",
        "Completed:",
        "Done:",
    ]

    for marker in summary_markers:
        if marker in output:
            idx = output.find(marker)
            summary_section = output[idx:]
            lines = summary_section.split("\n")
            # Take lines until next header or max lines
            result_lines = []
            for i, line in enumerate(lines[1:], 1):  # Skip marker line
                if i > max_lines:
                    break
                if line.startswith("#") and i > 1:
                    break
                result_lines.append(line)
            if result_lines:
                return "\n".join(result_lines).strip()[:max_chars]

    # If no markers, take the last meaningful lines
    lines = [line for line in output.split("\n") if line.strip()]
    if not lines:
        return ""

    # Take last few lines as summary
    last_lines = lines[-max_lines:]
    summary = "\n".join(last_lines)

    if len(summary) > max_chars:
        summary = summary[:max_chars] + "..."

    return summary
