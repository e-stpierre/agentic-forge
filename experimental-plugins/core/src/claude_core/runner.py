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
    skip_permissions: bool = True,
) -> ClaudeResult:
    """
    Run claude -p with the given prompt.

    Args:
        prompt: The prompt to send to Claude (can be a slash command)
        cwd: Working directory for the Claude session
        timeout: Timeout in seconds (default 5 minutes)
        print_output: Whether to print output as it arrives
        skip_permissions: Whether to skip permission prompts (default True for non-interactive use)

    Returns:
        ClaudeResult with captured output
    """
    # Build command - use stdin for prompt to avoid shell escaping issues
    cmd = ["claude", "--print"]
    if skip_permissions:
        cmd.append("--dangerously-skip-permissions")

    # Convert cwd to string if it's a Path
    cwd_str = str(cwd) if cwd else None

    if print_output:
        # Stream output in real-time
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd_str,
            shell=True,  # Required on Windows for PATH resolution
        )

        # Send prompt via stdin
        if process.stdin:
            process.stdin.write(prompt)
            process.stdin.close()

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
            returncode=process.returncode if process.returncode is not None else 1,
            stdout="".join(stdout_lines),
            stderr=stderr,
            prompt=prompt,
            cwd=cwd,
        )
    else:
        try:
            result = subprocess.run(
                cmd,
                input=prompt,
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


def main() -> None:
    """CLI entry point for running Claude commands."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Run Claude CLI commands from Python",
        prog="claude-run",
    )
    parser.add_argument(
        "prompt",
        nargs="?",
        help="Prompt to send to Claude (reads from stdin if not provided)",
    )
    parser.add_argument(
        "--cwd",
        type=Path,
        help="Working directory for the Claude session",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Timeout in seconds (default: 300)",
    )
    parser.add_argument(
        "--no-skip-permissions",
        action="store_true",
        help="Don't skip permission prompts",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check if Claude CLI is available and exit",
    )

    args = parser.parse_args()

    if args.check:
        if check_claude_available():
            print("Claude CLI is available")
            sys.exit(0)
        else:
            print("Claude CLI is not available")
            sys.exit(1)

    # Get prompt from argument or stdin
    prompt = args.prompt
    if not prompt:
        prompt = sys.stdin.read().strip()

    if not prompt:
        parser.error("No prompt provided")

    result = run_claude(
        prompt=prompt,
        cwd=args.cwd,
        timeout=args.timeout,
        print_output=True,
        skip_permissions=not args.no_skip_permissions,
    )

    if result.stderr:
        print(result.stderr, file=sys.stderr)

    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
