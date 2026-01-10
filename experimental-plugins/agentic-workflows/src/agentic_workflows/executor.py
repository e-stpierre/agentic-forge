"""Workflow executor for running workflows."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agentic_workflows.config import load_config
from agentic_workflows.logging.logger import WorkflowLogger
from agentic_workflows.parser import StepDefinition, StepType, WorkflowDefinition, WorkflowSettings
from agentic_workflows.progress import (
    WorkflowProgress,
    WorkflowStatus,
    create_progress,
    save_progress,
    update_step_completed,
    update_step_failed,
    update_step_started,
)
from agentic_workflows.ralph_loop import (
    build_ralph_system_message,
    create_ralph_state,
    deactivate_ralph_state,
    detect_completion_promise,
    update_ralph_iteration,
)
from agentic_workflows.runner import run_claude, run_claude_with_command
from agentic_workflows.templates.renderer import (
    TemplateRenderer,
    build_template_context,
    render_workflow_output,
)


class WorkflowExecutor:
    """Executes workflow definitions."""

    def __init__(self, repo_root: Path | None = None):
        self.repo_root = repo_root or Path.cwd()
        self.config = load_config(self.repo_root)
        self.renderer = TemplateRenderer()
        self.workflow_settings: WorkflowSettings | None = None

    def run(
        self,
        workflow: WorkflowDefinition,
        variables: dict[str, Any] | None = None,
        from_step: str | None = None,
        terminal_output: str = "base",
        dry_run: bool = False,
    ) -> WorkflowProgress:
        """Execute a workflow.

        Args:
            workflow: Parsed workflow definition
            variables: Variables to pass to templates
            from_step: Resume from a specific step
            terminal_output: Output mode (base or all)
            dry_run: Validate without executing
        """
        variables = variables or {}
        workflow_id = str(uuid.uuid4())[:8]
        self.workflow_settings = workflow.settings

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

        if dry_run:
            logger.info("workflow", "Dry run mode - skipping execution")
            progress.status = WorkflowStatus.COMPLETED.value
            progress.completed_at = datetime.now(timezone.utc).isoformat()
            save_progress(progress, self.repo_root)
            return progress

        skip_until = from_step
        print_output = terminal_output == "all"

        for step in workflow.steps:
            if skip_until:
                if step.name == skip_until:
                    skip_until = None
                else:
                    continue

            try:
                self._execute_step(step, progress, variables, logger, print_output)
                save_progress(progress, self.repo_root)

                if progress.status == WorkflowStatus.FAILED.value:
                    break

            except Exception as e:
                logger.error(step.name, f"Step failed: {e}")
                update_step_failed(progress, step.name, str(e))
                progress.status = WorkflowStatus.FAILED.value
                save_progress(progress, self.repo_root)
                break

        if progress.status == WorkflowStatus.RUNNING.value:
            progress.status = WorkflowStatus.COMPLETED.value
        progress.completed_at = datetime.now(timezone.utc).isoformat()
        save_progress(progress, self.repo_root)

        self._render_outputs(workflow, progress, variables, logger)

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

        plugin_templates = Path(__file__).parent.parent.parent / "templates"
        template_dirs = [plugin_templates, self.repo_root]

        for output in workflow.outputs:
            if output.when == "completed" and progress.status != WorkflowStatus.COMPLETED.value:
                continue
            if output.when == "failed" and progress.status != WorkflowStatus.FAILED.value:
                continue

            try:
                output_path_str = output.path
                if self.renderer.has_variables(output_path_str):
                    output_path_str = self.renderer.render_string(output_path_str, {"workflow_id": progress.workflow_id, **variables})
                output_path = self.repo_root / output_path_str

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
        print_output: bool,
    ) -> None:
        """Execute a single step."""
        logger.info(step.name, f"Starting step: {step.name}")
        update_step_started(progress, step.name)
        save_progress(progress, self.repo_root)

        context = {
            "variables": variables,
            "outputs": progress.step_outputs,
            **variables,
        }

        if step.type == StepType.PROMPT:
            self._execute_prompt_step(step, progress, context, logger, print_output)
        elif step.type == StepType.COMMAND:
            self._execute_command_step(step, progress, context, logger, print_output)
        elif step.type == StepType.RALPH_LOOP:
            self._execute_ralph_loop_step(step, progress, context, logger, print_output)
        else:
            raise NotImplementedError(f"Step type not yet implemented: {step.type.value}")

    def _execute_prompt_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        print_output: bool,
    ) -> None:
        """Execute a prompt step."""
        prompt = step.prompt or ""

        if self.renderer.has_variables(prompt):
            prompt = self.renderer.render_string(prompt, context)

        if step.agent:
            agent_path = self.repo_root / step.agent
            if agent_path.exists():
                agent_content = agent_path.read_text(encoding="utf-8")
                prompt = f"{agent_content}\n\n{prompt}"

        timeout = (step.step_timeout_minutes or 60) * 60
        max_retry = step.step_max_retry or self.config["defaults"]["maxRetry"]
        bypass_permissions = self.workflow_settings.bypass_permissions if self.workflow_settings else False

        for attempt in range(max_retry + 1):
            result = run_claude(
                prompt=prompt,
                cwd=self.repo_root,
                model=step.model,
                timeout=timeout,
                print_output=print_output,
                skip_permissions=bypass_permissions,
            )

            if result.success:
                output_summary = result.stdout[:200] if result.stdout else ""
                update_step_completed(progress, step.name, output_summary, result.stdout)
                logger.info(step.name, "Step completed successfully")
                return

            if attempt < max_retry:
                logger.warning(
                    step.name,
                    f"Attempt {attempt + 1} failed, retrying...",
                    error=result.stderr,
                )
                if progress.current_step:
                    progress.current_step["retry_count"] = attempt + 1
            else:
                error_msg = result.stderr or "Step failed"
                update_step_failed(progress, step.name, error_msg)
                progress.status = WorkflowStatus.FAILED.value
                logger.error(step.name, f"Step failed after {max_retry + 1} attempts")

    def _execute_command_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        print_output: bool,
    ) -> None:
        """Execute a command step."""
        command = step.command or ""
        args = step.args.copy()

        for key, value in args.items():
            if isinstance(value, str) and self.renderer.has_variables(value):
                args[key] = self.renderer.render_string(value, context)

        timeout = (step.step_timeout_minutes or 60) * 60
        max_retry = step.step_max_retry or self.config["defaults"]["maxRetry"]
        bypass_permissions = self.workflow_settings.bypass_permissions if self.workflow_settings else False

        for attempt in range(max_retry + 1):
            result = run_claude_with_command(
                command=command,
                args=args,
                cwd=self.repo_root,
                model=step.model,
                timeout=timeout,
                print_output=print_output,
                skip_permissions=bypass_permissions,
            )

            if result.success:
                output_summary = result.stdout[:200] if result.stdout else ""
                update_step_completed(progress, step.name, output_summary, result.stdout)
                logger.info(step.name, "Step completed successfully")
                return

            if attempt < max_retry:
                logger.warning(
                    step.name,
                    f"Attempt {attempt + 1} failed, retrying...",
                    error=result.stderr,
                )
                if progress.current_step:
                    progress.current_step["retry_count"] = attempt + 1
            else:
                error_msg = result.stderr or "Step failed"
                update_step_failed(progress, step.name, error_msg)
                progress.status = WorkflowStatus.FAILED.value
                logger.error(step.name, f"Step failed after {max_retry + 1} attempts")

    def _execute_ralph_loop_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        print_output: bool,
    ) -> None:
        """Execute a Ralph Wiggum loop step.

        The Ralph loop runs the same prompt iteratively until:
        - Claude outputs a completion JSON with the expected promise
        - Maximum iterations is reached
        """
        prompt = step.prompt or ""
        completion_promise = step.completion_promise or "COMPLETE"

        if self.renderer.has_variables(prompt):
            prompt = self.renderer.render_string(prompt, context)

        if self.renderer.has_variables(completion_promise):
            completion_promise = self.renderer.render_string(completion_promise, context)

        # Handle max_iterations which may be a template string or integer
        max_iterations_raw = step.max_iterations
        if isinstance(max_iterations_raw, str) and self.renderer.has_variables(max_iterations_raw):
            max_iterations = int(self.renderer.render_string(max_iterations_raw, context))
        else:
            max_iterations = int(max_iterations_raw) if max_iterations_raw else 5

        timeout = (step.step_timeout_minutes or 30) * 60
        bypass_permissions = self.workflow_settings.bypass_permissions if self.workflow_settings else False

        _ralph_state = create_ralph_state(
            workflow_id=progress.workflow_id,
            step_name=step.name,
            prompt=prompt,
            max_iterations=max_iterations,
            completion_promise=completion_promise,
            repo_root=self.repo_root,
        )

        logger.info(step.name, f"Starting Ralph loop (max {max_iterations} iterations)")

        all_outputs: list[str] = []

        for iteration in range(1, max_iterations + 1):
            logger.info(step.name, f"Ralph loop iteration {iteration}/{max_iterations}")

            system_message = build_ralph_system_message(iteration, max_iterations, completion_promise)
            full_prompt = f"{system_message}{prompt}"

            result = run_claude(
                prompt=full_prompt,
                cwd=self.repo_root,
                model=step.model,
                timeout=timeout,
                print_output=print_output,
                skip_permissions=bypass_permissions,
            )

            if not result.success:
                logger.warning(step.name, f"Iteration {iteration} failed: {result.stderr}")
                if iteration < max_iterations:
                    update_ralph_iteration(progress.workflow_id, step.name, self.repo_root)
                    continue
                else:
                    deactivate_ralph_state(progress.workflow_id, step.name, self.repo_root)
                    update_step_failed(progress, step.name, f"Ralph loop failed after {max_iterations} iterations")
                    progress.status = WorkflowStatus.FAILED.value
                    return

            all_outputs.append(result.stdout)

            completion_result = detect_completion_promise(result.stdout, completion_promise)

            if completion_result.is_complete and completion_result.promise_matched:
                logger.info(step.name, f"Ralph loop completed at iteration {iteration}")
                deactivate_ralph_state(progress.workflow_id, step.name, self.repo_root)
                combined_output = "\n\n---\n\n".join(all_outputs)
                output_summary = f"Completed in {iteration} iterations"
                update_step_completed(progress, step.name, output_summary, combined_output)
                return

            if iteration < max_iterations:
                update_ralph_iteration(progress.workflow_id, step.name, self.repo_root)

        logger.warning(step.name, f"Ralph loop reached max iterations ({max_iterations}) without completion")
        deactivate_ralph_state(progress.workflow_id, step.name, self.repo_root)
        combined_output = "\n\n---\n\n".join(all_outputs)
        output_summary = f"Max iterations ({max_iterations}) reached without completion promise"
        update_step_completed(progress, step.name, output_summary, combined_output)
