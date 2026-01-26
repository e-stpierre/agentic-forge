"""Claude CLI runner for workflow orchestration."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Generator
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


def parse_stream_json_line(line: str) -> dict[str, Any] | None:
    """Parse a single line of stream-json output.

    Args:
        line: A line from Claude's stream-json output

    Returns:
        Parsed JSON dict, or None if not valid JSON
    """
    line = line.strip()
    if not line.startswith("{"):
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def extract_text_from_message(data: dict[str, Any]) -> Generator[str, None, None]:
    """Extract text content from an assistant message.

    Handles the stream-json format where assistant messages contain
    content arrays with text blocks.

    Args:
        data: Parsed JSON from stream-json output

    Yields:
        Text content strings from the message
    """
    if data.get("type") != "assistant":
        return

    message = data.get("message", {})
    content = message.get("content", [])

    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text", "")
            if text:
                yield text


def extract_user_text(data: dict[str, Any]) -> str | None:
    """Extract text content from a user message.

    Args:
        data: Parsed JSON from stream-json output

    Returns:
        User message text, or None if not a user message
    """
    if data.get("type") != "user":
        return None

    message = data.get("message", {})
    content = message.get("content", [])

    texts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text", "")
            if text:
                texts.append(text)
        elif isinstance(block, str):
            texts.append(block)

    return "\n".join(texts) if texts else None


def extract_result_text(data: dict[str, Any]) -> str | None:
    """Extract the final result text from a result message.

    Args:
        data: Parsed JSON from stream-json output

    Returns:
        Result text, or None if not a result message
    """
    if data.get("type") != "result":
        return None
    return data.get("result")


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
    workflow_id: str | None = None,
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
        workflow_id: Optional workflow ID to set as OTEL_RESOURCE_ATTRIBUTE for tracing

    Returns:
        ClaudeResult with captured output
    """
    claude_path = get_executable("claude")
    cmd = [claude_path, "--print"]

    # Use stream-json format when streaming output for real-time parsing
    if print_output:
        cmd.extend(["--output-format", "stream-json", "--verbose"])

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

    # Set up environment with OTEL tracing if workflow_id is provided
    env = None
    if workflow_id:
        env = os.environ.copy()
        env["OTEL_RESOURCE_ATTRIBUTE"] = f"session={workflow_id}"

    if print_output:
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=cwd_str,
            env=env,
            shell=False,
        )

        if process.stdin:
            process.stdin.write(prompt)
            process.stdin.close()

        # Show user prompt at start in ALL mode (stream-json doesn't include user messages)
        if console:
            console.stream_text(prompt, role="user")

        # Collect all text for final result
        collected_text: list[str] = []
        result_text: str | None = None

        if process.stdout:
            for line in process.stdout:
                # Parse stream-json format
                data = parse_stream_json_line(line)
                if data is None:
                    continue

                # Note: user messages from stream-json are rare, but handle them if present
                user_text = extract_user_text(data)
                if user_text and console:
                    console.stream_text(user_text, role="user")

                # Extract text from assistant messages for streaming
                for text in extract_text_from_message(data):
                    if console:
                        console.stream_text(text, role="assistant")
                    else:
                        print(text, end="", flush=True)
                    collected_text.append(text)

                # Capture final result
                result = extract_result_text(data)
                if result is not None:
                    result_text = result

        # Signal that streaming is complete
        if console:
            console.stream_complete()

        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

        stderr = process.stderr.read() if process.stderr else ""

        # Use result_text if available, otherwise join collected text
        final_output = result_text if result_text is not None else "".join(collected_text)

        return ClaudeResult(
            returncode=process.returncode if process.returncode is not None else 1,
            stdout=final_output,
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
                encoding="utf-8",
                errors="replace",
                cwd=cwd_str,
                env=env,
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
