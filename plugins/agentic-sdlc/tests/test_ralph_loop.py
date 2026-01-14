"""Tests for Ralph Wiggum loop state management."""

from __future__ import annotations

from pathlib import Path

from agentic_sdlc.ralph_loop import (
    CompletionResult,
    _parse_ralph_state,
    build_ralph_system_message,
    create_ralph_state,
    deactivate_ralph_state,
    delete_ralph_state,
    detect_completion_promise,
    get_ralph_state_path,
    load_ralph_state,
    update_ralph_iteration,
)


class TestRalphStatePath:
    """Tests for ralph state file path handling."""

    def test_get_ralph_state_path_format(self, temp_dir: Path) -> None:
        """Test ralph state path follows expected format."""
        path = get_ralph_state_path("workflow-123", "apply-fixes", temp_dir)
        expected = temp_dir / "agentic" / "outputs" / "workflow-123" / "ralph-apply-fixes.md"
        assert path == expected

    def test_get_ralph_state_path_sanitizes_special_chars(self, temp_dir: Path) -> None:
        """Test special characters in step name are sanitized."""
        path = get_ralph_state_path("workflow", "step/with:special@chars", temp_dir)
        assert "/" not in path.name
        assert ":" not in path.name
        assert "@" not in path.name


class TestCreateRalphState:
    """Tests for creating ralph loop state."""

    def test_create_ralph_state_basic(self, temp_dir: Path) -> None:
        """Test creating basic ralph state."""
        state = create_ralph_state(
            workflow_id="test-workflow",
            step_name="apply-fixes",
            prompt="Fix the issues",
            max_iterations=10,
            completion_promise="FIXES_COMPLETE",
            repo_root=temp_dir,
        )

        assert state.active is True
        assert state.iteration == 1
        assert state.max_iterations == 10
        assert state.completion_promise == "FIXES_COMPLETE"
        assert state.prompt == "Fix the issues"
        assert state.started_at is not None

    def test_create_ralph_state_saves_file(self, temp_dir: Path) -> None:
        """Test that create_ralph_state saves file."""
        create_ralph_state(
            workflow_id="save-test",
            step_name="test-step",
            prompt="Test prompt",
            max_iterations=5,
            completion_promise="DONE",
            repo_root=temp_dir,
        )

        state_path = get_ralph_state_path("save-test", "test-step", temp_dir)
        assert state_path.exists()
        content = state_path.read_text()
        assert "active: true" in content
        assert "iteration: 1" in content


class TestLoadRalphState:
    """Tests for loading ralph loop state."""

    def test_load_ralph_state_existing(self, temp_dir: Path) -> None:
        """Test loading existing ralph state."""
        create_ralph_state(
            workflow_id="load-test",
            step_name="test-step",
            prompt="Original prompt",
            max_iterations=10,
            completion_promise="COMPLETE",
            repo_root=temp_dir,
        )

        loaded = load_ralph_state("load-test", "test-step", temp_dir)

        assert loaded is not None
        assert loaded.active is True
        assert loaded.iteration == 1
        assert loaded.max_iterations == 10
        assert loaded.completion_promise == "COMPLETE"
        assert loaded.prompt == "Original prompt"

    def test_load_ralph_state_nonexistent(self, temp_dir: Path) -> None:
        """Test loading nonexistent state returns None."""
        loaded = load_ralph_state("nonexistent", "step", temp_dir)
        assert loaded is None


