"""Workflow executor for running workflows."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agentic_sdlc.config import load_config
from agentic_sdlc.console import ConsoleOutput, OutputLevel
from agentic_sdlc.logging.logger import WorkflowLogger
from agentic_sdlc.parser import StepDefinition, StepType, WorkflowDefinition, WorkflowSettings
from agentic_sdlc.progress import (
    WorkflowProgress,
    WorkflowStatus,
    create_progress,
    generate_workflow_id,
    save_progress,
    update_step_failed,
    update_step_started,
)
from agentic_sdlc.renderer import (
    TemplateRenderer,
    build_template_context,
    render_workflow_output,
)
from agentic_sdlc.steps.base import StepContext
from agentic_sdlc.steps.conditional_step import ConditionalStepExecutor
from agentic_sdlc.steps.parallel_step import BranchStepExecutor, ParallelStepExecutor
from agentic_sdlc.steps.prompt_step import PromptStepExecutor
from agentic_sdlc.steps.ralph_loop_step import RalphLoopStepExecutor
from agentic_sdlc.steps.serial_step import SerialStepExecutor


class WorkflowExecutor:
    """Executes workflow definitions.

    Coordinates the execution of workflow steps by dispatching to
    specialized step executors based on step type.
    """

    def __init__(self, repo_root: Path | None = None):
        self.repo_root = repo_root or Path.cwd()
        self.config = load_config(self.repo_root)
        self.renderer = TemplateRenderer()
        self.workflow_settings: WorkflowSettings | None = None

        # Initialize step executors
        self._init_step_executors()

    def _init_step_executors(self) -> None:
        """Initialize all step executors with proper dependencies."""
        # Create simple executors first
        self.prompt_executor = PromptStepExecutor()
        self.ralph_loop_executor = RalphLoopStepExecutor()

        # Create branch executor for nested steps
        self.branch_executor = BranchStepExecutor(
            {
                StepType.PROMPT.value: self.prompt_executor,
                StepType.RALPH_LOOP.value: self.ralph_loop_executor,
            }
        )

        # Create complex executors that depend on branch executor
        self.parallel_executor = ParallelStepExecutor(self.branch_executor)
        self.serial_executor = SerialStepExecutor(self.branch_executor)
        self.conditional_executor = ConditionalStepExecutor(self.branch_executor)

        # Add complex executors to branch executor for nested support
        self.branch_executor.step_executors[StepType.SERIAL.value] = self.serial_executor
        self.branch_executor.step_executors[StepType.CONDITIONAL.value] = self.conditional_executor

        # Map step types to executors
        self.executors = {
            StepType.PROMPT: self.prompt_executor,
            StepType.PARALLEL: self.parallel_executor,
            StepType.SERIAL: self.serial_executor,
            StepType.CONDITIONAL: self.conditional_executor,
            StepType.RALPH_LOOP: self.ralph_loop_executor,
        }

    def run(
        self,
        workflow: WorkflowDefinition,
        variables: dict[str, Any] | None = None,
        from_step: str | None = None,
        terminal_output: str = "base",
    ) -> WorkflowProgress:
        """Execute a workflow.

        Args:
            workflow: Parsed workflow definition
            variables: Variables to pass to templates
            from_step: Resume from a specific step
            terminal_output: Output mode (base or all)
        """
        variables = variables or {}
        workflow_id = generate_workflow_id(workflow.name)
        self.workflow_settings = workflow.settings

        # Create console output handler
        output_level = OutputLevel.ALL if terminal_output == "all" else OutputLevel.BASE
        console = ConsoleOutput(level=output_level)

        for var in workflow.variables:
            if var.name not in variables:
                if var.required and var.default is None:
                    raise ValueError(f"Missing required variable: {var.name}")
                variables[var.name] = var.default

        step_names = [s.name for s in workflow.steps]

        progress = create_progress(workflow_id, workflow.name, step_names, variables)
        save_progress(progress, self.repo_root)

        logger = WorkflowLogger(workflow_id, self.repo_root)
        logger.info("workflow", f"Started workflow: {workflow.name}")

        # Print workflow start
        console.workflow_start(workflow.name, workflow_id)

        skip_until = from_step

        for step in workflow.steps:
            if skip_until:
                if step.name == skip_until:
                    skip_until = None
                else:
                    continue

            try:
                self._execute_step(step, progress, variables, logger, console)
                save_progress(progress, self.repo_root)

                if progress.status == WorkflowStatus.FAILED.value:
                    break

            except Exception as e:
                logger.error(step.name, f"Step failed: {e}")
                console.step_failed(step.name, str(e))
                update_step_failed(progress, step.name, str(e))
                progress.status = WorkflowStatus.FAILED.value
                save_progress(progress, self.repo_root)
                break

        if progress.status == WorkflowStatus.RUNNING.value:
            progress.status = WorkflowStatus.COMPLETED.value
        progress.completed_at = datetime.now(timezone.utc).isoformat()
        save_progress(progress, self.repo_root)

        self._render_outputs(workflow, progress, variables, logger)

        # Print workflow completion
        console.workflow_complete(workflow.name, progress.status)
        logger.info("workflow", f"Workflow {progress.status}: {workflow.name}")
        return progress

    def _render_outputs(
        self,
        workflow: WorkflowDefinition,
        progress: WorkflowProgress,
        variables: dict[str, Any],
        logger: WorkflowLogger,
    ) -> None:
        """Render output templates at workflow completion."""
        if not workflow.outputs:
            return

        step_outputs = {}
        for step in progress.completed_steps:
            step_outputs[step.name] = {
                "status": step.status,
                "started_at": step.started_at,
                "completed_at": step.completed_at,
                "output_summary": step.output_summary,
                "error": step.error,
            }
            if step.name in progress.step_outputs:
                step_outputs[step.name]["output"] = progress.step_outputs[step.name]

        context = build_template_context(
            workflow_name=workflow.name,
            started_at=progress.started_at or "",
            completed_at=progress.completed_at,
            step_outputs=step_outputs,
            files_changed=[],
            branches=[],
            pull_requests=[],
            inputs=variables,
        )

        plugin_templates = Path(__file__).parent / "templates"
        template_dirs = [plugin_templates, self.repo_root]

        # Workflow output directory: agentic/outputs/<workflow_id>/
        output_dir = self.repo_root / "agentic" / "outputs" / progress.workflow_id

        for output in workflow.outputs:
            if output.when == "completed" and progress.status != WorkflowStatus.COMPLETED.value:
                continue
            if output.when == "failed" and progress.status != WorkflowStatus.FAILED.value:
                continue

            try:
                output_path_str = output.path
                if self.renderer.has_variables(output_path_str):
                    output_path_str = self.renderer.render_string(output_path_str, {"workflow_id": progress.workflow_id, **variables})
                # Resolve output path relative to workflow output directory
                output_path = output_dir / output_path_str

                render_workflow_output(
                    template_path=Path(output.template),
                    output_path=output_path,
                    context=context,
                    template_dirs=template_dirs,
                )
                logger.info("workflow", f"Generated output: {output_path}")
            except Exception as e:
                logger.error("workflow", f"Failed to render output '{output.name}': {e}")

    def _execute_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        variables: dict[str, Any],
        logger: WorkflowLogger,
        console: ConsoleOutput,
    ) -> None:
        """Execute a single step by dispatching to the appropriate executor."""
        logger.info(step.name, f"Starting step: {step.name}")
        console.step_start(step.name, step.type.value)
        update_step_started(progress, step.name)
        save_progress(progress, self.repo_root)

        # Build step context
        context = StepContext(
            repo_root=self.repo_root,
            config=self.config,
            renderer=self.renderer,
            workflow_settings=self.workflow_settings,
            workflow_id=progress.workflow_id,
            variables=variables,
            outputs=progress.step_outputs,
        )

        # Get executor for step type
        executor = self.executors.get(step.type)
        if not executor:
            raise NotImplementedError(f"Step type not yet implemented: {step.type.value}")

        # Execute the step
        executor.execute(step, progress, context, logger, console)
