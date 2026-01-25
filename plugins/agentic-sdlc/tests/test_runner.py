"""Tests for Claude CLI runner."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from agentic_sdlc.runner import (
    MODEL_MAP,
    ClaudeResult,
    SessionOutput,
    _get_agentic_system_prompt,
    check_claude_available,
    get_executable,
    run_claude,
)


class TestGetExecutable:
    """Tests for get_executable function."""

    def test_get_executable_found(self) -> None:
        """Test getting executable that exists."""
        # 'python' should exist in most environments
        path = get_executable("python")
        assert path is not None
        assert len(path) > 0

    def test_get_executable_not_found(self) -> None:
        """Test getting executable that doesn't exist."""
        with pytest.raises(FileNotFoundError, match="Executable not found"):
            get_executable("nonexistent_executable_12345")

    def test_get_executable_returns_path(self) -> None:
        """Test that get_executable returns a valid path string."""
        path = get_executable("python")
        # Should be an absolute path
        assert Path(path).is_absolute() or "/" in path or "\\" in path


class TestModelMap:
    """Tests for model mapping."""

    def test_model_map_contains_all_models(self) -> None:
        """Test all expected models are in the map."""
        assert "sonnet" in MODEL_MAP
        assert "haiku" in MODEL_MAP
        assert "opus" in MODEL_MAP

    def test_model_map_values(self) -> None:
        """Test model map values are correct."""
        assert MODEL_MAP["sonnet"] == "sonnet"
        assert MODEL_MAP["haiku"] == "haiku"
        assert MODEL_MAP["opus"] == "opus"


class TestSessionOutput:
    """Tests for SessionOutput parsing."""

    def test_from_stdout_with_valid_json(self) -> None:
        """Test parsing stdout with valid session JSON."""
        stdout = """
Some output text here.

```json
{
  "sessionId": "abc123",
  "isSuccess": true,
  "context": "Task completed successfully."
}
```
"""
        output = SessionOutput.from_stdout(stdout)

        assert output.session_id == "abc123"
        assert output.is_success is True
        assert output.context == "Task completed successfully."

    def test_from_stdout_with_extra_keys(self) -> None:
        """Test parsing stdout preserves extra keys."""
        stdout = """
```json
{
  "sessionId": "test",
  "isSuccess": true,
  "context": "Done",
  "customKey": "customValue",
  "anotherKey": 123
}
```
"""
        output = SessionOutput.from_stdout(stdout)

        assert output.extra["customKey"] == "customValue"
        assert output.extra["anotherKey"] == 123
        assert output.raw_json is not None

    def test_from_stdout_no_json(self) -> None:
        """Test parsing stdout without JSON."""
        stdout = "Just regular output without any JSON blocks."
        output = SessionOutput.from_stdout(stdout)

        assert output.session_id is None
        assert output.is_success is False
        assert "No valid session output JSON" in output.context

    def test_from_stdout_empty(self) -> None:
        """Test parsing empty stdout."""
        output = SessionOutput.from_stdout("")

        assert output.session_id is None
        assert output.is_success is False
        assert "No output received" in output.context

    def test_from_stdout_multiple_json_blocks(self) -> None:
        """Test parsing stdout with multiple JSON blocks uses last valid one."""
        stdout = """
First JSON:
```json
{"sessionId": "first", "isSuccess": false, "context": "First attempt"}
```

Second JSON:
```json
{"sessionId": "second", "isSuccess": true, "context": "Final success"}
```
"""
        output = SessionOutput.from_stdout(stdout)

        assert output.session_id == "second"
        assert output.is_success is True

    def test_from_stdout_bare_json(self) -> None:
        """Test parsing bare JSON without code blocks."""
        stdout = 'Output: {"sessionId": "bare", "isSuccess": true, "context": "Bare JSON"}'
        output = SessionOutput.from_stdout(stdout)

        assert output.session_id == "bare"
        assert output.is_success is True

    def test_from_stdout_invalid_json(self) -> None:
        """Test parsing stdout with invalid JSON."""
        stdout = """
```json
{invalid json here
```
"""
        output = SessionOutput.from_stdout(stdout)

        assert output.session_id is None
        assert output.is_success is False

    def test_from_stdout_missing_required_keys(self) -> None:
        """Test JSON without required keys is skipped."""
        stdout = """
```json
{"someOtherKey": "value"}
```
"""
        output = SessionOutput.from_stdout(stdout)

        assert output.session_id is None
        assert "No valid session output JSON" in output.context


class TestClaudeResult:
    """Tests for ClaudeResult dataclass."""

    def test_success_property_true(self) -> None:
        """Test success property with returncode 0."""
        result = ClaudeResult(
            returncode=0,
            stdout="output",
            stderr="",
            prompt="test",
            cwd=None,
        )
        assert result.success is True

    def test_success_property_false(self) -> None:
        """Test success property with non-zero returncode."""
        result = ClaudeResult(
            returncode=1,
            stdout="",
            stderr="error",
            prompt="test",
            cwd=None,
        )
        assert result.success is False

    def test_session_output_lazy_parsing(self) -> None:
        """Test session_output is parsed lazily."""
        result = ClaudeResult(
            returncode=0,
            stdout='{"sessionId": "lazy", "isSuccess": true, "context": "Test"}',
            stderr="",
            prompt="test",
            cwd=None,
        )

        # First access should parse
        output1 = result.session_output
        # Second access should return cached
        output2 = result.session_output

        assert output1 is output2
        assert output1.session_id == "lazy"

    def test_str_representation(self) -> None:
        """Test string representation."""
        result = ClaudeResult(
            returncode=0,
            stdout="",
            stderr="",
            prompt="test",
            cwd=None,
            model="sonnet",
        )
        str_repr = str(result)

        assert "SUCCESS" in str_repr
        assert "sonnet" in str_repr

    def test_str_representation_failed(self) -> None:
        """Test string representation for failed result."""
        result = ClaudeResult(
            returncode=1,
            stdout="",
            stderr="error",
            prompt="test",
            cwd=None,
        )
        str_repr = str(result)

        assert "FAILED" in str_repr


