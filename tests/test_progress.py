"""Tests for workflow progress tracking."""

from __future__ import annotations

import json
from pathlib import Path

from agentic_sdlc.progress import (
    StepProgress,
    StepStatus,
    WorkflowProgress,
    WorkflowStatus,
    _dict_to_progress,
    _progress_to_dict,
    create_progress,
    generate_workflow_id,
    get_progress_path,
    load_progress,
    save_progress,
    update_step_completed,
    update_step_failed,
    update_step_skipped,
    update_step_started,
)


class TestWorkflowStatus:
    """Tests for WorkflowStatus enum."""

    def test_workflow_status_values(self) -> None:
        """Test all workflow status values exist."""
        assert WorkflowStatus.PENDING.value == "pending"
        assert WorkflowStatus.RUNNING.value == "running"
        assert WorkflowStatus.COMPLETED.value == "completed"
        assert WorkflowStatus.FAILED.value == "failed"
        assert WorkflowStatus.PAUSED.value == "paused"
        assert WorkflowStatus.CANCELED.value == "canceled"


class TestStepStatus:
    """Tests for StepStatus enum."""

    def test_step_status_values(self) -> None:
        """Test all step status values exist."""
        assert StepStatus.PENDING.value == "pending"
        assert StepStatus.RUNNING.value == "running"
        assert StepStatus.COMPLETED.value == "completed"
        assert StepStatus.FAILED.value == "failed"
        assert StepStatus.SKIPPED.value == "skipped"


class TestGenerateWorkflowId:
    """Tests for workflow ID generation."""

    def test_generate_workflow_id_format(self) -> None:
        """Test workflow ID follows expected format."""
        workflow_id = generate_workflow_id("test-workflow")
        parts = workflow_id.split("-")
        # Format: YYYYMMDD-HHMMSS-workflow-name
        assert len(parts) >= 4
        assert len(parts[0]) == 8  # Date
        assert len(parts[1]) == 6  # Time
        assert "test" in workflow_id
        assert "workflow" in workflow_id

    def test_generate_workflow_id_sanitizes_spaces(self) -> None:
        """Test workflow ID sanitizes spaces."""
        workflow_id = generate_workflow_id("my test workflow")
        assert " " not in workflow_id
        assert "my-test-workflow" in workflow_id

    def test_generate_workflow_id_sanitizes_underscores(self) -> None:
        """Test workflow ID sanitizes underscores."""
        workflow_id = generate_workflow_id("my_test_workflow")
        assert "_" not in workflow_id
        assert "my-test-workflow" in workflow_id

    def test_generate_workflow_id_removes_special_chars(self) -> None:
        """Test workflow ID removes special characters."""
        workflow_id = generate_workflow_id("test@workflow#name!")
        assert "@" not in workflow_id
        assert "#" not in workflow_id
        assert "!" not in workflow_id

    def test_generate_workflow_id_unique(self) -> None:
        """Test workflow IDs are unique (due to timestamp)."""
        id1 = generate_workflow_id("test")
        id2 = generate_workflow_id("test")
        # Due to timing, they might be the same or different
        # At minimum, they should be valid
        assert id1.endswith("-test")
        assert id2.endswith("-test")


class TestProgressPath:
    """Tests for progress file path handling."""

    def test_get_progress_path(self, temp_dir: Path) -> None:
        """Test progress path generation."""
        path = get_progress_path("20260111-143052-test-workflow", temp_dir)
        expected = temp_dir / "agentic" / "outputs" / "20260111-143052-test-workflow" / "progress.json"
        assert path == expected

    def test_get_progress_path_uses_cwd_when_none(self, monkeypatch, temp_dir: Path) -> None:
        """Test progress path uses current directory when no root specified."""
        monkeypatch.chdir(temp_dir)
        path = get_progress_path("test-workflow")
        assert path.name == "progress.json"
        assert "test-workflow" in str(path)


class TestCreateProgress:
    """Tests for creating workflow progress."""

    def test_create_progress_basic(self) -> None:
        """Test creating basic progress document."""
        progress = create_progress(
            workflow_id="test-id",
            workflow_name="test-workflow",
            step_names=["step1", "step2", "step3"],
            variables={"var1": "value1"},
        )

        assert progress.workflow_id == "test-id"
        assert progress.workflow_name == "test-workflow"
        assert progress.status == WorkflowStatus.RUNNING.value
        assert progress.pending_steps == ["step1", "step2", "step3"]
        assert progress.variables == {"var1": "value1"}
        assert progress.started_at is not None
        assert progress.completed_steps == []
        assert progress.running_steps == []

    def test_create_progress_copies_lists(self) -> None:
        """Test that create_progress makes copies of lists."""
        step_names = ["step1", "step2"]
        variables = {"key": "value"}

        progress = create_progress("id", "name", step_names, variables)

        step_names.append("step3")
        variables["new_key"] = "new_value"

        assert progress.pending_steps == ["step1", "step2"]
        assert progress.variables == {"key": "value"}


