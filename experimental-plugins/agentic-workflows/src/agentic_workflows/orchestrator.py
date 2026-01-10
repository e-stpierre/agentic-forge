"""Async workflow orchestration with Claude decision loop."""

from __future__ import annotations

import json
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

from agentic_workflows.config import load_config
from agentic_workflows.executor import WorkflowExecutor
from agentic_workflows.git.worktree import (
    create_worktree,
    remove_worktree,
    prune_orphaned,
    Worktree,
)
from agentic_workflows.logging.logger import WorkflowLogger, LogLevel
from agentic_workflows.parser import (
    WorkflowDefinition,
    StepDefinition,
    StepType,
    WorkflowParser,
)
from agentic_workflows.progress import (
    WorkflowProgress,
    WorkflowStatus,
    StepStatus,
    load_progress,
    save_progress,
    create_progress,
    update_step_started,
    update_step_completed,
    update_step_failed,
    ParallelBranch,
    _progress_to_dict,
)
from agentic_workflows.runner import run_claude
from agentic_workflows.templates.renderer import TemplateRenderer

if TYPE_CHECKING:
    from typing import Any


@dataclass
class OrchestratorAction:
    """Parsed action from orchestrator response."""

    type: str
    step_name: str | None = None
    context_to_pass: str | None = None
    error_context: str | None = None


@dataclass
class OrchestratorDecision:
    """Decision from Claude orchestrator."""

    workflow_status: str
    action: OrchestratorAction
    reasoning: str
    progress_update: str


