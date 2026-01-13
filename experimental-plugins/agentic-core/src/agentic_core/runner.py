"""
Claude CLI runner for agentic workflow execution.

This module provides functions to invoke Claude Code via the CLI
in a way that allows Claude to execute tools and make file changes,
rather than just returning text responses.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


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
        return f"ClaudeResult({status}, prompt={self.prompt[:50]!r}...)"


def run_claude(
    prompt: str,
    cwd: Path | None = None,
    timeout: int | None = 300,
    print_output: bool = False,
    skip_permissions: bool = True,
) -> ClaudeResult:
    """
    Run claude --print with the given prompt.

    This uses --print mode with stdin to allow Claude to execute tools
    and make actual file changes, unlike -p which captures output.

    Args:
        prompt: The prompt to send to Claude (can be a slash command)
        cwd: Working directory for the Claude session
        timeout: Timeout in seconds (default 5 minutes)
        print_output: Whether to print output as it arrives
        skip_permissions: Whether to skip permission prompts (default True)

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
            shell=False,
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
                shell=False,
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
    **kwargs,
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
            shell=False,
            timeout=10,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False
