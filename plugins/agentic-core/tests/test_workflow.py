"""Tests for workflow parsing and execution."""

import pytest

from agentic_core.workflow import (
    TemplateResolver,
    WorkflowDefinition,
    WorkflowExecutor,
    WorkflowParseError,
    WorkflowParser,
    WorkflowType,
    resolve_template,
)


class TestWorkflowParser:
    """Tests for YAML workflow parser."""

    def test_parse_minimal_workflow(self):
        """Test parsing minimal workflow YAML."""
        yaml_content = """
name: test-workflow
type: one-shot
steps:
  - name: step1
    agent: developer
    task:
      description: Do something
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(yaml_content)

        assert workflow.name == "test-workflow"
        assert workflow.type == WorkflowType.ONE_SHOT
        assert len(workflow.steps) == 1
        assert workflow.steps[0].name == "step1"

    def test_parse_full_workflow(self):
        """Test parsing full workflow with all fields."""
        yaml_content = """
name: feature-workflow
type: feature
version: "2.0"
description: A feature workflow

settings:
  human_in_loop: true
  max_retries: 5
  timeout_minutes: 120
  git:
    enabled: true
    auto_branch: true
    auto_pr: true

agents:
  - name: planner
    provider: claude
    model: opus
    persona: "You are a senior architect"
  - name: developer
    provider: mock
    model: sonnet

inputs:
  - name: codebase
    type: codebase
    source: src/
    glob: "**/*.py"

steps:
  - name: plan
    agent: planner
    task:
      description: Create implementation plan
      prompt: "Plan the implementation of {{ feature }}"
    checkpoint: true
  - name: implement
    agent: developer
    task:
      description: Implement the plan
      context:
        - plan
    conditions:
      requires:
        - plan

outputs:
  - name: plan
    type: file
    path: plan.md
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(yaml_content)

        assert workflow.name == "feature-workflow"
        assert workflow.type == WorkflowType.FEATURE
        assert workflow.version == "2.0"
        assert workflow.settings.human_in_loop is True
        assert workflow.settings.max_retries == 5
        assert workflow.settings.git.enabled is True
        assert workflow.settings.git.auto_pr is True

        assert len(workflow.agents) == 2
        assert workflow.agents[0].name == "planner"
        assert workflow.agents[0].provider == "claude"
        assert workflow.agents[0].model == "opus"

        assert len(workflow.steps) == 2
        assert workflow.steps[0].checkpoint is True
        assert workflow.steps[1].conditions.requires == ["plan"]

        assert len(workflow.inputs) == 1
        assert workflow.inputs[0].name == "codebase"

        assert len(workflow.outputs) == 1
        assert workflow.outputs[0].name == "plan"

    def test_parse_meeting_workflow(self):
        """Test parsing meeting-type workflow."""
        yaml_content = """
name: planning-meeting
type: meeting

meeting:
  topic: Sprint planning
  agents:
    - architect
    - developer
    - pm
  max_rounds: 3
  interactive: true

agents:
  - name: architect
  - name: developer
  - name: pm

steps: []
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(yaml_content)

        assert workflow.type == WorkflowType.MEETING
        assert workflow.meeting is not None
        assert workflow.meeting.topic == "Sprint planning"
        assert len(workflow.meeting.agents) == 3
        assert workflow.meeting.max_rounds == 3
        assert workflow.meeting.interactive is True

    def test_parse_invalid_type(self):
        """Test parsing with invalid workflow type."""
        yaml_content = """
name: test
type: invalid-type
steps: []
"""
        parser = WorkflowParser()
        with pytest.raises(WorkflowParseError, match="Invalid workflow type"):
            parser.parse_string(yaml_content)

    def test_parse_missing_name(self):
        """Test parsing without required name field."""
        yaml_content = """
