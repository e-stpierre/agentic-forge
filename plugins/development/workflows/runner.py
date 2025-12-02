#!/usr/bin/env python3
"""
Claude CLI runner for workflow orchestration.

This module provides functions to invoke Claude Code via the CLI
and capture the output for use in Python-based workflows.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing import Any


@dataclass
class ClaudeResult:
    """Result from a Claude CLI invocation."""

    returncode: int
    stdout: str
    stderr: str
    prompt: str
    cwd: Path | None

    @property
    def success(self) -> bool:
        """Return True if the command completed successfully."""
        return self.returncode == 0

    def __str__(self) -> str:
        status = "SUCCESS" if self.success else "FAILED"
        return f"ClaudeResult({status}, prompt={self.prompt!r})"


def run_claude(
    prompt: str,
    cwd: Path | None = None,
    timeout: int | None = 300,
    print_output: bool = False,
) -> ClaudeResult:
    """
    Run claude -p with the given prompt.

    Args:
        prompt: The prompt to send to Claude (can be a slash command)
        cwd: Working directory for the Claude session
        timeout: Timeout in seconds (default 5 minutes)
        print_output: Whether to print output as it arrives

    Returns:
        ClaudeResult with captured output
    """
    cmd = ["claude", "-p", prompt]

    # Convert cwd to string if it's a Path
    cwd_str = str(cwd) if cwd else None

    if print_output:
        # Stream output in real-time
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd_str,
            shell=True,  # Required on Windows for PATH resolution
        )

        stdout_lines: list[str] = []

        # Read stdout line by line
        if process.stdout:
            for line in process.stdout:
                print(line, end="", flush=True)
                stdout_lines.append(line)

        # Wait for completion
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

        stderr = process.stderr.read() if process.stderr else ""

        return ClaudeResult(
            returncode=process.returncode or 1,
            stdout="".join(stdout_lines),
            stderr=stderr,
            prompt=prompt,
            cwd=cwd,
        )
    else:
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=cwd_str,
                timeout=timeout,
                shell=True,  # Required on Windows for PATH resolution
            )

            return ClaudeResult(
                returncode=result.returncode,
                stdout=result.stdout,
                stderr=result.stderr,
                prompt=prompt,
                cwd=cwd,
            )
        except subprocess.TimeoutExpired:
            return ClaudeResult(
                returncode=1,
                stdout="",
                stderr=f"Command timed out after {timeout} seconds",
                prompt=prompt,
                cwd=cwd,
            )


def run_claude_with_command(
    command: str,
    args: str = "",
    cwd: Path | None = None,
    **kwargs: Any,
) -> ClaudeResult:
    """
    Run a Claude slash command.

    Args:
        command: The slash command name (without /)
        args: Arguments to pass to the command
        cwd: Working directory
        **kwargs: Additional arguments passed to run_claude

    Returns:
        ClaudeResult
    """
    prompt = f"/{command}"
    if args:
        prompt = f"{prompt} {args}"

    return run_claude(prompt, cwd=cwd, **kwargs)


def check_claude_available() -> bool:
    """
    Check if the claude CLI is available.

    Returns:
        True if claude is available, False otherwise
    """
    try:
        result = subprocess.run(
            ["claude", "--version"],
            capture_output=True,
            text=True,
            shell=True,
            timeout=10,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


if __name__ == "__main__":
    # Quick test
    if check_claude_available():
        print("Claude CLI is available")
        result = run_claude("Say hello", print_output=True)
        print(f"\nResult: {result}")
    else:
        print("Claude CLI is not available")
        sys.exit(1)
