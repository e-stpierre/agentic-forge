"""Tests for step executors."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from agentic_sdlc.console import ConsoleOutput
from agentic_sdlc.logging.logger import WorkflowLogger
from agentic_sdlc.parser import StepDefinition, StepType, WorkflowSettings
from agentic_sdlc.progress import WorkflowProgress, create_progress
from agentic_sdlc.renderer import TemplateRenderer
from agentic_sdlc.steps.base import StepContext, StepExecutor
from agentic_sdlc.steps.conditional_step import ConditionalStepExecutor
from agentic_sdlc.steps.prompt_step import PromptStepExecutor
from agentic_sdlc.steps.serial_step import SerialStepExecutor


@pytest.fixture
def step_context(temp_dir: Path) -> StepContext:
    """Create a step context for testing."""
    return StepContext(
        repo_root=temp_dir,
        config={
            "defaults": {
                "model": "sonnet",
                "maxRetry": 3,
                "timeoutMinutes": 60,
            }
        },
        renderer=TemplateRenderer(),
        workflow_settings=WorkflowSettings(),
        workflow_id="test-workflow-id",
        variables={"test_var": "test_value"},
        outputs={},
    )


@pytest.fixture
def workflow_progress() -> WorkflowProgress:
    """Create a workflow progress for testing."""
    return create_progress(
        workflow_id="test-workflow-id",
        workflow_name="test-workflow",
        step_names=["step1", "step2"],
        variables={},
    )


@pytest.fixture
def mock_logger() -> MagicMock:
    """Create a mock logger."""
    return MagicMock(spec=WorkflowLogger)


@pytest.fixture
def mock_console() -> ConsoleOutput:
    """Create a mock console."""
    import io

    return ConsoleOutput(stream=io.StringIO())


class TestStepContext:
    """Tests for StepContext dataclass."""

    def test_step_context_creation(self, temp_dir: Path) -> None:
        """Test creating StepContext."""
        context = StepContext(
            repo_root=temp_dir,
            config={"key": "value"},
            renderer=TemplateRenderer(),
            workflow_settings=WorkflowSettings(),
            workflow_id="test-workflow-123",
            variables={"var": "val"},
            outputs={"output": "data"},
        )

        assert context.repo_root == temp_dir
        assert context.config == {"key": "value"}
        assert context.workflow_id == "test-workflow-123"
        assert context.variables == {"var": "val"}
        assert context.outputs == {"output": "data"}

    def test_build_template_context_includes_workflow_id(self, temp_dir: Path) -> None:
        """Test that build_template_context includes workflow_id."""
        context = StepContext(
            repo_root=temp_dir,
            config={"key": "value"},
            renderer=TemplateRenderer(),
            workflow_settings=WorkflowSettings(),
            workflow_id="test-workflow-456",
            variables={"task": "feature"},
            outputs={"plan": {"summary": "test"}},
        )

        template_ctx = context.build_template_context()

        assert template_ctx["workflow_id"] == "test-workflow-456"
        assert template_ctx["variables"]["task"] == "feature"
        assert template_ctx["outputs"]["plan"]["summary"] == "test"
        # Variables should also be spread at top level
        assert template_ctx["task"] == "feature"

    def test_resolve_model_step_takes_priority(self, temp_dir: Path) -> None:
        """Test that step-level model takes priority over workflow-level."""
        context = StepContext(
            repo_root=temp_dir,
            config={"defaults": {"model": "sonnet"}},
            renderer=TemplateRenderer(),
            workflow_settings=WorkflowSettings(model="haiku"),
            workflow_id="test-workflow",
            variables={},
            outputs={},
        )

        assert context.resolve_model("opus") == "opus"

    def test_resolve_model_workflow_takes_priority_over_config(self, temp_dir: Path) -> None:
        """Test that workflow-level model takes priority over config default."""
        context = StepContext(
            repo_root=temp_dir,
            config={"defaults": {"model": "sonnet"}},
            renderer=TemplateRenderer(),
            workflow_settings=WorkflowSettings(model="haiku"),
            workflow_id="test-workflow",
            variables={},
            outputs={},
        )

        assert context.resolve_model(None) == "haiku"

    def test_resolve_model_falls_back_to_config(self, temp_dir: Path) -> None:
        """Test that model falls back to config default when not set elsewhere."""
        context = StepContext(
            repo_root=temp_dir,
            config={"defaults": {"model": "opus"}},
            renderer=TemplateRenderer(),
            workflow_settings=WorkflowSettings(),  # No model set
            workflow_id="test-workflow",
            variables={},
            outputs={},
        )

        assert context.resolve_model(None) == "opus"

    def test_resolve_model_falls_back_to_sonnet(self, temp_dir: Path) -> None:
        """Test that model falls back to sonnet when nothing is configured."""
        context = StepContext(
            repo_root=temp_dir,
            config={"defaults": {}},  # No model in config
            renderer=TemplateRenderer(),
            workflow_settings=WorkflowSettings(),  # No model set
            workflow_id="test-workflow",
            variables={},
            outputs={},
        )

        assert context.resolve_model(None) == "sonnet"


class TestStepExecutorBase:
    """Tests for base StepExecutor class."""

    def test_step_executor_is_abstract(self) -> None:
        """Test that StepExecutor cannot be instantiated directly."""
        # StepExecutor should have execute as abstract method
        with pytest.raises(TypeError):
            StepExecutor()


class TestPromptStepExecutor:
    """Tests for PromptStepExecutor."""

    def test_prompt_step_executor_init(self) -> None:
        """Test PromptStepExecutor initialization."""
        executor = PromptStepExecutor()
        assert executor is not None

    @patch("agentic_sdlc.steps.prompt_step.run_claude")
    def test_execute_basic_prompt(
        self,
        mock_run,
        step_context: StepContext,
        workflow_progress: WorkflowProgress,
        mock_logger: MagicMock,
        mock_console: ConsoleOutput,
    ) -> None:
        """Test executing basic prompt step."""
        mock_run.return_value = MagicMock(
            success=True,
            stdout="Output",
            stderr="",
            session_output=MagicMock(
                is_success=True,
                context="Done",
            ),
        )

        step = StepDefinition(
            name="test-prompt",
            type=StepType.PROMPT,
            prompt="Test prompt content",
        )

        executor = PromptStepExecutor()
        executor.execute(step, workflow_progress, step_context, mock_logger, mock_console)

        mock_run.assert_called_once()
        # Check the first positional arg (prompt) contains our text
        call_args = mock_run.call_args
        # call_args can be (args, kwargs) or call_args.args and call_args.kwargs
        prompt_arg = call_args.args[0] if call_args.args else call_args.kwargs.get("prompt", "")
        assert "Test prompt content" in prompt_arg

    @patch("agentic_sdlc.steps.prompt_step.run_claude")
    def test_execute_prompt_with_variables(
        self,
        mock_run,
        step_context: StepContext,
        workflow_progress: WorkflowProgress,
        mock_logger: MagicMock,
        mock_console: ConsoleOutput,
    ) -> None:
        """Test executing prompt with variable interpolation."""
        mock_run.return_value = MagicMock(
            success=True,
            stdout="Output",
            stderr="",
            session_output=MagicMock(
                is_success=True,
                context="Done",
            ),
        )

        step = StepDefinition(
            name="test-prompt",
            type=StepType.PROMPT,
            prompt="Value is {{ variables.test_var }}",
        )

        executor = PromptStepExecutor()
        executor.execute(step, workflow_progress, step_context, mock_logger, mock_console)

        call_args = mock_run.call_args
        prompt_arg = call_args.args[0] if call_args.args else call_args.kwargs.get("prompt", "")
        assert "test_value" in prompt_arg


class TestConditionalStepExecutor:
    """Tests for ConditionalStepExecutor."""

    def test_conditional_step_executor_init(self) -> None:
        """Test ConditionalStepExecutor initialization."""
        branch_executor = MagicMock()
        executor = ConditionalStepExecutor(branch_executor)
        assert executor is not None

    def test_evaluate_condition_true(self) -> None:
        """Test evaluating true condition."""
        branch_executor = MagicMock()
        executor = ConditionalStepExecutor(branch_executor)

        context = {"variables": {"enabled": True}}
        result = executor._evaluate_condition("variables.enabled", context)

        assert result is True

    def test_evaluate_condition_false(self) -> None:
        """Test evaluating false condition."""
        branch_executor = MagicMock()
        executor = ConditionalStepExecutor(branch_executor)

        context = {"variables": {"enabled": False}}
        result = executor._evaluate_condition("variables.enabled", context)

        assert result is False

    def test_evaluate_condition_comparison(self) -> None:
        """Test evaluating comparison condition."""
        branch_executor = MagicMock()
        executor = ConditionalStepExecutor(branch_executor)

        context = {"variables": {"status": "active"}}
        # The conditional executor doesn't support > comparisons, use ==
        result = executor._evaluate_condition("variables.status == 'active'", context)

        assert result is True

    def test_evaluate_condition_string_comparison(self) -> None:
        """Test evaluating string comparison condition."""
        branch_executor = MagicMock()
        executor = ConditionalStepExecutor(branch_executor)

        context = {"variables": {"status": "active"}}
        result = executor._evaluate_condition("variables.status == 'active'", context)

        assert result is True


class TestSerialStepExecutor:
    """Tests for SerialStepExecutor."""

    def test_serial_step_executor_init(self) -> None:
        """Test SerialStepExecutor initialization."""
        branch_executor = MagicMock()
        executor = SerialStepExecutor(branch_executor)
        assert executor is not None

    def test_execute_serial_steps(
        self,
        step_context: StepContext,
        workflow_progress: WorkflowProgress,
        mock_logger: MagicMock,
        mock_console: ConsoleOutput,
    ) -> None:
        """Test executing serial steps in order."""
        from agentic_sdlc.steps.base import StepResult

        branch_executor = MagicMock()
        # Mock the execute method to return success
        branch_executor.execute.return_value = StepResult(success=True, output_summary="Done")
        executor = SerialStepExecutor(branch_executor)

        inner_steps = [
            StepDefinition(name="inner1", type=StepType.PROMPT, prompt="Step 1"),
            StepDefinition(name="inner2", type=StepType.PROMPT, prompt="Step 2"),
        ]

        step = StepDefinition(
            name="serial-step",
            type=StepType.SERIAL,
            steps=inner_steps,
        )

        executor.execute(step, workflow_progress, step_context, mock_logger, mock_console)

        # Branch executor execute should be called for each inner step
        assert branch_executor.execute.call_count == 2


class TestStepExecutorRetry:
    """Tests for step retry behavior."""

    @patch("agentic_sdlc.steps.prompt_step.run_claude")
    def test_prompt_retries_on_failure(
        self,
        mock_run,
        step_context: StepContext,
        workflow_progress: WorkflowProgress,
        mock_logger: MagicMock,
        mock_console: ConsoleOutput,
    ) -> None:
        """Test prompt step retries on failure."""
        # First call fails, second succeeds
        mock_run.side_effect = [
            MagicMock(
                success=False,
                returncode=1,
                stdout="",
                stderr="Error",
                session_output=MagicMock(is_success=False, context="Failed"),
            ),
            MagicMock(
                success=True,
                stdout="Output",
                stderr="",
                session_output=MagicMock(is_success=True, context="Done"),
            ),
        ]

        step = StepDefinition(
            name="test-prompt",
            type=StepType.PROMPT,
            prompt="Test",
            step_max_retry=2,  # Use correct field name
        )

        executor = PromptStepExecutor()
        executor.execute(step, workflow_progress, step_context, mock_logger, mock_console)

        # Should have retried
        assert mock_run.call_count == 2