type: one-shot
steps: []
"""
        parser = WorkflowParser()
        with pytest.raises(WorkflowParseError, match="Missing required field: name"):
            parser.parse_string(yaml_content)


class TestTemplateResolver:
    """Tests for template resolution."""

    def test_resolve_simple_variable(self):
        """Test resolving simple variable."""
        template = "Hello {{ name }}!"
        result = resolve_template(template, {"name": "World"})
        assert result == "Hello World!"

    def test_resolve_nested_variable(self):
        """Test resolving nested variable."""
        template = "Output: {{ outputs.step1 }}"
        result = resolve_template(template, {"outputs": {"step1": "content"}})
        assert result == "Output: content"

    def test_has_variables(self):
        """Test detecting template variables."""
        resolver = TemplateResolver()
        assert resolver.has_variables("{{ variable }}")
        assert resolver.has_variables("Hello {{ name }}!")
        assert not resolver.has_variables("No variables here")

    def test_extract_variables(self):
        """Test extracting variable names."""
        resolver = TemplateResolver()
        variables = resolver.extract_variables("{{ name }} and {{ outputs.step1 }}")
        assert "name" in variables
        assert "outputs" in variables

    def test_truncate_lines_filter(self):
        """Test truncate_lines filter."""
        resolver = TemplateResolver()
        template = "{{ content | truncate_lines(3) }}"
        content = "line1\nline2\nline3\nline4\nline5"
        result = resolver.resolve(template, {"content": content})
        assert "line1" in result
        assert "line2" in result
        assert "line3" in result
        assert "2 more lines" in result

    def test_code_block_filter(self):
        """Test code_block filter."""
        resolver = TemplateResolver()
        template = "{{ code | code_block('python') }}"
        result = resolver.resolve(template, {"code": "print('hello')"})
        assert "```python" in result
        assert "print('hello')" in result
        assert "```" in result

    def test_bullet_list_filter(self):
        """Test bullet_list filter."""
        resolver = TemplateResolver()
        template = "{{ items | bullet_list }}"
        result = resolver.resolve(template, {"items": ["a", "b", "c"]})
        assert "- a" in result
        assert "- b" in result
        assert "- c" in result


class TestWorkflowExecutor:
    """Tests for workflow execution."""

    @pytest.fixture
    def simple_workflow(self):
        """Create a simple test workflow."""
        yaml_content = """
name: test-workflow
type: one-shot

agents:
  - name: developer
    provider: mock

steps:
  - name: step1
    agent: developer
    task:
      description: Fix a bug
      prompt: Fix the login bug
"""
        parser = WorkflowParser()
        return parser.parse_string(yaml_content)

    @pytest.fixture
    def multi_step_workflow(self):
        """Create a multi-step test workflow."""
        yaml_content = """
name: multi-step
type: feature

agents:
  - name: planner
    provider: mock
  - name: developer
    provider: mock

steps:
  - name: plan
    agent: planner
    task:
      description: Create plan
      prompt: Plan the feature
  - name: implement
    agent: developer
    task:
      description: Implement
      prompt: "Implement based on: {{ outputs.plan }}"
    conditions:
      requires:
        - plan
"""
        parser = WorkflowParser()
        return parser.parse_string(yaml_content)

    @pytest.mark.asyncio
    async def test_execute_simple_workflow(self, simple_workflow):
        """Test executing a simple workflow."""
        executor = WorkflowExecutor()
        result = await executor.run(simple_workflow)

        assert result.status.value == "completed"
        assert "step1" in result.step_outputs
        assert result.step_outputs["step1"].content

    @pytest.mark.asyncio
    async def test_execute_dry_run(self, simple_workflow):
        """Test dry run mode."""
        executor = WorkflowExecutor()
        result = await executor.run(simple_workflow, dry_run=True)

        assert result.status.value == "completed"
        assert result.outputs.get("dry_run") is True
        assert "step1" in result.outputs.get("steps", [])

    @pytest.mark.asyncio
    async def test_execute_multi_step(self, multi_step_workflow):
        """Test multi-step workflow with dependencies."""
        executor = WorkflowExecutor()
        result = await executor.run(multi_step_workflow)

        assert result.status.value == "completed"
        assert "plan" in result.step_outputs
        assert "implement" in result.step_outputs

    @pytest.mark.asyncio
    async def test_execute_with_variables(self):
        """Test workflow with template variables."""
        yaml_content = """
name: test-vars
type: one-shot

agents:
  - name: developer
    provider: mock

steps:
  - name: step1
    agent: developer
    task:
      description: Fix bug
      prompt: "Fix bug #{{ issue_number }} in {{ component }}"
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(yaml_content)

        executor = WorkflowExecutor()
        result = await executor.run(
            workflow,
            variables={"issue_number": "1234", "component": "auth"},
        )

        assert result.status.value == "completed"

    @pytest.mark.asyncio
    async def test_execute_from_step(self):
        """Test resuming from a specific step."""
        # Use a workflow without step dependencies for resume testing
        yaml_content = """
name: resume-test
type: feature

agents:
  - name: planner
    provider: mock
  - name: developer
    provider: mock

steps:
  - name: plan
    agent: planner
    task:
      description: Create plan
      prompt: Plan the feature
  - name: implement
    agent: developer
    task:
      description: Implement
      prompt: Implement the feature
"""
        parser = WorkflowParser()
        workflow = parser.parse_string(yaml_content)

        executor = WorkflowExecutor()
        result = await executor.run(workflow, from_step="implement")

        assert result.status.value == "completed"
        # Plan step should be skipped (marked completed but no output)
        assert "implement" in result.step_outputs
