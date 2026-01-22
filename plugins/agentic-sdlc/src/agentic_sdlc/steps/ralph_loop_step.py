"""Ralph loop step executor."""

from __future__ import annotations

from typing import TYPE_CHECKING

from agentic_sdlc.console import extract_summary
from agentic_sdlc.progress import WorkflowStatus, update_step_completed, update_step_failed
from agentic_sdlc.ralph_loop import (
    build_ralph_system_message,
    create_ralph_state,
    deactivate_ralph_state,
    detect_completion_promise,
    update_ralph_iteration,
)
from agentic_sdlc.runner import run_claude
from agentic_sdlc.steps.base import StepContext, StepExecutor, StepResult

if TYPE_CHECKING:
    from agentic_sdlc.console import ConsoleOutput
    from agentic_sdlc.logging.logger import WorkflowLogger
    from agentic_sdlc.parser import StepDefinition
    from agentic_sdlc.progress import WorkflowProgress


class RalphLoopStepExecutor(StepExecutor):
    """Executes a Ralph Wiggum loop step.

    The Ralph loop runs the same prompt iteratively until:
    - Claude outputs a completion JSON with the expected promise
    - Maximum iterations is reached
    """

    def execute(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: StepContext,
        logger: WorkflowLogger,
        console: ConsoleOutput,
    ) -> StepResult:
        """Execute a Ralph Wiggum loop step."""
        prompt_template = step.prompt or ""
        completion_promise = step.completion_promise or "COMPLETE"
        template_context = context.build_template_context()

        if context.renderer.has_variables(completion_promise):
            completion_promise = context.renderer.render_string(completion_promise, template_context)

        # Handle max_iterations which may be a template string or integer
        max_iterations_raw = step.max_iterations
        if isinstance(max_iterations_raw, str) and context.renderer.has_variables(max_iterations_raw):
            max_iterations = int(context.renderer.render_string(max_iterations_raw, template_context))
        else:
            max_iterations = int(max_iterations_raw) if max_iterations_raw else 5

        timeout = (step.step_timeout_minutes or 30) * 60
        bypass_permissions = context.workflow_settings.bypass_permissions if context.workflow_settings else False
        allowed_tools = context.workflow_settings.required_tools if context.workflow_settings else None

        # Always enable streaming when console is provided (handles both BASE and ALL modes)
        print_output = True

        logger.info(step.name, f"Starting Ralph loop (max {max_iterations} iterations)")
        console.info(f"Ralph loop starting (max {max_iterations} iterations)")

        all_outputs: list[str] = []

        for iteration in range(1, max_iterations + 1):
            logger.info(step.name, f"Ralph loop iteration {iteration}/{max_iterations}")

            # Render prompt with iteration context for each iteration
            iteration_context = {
                **template_context,
                "iteration": iteration,
                "max_iterations": max_iterations,
            }
            if context.renderer.has_variables(prompt_template):
                prompt = context.renderer.render_string(prompt_template, iteration_context)
            else:
                prompt = prompt_template

            # Create ralph state on first iteration (after we have the rendered prompt)
            if iteration == 1:
                _ralph_state = create_ralph_state(
                    workflow_id=progress.workflow_id,
                    step_name=step.name,
                    prompt=prompt,
                    max_iterations=max_iterations,
                    completion_promise=completion_promise,
                    repo_root=context.repo_root,
                )

            system_message = build_ralph_system_message(iteration, max_iterations, completion_promise)
            full_prompt = f"{system_message}{prompt}"

            result = run_claude(
                prompt=full_prompt,
                cwd=context.repo_root,
                model=context.resolve_model(step.model),
                timeout=timeout,
                print_output=print_output,
                skip_permissions=bypass_permissions,
                allowed_tools=allowed_tools,
                console=console,
                workflow_id=context.workflow_id,
            )

            if not result.success:
                error_summary = extract_summary(result.stderr) if result.stderr else "Unknown error"
                logger.warning(step.name, f"Iteration {iteration} failed: {result.stderr}")
                console.ralph_iteration(step.name, iteration, max_iterations, f"Failed: {error_summary}")
                if iteration < max_iterations:
                    update_ralph_iteration(progress.workflow_id, step.name, context.repo_root)
                    continue
                else:
                    deactivate_ralph_state(progress.workflow_id, step.name, context.repo_root)
                    error_msg = f"Ralph loop failed after {max_iterations} iterations"
                    console.step_failed(step.name, error_msg)
                    update_step_failed(progress, step.name, error_msg)
                    progress.status = WorkflowStatus.FAILED.value
                    return StepResult(success=False, error=error_msg)

            all_outputs.append(result.stdout)

            # Print iteration summary
            iteration_summary = extract_summary(result.stdout)
            console.ralph_iteration(step.name, iteration, max_iterations, iteration_summary)

            completion_result = detect_completion_promise(result.stdout, completion_promise)

            # Check for failure signal first
            if completion_result.is_failed:
                error_msg = f"Ralph loop failed: {completion_result.failure_reason}"
                logger.error(step.name, error_msg)
                deactivate_ralph_state(progress.workflow_id, step.name, context.repo_root)
                combined_output = "\n\n---\n\n".join(all_outputs)
                console.step_failed(step.name, error_msg)
                update_step_failed(progress, step.name, error_msg)
                progress.status = WorkflowStatus.FAILED.value
                return StepResult(success=False, error=error_msg, full_output=combined_output)

            if completion_result.is_complete and completion_result.promise_matched:
                logger.info(step.name, f"Ralph loop completed at iteration {iteration}")
                deactivate_ralph_state(progress.workflow_id, step.name, context.repo_root)
                combined_output = "\n\n---\n\n".join(all_outputs)
                output_summary = f"Completed in {iteration} iterations"
                update_step_completed(progress, step.name, output_summary, combined_output)
                console.ralph_complete(step.name, iteration, max_iterations)
                return StepResult(success=True, output_summary=output_summary, full_output=combined_output)

            if iteration < max_iterations:
                update_ralph_iteration(progress.workflow_id, step.name, context.repo_root)

        logger.warning(step.name, f"Ralph loop reached max iterations ({max_iterations}) without completion")
        deactivate_ralph_state(progress.workflow_id, step.name, context.repo_root)
        combined_output = "\n\n---\n\n".join(all_outputs)
        output_summary = f"Max iterations ({max_iterations}) reached without completion promise"
        update_step_completed(progress, step.name, output_summary, combined_output)
        console.ralph_max_iterations(step.name, max_iterations)
        return StepResult(success=True, output_summary=output_summary, full_output=combined_output)