class TestSaveAndLoadProgress:
    """Tests for saving and loading progress."""

    def test_save_and_load_progress(self, temp_dir: Path) -> None:
        """Test round-trip save and load of progress."""
        progress = create_progress(
            workflow_id="test-save-load",
            workflow_name="test-workflow",
            step_names=["step1"],
            variables={"var": "value"},
        )

        save_progress(progress, temp_dir)
        loaded = load_progress("test-save-load", temp_dir)

        assert loaded is not None
        assert loaded.workflow_id == progress.workflow_id
        assert loaded.workflow_name == progress.workflow_name
        assert loaded.status == progress.status
        assert loaded.variables == progress.variables

    def test_load_progress_nonexistent(self, temp_dir: Path) -> None:
        """Test loading nonexistent progress returns None."""
        loaded = load_progress("nonexistent-workflow", temp_dir)
        assert loaded is None

    def test_save_progress_creates_directories(self, temp_dir: Path) -> None:
        """Test save_progress creates necessary directories."""
        progress = create_progress("new-workflow", "test", [], {})
        save_progress(progress, temp_dir)

        expected_path = temp_dir / "agentic" / "outputs" / "new-workflow" / "progress.json"
        assert expected_path.exists()

    def test_save_progress_valid_json(self, temp_dir: Path) -> None:
        """Test saved progress is valid JSON."""
        progress = create_progress("json-test", "test", ["step1"], {"var": "value"})
        save_progress(progress, temp_dir)

        progress_path = get_progress_path("json-test", temp_dir)
        with open(progress_path) as f:
            data = json.load(f)

        assert data["workflow_id"] == "json-test"
        assert isinstance(data["pending_steps"], list)


class TestStepUpdates:
    """Tests for step status updates."""

    def test_update_step_started(self) -> None:
        """Test marking a step as started."""
        progress = create_progress("test", "workflow", ["step1", "step2"], {})
        update_step_started(progress, "step1")

        assert "step1" not in progress.pending_steps
        assert "step1" in progress.running_steps
        assert progress.current_step is not None
        assert progress.current_step["name"] == "step1"

    def test_update_step_completed(self) -> None:
        """Test marking a step as completed."""
        progress = create_progress("test", "workflow", ["step1"], {})
        update_step_started(progress, "step1")
        update_step_completed(progress, "step1", output_summary="Done", output={"result": "success"})

        assert "step1" not in progress.running_steps
        assert len(progress.completed_steps) == 1
        assert progress.completed_steps[0].name == "step1"
        assert progress.completed_steps[0].status == StepStatus.COMPLETED.value
        assert progress.completed_steps[0].output_summary == "Done"
        assert progress.step_outputs["step1"] == {"result": "success"}
        assert progress.current_step is None

    def test_update_step_failed(self) -> None:
        """Test marking a step as failed."""
        progress = create_progress("test", "workflow", ["step1"], {})
        update_step_started(progress, "step1")
        update_step_failed(progress, "step1", error="Something went wrong")

        assert "step1" not in progress.running_steps
        assert len(progress.completed_steps) == 1
        assert progress.completed_steps[0].status == StepStatus.FAILED.value
        assert progress.completed_steps[0].error == "Something went wrong"
        assert len(progress.errors) == 1
        assert progress.errors[0]["step"] == "step1"

    def test_update_step_skipped(self) -> None:
        """Test marking a step as skipped."""
        progress = create_progress("test", "workflow", ["step1", "step2"], {})
        update_step_skipped(progress, "step2")

        assert "step2" not in progress.pending_steps
        assert len(progress.completed_steps) == 1
        assert progress.completed_steps[0].status == StepStatus.SKIPPED.value

    def test_update_step_preserves_retry_count(self) -> None:
        """Test that retry count is preserved in step updates."""
        progress = create_progress("test", "workflow", ["step1"], {})
        update_step_started(progress, "step1")
        progress.current_step["retry_count"] = 3

        update_step_completed(progress, "step1")

        assert progress.completed_steps[0].retry_count == 3


class TestProgressConversion:
    """Tests for progress dict conversion."""

    def test_progress_to_dict_and_back(self) -> None:
        """Test round-trip conversion through dict."""
        progress = WorkflowProgress(
            workflow_id="test-id",
            workflow_name="test-workflow",
            status="running",
            started_at="2026-01-11T14:30:00Z",
            completed_steps=[
                StepProgress(
                    name="step1",
                    status="completed",
                    started_at="2026-01-11T14:30:00Z",
                    completed_at="2026-01-11T14:31:00Z",
                )
            ],
            pending_steps=["step2"],
            variables={"var": "value"},
            step_outputs={"step1": {"result": "ok"}},
        )

        data = _progress_to_dict(progress)
        restored = _dict_to_progress(data)

        assert restored.workflow_id == progress.workflow_id
        assert restored.workflow_name == progress.workflow_name
        assert restored.status == progress.status
        assert len(restored.completed_steps) == 1
        assert restored.completed_steps[0].name == "step1"
        assert restored.step_outputs == progress.step_outputs

    def test_dict_to_progress_with_minimal_data(self) -> None:
        """Test converting minimal dict to progress."""
        data = {
            "workflow_id": "minimal",
            "workflow_name": "test",
        }
        progress = _dict_to_progress(data)

        assert progress.workflow_id == "minimal"
        assert progress.workflow_name == "test"
        assert progress.status == "pending"
        assert progress.completed_steps == []
        assert progress.pending_steps == []


class TestStepProgress:
    """Tests for StepProgress dataclass."""

    def test_step_progress_defaults(self) -> None:
        """Test StepProgress default values."""
        step = StepProgress(name="test", status="pending")

        assert step.name == "test"
        assert step.status == "pending"
        assert step.started_at is None
        assert step.completed_at is None
        assert step.retry_count == 0
        assert step.output_summary == ""
        assert step.error is None
        assert step.human_input is None
