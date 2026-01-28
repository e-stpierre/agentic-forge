"""Parallel step executor."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import replace
from typing import TYPE_CHECKING, Any

from agentic_sdlc.git.worktree import Worktree, create_worktree, remove_worktree
from agentic_sdlc.progress import WorkflowStatus, update_step_completed, update_step_failed
from agentic_sdlc.steps.base import StepContext, StepExecutor, StepResult

if TYPE_CHECKING:
    from agentic_sdlc.console import ConsoleOutput
    from agentic_sdlc.logging.logger import WorkflowLogger
    from agentic_sdlc.parser import StepDefinition
    from agentic_sdlc.progress import WorkflowProgress


class ParallelStepExecutor(StepExecutor):
    """Executes steps in parallel.

    Each step in the parallel block runs concurrently. Results are collected
    based on the merge strategy.

    When git.worktree is enabled, each branch runs in its own git worktree.
    """

    def __init__(self, branch_executor: BranchStepExecutor):
        """Initialize with branch executor for nested steps.

        Args:
            branch_executor: Executor for steps within parallel branches
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
        """Execute steps in parallel."""
        if not step.steps:
            logger.warning(step.name, "Parallel step has no sub-steps")
            update_step_completed(progress, step.name, "No sub-steps to execute")
            console.step_complete(step.name, "No sub-steps to execute")
            return StepResult(success=True, output_summary="No sub-steps to execute")

        use_worktree = step.git and step.git.worktree

        logger.info(step.name, f"Starting parallel execution of {len(step.steps)} branches")
        if use_worktree:
            console.info(f"Parallel: starting {len(step.steps)} branches (worktree isolation)")
        else:
            console.info(f"Parallel: starting {len(step.steps)} branches")

        # Enter parallel mode to disable in-place streaming (avoids interleaved output)
        console.enter_parallel_mode()

        branch_results: dict[str, dict[str, Any]] = {}
        failed_branches: list[str] = []
        worktrees: dict[str, Worktree] = {}

        def execute_branch(branch_step: StepDefinition) -> tuple[str, bool, str, Worktree | None]:
            """Execute a single branch and return (name, success, output_summary, worktree)."""
            branch_context = replace(context)
            branch_context.variables = context.variables.copy()
            worktree: Worktree | None = None

            try:
                if use_worktree:
                    worktree = create_worktree(
                        workflow_name=progress.workflow_name,
                        step_name=branch_step.name,
                        repo_root=context.repo_root,
                    )
                    logger.info(branch_step.name, f"Created worktree: {worktree.path}")
                    console.info(f"  Branch '{branch_step.name}' worktree: {worktree.branch}")
                    branch_context.cwd_override = worktree.path

                result = self.branch_executor.execute(branch_step, progress, branch_context, logger, console)

                return (branch_step.name, result.success, result.output_summary, worktree)
            except Exception as e:
                logger.error(branch_step.name, f"Branch failed: {e}")
                return (branch_step.name, False, str(e), worktree)

        with ThreadPoolExecutor(max_workers=len(step.steps)) as executor:
            futures = {executor.submit(execute_branch, branch_step): branch_step for branch_step in step.steps}

            for future in as_completed(futures):
                branch_step = futures[future]
                try:
                    name, success, output, worktree = future.result()
                    branch_results[name] = {"success": success, "output": output}
                    if worktree:
                        worktrees[name] = worktree
                    if success:
                        console.info(f"  Branch '{name}' completed")
                    else:
                        console.error(f"  Branch '{name}' failed: {output}")
                        failed_branches.append(name)
                except Exception as e:
                    branch_results[branch_step.name] = {"success": False, "output": str(e)}
                    failed_branches.append(branch_step.name)
                    console.error(f"  Branch '{branch_step.name}' exception: {e}")

        # Exit parallel mode after all branches complete
        console.exit_parallel_mode()

        # Handle merge modes
        if step.merge_mode == "merge" and worktrees:
            self._merge_worktree_branches(step, worktrees, failed_branches, context, logger, console)

        if step.merge_mode == "independent" and worktrees:
            for name, worktree in worktrees.items():
                remove_worktree(worktree, context.repo_root, delete_branch=False)
                logger.info(name, f"Worktree removed, branch preserved: {worktree.branch}")

        # Handle completion based on merge strategy
        if step.merge_strategy == "wait-all":
            if failed_branches and step.merge_mode != "independent":
                error_msg = f"Parallel branches failed: {', '.join(failed_branches)}"
                update_step_failed(progress, step.name, error_msg)
                console.step_failed(step.name, error_msg)
                progress.status = WorkflowStatus.FAILED.value
                return StepResult(success=False, error=error_msg)
            else:
                completed = len(step.steps) - len(failed_branches)
                output_summary = f"Completed {completed}/{len(step.steps)} branches"
                if failed_branches:
                    output_summary += f" (failed: {', '.join(failed_branches)})"
                update_step_completed(progress, step.name, output_summary)
                console.step_complete(step.name, output_summary)
                logger.info(step.name, output_summary)
                return StepResult(success=True, output_summary=output_summary)

        return StepResult(success=True, output_summary="Parallel execution completed")

    def _merge_worktree_branches(
        self,
        step: StepDefinition,
        worktrees: dict[str, Worktree],
        failed_branches: list[str],
        context: StepContext,
        logger: WorkflowLogger,
        console: ConsoleOutput,
    ) -> None:
        """Merge successful worktree branches back to base branch."""
        from agentic_sdlc.git.worktree import _run_git

        console.info("Merging parallel branches...")

        for name, worktree in worktrees.items():
            if name in failed_branches:
                remove_worktree(worktree, context.repo_root, delete_branch=True)
                logger.info(name, "Failed branch worktree removed")
                continue

            try:
                _run_git(["checkout", worktree.base_branch], cwd=context.repo_root)
                _run_git(
                    ["merge", "--no-ff", "-m", f"Merge parallel branch: {name}", worktree.branch],
                    cwd=context.repo_root,
                )
                logger.info(name, f"Merged branch {worktree.branch} into {worktree.base_branch}")
                console.info(f"  Merged '{name}'")
            except Exception as e:
                logger.error(name, f"Merge failed: {e}")
                console.error(f"  Merge failed for '{name}': {e}")

            remove_worktree(worktree, context.repo_root, delete_branch=True)
            logger.info(name, "Worktree and branch cleaned up")


class BranchStepExecutor:
    """Executes steps within parallel/serial branches.

    This is a thin wrapper that delegates to the appropriate step executor
    based on step type. It's used for nested step execution.
    """

    def __init__(self, step_executors: dict[str, StepExecutor]):
        """Initialize with available step executors.

        Args:
            step_executors: Map of step type to executor instance
        """
        self.step_executors = step_executors

    def execute(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: StepContext,
        logger: WorkflowLogger,
        console: ConsoleOutput,
    ) -> StepResult:
        """Execute a branch step by delegating to the appropriate executor."""

        logger.info(step.name, f"Starting branch step: {step.name}")

        step_type = step.type.value
        executor = self.step_executors.get(step_type)
        if not executor:
            error = f"Step type not supported in branches: {step_type}"
            logger.error(step.name, error)
            return StepResult(success=False, error=error)

        return executor.execute(step, progress, context, logger, console)
