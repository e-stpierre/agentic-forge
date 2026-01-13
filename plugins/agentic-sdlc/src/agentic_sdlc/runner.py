"""Claude CLI runner for workflow orchestration."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing import Any

    from agentic_sdlc.console import ConsoleOutput

MODEL_MAP = {
    "sonnet": "sonnet",
    "haiku": "haiku",
    "opus": "opus",
}


@dataclass
class ClaudeResult:
    """Result from a Claude CLI invocation."""

    returncode: int
    stdout: str
    stderr: str
    prompt: str
    cwd: Path | None
    model: str | None = None

    @property
    def success(self) -> bool:
        """Return True if the command completed successfully."""
        return self.returncode == 0

    def __str__(self) -> str:
        status = "SUCCESS" if self.success else "FAILED"
        model_str = f", model={self.model}" if self.model else ""
        return f"ClaudeResult({status}{model_str})"


def run_claude(
    prompt: str,
    cwd: Path | None = None,
    model: str = "sonnet",
    timeout: int | None = 300,
    print_output: bool = False,
    skip_permissions: bool = False,
    allowed_tools: list[str] | None = None,
    console: ConsoleOutput | None = None,
) -> ClaudeResult:
    """Run claude with the given prompt.

    Args:
        prompt: The prompt to send to Claude
        cwd: Working directory for the Claude session
        model: Model to use (sonnet, haiku, opus)
        timeout: Timeout in seconds (default 5 minutes)
        print_output: Whether to stream output in real-time
        skip_permissions: Whether to skip permission prompts
        allowed_tools: List of tools Claude is allowed to use without prompting
        console: Optional console output handler for streaming

    Returns:
        ClaudeResult with captured output
    """
    cmd = ["claude", "--print"]

    if model and model in MODEL_MAP:
        cmd.extend(["--model", MODEL_MAP[model]])

    if skip_permissions:
        cmd.append("--dangerously-skip-permissions")

    if allowed_tools:
        for tool in allowed_tools:
            cmd.extend(["--allowedTools", tool])

    cwd_str = str(cwd) if cwd else None

    if print_output:
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd_str,
            shell=False,
        )

        if process.stdin:
            process.stdin.write(prompt)
            process.stdin.close()

        stdout_lines: list[str] = []
        if process.stdout:
            for line in process.stdout:
                if console:
                    console.stream_line(line)
                else:
                    print(line, end="", flush=True)
                stdout_lines.append(line)

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
            model=model,
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
                model=model,
            )
        except subprocess.TimeoutExpired:
            return ClaudeResult(
                returncode=1,
                stdout="",
                stderr=f"Command timed out after {timeout} seconds",
                prompt=prompt,
                cwd=cwd,
                model=model,
            )


def run_claude_with_command(
    command: str,
    args: dict[str, Any] | None = None,
    cwd: Path | None = None,
    **kwargs: Any,
) -> ClaudeResult:
    """Run a Claude slash command with arguments.

    Args:
        command: The slash command name (without /)
        args: Command arguments as key-value pairs
        cwd: Working directory
        **kwargs: Additional arguments passed to run_claude
    """
    prompt = f"/{command}"
    if args:
        args_str = " ".join(f"--{k} {v}" for k, v in args.items())
        prompt = f"{prompt} {args_str}"

    return run_claude(prompt, cwd=cwd, **kwargs)


def check_claude_available() -> bool:
    """Check if the claude CLI is available.

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
