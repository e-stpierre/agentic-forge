"""Claude CLI runner for workflow orchestration."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing import Any

    from agentic_sdlc.console import ConsoleOutput


def get_executable(name: str) -> str:
    """Resolve executable path for cross-platform subprocess calls.

    Uses shutil.which() to find the full path, allowing shell=False
    in subprocess calls while maintaining Windows compatibility.

    Args:
        name: Executable name (e.g., "claude", "git")

    Returns:
        Full path to the executable

    Raises:
        FileNotFoundError: If executable not found in PATH
    """
    path = shutil.which(name)
    if not path:
        raise FileNotFoundError(f"Executable not found in PATH: {name}")
    return path


MODEL_MAP = {
    "sonnet": "sonnet",
    "haiku": "haiku",
    "opus": "opus",
}

# Path to the agentic system prompt file
AGENTIC_SYSTEM_PROMPT_FILE = Path(__file__).parent.parent.parent / "prompts" / "agentic-system.md"


def _get_agentic_system_prompt() -> str | None:
    """Load the agentic system prompt from file.

    Returns:
        The system prompt content, or None if the file doesn't exist.
    """
    if AGENTIC_SYSTEM_PROMPT_FILE.exists():
        return AGENTIC_SYSTEM_PROMPT_FILE.read_text(encoding="utf-8")
    return None


@dataclass
class SessionOutput:
    """Parsed output from a Claude session with standardized format."""

    session_id: str | None = None
    is_success: bool = False
    context: str = ""
    extra: dict[str, Any] = field(default_factory=dict)
    raw_json: dict[str, Any] | None = None

    @classmethod
    def from_stdout(cls, stdout: str) -> SessionOutput:
        """Extract the session output JSON from Claude's stdout.

        Looks for the last JSON block that contains the required base keys
        (sessionId, isSuccess, context).

        Args:
            stdout: The full stdout from Claude session

        Returns:
            SessionOutput with parsed values, or defaults if not found
        """
        if not stdout:
            return cls(context="No output received from Claude session")

        # Find all JSON blocks in the output
        json_pattern = r"```(?:json)?\s*(\{[^`]*\})\s*```"
        matches = re.findall(json_pattern, stdout, re.DOTALL)

        # Also look for bare JSON objects at the end of output
        bare_json_pattern = r"\{[^{}]*\"sessionId\"[^{}]*\}"
        bare_matches = re.findall(bare_json_pattern, stdout, re.DOTALL)

        all_matches = matches + bare_matches

        # Try to parse each match, starting from the last (most recent)
        for match in reversed(all_matches):
            try:
                data = json.loads(match)
                # Check if it has the required base keys
                if "sessionId" in data and "isSuccess" in data and "context" in data:
                    extra = {k: v for k, v in data.items() if k not in ("sessionId", "isSuccess", "context")}
                    return cls(
                        session_id=data.get("sessionId"),
                        is_success=bool(data.get("isSuccess", False)),
                        context=data.get("context", ""),
                        extra=extra,
                        raw_json=data,
                    )
            except json.JSONDecodeError:
                continue

        return cls(context="No valid session output JSON found in Claude response")


@dataclass
class ClaudeResult:
    """Result from a Claude CLI invocation."""

    returncode: int
    stdout: str
    stderr: str
    prompt: str
    cwd: Path | None
    model: str | None = None
    _session_output: SessionOutput | None = None

    @property
    def success(self) -> bool:
        """Return True if the command completed successfully."""
        return self.returncode == 0

    @property
    def session_output(self) -> SessionOutput:
        """Parse and return the session output from stdout.

        The session output is parsed lazily on first access.
        """
        if self._session_output is None:
            self._session_output = SessionOutput.from_stdout(self.stdout)
        return self._session_output

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
    append_system_prompt: bool = True,
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
        append_system_prompt: Whether to append the agentic system prompt (default True)

    Returns:
        ClaudeResult with captured output
    """
    claude_path = get_executable("claude")
    cmd = [claude_path, "--print"]

    if model and model in MODEL_MAP:
        cmd.extend(["--model", MODEL_MAP[model]])

    if skip_permissions:
        cmd.append("--dangerously-skip-permissions")

    if allowed_tools:
        for tool in allowed_tools:
            cmd.extend(["--allowedTools", tool])

    # Append agentic system prompt for standardized output format
    if append_system_prompt:
        system_prompt = _get_agentic_system_prompt()
        if system_prompt:
            cmd.extend(["--append-system-prompt", system_prompt])

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

        # Signal that streaming is complete
        if console:
            console.stream_complete()

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


def _quote_arg_value(value: Any) -> str:
    """Quote an argument value if it contains spaces or special characters.

    Args:
        value: The argument value to potentially quote

    Returns:
        The value as a string, quoted if necessary
    """
    value_str = str(value)
    # Quote values that contain spaces, quotes, or are empty
    if " " in value_str or '"' in value_str or "'" in value_str or not value_str:
        # Escape any existing double quotes and wrap in double quotes
        escaped = value_str.replace('"', '\\"')
        return f'"{escaped}"'
    return value_str


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
        args_str = " ".join(f"--{k} {_quote_arg_value(v)}" for k, v in args.items())
        prompt = f"{prompt} {args_str}"

    return run_claude(prompt, cwd=cwd, **kwargs)


def check_claude_available() -> bool:
    """Check if the claude CLI is available.

    Returns:
        True if claude is available, False otherwise
    """
    try:
        claude_path = get_executable("claude")
        result = subprocess.run(
            [claude_path, "--version"],
            capture_output=True,
            text=True,
            shell=False,
            timeout=10,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False
