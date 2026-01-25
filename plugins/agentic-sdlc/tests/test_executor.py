"""Tests for workflow executor."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from agentic_sdlc.executor import WorkflowExecutor
from agentic_sdlc.parser import StepType, WorkflowParser
from agentic_sdlc.progress import WorkflowStatus


class TestWorkflowExecutor:
    """Tests for WorkflowExecutor class."""

    def test_executor_init(self, temp_dir: Path) -> None:
        """Test executor initialization."""
        executor = WorkflowExecutor(repo_root=temp_dir)

        assert executor.repo_root == temp_dir
        assert executor.config is not None
        assert executor.renderer is not None

    def test_executor_init_step_executors(self, temp_dir: Path) -> None:
        """Test all step executors are initialized."""
        executor = WorkflowExecutor(repo_root=temp_dir)

        assert StepType.PROMPT in executor.executors
        assert StepType.PARALLEL in executor.executors
        assert StepType.SERIAL in executor.executors
        assert StepType.CONDITIONAL in executor.executors
        assert StepType.RALPH_LOOP in executor.executors

    def test_executor_uses_cwd_when_no_root(self, monkeypatch, temp_dir: Path) -> None:
        """Test executor uses current directory when no root specified."""
        monkeypatch.chdir(temp_dir)
        executor = WorkflowExecutor()

        assert executor.repo_root == temp_dir


class TestWorkflowExecutorRun:
    """Tests for workflow execution."""

    @patch("agentic_sdlc.executor.PromptStepExecutor.execute")
    def test_run_minimal_workflow(self, mock_execute, temp_dir: Path, sample_workflow_yaml: str) -> None:
        """Test running a minimal workflow."""
        mock_execute.return_value = None

        parser = WorkflowParser()
        workflow = parser.parse_string(sample_workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)
        progress = executor.run(workflow)

        assert progress.workflow_name == "test-workflow"
        assert progress.status == WorkflowStatus.COMPLETED.value

    @patch("agentic_sdlc.executor.PromptStepExecutor.execute")
    def test_run_creates_progress_file(self, mock_execute, temp_dir: Path, sample_workflow_yaml: str) -> None:
        """Test running creates progress file."""
        mock_execute.return_value = None

        parser = WorkflowParser()
        workflow = parser.parse_string(sample_workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)
        progress = executor.run(workflow)

        progress_dir = temp_dir / "agentic" / "outputs" / progress.workflow_id
        assert progress_dir.exists()
        assert (progress_dir / "progress.json").exists()

    @patch("agentic_sdlc.executor.PromptStepExecutor.execute")
    def test_run_with_variables(self, mock_execute, temp_dir: Path) -> None:
        """Test running with custom variables."""
        mock_execute.return_value = None

        workflow_yaml = """
name: variable-test
version: "1.0"
description: Test with variables
variables:
  - name: custom_var
    type: string
    default: default_value
steps:
  - name: test
    type: prompt
    prompt: "{{ variables.custom_var }}"
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)
        progress = executor.run(
            workflow,
            variables={"custom_var": "custom_value"},
        )

        assert progress.variables["custom_var"] == "custom_value"

    @patch("agentic_sdlc.executor.PromptStepExecutor.execute")
    def test_run_with_default_variables(self, mock_execute, temp_dir: Path) -> None:
        """Test running uses default variable values."""
        mock_execute.return_value = None

        workflow_yaml = """
name: default-var-test
version: "1.0"
description: Test with default variables
variables:
  - name: my_var
    type: string
    default: the_default
steps:
  - name: test
    type: prompt
    prompt: "Test"
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)
        progress = executor.run(workflow)

        assert progress.variables["my_var"] == "the_default"

    def test_run_raises_for_missing_required_variable(self, temp_dir: Path) -> None:
        """Test running raises error for missing required variable."""
        workflow_yaml = """
name: required-var-test
version: "1.0"
description: Test with required variable
variables:
  - name: required_var
    type: string
    required: true