class TestUpdateRalphIteration:
    """Tests for updating ralph loop iteration."""

    def test_update_ralph_iteration_increments(self, temp_dir: Path) -> None:
        """Test iteration counter increments."""
        create_ralph_state(
            workflow_id="update-test",
            step_name="test-step",
            prompt="Test",
            max_iterations=10,
            completion_promise="DONE",
            repo_root=temp_dir,
        )

        state = update_ralph_iteration("update-test", "test-step", temp_dir)

        assert state is not None
        assert state.iteration == 2

    def test_update_ralph_iteration_persists(self, temp_dir: Path) -> None:
        """Test iteration update is persisted to file."""
        create_ralph_state(
            workflow_id="persist-test",
            step_name="test-step",
            prompt="Test",
            max_iterations=10,
            completion_promise="DONE",
            repo_root=temp_dir,
        )

        update_ralph_iteration("persist-test", "test-step", temp_dir)
        loaded = load_ralph_state("persist-test", "test-step", temp_dir)

        assert loaded is not None
        assert loaded.iteration == 2

    def test_update_ralph_iteration_nonexistent(self, temp_dir: Path) -> None:
        """Test updating nonexistent state returns None."""
        result = update_ralph_iteration("nonexistent", "step", temp_dir)
        assert result is None


class TestDeactivateRalphState:
    """Tests for deactivating ralph state."""

    def test_deactivate_ralph_state(self, temp_dir: Path) -> None:
        """Test deactivating ralph state."""
        create_ralph_state(
            workflow_id="deactivate-test",
            step_name="test-step",
            prompt="Test",
            max_iterations=10,
            completion_promise="DONE",
            repo_root=temp_dir,
        )

        deactivate_ralph_state("deactivate-test", "test-step", temp_dir)
        loaded = load_ralph_state("deactivate-test", "test-step", temp_dir)

        assert loaded is not None
        assert loaded.active is False


class TestDeleteRalphState:
    """Tests for deleting ralph state."""

    def test_delete_ralph_state(self, temp_dir: Path) -> None:
        """Test deleting ralph state file."""
        create_ralph_state(
            workflow_id="delete-test",
            step_name="test-step",
            prompt="Test",
            max_iterations=10,
            completion_promise="DONE",
            repo_root=temp_dir,
        )

        state_path = get_ralph_state_path("delete-test", "test-step", temp_dir)
        assert state_path.exists()

        delete_ralph_state("delete-test", "test-step", temp_dir)
        assert not state_path.exists()

    def test_delete_ralph_state_nonexistent(self, temp_dir: Path) -> None:
        """Test deleting nonexistent state doesn't raise."""
        # Should not raise
        delete_ralph_state("nonexistent", "step", temp_dir)


class TestParseRalphState:
    """Tests for parsing ralph state from markdown."""

    def test_parse_ralph_state_valid(self) -> None:
        """Test parsing valid markdown with frontmatter."""
        content = """---
active: true
iteration: 3
max_iterations: 10
completion_promise: COMPLETE
started_at: "2026-01-11T14:30:00Z"
---

# Ralph Loop Prompt

Fix all the bugs in the codebase.
"""
        state = _parse_ralph_state(content)

        assert state is not None
        assert state.active is True
        assert state.iteration == 3
        assert state.max_iterations == 10
        assert state.completion_promise == "COMPLETE"
        assert state.prompt == "Fix all the bugs in the codebase."

    def test_parse_ralph_state_no_frontmatter(self) -> None:
        """Test parsing content without frontmatter returns None."""
        content = "Just plain text without frontmatter"
        state = _parse_ralph_state(content)
        assert state is None

    def test_parse_ralph_state_incomplete_frontmatter(self) -> None:
        """Test parsing with incomplete frontmatter."""
        content = """---
active: true
---"""
        state = _parse_ralph_state(content)
        # Should still parse with defaults
        assert state is not None
        assert state.active is True
        assert state.iteration == 1
        assert state.max_iterations == 5


