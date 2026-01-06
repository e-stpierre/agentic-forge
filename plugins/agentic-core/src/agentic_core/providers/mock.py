"""Mock provider for testing."""

import hashlib
import json
import time
from pathlib import Path
from typing import Callable, Optional
from uuid import uuid4

from agentic_core.providers.base import CLIProvider, InvocationResult, ProviderCapabilities


class MockProvider(CLIProvider):
    """Mock provider for testing without real AI CLIs.

    Features:
    - Deterministic responses based on prompt patterns
    - Configurable latency simulation
    - Error simulation
    - Session tracking
    """

    name = "mock"
    capabilities = ProviderCapabilities(
        session_resume=True,
        json_output=True,
        tool_restrictions=True,
        system_prompt=True,
        model_selection=True,
    )

    def __init__(
        self,
        latency_ms: int = 100,
        error_rate: float = 0.0,
        response_fn: Optional[Callable[[str], str]] = None,
    ):
        """Initialize mock provider.

        Args:
            latency_ms: Simulated latency in milliseconds
            error_rate: Probability of returning an error (0.0-1.0)
            response_fn: Optional custom response function
        """
        self.latency_ms = latency_ms
        self.error_rate = error_rate
        self.response_fn = response_fn
        self._sessions: dict[str, list[str]] = {}  # session_id -> prompts

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
        """Build mock command (not actually executed)."""
        return ["mock-cli", "--print"], prompt

    def parse_output(
        self,
        stdout: str,
        stderr: str,
        return_code: int,
        duration_ms: int,
    ) -> InvocationResult:
        """Parse mock output (not used in mock mode)."""
        return InvocationResult(content=stdout, duration_ms=duration_ms)

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
        """Generate mock response without subprocess."""
        import random

        start = time.time()

        # Simulate latency
        time.sleep(self.latency_ms / 1000)

        # Simulate errors
        if random.random() < self.error_rate:
            return InvocationResult(
                content="",
                is_error=True,
                error_message="Simulated error from mock provider",
                duration_ms=int((time.time() - start) * 1000),
            )

        # Track session
        if session_id is None:
            session_id = str(uuid4())
        if session_id not in self._sessions:
            self._sessions[session_id] = []
        self._sessions[session_id].append(prompt)

        # Generate response
        if self.response_fn:
            content = self.response_fn(prompt)
        else:
            content = self._default_response(prompt, system_prompt)

        # Estimate tokens (rough approximation)
        full_prompt = f"{system_prompt}\n{prompt}" if system_prompt else prompt
        tokens_in = len(full_prompt.split()) * 1.3
        tokens_out = len(content.split()) * 1.3

        return InvocationResult(
            content=content,
            session_id=session_id,
            tokens_in=int(tokens_in),
            tokens_out=int(tokens_out),
            duration_ms=int((time.time() - start) * 1000),
            raw_output=json.dumps({"result": content, "session_id": session_id}),
            is_error=False,
        )

    def _default_response(self, prompt: str, system_prompt: Optional[str]) -> str:
        """Generate deterministic default response based on prompt."""
        prompt_lower = prompt.lower()

        # Pattern-based responses
        if "fix" in prompt_lower and "bug" in prompt_lower:
            return "I've analyzed the code and fixed the bug. The issue was in the error handling logic. Here's the fix:\n\n```python\n# Fixed error handling\ntry:\n    result = process_data()\nexcept ValueError as e:\n    logger.error(f'Invalid data: {e}')\n    return None\n```"

        if "implement" in prompt_lower or "add" in prompt_lower:
            return "I've implemented the requested feature. Here's a summary of the changes:\n\n1. Added new function `handle_feature()`\n2. Updated tests to cover new functionality\n3. Updated documentation\n\nThe implementation follows the existing patterns in the codebase."

        if "test" in prompt_lower:
            return "All tests pass. Here's the test output:\n\n```\n✓ test_basic_functionality\n✓ test_edge_cases\n✓ test_error_handling\n\n3 tests passed, 0 failed\n```"

        if "review" in prompt_lower:
            return "Code review complete. The code looks good overall with a few suggestions:\n\n1. Consider adding error handling for edge cases\n2. The function could be more readable with type hints\n3. Tests coverage could be improved"

        if "plan" in prompt_lower:
            return "Here's the implementation plan:\n\n## Tasks\n1. Analyze requirements\n2. Design solution architecture\n3. Implement core functionality\n4. Write tests\n5. Update documentation\n\n## Considerations\n- Backward compatibility\n- Performance implications\n- Security review needed"

        # Default: echo back a summary
        prompt_hash = hashlib.md5(prompt.encode()).hexdigest()[:8]
        return f"Mock response for prompt ({prompt_hash}): Task acknowledged and completed successfully."

    def health_check(self) -> bool:
        """Mock provider is always healthy."""
        return True

    def get_session_history(self, session_id: str) -> list[str]:
        """Get the prompt history for a session (testing utility)."""
        return self._sessions.get(session_id, [])

    def clear_sessions(self) -> None:
        """Clear all session data (testing utility)."""
        self._sessions.clear()
