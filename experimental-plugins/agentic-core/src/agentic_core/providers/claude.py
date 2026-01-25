"""Claude CLI provider implementation."""

import json
import shutil
from pathlib import Path
from typing import Optional

from agentic_core.providers.base import CLIProvider, InvocationResult, ProviderCapabilities


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


class ClaudeProvider(CLIProvider):
    """Claude CLI provider.

    Supports the official Claude CLI with features:
    - Session resume via --resume flag
    - JSON output format
    - Tool restrictions via --allowedTools
    - System prompt injection via --append-system-prompt
    - Model selection
    """

    name = "claude"
    capabilities = ProviderCapabilities(
        session_resume=True,
        json_output=True,
        tool_restrictions=True,
        system_prompt=True,
        model_selection=True,
    )

    def __init__(self, cli_path: str = "claude"):
        """Initialize Claude provider.

        Args:
            cli_path: Path to the claude CLI executable
        """
        self.cli_path = cli_path

    def build_command(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        model: Optional[str] = None,
        tools: Optional[list[str]] = None,
        working_dir: Optional[Path] = None,
        timeout: int = 300,
        json_output: bool = True,
    ) -> tuple[list[str], Optional[str]]:
        """Build Claude CLI command.

        Uses stdin for prompt to avoid shell escaping issues with special
        characters (like ## which gets interpreted as shell comment).

        Example output:
            claude --print --output-format json --model sonnet
            (prompt passed via stdin)
        """
        # Use --print flag which reads from stdin, avoiding shell escaping issues
        cmd = [self.cli_path, "--print"]

        if json_output:
            cmd.extend(["--output-format", "json"])

        if system_prompt:
            cmd.extend(["--append-system-prompt", system_prompt])

        if session_id:
            cmd.extend(["--resume", session_id])

        if model:
            cmd.extend(["--model", model])

        if tools:
            cmd.extend(["--allowedTools", ",".join(tools)])

        return cmd, prompt

    def parse_output(
        self,
        stdout: str,
        stderr: str,
        return_code: int,
        duration_ms: int,
    ) -> InvocationResult:
        """Parse Claude CLI JSON output.

        Expected JSON format:
        {
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "duration_ms": 15195,
            "duration_api_ms": 24286,
            "num_turns": 1,
            "result": "...",
            "session_id": "d1224248-b6fb-4f9b-b104-7d5bb3cb29d3",
            "total_cost_usd": 0.21456675,
            "usage": {
                "input_tokens": 3,
                "cache_creation_input_tokens": 27037,
                "cache_read_input_tokens": 0,
                "output_tokens": 477
            }
        }
        """
        if return_code != 0:
            return InvocationResult(
                content="",
                raw_output=stdout,
                is_error=True,
                error_message=stderr or f"Claude CLI exited with code {return_code}",
                duration_ms=duration_ms,
            )

        try:
            data = json.loads(stdout)

            # Extract token usage
            usage = data.get("usage", {})
            tokens_in = (
                usage.get("input_tokens", 0)
                + usage.get("cache_creation_input_tokens", 0)
                + usage.get("cache_read_input_tokens", 0)
            )
            tokens_out = usage.get("output_tokens", 0)

            is_error = data.get("is_error", False) or data.get("subtype") == "error"

            return InvocationResult(
                content=data.get("result", ""),
                session_id=data.get("session_id"),
                tokens_in=tokens_in if tokens_in > 0 else None,
                tokens_out=tokens_out if tokens_out > 0 else None,
                duration_ms=data.get("duration_ms", duration_ms),
                raw_output=stdout,
                is_error=is_error,
                error_message=data.get("error", "") if is_error else "",
            )
        except json.JSONDecodeError:
            # Non-JSON output (text mode or error)
            return InvocationResult(
                content=stdout.strip(),
                raw_output=stdout,
                duration_ms=duration_ms,
                is_error=False,
            )

    def health_check(self) -> bool:
        """Check if Claude CLI is available."""
        import subprocess

        try:
            exec_path = get_executable(self.cli_path)
            result = subprocess.run(
                [exec_path, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
                shell=False,
            )
            return result.returncode == 0
        except Exception:
            return False