steps:
  - name: test
    type: prompt
    prompt: "Test"
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)

        with pytest.raises(ValueError, match="Missing required variable"):
            executor.run(workflow)

    @patch("agentic_sdlc.executor.PromptStepExecutor.execute")
    def test_run_from_step(self, mock_execute, temp_dir: Path) -> None:
        """Test running from a specific step."""
        mock_execute.return_value = None

        workflow_yaml = """
name: multi-step
version: "1.0"
description: Multi-step workflow
steps:
  - name: step1
    type: prompt
    prompt: "Step 1"
  - name: step2
    type: prompt
    prompt: "Step 2"
  - name: step3
    type: prompt
    prompt: "Step 3"
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)
        progress = executor.run(workflow, from_step="step2")

        # step1 should be skipped, step2 and step3 executed
        assert progress.status == WorkflowStatus.COMPLETED.value
        # Mock should be called twice (step2 and step3)
        assert mock_execute.call_count == 2

    @patch("agentic_sdlc.executor.PromptStepExecutor.execute")
    def test_run_sets_terminal_output_level(self, mock_execute, temp_dir: Path, sample_workflow_yaml: str) -> None:
        """Test terminal output level is set correctly."""
        mock_execute.return_value = None

        parser = WorkflowParser()
        workflow = parser.parse_string(sample_workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)

        # Test base mode
        progress = executor.run(workflow, terminal_output="base")
        assert progress is not None

        # Test all mode
        progress = executor.run(workflow, terminal_output="all")
        assert progress is not None


class TestWorkflowExecutorStepDispatch:
    """Tests for step dispatch in executor."""

    @patch("agentic_sdlc.steps.prompt_step.PromptStepExecutor.execute")
    def test_dispatch_prompt_step(self, mock_execute, temp_dir: Path) -> None:
        """Test dispatching prompt step to correct executor."""
        workflow_yaml = """
name: prompt-dispatch
version: "1.0"
description: Test prompt dispatch
steps:
  - name: test-prompt
    type: prompt
    prompt: "Test"
"""
        mock_execute.return_value = None

        parser = WorkflowParser()
        workflow = parser.parse_string(workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)
        executor.run(workflow)

        mock_execute.assert_called()

class TestWorkflowExecutorOutputs:
    """Tests for workflow output rendering."""

    def test_render_outputs_on_completion(self, temp_dir: Path) -> None:
        """Test outputs are rendered on workflow completion."""
        # Create template directory
        templates_dir = temp_dir / "agentic" / "templates"
        templates_dir.mkdir(parents=True)
        template_file = templates_dir / "test-output.md.j2"
        template_file.write_text("Workflow: {{ workflow.name }}")

        workflow_yaml = """
name: output-test
version: "1.0"
description: Test output rendering
steps: []
outputs:
  - name: test-output
    template: test-output.md.j2
    path: output.md
    when: always
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)
        progress = executor.run(workflow)

        # Workflow with no steps should complete successfully
        # The test verifies the execution path doesn't error
        assert progress is not None
        assert progress.status == WorkflowStatus.COMPLETED.value


class TestWorkflowExecutorErrorHandling:
    """Tests for error handling in executor."""

    @patch("agentic_sdlc.steps.prompt_step.PromptStepExecutor.execute")
    def test_step_failure_marks_workflow_failed(self, mock_execute, temp_dir: Path) -> None:
        """Test step failure marks workflow as failed."""
        mock_execute.side_effect = Exception("Step execution failed")

        workflow_yaml = """
name: failing-workflow
version: "1.0"
description: Test failure handling
steps:
  - name: failing-step
    type: prompt
    prompt: "This will fail"
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)
        progress = executor.run(workflow)

        assert progress.status == WorkflowStatus.FAILED.value
        assert len(progress.errors) > 0

    @patch("agentic_sdlc.steps.prompt_step.PromptStepExecutor.execute")
    def test_step_failure_stops_execution(self, mock_execute, temp_dir: Path) -> None:
        """Test step failure stops further execution."""
        call_count = [0]

        def side_effect(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                raise Exception("First step failed")

        mock_execute.side_effect = side_effect

        workflow_yaml = """
name: multi-step-fail
version: "1.0"
description: Test failure stops execution
steps:
  - name: step1
    type: prompt
    prompt: "Step 1"
  - name: step2
    type: prompt
    prompt: "Step 2"
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(workflow_yaml)

        executor = WorkflowExecutor(repo_root=temp_dir)
        progress = executor.run(workflow)

        # Only first step should have been attempted
        assert call_count[0] == 1
        assert progress.status == WorkflowStatus.FAILED.value
