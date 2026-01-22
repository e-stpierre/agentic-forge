"""Prompt step executor."""

from __future__ import annotations

from typing import TYPE_CHECKING

from agentic_sdlc.console import OutputLevel, extract_summary
from agentic_sdlc.progress import WorkflowStatus, update_step_completed, update_step_failed
from agentic_sdlc.runner import run_claude
from agentic_sdlc.steps.base import StepContext, StepExecutor, StepResult

if TYPE_CHECKING:
    from agentic_sdlc.console import ConsoleOutput
    from agentic_sdlc.logging.logger import WorkflowLogger
    from agentic_sdlc.parser import StepDefinition
    from agentic_sdlc.progress import WorkflowProgress


class PromptStepExecutor(StepExecutor):
    """Executes prompt steps by sending prompts to Claude."""

    def execute(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: StepContext,
        logger: WorkflowLogger,
        console: ConsoleOutput,
    ) -> StepResult:
        """Execute a prompt step."""
        prompt = step.prompt or ""
        template_context = context.build_template_context()

        if context.renderer.has_variables(prompt):
            prompt = context.renderer.render_string(prompt, template_context)

        cwd = context.cwd_override or context.repo_root

        # Load agent file if specified
        if step.agent:
            agent_path = context.repo_root / step.agent
            if agent_path.exists():
                agent_content = agent_path.read_text(encoding="utf-8")
                prompt = f"{agent_content}\n\n{prompt}"

        timeout = (step.step_timeout_minutes or 60) * 60
        max_retry = step.step_max_retry or context.config["defaults"]["maxRetry"]
        bypass_permissions = context.workflow_settings.bypass_permissions if context.workflow_settings else False
        allowed_tools = context.workflow_settings.required_tools if context.workflow_settings else None

        # Always enable streaming when console is provided (handles both BASE and ALL modes)
        print_output = True

        for attempt in range(max_retry + 1):
            result = run_claude(
                prompt=prompt,
                cwd=cwd,
                model=context.resolve_model(step.model),
                timeout=timeout,
                print_output=print_output,
                skip_permissions=bypass_permissions,
                allowed_tools=allowed_tools,
                console=console,
                workflow_id=context.workflow_id,
            )

            if result.success:
                # Use session output context if available, fall back to extracted summary
                session_out = result.session_output
                if session_out.is_success and session_out.context:
                    output_summary = session_out.context
                    if session_out.session_id:
                        logger.info(step.name, f"Session ID: {session_out.session_id}")
                else:
                    output_summary = extract_summary(result.stdout) if result.stdout else ""
                update_step_completed(progress, step.name, output_summary, result.stdout)
                console.step_complete(step.name, output_summary)
                logger.info(step.name, "Step completed successfully")
                return StepResult(success=True, output_summary=output_summary, full_output=result.stdout)

            if attempt < max_retry:
                error_summary = extract_summary(result.stderr) if result.stderr else "Unknown error"
                console.step_retry(step.name, attempt + 1, max_retry + 1, error_summary)
                logger.warning(
                    step.name,
                    f"Attempt {attempt + 1} failed, retrying...",
                    error=result.stderr,
                )
                if progress.current_step:
                    progress.current_step["retry_count"] = attempt + 1
            else:
                error_msg = result.stderr or "Step failed"
                error_summary = extract_summary(error_msg) if error_msg else "Unknown error"
                console.step_failed(step.name, error_summary)
                update_step_failed(progress, step.name, error_msg)
                progress.status = WorkflowStatus.FAILED.value
                logger.error(step.name, f"Step failed after {max_retry + 1} attempts")
                return StepResult(success=False, error=error_msg)

        return StepResult(success=False, error="Unexpected exit from retry loop")
