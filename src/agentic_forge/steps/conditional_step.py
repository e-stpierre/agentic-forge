"""Conditional step executor."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from agentic_sdlc.progress import WorkflowStatus, update_step_completed, update_step_failed
from agentic_sdlc.steps.base import StepContext, StepExecutor, StepResult

if TYPE_CHECKING:
    from agentic_sdlc.console import ConsoleOutput
    from agentic_sdlc.logging.logger import WorkflowLogger
    from agentic_sdlc.parser import StepDefinition
    from agentic_sdlc.progress import WorkflowProgress
    from agentic_sdlc.steps.parallel_step import BranchStepExecutor


class ConditionalStepExecutor(StepExecutor):
    """Executes a conditional step based on condition evaluation.

    Evaluates the condition expression and executes either the 'then' or 'else' branch.
    """

    def __init__(self, branch_executor: BranchStepExecutor):
        """Initialize with branch executor for nested steps.

        Args:
            branch_executor: Executor for steps within conditional branches
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
        """Execute a conditional step based on condition evaluation."""
        condition = step.condition or "false"
        logger.info(step.name, f"Evaluating condition: {condition}")

        template_context = context.build_template_context()
        if context.renderer.has_variables(condition):
            condition = context.renderer.render_string(condition, template_context)

        condition_result = self._evaluate_condition(condition, template_context)
        logger.info(step.name, f"Condition evaluated to: {condition_result}")
        console.info(f"Conditional '{step.name}': {condition} = {condition_result}")

        if condition_result:
            steps_to_run = step.then_steps
            branch_name = "then"
        else:
            steps_to_run = step.else_steps
            branch_name = "else"

        if not steps_to_run:
            output_summary = f"Condition {condition_result}, no '{branch_name}' branch to execute"
            update_step_completed(progress, step.name, output_summary)
            console.step_complete(step.name, output_summary)
            return StepResult(success=True, output_summary=output_summary)

        logger.info(step.name, f"Executing '{branch_name}' branch with {len(steps_to_run)} steps")

        for sub_step in steps_to_run:
            try:
                result = self.branch_executor.execute(sub_step, progress, context, logger, console)

                if not result.success:
                    logger.warning(step.name, f"Conditional '{branch_name}' branch stopped due to failure")
                    error_msg = f"Step '{sub_step.name}' failed: {result.error}"
                    update_step_failed(progress, step.name, error_msg)
                    console.step_failed(step.name, f"Step '{sub_step.name}' failed")
                    progress.status = WorkflowStatus.FAILED.value
                    return StepResult(success=False, error=error_msg)

                if progress.status == WorkflowStatus.FAILED.value:
                    logger.warning(step.name, f"Conditional '{branch_name}' branch stopped due to failure")
                    break

            except Exception as e:
                logger.error(sub_step.name, f"Step failed in conditional branch: {e}")
                error_msg = f"Step '{sub_step.name}' failed: {e}"
                update_step_failed(progress, step.name, error_msg)
                console.step_failed(step.name, f"Step '{sub_step.name}' failed")
                progress.status = WorkflowStatus.FAILED.value
                return StepResult(success=False, error=error_msg)

        if progress.status != WorkflowStatus.FAILED.value:
            output_summary = f"Executed '{branch_name}' branch ({len(steps_to_run)} steps)"
            update_step_completed(progress, step.name, output_summary)
            console.step_complete(step.name, output_summary)
            logger.info(step.name, output_summary)
            return StepResult(success=True, output_summary=output_summary)

        return StepResult(success=False, error="Conditional execution failed")

    def _evaluate_condition(self, condition: str, context: dict[str, Any]) -> bool:
        """Evaluate a condition expression.

        Supports simple comparisons and variable access:
        - variables.name == 'value'
        - variables.name != 'value'
        - variables.flag (truthy check)
        """
        condition = condition.strip()

        if condition.lower() in ("true", "1", "yes"):
            return True
        if condition.lower() in ("false", "0", "no", "none", ""):
            return False

        if "!=" in condition:
            left, right = condition.split("!=", 1)
            left_val = self._resolve_value(left.strip(), context)
            right_val = self._resolve_value(right.strip(), context)
            return left_val != right_val

        if "==" in condition:
            left, right = condition.split("==", 1)
            left_val = self._resolve_value(left.strip(), context)
            right_val = self._resolve_value(right.strip(), context)
            return left_val == right_val

        value = self._resolve_value(condition, context)
        return bool(value) and value not in ("none", "None", "null", "")

    def _resolve_value(self, expr: str, context: dict[str, Any]) -> Any:
        """Resolve a value expression from context or as a literal."""
        expr = expr.strip()

        if (expr.startswith("'") and expr.endswith("'")) or (expr.startswith('"') and expr.endswith('"')):
            return expr[1:-1]

        if expr.startswith("variables."):
            var_name = expr[10:]
            return context.get("variables", {}).get(var_name)

        if expr.startswith("outputs."):
            output_name = expr[8:]
            return context.get("outputs", {}).get(output_name)

        return context.get(expr, expr)
