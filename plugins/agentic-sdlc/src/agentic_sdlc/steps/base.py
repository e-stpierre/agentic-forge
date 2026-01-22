"""Base class for step executors."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agentic_sdlc.console import ConsoleOutput
    from agentic_sdlc.logging.logger import WorkflowLogger
    from agentic_sdlc.parser import StepDefinition, WorkflowSettings
    from agentic_sdlc.progress import WorkflowProgress
    from agentic_sdlc.renderer import TemplateRenderer


@dataclass
class StepContext:
    """Context passed to step executors.

    Contains all the shared state and dependencies needed for step execution.
    """

    repo_root: Path
    config: dict[str, Any]
    renderer: TemplateRenderer
    workflow_settings: WorkflowSettings | None
    workflow_id: str = ""
    variables: dict[str, Any] = field(default_factory=dict)
    outputs: dict[str, Any] = field(default_factory=dict)
    cwd_override: Path | None = None

    def build_template_context(self) -> dict[str, Any]:
        """Build context dictionary for template rendering."""
        return {
            "variables": self.variables,
            "outputs": self.outputs,
            "workflow_id": self.workflow_id,
            **self.variables,
        }

    def resolve_model(self, step_model: str | None) -> str:
        """Resolve the model to use for a step.

        Priority: step.model > config.defaults.model > "sonnet"
        """
        if step_model:
            return step_model
        return self.config["defaults"].get("model", "sonnet")


@dataclass
class StepResult:
    """Result from step execution."""

    success: bool
    output_summary: str = ""
    full_output: str = ""
    error: str | None = None


class StepExecutor(ABC):
    """Base class for step executors.

    Each step type implements this interface to handle its specific execution logic.
    """

    @abstractmethod
    def execute(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: StepContext,
        logger: WorkflowLogger,
        console: ConsoleOutput,
    ) -> StepResult:
        """Execute the step.

        Args:
            step: Step definition from workflow
            progress: Workflow progress tracker
            context: Shared execution context
            logger: Workflow logger
            console: Console output handler

        Returns:
            StepResult with success status and output
        """
        pass
