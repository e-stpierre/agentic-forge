"""Tests for YAML workflow parser."""

from __future__ import annotations

import pytest

from agentic_sdlc.parser import (
    StepType,
    WorkflowParseError,
    WorkflowParser,
)


class TestWorkflowParser:
    """Tests for WorkflowParser class."""

    def test_parse_minimal_workflow(
        self, sample_workflow_yaml: str, temp_dir
    ) -> None:
        """Test parsing a minimal valid workflow."""
        workflow_file = temp_dir / "workflow.yaml"
        workflow_file.write_text(sample_workflow_yaml)

        parser = WorkflowParser()
        workflow = parser.parse_file(workflow_file)

        assert workflow.name == "test-workflow"
        assert workflow.version == "1.0"
        assert workflow.description == "A test workflow"
        assert len(workflow.steps) == 1
        assert workflow.steps[0].name == "test-step"
        assert workflow.steps[0].type == StepType.PROMPT
        assert workflow.steps[0].prompt == "Test prompt"

    def test_parse_string_workflow(self, sample_workflow_yaml: str) -> None:
        """Test parsing workflow from string."""
        parser = WorkflowParser()
        workflow = parser.parse_string(sample_workflow_yaml)

        assert workflow.name == "test-workflow"
        assert len(workflow.steps) == 1

    def test_parse_missing_name_raises_error(self, temp_dir) -> None:
        """Test that missing name field raises validation error."""
        workflow_file = temp_dir / "workflow.yaml"
        workflow_file.write_text("steps: []")

        parser = WorkflowParser()
        with pytest.raises(WorkflowParseError, match="Missing required field: name"):
            parser.parse_file(workflow_file)

    def test_parse_invalid_yaml_raises_error(self, temp_dir) -> None:
        """Test that invalid YAML syntax raises error."""
        workflow_file = temp_dir / "workflow.yaml"
        workflow_file.write_text("name: [invalid yaml")

        parser = WorkflowParser()
        with pytest.raises(WorkflowParseError, match="Invalid YAML"):
            parser.parse_file(workflow_file)

    def test_parse_nonexistent_file_raises_error(self, temp_dir) -> None:
        """Test that nonexistent file raises error."""
        workflow_file = temp_dir / "nonexistent.yaml"

        parser = WorkflowParser()
        with pytest.raises(WorkflowParseError, match="Workflow file not found"):
            parser.parse_file(workflow_file)

    def test_parse_invalid_step_type_raises_error(self, temp_dir) -> None:
        """Test that invalid step type raises error."""
        workflow_file = temp_dir / "workflow.yaml"
        workflow_file.write_text(
            """
name: test
steps:
  - name: bad-step
    type: invalid-type
"""
        )

        parser = WorkflowParser()
        with pytest.raises(WorkflowParseError, match="Invalid step type"):
            parser.parse_file(workflow_file)

    def test_parse_parallel_workflow(
        self, sample_parallel_workflow_yaml: str
    ) -> None:
        """Test parsing workflow with parallel steps."""
        parser = WorkflowParser()
        workflow = parser.parse_string(sample_parallel_workflow_yaml)

        assert workflow.name == "parallel-workflow"
        assert len(workflow.steps) == 1

        parallel_step = workflow.steps[0]
        assert parallel_step.type == StepType.PARALLEL
        assert len(parallel_step.steps) == 2
        assert parallel_step.steps[0].name == "branch-a"
        assert parallel_step.steps[0].type == StepType.SERIAL

    def test_parse_conditional_workflow(
        self, sample_conditional_workflow_yaml: str
    ) -> None:
        """Test parsing workflow with conditional steps."""
        parser = WorkflowParser()
        workflow = parser.parse_string(sample_conditional_workflow_yaml)

        assert workflow.name == "conditional-workflow"
        assert len(workflow.variables) == 1
        assert workflow.variables[0].name == "run_tests"
        assert workflow.variables[0].type == "boolean"
        assert workflow.variables[0].default is True

        conditional_step = workflow.steps[0]
        assert conditional_step.type == StepType.CONDITIONAL
        assert conditional_step.condition == "variables.run_tests"
        assert len(conditional_step.then_steps) == 1
        assert len(conditional_step.else_steps) == 1

    def test_parse_workflow_not_dict_raises_error(self) -> None:
        """Test that non-dict workflow raises error."""
        parser = WorkflowParser()
        with pytest.raises(WorkflowParseError, match="must be a dictionary"):
            parser.parse_string("- item1\n- item2")

    def test_parse_nested_parallel_raises_error(self, temp_dir) -> None:
        """Test that nested parallel steps raise error."""
        workflow_file = temp_dir / "workflow.yaml"
        workflow_file.write_text(
            """
name: nested-parallel
steps:
  - name: outer-parallel
    type: parallel
    steps:
      - name: inner-parallel
        type: parallel
        steps: []
"""
        )

        parser = WorkflowParser()
        with pytest.raises(WorkflowParseError, match="Nested parallel steps"):
            parser.parse_file(workflow_file)


class TestWorkflowParserSettings:
    """Tests for parsing workflow settings."""

    def test_default_settings(self) -> None:
        """Test default settings are applied."""
        parser = WorkflowParser()
        workflow = parser.parse_string("name: test\nsteps: []")

        assert workflow.settings.max_retry == 3
        assert workflow.settings.timeout_minutes == 60
        assert workflow.settings.track_progress is True
        assert workflow.settings.git.enabled is False

    def test_custom_settings(self) -> None:
        """Test custom settings are parsed."""
        parser = WorkflowParser()
        workflow = parser.parse_string(
            """
name: test
settings:
  max-retry: 5
  timeout-minutes: 120
  track-progress: false
  git:
    enabled: true
    worktree: true
    branch-prefix: custom
steps: []
"""
        )

        assert workflow.settings.max_retry == 5
        assert workflow.settings.timeout_minutes == 120
        assert workflow.settings.track_progress is False
        assert workflow.settings.git.enabled is True
        assert workflow.settings.git.worktree is True
        assert workflow.settings.git.branch_prefix == "custom"


class TestWorkflowParserOutputs:
    """Tests for parsing workflow outputs."""

    def test_parse_outputs(self) -> None:
        """Test parsing workflow outputs."""
        parser = WorkflowParser()
        workflow = parser.parse_string(
            """
name: test
steps: []
outputs:
  - name: summary
    template: summary.md.j2
    path: output/summary.md
    when: completed
"""
        )

        assert len(workflow.outputs) == 1
        output = workflow.outputs[0]
        assert output.name == "summary"
        assert output.template == "summary.md.j2"
        assert output.path == "output/summary.md"
        assert output.when == "completed"

    def test_missing_output_fields_raises_error(self) -> None:
        """Test that missing required output fields raise error."""
        parser = WorkflowParser()
        with pytest.raises(WorkflowParseError, match="Missing required field"):
            parser.parse_string(
                """
name: test
steps: []
outputs:
  - name: summary
    template: summary.md.j2
"""
            )
