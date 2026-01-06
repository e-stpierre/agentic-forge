"""Base interface for AI CLI providers."""

import subprocess
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class ProviderCapabilities:
    """Capabilities supported by a provider."""

    session_resume: bool = False
    json_output: bool = False
    tool_restrictions: bool = False
    system_prompt: bool = True
    model_selection: bool = True


@dataclass
class InvocationResult:
    """Standardized result from any provider invocation."""

    content: str
    session_id: Optional[str] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    duration_ms: Optional[int] = None
    raw_output: str = ""
    is_error: bool = False
    error_message: str = ""


class CLIProvider(ABC):
    """Abstract base class for AI CLI providers."""

    name: str = "base"
    capabilities: ProviderCapabilities = field(default_factory=ProviderCapabilities)

    @abstractmethod
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
        """Build the CLI command for this provider.

        Args:
            prompt: The main prompt to send to the AI
            system_prompt: Optional system prompt to prepend
            session_id: Optional session ID for resuming conversations
            model: Optional model override
            tools: Optional list of allowed tools
            working_dir: Working directory for the command
            timeout: Command timeout in seconds
            json_output: Whether to request JSON output format

        Returns:
            List of command arguments
        """
        pass

    @abstractmethod
    def parse_output(
        self,
        stdout: str,
        stderr: str,
        return_code: int,
        duration_ms: int,
    ) -> InvocationResult:
        """Parse the CLI output into a standardized result.

        Args:
            stdout: Standard output from the command
            stderr: Standard error from the command
            return_code: Process return code
            duration_ms: Duration of the command in milliseconds

        Returns:
            Standardized InvocationResult
        """
        pass

    def invoke(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        model: Optional[str] = None,
        tools: Optional[list[str]] = None,
        working_dir: Optional[Path] = None,
        timeout: int = 300,
        json_output: bool = True,
    ) -> InvocationResult:
        """Invoke the CLI and return result.

        Args:
            prompt: The main prompt to send
            system_prompt: Optional system prompt
            session_id: Optional session ID for resume
            model: Optional model override
            tools: Optional list of allowed tools
            working_dir: Working directory
            timeout: Timeout in seconds
            json_output: Request JSON output format

        Returns:
            InvocationResult with response content and metadata
        """
        cmd = self.build_command(
            prompt=prompt,
            system_prompt=system_prompt,
            session_id=session_id,
            model=model,
            tools=tools,
            working_dir=working_dir,
            timeout=timeout,
            json_output=json_output,
        )

        cwd = working_dir or Path.cwd()

        start = time.time()
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=str(cwd),
                timeout=timeout,
                shell=True,  # Required on Windows for PATH resolution
            )
            duration_ms = int((time.time() - start) * 1000)

            return self.parse_output(
                result.stdout,
                result.stderr,
                result.returncode,
                duration_ms,
            )
        except subprocess.TimeoutExpired:
            return InvocationResult(
                content="",
                is_error=True,
                error_message=f"Command timed out after {timeout}s",
                duration_ms=int((time.time() - start) * 1000),
            )
        except FileNotFoundError:
            return InvocationResult(
                content="",
                is_error=True,
                error_message=f"CLI not found: {cmd[0]}. Is it installed?",
                duration_ms=int((time.time() - start) * 1000),
            )
        except Exception as e:
            return InvocationResult(
                content="",
                is_error=True,
                error_message=str(e),
                duration_ms=int((time.time() - start) * 1000),
            )

    def health_check(self) -> bool:
        """Check if the provider CLI is available.

        Returns:
            True if the CLI is available and working
        """
        try:
            cmd = self.build_command(
                prompt="Say 'ok'",
                timeout=30,
                json_output=True,
            )
            result = subprocess.run(
                [cmd[0], "--version"],
                capture_output=True,
                text=True,
                timeout=10,
                shell=True,  # Required on Windows for PATH resolution
            )
            return result.returncode == 0
        except Exception:
            return False