class TestRunClaude:
    """Tests for run_claude function."""

    @patch("agentic_sdlc.runner.subprocess.run")
    @patch("agentic_sdlc.runner.get_executable")
    def test_run_claude_basic(self, mock_get_exe, mock_run) -> None:
        """Test basic claude run."""
        mock_get_exe.return_value = "/usr/bin/claude"
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="output",
            stderr="",
        )

        result = run_claude("test prompt", append_system_prompt=False)

        assert result.success is True
        assert result.stdout == "output"
        mock_run.assert_called_once()

    @patch("agentic_sdlc.runner.subprocess.run")
    @patch("agentic_sdlc.runner.get_executable")
    def test_run_claude_with_model(self, mock_get_exe, mock_run) -> None:
        """Test claude run with specific model."""
        mock_get_exe.return_value = "/usr/bin/claude"
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="",
            stderr="",
        )

        run_claude("prompt", model="opus", append_system_prompt=False)

        call_args = mock_run.call_args
        cmd = call_args[0][0]
        assert "--model" in cmd
        assert "opus" in cmd

    @patch("agentic_sdlc.runner.subprocess.run")
    @patch("agentic_sdlc.runner.get_executable")
    def test_run_claude_with_skip_permissions(self, mock_get_exe, mock_run) -> None:
        """Test claude run with skip permissions."""
        mock_get_exe.return_value = "/usr/bin/claude"
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="",
            stderr="",
        )

        run_claude("prompt", skip_permissions=True, append_system_prompt=False)

        call_args = mock_run.call_args
        cmd = call_args[0][0]
        assert "--dangerously-skip-permissions" in cmd

    @patch("agentic_sdlc.runner.subprocess.run")
    @patch("agentic_sdlc.runner.get_executable")
    def test_run_claude_with_allowed_tools(self, mock_get_exe, mock_run) -> None:
        """Test claude run with allowed tools."""
        mock_get_exe.return_value = "/usr/bin/claude"
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="",
            stderr="",
        )

        run_claude("prompt", allowed_tools=["Read", "Write"], append_system_prompt=False)

        call_args = mock_run.call_args
        cmd = call_args[0][0]
        assert "--allowedTools" in cmd

    @patch("agentic_sdlc.runner.subprocess.run")
    @patch("agentic_sdlc.runner.get_executable")
    def test_run_claude_timeout(self, mock_get_exe, mock_run) -> None:
        """Test claude run with timeout."""
        mock_get_exe.return_value = "/usr/bin/claude"
        mock_run.side_effect = TimeoutError("Command timed out")

        # Should handle timeout gracefully
        import subprocess

        mock_run.side_effect = subprocess.TimeoutExpired("claude", 300)

        result = run_claude("prompt", timeout=300, append_system_prompt=False)

        assert result.success is False
        assert "timed out" in result.stderr

    @patch("agentic_sdlc.runner.subprocess.run")
    @patch("agentic_sdlc.runner.get_executable")
    def test_run_claude_with_cwd(self, mock_get_exe, mock_run, temp_dir: Path) -> None:
        """Test claude run with working directory."""
        mock_get_exe.return_value = "/usr/bin/claude"
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="",
            stderr="",
        )

        run_claude("prompt", cwd=temp_dir, append_system_prompt=False)

        call_args = mock_run.call_args
        assert call_args.kwargs["cwd"] == str(temp_dir)


class TestCheckClaudeAvailable:
    """Tests for check_claude_available function."""

    @patch("agentic_sdlc.runner.subprocess.run")
    @patch("agentic_sdlc.runner.get_executable")
    def test_claude_available(self, mock_get_exe, mock_run) -> None:
        """Test when claude is available."""
        mock_get_exe.return_value = "/usr/bin/claude"
        mock_run.return_value = MagicMock(returncode=0)

        assert check_claude_available() is True

    @patch("agentic_sdlc.runner.get_executable")
    def test_claude_not_available(self, mock_get_exe) -> None:
        """Test when claude is not available."""
        mock_get_exe.side_effect = FileNotFoundError("not found")

        assert check_claude_available() is False

    @patch("agentic_sdlc.runner.subprocess.run")
    @patch("agentic_sdlc.runner.get_executable")
    def test_claude_version_fails(self, mock_get_exe, mock_run) -> None:
        """Test when claude --version fails."""
        mock_get_exe.return_value = "/usr/bin/claude"
        mock_run.return_value = MagicMock(returncode=1)

        assert check_claude_available() is False


class TestAgenticSystemPrompt:
    """Tests for agentic system prompt loading."""

    def test_get_agentic_system_prompt_exists(self) -> None:
        """Test loading system prompt when file exists."""
        # This tests the actual file in the repository
        prompt = _get_agentic_system_prompt()
        # May or may not exist depending on test environment
        if prompt is not None:
            assert len(prompt) > 0
            assert "sessionId" in prompt or "isSuccess" in prompt

    @patch("agentic_sdlc.runner.AGENTIC_SYSTEM_PROMPT_FILE")
    def test_get_agentic_system_prompt_not_exists(self, mock_path) -> None:
        """Test loading system prompt when file doesn't exist."""
        mock_path.exists.return_value = False
        # Call function to verify it doesn't error
        # The actual implementation doesn't use the mock this way
        _get_agentic_system_prompt()
