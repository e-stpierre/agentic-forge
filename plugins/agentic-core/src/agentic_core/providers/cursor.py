"""Cursor CLI provider implementation."""

import json
from pathlib import Path
from typing import Optional

from agentic_core.providers.base import CLIProvider, InvocationResult, ProviderCapabilities


class CursorProvider(CLIProvider):
    """Cursor CLI provider.

    Supports the cursor-agent CLI with features:
    - Session resume
    - JSON output format
    - System prompt (embedded in prompt)
    - Model selection
    """

    name = "cursor"
    capabilities = ProviderCapabilities(
        session_resume=True,
        json_output=True,
        tool_restrictions=False,  # Cursor doesn't support tool restrictions
        system_prompt=True,
        model_selection=True,
    )

    def __init__(self, cli_path: str = "cursor-agent"):
        """Initialize Cursor provider.

        Args:
            cli_path: Path to the cursor-agent CLI executable
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
    ) -> list[str]:
        """Build Cursor CLI command.

        Example output:
            cursor-agent -p "Fix the bug" --model gpt-4
        """
        # Embed system prompt in the main prompt if provided
        full_prompt = prompt
        if system_prompt:
            full_prompt = f"{system_prompt}\n\n{prompt}"

        cmd = [self.cli_path, "-p", full_prompt]

        if json_output:
            cmd.extend(["--output-format", "json"])

        if session_id:
            cmd.extend(["--resume", session_id])

        if model:
            cmd.extend(["--model", model])

        # Note: tools parameter is ignored as Cursor doesn't support it

        return cmd

    def parse_output(
        self,
        stdout: str,
        stderr: str,
        return_code: int,
        duration_ms: int,
    ) -> InvocationResult:
        """Parse Cursor CLI output.

        Assumes similar JSON format to Claude CLI.
        """
        if return_code != 0:
            return InvocationResult(
                content="",
                raw_output=stdout,
                is_error=True,
                error_message=stderr or f"Cursor CLI exited with code {return_code}",
                duration_ms=duration_ms,
            )

        try:
            data = json.loads(stdout)

            # Extract token usage if available
            usage = data.get("usage", {})
            tokens_in = usage.get("input_tokens", 0) or usage.get("prompt_tokens", 0)
            tokens_out = usage.get("output_tokens", 0) or usage.get("completion_tokens", 0)

            is_error = data.get("is_error", False) or data.get("error") is not None

            return InvocationResult(
                content=data.get("result", data.get("content", "")),
                session_id=data.get("session_id"),
                tokens_in=tokens_in if tokens_in > 0 else None,
                tokens_out=tokens_out if tokens_out > 0 else None,
                duration_ms=data.get("duration_ms", duration_ms),
                raw_output=stdout,
                is_error=is_error,
                error_message=data.get("error", "") if is_error else "",
            )
        except json.JSONDecodeError:
            # Non-JSON output
            return InvocationResult(
                content=stdout.strip(),
                raw_output=stdout,
                duration_ms=duration_ms,
                is_error=False,
            )

    def health_check(self) -> bool:
        """Check if Cursor CLI is available."""
        import subprocess

        try:
            result = subprocess.run(
                [self.cli_path, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.returncode == 0
        except Exception:
            return False
