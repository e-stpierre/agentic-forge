"""Serial step executor."""

from __future__ import annotations

from typing import TYPE_CHECKING

from agentic_sdlc.progress import WorkflowStatus, update_step_completed, update_step_failed
from agentic_sdlc.steps.base import StepContext, StepExecutor, StepResult

if TYPE_CHECKING:
    from agentic_sdlc.console import ConsoleOutput
    from agentic_sdlc.logging.logger import WorkflowLogger
    from agentic_sdlc.parser import StepDefinition
    from agentic_sdlc.progress import WorkflowProgress
    from agentic_sdlc.steps.parallel_step import BranchStepExecutor


class SerialStepExecutor(StepExecutor):
    """Executes steps sequentially within a serial block.

    Each step runs one after another. If any step fails, subsequent steps are skipped.
    """

    def __init__(self, branch_executor: BranchStepExecutor):
        """Initialize with branch executor for nested steps.

        Args:
            branch_executor: Executor for steps within serial block
        """
        self.branch_executor = branch_executor

    def execute(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: StepContext,
        logger: WorkflowLogger,
        console: ConsoleOutput,
    ) -> StepResult:
        """Execute steps sequentially within a serial block."""
        if not step.steps:
            logger.warning(step.name, "Serial step has no sub-steps")
            update_step_completed(progress, step.name, "No sub-steps to execute")
            console.step_complete(step.name, "No sub-steps to execute")
            return StepResult(success=True, output_summary="No sub-steps to execute")

        logger.info(step.name, f"Starting serial execution of {len(step.steps)} steps")
        console.info(f"Serial: executing {len(step.steps)} steps in sequence")

        completed_count = 0

        for sub_step in step.steps:
            try:
                result = self.branch_executor.execute(sub_step, progress, context, logger, console)

                if not result.success:
                    logger.warning(step.name, f"Serial block stopped at step '{sub_step.name}' due to failure")
                    error_msg = f"Step '{sub_step.name}' failed: {result.error}"
                    update_step_failed(progress, step.name, error_msg)
                    console.step_failed(step.name, f"Step '{sub_step.name}' failed")
                    progress.status = WorkflowStatus.FAILED.value
                    return StepResult(success=False, error=error_msg)

                completed_count += 1

                if progress.status == WorkflowStatus.FAILED.value:
                    logger.warning(step.name, f"Serial block stopped at step '{sub_step.name}' due to failure")
                    break

            except Exception as e:
                logger.error(sub_step.name, f"Step failed in serial block: {e}")
                error_msg = f"Step '{sub_step.name}' failed: {e}"
                update_step_failed(progress, step.name, error_msg)
                console.step_failed(step.name, f"Step '{sub_step.name}' failed")
                progress.status = WorkflowStatus.FAILED.value
                return StepResult(success=False, error=error_msg)

        if progress.status != WorkflowStatus.FAILED.value:
            output_summary = f"Completed {completed_count}/{len(step.steps)} steps"
            update_step_completed(progress, step.name, output_summary)
            console.step_complete(step.name, output_summary)
            logger.info(step.name, output_summary)
            return StepResult(success=True, output_summary=output_summary)

        return StepResult(success=False, error="Serial execution failed")