class WorkflowOrchestrator:
    """Main orchestration loop for workflow execution."""

    def __init__(self, repo_root: Path | None = None):
        self.repo_root = repo_root or Path.cwd()
        self.config = load_config(self.repo_root)
        self.renderer = TemplateRenderer()
        self.executor = WorkflowExecutor(self.repo_root)
        self._shutdown_requested = False
        self._running_processes: list = []

        if sys.platform != "win32":
            signal.signal(signal.SIGINT, self._handle_shutdown)
            signal.signal(signal.SIGTERM, self._handle_shutdown)
        else:
            signal.signal(signal.SIGINT, self._handle_shutdown)
            signal.signal(signal.SIGBREAK, self._handle_shutdown)

    def _handle_shutdown(self, signum: int, frame: Any) -> None:
        """Handle graceful shutdown on SIGINT/SIGTERM."""
        self._shutdown_requested = True
        print("\nShutdown requested, cleaning up...")

    def run(
        self,
        workflow: WorkflowDefinition,
        variables: dict[str, Any] | None = None,
        from_step: str | None = None,
        terminal_output: str = "base",
    ) -> WorkflowProgress:
        """Run a workflow with orchestration loop.

        Args:
            workflow: Parsed workflow definition
            variables: Workflow variables
            from_step: Resume from specific step
            terminal_output: Output mode (base or all)
        """
        prune_orphaned(self.repo_root)

        variables = variables or {}

        progress = self._init_progress(workflow, variables, from_step)
        logger = WorkflowLogger(progress.workflow_id, self.repo_root)

        logger.info("orchestrator", f"Starting workflow: {workflow.name}")

        while not self._shutdown_requested:
            decision = self._get_orchestrator_decision(workflow, progress, logger)

            if decision is None:
                logger.error("orchestrator", "Failed to get orchestrator decision")
                progress.status = WorkflowStatus.FAILED.value
                break

            logger.info("orchestrator", decision.reasoning)

            if decision.workflow_status == "completed":
                progress.status = WorkflowStatus.COMPLETED.value
                break
            elif decision.workflow_status == "failed":
                progress.status = WorkflowStatus.FAILED.value
                break
            elif decision.workflow_status == "blocked":
                progress.status = WorkflowStatus.PAUSED.value
                break

            if decision.action.type == "execute_step":
                self._execute_step_action(
                    workflow, progress, decision.action, logger, terminal_output
                )
            elif decision.action.type == "retry_step":
                self._retry_step_action(
                    workflow, progress, decision.action, logger, terminal_output
                )
            elif decision.action.type == "wait_for_human":
                self._wait_for_human_action(progress, decision.action, logger)
                break
            elif decision.action.type == "abort":
                progress.status = WorkflowStatus.FAILED.value
                break

            save_progress(progress, self.repo_root)

            if self._shutdown_requested:
                self._handle_graceful_shutdown(progress, logger)
                break

        progress.completed_at = datetime.now(timezone.utc).isoformat()
        save_progress(progress, self.repo_root)

        return progress

    def _init_progress(
        self,
        workflow: WorkflowDefinition,
        variables: dict[str, Any],
        from_step: str | None,
    ) -> WorkflowProgress:
        """Initialize or resume progress document."""
        import uuid

        workflow_id = str(uuid.uuid4())[:8]
        step_names = self._collect_step_names(workflow.steps)

        for var in workflow.variables:
            if var.name not in variables:
                if var.required and var.default is None:
                    raise ValueError(f"Missing required variable: {var.name}")
                variables[var.name] = var.default

        progress = create_progress(workflow_id, workflow.name, step_names, variables)

        if from_step:
            skip = True
            new_pending = []
            for name in step_names:
                if name == from_step:
                    skip = False
                if skip:
                    from agentic_workflows.progress import StepProgress

                    progress.completed_steps.append(
                        StepProgress(
                            name=name,
                            status="skipped",
                            output_summary="Skipped (resumed from later step)",
                        )
                    )
                else:
                    new_pending.append(name)
            progress.pending_steps = new_pending

        save_progress(progress, self.repo_root)
        return progress

    def _collect_step_names(self, steps: list[StepDefinition]) -> list[str]:
        """Recursively collect all step names."""
        names = []
        for step in steps:
            names.append(step.name)
            if step.steps:
                names.extend(self._collect_step_names(step.steps))
            if step.then_steps:
                names.extend(self._collect_step_names(step.then_steps))
            if step.else_steps:
                names.extend(self._collect_step_names(step.else_steps))
        return names

    def _get_orchestrator_decision(
        self,
        workflow: WorkflowDefinition,
        progress: WorkflowProgress,
        logger: WorkflowLogger,
    ) -> OrchestratorDecision | None:
        """Call Claude orchestrator to get next action."""
        cmd_path = Path(__file__).parent.parent / "commands" / "orchestrate.md"
        if not cmd_path.exists():
            logger.error("orchestrator", "Orchestrate command not found")
            return None

        cmd_template = cmd_path.read_text(encoding="utf-8")

        workflow_yaml = yaml.dump(self._workflow_to_dict(workflow), default_flow_style=False)
        progress_json = json.dumps(_progress_to_dict(progress), indent=2)

        last_step_name = None
        last_step_output = None
        if progress.completed_steps:
            last = progress.completed_steps[-1]
            if isinstance(last, dict):
                last_step_name = last.get("name")
            else:
                last_step_name = last.name
            last_step_output = progress.step_outputs.get(last_step_name, "")

        prompt = self.renderer.render_string(
            cmd_template,
            {
                "workflow_yaml": workflow_yaml,
                "progress_json": progress_json,
                "last_step_name": last_step_name,
                "last_step_output": last_step_output[:2000] if last_step_output else None,
            },
        )

        max_retry = self.config["defaults"]["maxRetry"]
        for attempt in range(max_retry):
            result = run_claude(
                prompt=prompt,
                cwd=self.repo_root,
                model="sonnet",
                timeout=120,
                print_output=False,
            )

            if not result.success:
                logger.warning(
                    "orchestrator", f"Orchestrator call failed: {result.stderr}"
                )
                continue

            try:
                response = self._parse_orchestrator_response(result.stdout)
                return response
            except Exception as e:
                logger.warning("orchestrator", f"Failed to parse response: {e}")
                continue

        return None

    def _parse_orchestrator_response(self, output: str) -> OrchestratorDecision:
        """Parse Claude's JSON response."""
        json_str = output
        if "```json" in output:
            start = output.find("```json") + 7
            end = output.find("```", start)
            json_str = output[start:end].strip()
        elif "```" in output:
            start = output.find("```") + 3
            end = output.find("```", start)
            json_str = output[start:end].strip()

        data = json.loads(json_str)

        action_data = data.get("next_action", {})
        action = OrchestratorAction(
            type=action_data.get("type", "abort"),
            step_name=action_data.get("step_name"),
            context_to_pass=action_data.get("context_to_pass"),
            error_context=action_data.get("error_context"),
        )

        return OrchestratorDecision(
            workflow_status=data.get("workflow_status", "failed"),
            action=action,
            reasoning=data.get("reasoning", ""),
            progress_update=data.get("progress_update", ""),
        )

    def _execute_step_action(
        self,
        workflow: WorkflowDefinition,
        progress: WorkflowProgress,
        action: OrchestratorAction,
        logger: WorkflowLogger,
        terminal_output: str,
    ) -> None:
        """Execute a step based on orchestrator decision."""
        step = self._find_step(workflow.steps, action.step_name)
        if not step:
            logger.error("orchestrator", f"Step not found: {action.step_name}")
            return

        if step.type == StepType.PARALLEL:
            self._execute_parallel_step(
                workflow, step, progress, logger, terminal_output
            )
        elif step.type == StepType.CONDITIONAL:
            self._execute_conditional_step(
                workflow, step, progress, logger, terminal_output
            )
        elif step.type == StepType.RECURRING:
            self._execute_recurring_step(
                workflow, step, progress, logger, terminal_output
            )
        elif step.type == StepType.WAIT_FOR_HUMAN:
            self._execute_wait_for_human_step(step, progress, logger)
        else:
            print_output = terminal_output == "all"
            self.executor._execute_step(
                step, progress, progress.variables, logger, print_output
            )

    def _execute_parallel_step(
        self,
        workflow: WorkflowDefinition,
        step: StepDefinition,
        progress: WorkflowProgress,
        logger: WorkflowLogger,
        terminal_output: str,
    ) -> None:
        """Execute parallel steps in separate worktrees."""
        logger.info(
            step.name, f"Starting parallel execution with {len(step.steps)} branches"
        )
        update_step_started(progress, step.name)

        max_workers = self.config["execution"]["maxWorkers"]
        worktrees: list[Worktree] = []

        try:
            for sub_step in step.steps:
                wt = create_worktree(
                    workflow.name,
                    sub_step.name,
                    repo_root=self.repo_root,
                )
                worktrees.append(wt)

                branch = ParallelBranch(
                    branch_id=sub_step.name,
                    status="running",
                    worktree_path=str(wt.path),
                    progress_file=str(
                        wt.path
                        / "agentic"
                        / "workflows"
                        / progress.workflow_id
                        / "progress.json"
                    ),
                )
                progress.parallel_branches.append(branch)

            save_progress(progress, self.repo_root)

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {}
                for wt, sub_step in zip(worktrees, step.steps):
                    future = executor.submit(
                        self._execute_in_worktree,
                        workflow,
                        sub_step,
                        progress,
                        wt,
                        logger,
                        terminal_output,
                    )
                    futures[future] = (wt, sub_step)

                all_success = True
                for future in as_completed(futures):
                    wt, sub_step = futures[future]
                    try:
                        result = future.result()
                        if not result:
                            all_success = False
                            logger.error(sub_step.name, "Parallel branch failed")
                    except Exception as e:
                        all_success = False
                        logger.error(sub_step.name, f"Parallel branch error: {e}")

            if all_success:
                update_step_completed(
                    progress, step.name, "All parallel branches completed"
                )
                logger.info(step.name, "Parallel execution completed successfully")
            else:
                update_step_failed(
                    progress, step.name, "One or more parallel branches failed"
                )

        finally:
            for wt in worktrees:
                try:
                    remove_worktree(wt, self.repo_root, delete_branch=False)
                except Exception as e:
                    logger.warning(step.name, f"Failed to clean worktree: {e}")

            progress.parallel_branches.clear()

    def _execute_in_worktree(
        self,
        workflow: WorkflowDefinition,
        step: StepDefinition,
        parent_progress: WorkflowProgress,
        worktree: Worktree,
        logger: WorkflowLogger,
        terminal_output: str,
    ) -> bool:
        """Execute a step in a worktree."""
        wt_executor = WorkflowExecutor(worktree.path)
        wt_logger = WorkflowLogger(parent_progress.workflow_id, worktree.path)

        try:
            print_output = terminal_output == "all"
            wt_executor._execute_step(
                step, parent_progress, parent_progress.variables, wt_logger, print_output
            )
            return True
        except Exception as e:
            logger.error(step.name, f"Worktree execution failed: {e}")
            return False

    def _execute_conditional_step(
        self,
        workflow: WorkflowDefinition,
        step: StepDefinition,
        progress: WorkflowProgress,
        logger: WorkflowLogger,
        terminal_output: str,
    ) -> None:
        """Execute conditional step based on condition evaluation."""
        logger.info(step.name, f"Evaluating condition: {step.condition}")
        update_step_started(progress, step.name)

        context = {"outputs": progress.step_outputs, "variables": progress.variables}
        try:
            condition_result = self.renderer.render_string(
                "{{ " + (step.condition or "false") + " }}", context
            )
            is_true = condition_result.lower() in ("true", "1", "yes")
        except Exception as e:
            logger.error(step.name, f"Condition evaluation failed: {e}")
            update_step_failed(progress, step.name, f"Condition error: {e}")
            return

        steps_to_run = step.then_steps if is_true else step.else_steps
        logger.info(
            step.name,
            f"Condition {'met' if is_true else 'not met'}, executing {len(steps_to_run)} steps",
        )

        print_output = terminal_output == "all"
        for sub_step in steps_to_run:
            self.executor._execute_step(
                sub_step, progress, progress.variables, logger, print_output
            )
            if progress.status == WorkflowStatus.FAILED.value:
                break

        if progress.status != WorkflowStatus.FAILED.value:
            update_step_completed(progress, step.name, f"Condition: {is_true}")

    def _execute_recurring_step(
        self,
        workflow: WorkflowDefinition,
        step: StepDefinition,
        progress: WorkflowProgress,
        logger: WorkflowLogger,
        terminal_output: str,
    ) -> None:
        """Execute recurring step until condition met or max iterations."""
        logger.info(
            step.name, f"Starting recurring step (max {step.max_iterations} iterations)"
        )
        update_step_started(progress, step.name)

        print_output = terminal_output == "all"
        iteration = 0

        while iteration < step.max_iterations:
            iteration += 1
            logger.info(step.name, f"Iteration {iteration}/{step.max_iterations}")

            for sub_step in step.steps:
                self.executor._execute_step(
                    sub_step, progress, progress.variables, logger, print_output
                )
                if progress.status == WorkflowStatus.FAILED.value:
                    return

            if step.until:
                context = {
                    "outputs": progress.step_outputs,
                    "variables": progress.variables,
                }
                try:
                    result = self.renderer.render_string(
                        "{{ " + step.until + " }}", context
                    )
                    if result.lower() in ("true", "1", "yes"):
                        logger.info(
                            step.name,
                            f"Until condition met after {iteration} iterations",
                        )
                        break
                except Exception as e:
                    logger.warning(step.name, f"Until condition error: {e}")

        update_step_completed(
            progress, step.name, f"Completed after {iteration} iterations"
        )

    def _execute_wait_for_human_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        logger: WorkflowLogger,
    ) -> None:
        """Set up wait-for-human step."""
        logger.info(step.name, f"Waiting for human input: {step.message}")
        update_step_started(progress, step.name)

        progress.current_step = {
            "name": step.name,
            "type": "wait-for-human",
            "message": step.message,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "timeout_minutes": step.step_timeout_minutes or 5,
            "on_timeout": step.on_timeout,
        }
        progress.status = WorkflowStatus.PAUSED.value

        print(f"\n{'='*60}")
        print("HUMAN INPUT REQUIRED")
        print(f"{'='*60}")
        print(f"\n{step.message}\n")
        print(
            f"Provide input with: agentic-workflow input {progress.workflow_id} \"<your response>\""
        )
        print(f"{'='*60}\n")

    def _retry_step_action(
        self,
        workflow: WorkflowDefinition,
        progress: WorkflowProgress,
        action: OrchestratorAction,
        logger: WorkflowLogger,
        terminal_output: str,
    ) -> None:
        """Retry a failed step with error context."""
        step = self._find_step(workflow.steps, action.step_name)
        if not step:
            logger.error("orchestrator", f"Step not found: {action.step_name}")
            return

        if action.error_context and step.prompt:
            step.prompt = f"{step.prompt}\n\nPrevious attempt failed:\n{action.error_context}"

        print_output = terminal_output == "all"
        self.executor._execute_step(
            step, progress, progress.variables, logger, print_output
        )

    def _wait_for_human_action(
        self,
        progress: WorkflowProgress,
        action: OrchestratorAction,
        logger: WorkflowLogger,
    ) -> None:
        """Handle wait for human action from orchestrator."""
        progress.status = WorkflowStatus.PAUSED.value
        logger.info("orchestrator", "Workflow paused waiting for human input")

    def _find_step(
        self, steps: list[StepDefinition], name: str | None
    ) -> StepDefinition | None:
        """Find step by name recursively."""
        if not name:
            return None
        for step in steps:
            if step.name == name:
                return step
            if step.steps:
                found = self._find_step(step.steps, name)
                if found:
                    return found
            if step.then_steps:
                found = self._find_step(step.then_steps, name)
                if found:
                    return found
            if step.else_steps:
                found = self._find_step(step.else_steps, name)
                if found:
                    return found
        return None

    def _handle_graceful_shutdown(
        self,
        progress: WorkflowProgress,
        logger: WorkflowLogger,
    ) -> None:
        """Handle graceful shutdown."""
        logger.info("orchestrator", "Performing graceful shutdown")
        progress.status = WorkflowStatus.CANCELLED.value

        prune_orphaned(self.repo_root)

    def _workflow_to_dict(self, workflow: WorkflowDefinition) -> dict[str, Any]:
        """Convert workflow to dict for YAML serialization."""
        return {
            "name": workflow.name,
            "steps": [{"name": s.name, "type": s.type.value} for s in workflow.steps],
        }


def process_human_input(
    workflow_id: str, response: str, repo_root: Path | None = None
) -> bool:
    """Process human input for a paused workflow.

    Returns True if workflow can resume.
    """
    if repo_root is None:
        repo_root = Path.cwd()

    progress = load_progress(workflow_id, repo_root)
    if not progress:
        print(f"Workflow not found: {workflow_id}")
        return False

    if progress.status != WorkflowStatus.PAUSED.value:
        print(f"Workflow is not paused: {progress.status}")
        return False

    if not progress.current_step or progress.current_step.get("type") != "wait-for-human":
        print("Workflow is not waiting for human input")
        return False

    progress.current_step["human_input"] = response
    progress.status = WorkflowStatus.RUNNING.value
    save_progress(progress, repo_root)

    print(f"Input received. Resume workflow with: agentic-workflow resume {workflow_id}")
    return True