class TestDetectCompletionPromise:
    """Tests for completion promise detection."""

    def test_detect_completion_json_block(self) -> None:
        """Test detecting completion in JSON code block."""
        output = """
I've completed the task.

```json
{
  "ralph_complete": true,
  "promise": "COMPLETED"
}
```
"""
        result = detect_completion_promise(output, "COMPLETED")

        assert result.is_complete is True
        assert result.promise_matched is True
        assert result.promise_value == "COMPLETED"

    def test_detect_completion_plain_code_block(self) -> None:
        """Test detecting completion in plain code block."""
        output = """
Done!

```
{"ralph_complete": true, "promise": "DONE"}
```
"""
        result = detect_completion_promise(output, "DONE")

        assert result.is_complete is True
        assert result.promise_matched is True

    def test_detect_completion_raw_json(self) -> None:
        """Test detecting completion in raw JSON."""
        output = 'The task is done. {"ralph_complete": true, "promise": "FINISHED"}'
        result = detect_completion_promise(output, "FINISHED")

        assert result.is_complete is True
        assert result.promise_matched is True

    def test_detect_completion_wrong_promise(self) -> None:
        """Test detecting completion with wrong promise."""
        output = """
```json
{"ralph_complete": true, "promise": "WRONG_PROMISE"}
```
"""
        result = detect_completion_promise(output, "EXPECTED_PROMISE")

        assert result.is_complete is True
        assert result.promise_matched is False
        assert result.promise_value == "WRONG_PROMISE"

    def test_detect_completion_not_complete(self) -> None:
        """Test detecting ralph_complete: false."""
        output = """
```json
{"ralph_complete": false, "promise": "DONE"}
```
"""
        result = detect_completion_promise(output, "DONE")

        assert result.is_complete is False
        assert result.promise_matched is False

    def test_detect_completion_no_json(self) -> None:
        """Test output without any JSON."""
        output = "Just some regular output without any JSON"
        result = detect_completion_promise(output, "DONE")

        assert result.is_complete is False
        assert result.promise_matched is False
        assert result.promise_value is None

    def test_detect_completion_case_insensitive(self) -> None:
        """Test promise matching is case insensitive."""
        output = '{"ralph_complete": true, "promise": "completed"}'
        result = detect_completion_promise(output, "COMPLETED")

        assert result.is_complete is True
        assert result.promise_matched is True

    def test_detect_completion_invalid_json(self) -> None:
        """Test handling invalid JSON gracefully."""
        output = """
```json
{invalid json here}
```
"""
        result = detect_completion_promise(output, "DONE")

        assert result.is_complete is False

    def test_detect_completion_output_preserved(self) -> None:
        """Test that original output is preserved in result."""
        output = "Full output text here"
        result = detect_completion_promise(output, "DONE")

        assert result.output == output


class TestBuildRalphSystemMessage:
    """Tests for building ralph system message."""

    def test_build_ralph_system_message_format(self) -> None:
        """Test system message format."""
        message = build_ralph_system_message(3, 10, "COMPLETE")

        assert "Iteration 3/10" in message
        assert "COMPLETE" in message
        assert "ralph_complete" in message
        assert "7 iterations remaining" in message

    def test_build_ralph_system_message_first_iteration(self) -> None:
        """Test system message for first iteration."""
        message = build_ralph_system_message(1, 5, "DONE")

        assert "Iteration 1/5" in message
        assert "4 iterations remaining" in message

    def test_build_ralph_system_message_last_iteration(self) -> None:
        """Test system message for last iteration."""
        message = build_ralph_system_message(10, 10, "FINISHED")

        assert "Iteration 10/10" in message
        assert "0 iterations remaining" in message


class TestCompletionResult:
    """Tests for CompletionResult dataclass."""

    def test_completion_result_defaults(self) -> None:
        """Test CompletionResult defaults."""
        result = CompletionResult(
            is_complete=False,
            promise_matched=False,
            promise_value=None,
            output="test output",
        )

        assert result.is_complete is False
        assert result.promise_matched is False
        assert result.promise_value is None
        assert result.output == "test output"

    def test_completion_result_success(self) -> None:
        """Test successful completion result."""
        result = CompletionResult(
            is_complete=True,
            promise_matched=True,
            promise_value="DONE",
            output="completed",
        )

        assert result.is_complete is True
        assert result.promise_matched is True
        assert result.promise_value == "DONE"
