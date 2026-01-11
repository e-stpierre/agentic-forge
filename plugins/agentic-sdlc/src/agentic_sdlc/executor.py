"""Workflow executor for running workflows."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agentic_sdlc.config import load_config
from agentic_sdlc.console import ConsoleOutput, OutputLevel, extract_summary
from agentic_sdlc.git.worktree import Worktree, create_worktree, remove_worktree
from agentic_sdlc.logging.logger import WorkflowLogger
from agentic_sdlc.parser import StepDefinition, StepType, WorkflowDefinition, WorkflowSettings
from agentic_sdlc.progress import (
    WorkflowProgress,
    WorkflowStatus,
    create_progress,
    generate_workflow_id,
    save_progress,
    update_step_completed,
    update_step_failed,
    update_step_started,
)
from agentic_sdlc.ralph_loop import (
    build_ralph_system_message,
    create_ralph_state,
    deactivate_ralph_state,
    detect_completion_promise,
    update_ralph_iteration,
)
from agentic_sdlc.renderer import (
    TemplateRenderer,
    build_template_context,
    render_workflow_output,
)
from agentic_sdlc.runner import run_claude, run_claude_with_command


class WorkflowExecutor:
    """Executes workflow definitions."""

    def __init__(self, repo_root: Path | None = None):
        self.repo_root = repo_root or Path.cwd()
        self.config = load_config(self.repo_root)
        self.renderer = TemplateRenderer()
        self.workflow_settings: WorkflowSettings | None = None

    def _resolve_model(self, step_model: str | None) -> str:
        """Resolve the model to use for a step.

        Priority: step.model > config.defaults.model > "sonnet"
        """
        if step_model:
            return step_model
        return self.config["defaults"].get("model", "sonnet")

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

        if dry_run:
            logger.info("workflow", "Dry run mode - skipping execution")
            console.info("Dry run mode - skipping execution")
            progress.status = WorkflowStatus.COMPLETED.value
            progress.completed_at = datetime.now(timezone.utc).isoformat()
            save_progress(progress, self.repo_root)
            return progress

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
        console: ConsoleOutput,
    ) -> None:
        """Execute a single step."""
        logger.info(step.name, f"Starting step: {step.name}")
        console.step_start(step.name, step.type.value)
        update_step_started(progress, step.name)
        save_progress(progress, self.repo_root)

        context = {
            "variables": variables,
            "outputs": progress.step_outputs,
            **variables,
        }

        if step.type == StepType.PROMPT:
            self._execute_prompt_step(step, progress, context, logger, console)
        elif step.type == StepType.COMMAND:
            self._execute_command_step(step, progress, context, logger, console)
        elif step.type == StepType.PARALLEL:
            self._execute_parallel_step(step, progress, context, logger, console)
        elif step.type == StepType.SERIAL:
            self._execute_serial_step(step, progress, context, logger, console)
        elif step.type == StepType.CONDITIONAL:
            self._execute_conditional_step(step, progress, context, logger, console)
        elif step.type == StepType.RALPH_LOOP:
            self._execute_ralph_loop_step(step, progress, context, logger, console)
        else:
            raise NotImplementedError(f"Step type not yet implemented: {step.type.value}")

    def _execute_prompt_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        console: ConsoleOutput,
        cwd_override: Path | None = None,
    ) -> None:
        """Execute a prompt step."""
        prompt = step.prompt or ""

        if self.renderer.has_variables(prompt):
            prompt = self.renderer.render_string(prompt, context)

        cwd = cwd_override or self.repo_root

        if step.agent:
            agent_path = self.repo_root / step.agent
            if agent_path.exists():
                agent_content = agent_path.read_text(encoding="utf-8")
                prompt = f"{agent_content}\n\n{prompt}"

        timeout = (step.step_timeout_minutes or 60) * 60
        max_retry = step.step_max_retry or self.config["defaults"]["maxRetry"]
        bypass_permissions = self.workflow_settings.bypass_permissions if self.workflow_settings else False
        allowed_tools = self.workflow_settings.required_tools if self.workflow_settings else None

        print_output = console.level == OutputLevel.ALL

        for attempt in range(max_retry + 1):
            result = run_claude(
                prompt=prompt,
                cwd=cwd,
                model=self._resolve_model(step.model),
                timeout=timeout,
                print_output=print_output,
                skip_permissions=bypass_permissions,
                allowed_tools=allowed_tools,
                console=console,
            )

            if result.success:
                output_summary = extract_summary(result.stdout) if result.stdout else ""
                update_step_completed(progress, step.name, output_summary, result.stdout)
                console.step_complete(step.name, output_summary)
                logger.info(step.name, "Step completed successfully")
                return

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

    def _execute_command_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        console: ConsoleOutput,
        cwd_override: Path | None = None,
    ) -> None:
        """Execute a command step."""
        command = step.command or ""
        args = step.args.copy()

        for key, value in args.items():
            if isinstance(value, str) and self.renderer.has_variables(value):
                args[key] = self.renderer.render_string(value, context)

        cwd = cwd_override or self.repo_root
        timeout = (step.step_timeout_minutes or 60) * 60
        max_retry = step.step_max_retry or self.config["defaults"]["maxRetry"]
        bypass_permissions = self.workflow_settings.bypass_permissions if self.workflow_settings else False
        allowed_tools = self.workflow_settings.required_tools if self.workflow_settings else None

        print_output = console.level == OutputLevel.ALL

        for attempt in range(max_retry + 1):
            result = run_claude_with_command(
                command=command,
                args=args,
                cwd=cwd,
                model=self._resolve_model(step.model),
                timeout=timeout,
                print_output=print_output,
                skip_permissions=bypass_permissions,
                allowed_tools=allowed_tools,
                console=console,
            )

            if result.success:
                output_summary = extract_summary(result.stdout) if result.stdout else ""
                update_step_completed(progress, step.name, output_summary, result.stdout)
                console.step_complete(step.name, output_summary)
                logger.info(step.name, "Step completed successfully")
                return

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

    def _execute_ralph_loop_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        console: ConsoleOutput,
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
        allowed_tools = self.workflow_settings.required_tools if self.workflow_settings else None

        print_output = console.level == OutputLevel.ALL

        _ralph_state = create_ralph_state(
            workflow_id=progress.workflow_id,
            step_name=step.name,
            prompt=prompt,
            max_iterations=max_iterations,
            completion_promise=completion_promise,
            repo_root=self.repo_root,
        )

        logger.info(step.name, f"Starting Ralph loop (max {max_iterations} iterations)")
        console.info(f"Ralph loop starting (max {max_iterations} iterations)")

        all_outputs: list[str] = []

        for iteration in range(1, max_iterations + 1):
            logger.info(step.name, f"Ralph loop iteration {iteration}/{max_iterations}")

            system_message = build_ralph_system_message(iteration, max_iterations, completion_promise)
            full_prompt = f"{system_message}{prompt}"

            result = run_claude(
                prompt=full_prompt,
                cwd=self.repo_root,
                model=self._resolve_model(step.model),
                timeout=timeout,
                print_output=print_output,
                skip_permissions=bypass_permissions,
                allowed_tools=allowed_tools,
                console=console,
            )

            if not result.success:
                error_summary = extract_summary(result.stderr) if result.stderr else "Unknown error"
                logger.warning(step.name, f"Iteration {iteration} failed: {result.stderr}")
                console.ralph_iteration(step.name, iteration, max_iterations, f"Failed: {error_summary}")
                if iteration < max_iterations:
                    update_ralph_iteration(progress.workflow_id, step.name, self.repo_root)
                    continue
                else:
                    deactivate_ralph_state(progress.workflow_id, step.name, self.repo_root)
                    console.step_failed(step.name, f"Ralph loop failed after {max_iterations} iterations")
                    update_step_failed(progress, step.name, f"Ralph loop failed after {max_iterations} iterations")
                    progress.status = WorkflowStatus.FAILED.value
                    return

            all_outputs.append(result.stdout)

            # Print iteration summary
            iteration_summary = extract_summary(result.stdout)
            console.ralph_iteration(step.name, iteration, max_iterations, iteration_summary)

            completion_result = detect_completion_promise(result.stdout, completion_promise)

            if completion_result.is_complete and completion_result.promise_matched:
                logger.info(step.name, f"Ralph loop completed at iteration {iteration}")
                deactivate_ralph_state(progress.workflow_id, step.name, self.repo_root)
                combined_output = "\n\n---\n\n".join(all_outputs)
                output_summary = f"Completed in {iteration} iterations"
                update_step_completed(progress, step.name, output_summary, combined_output)
                console.ralph_complete(step.name, iteration, max_iterations)
                return

            if iteration < max_iterations:
                update_ralph_iteration(progress.workflow_id, step.name, self.repo_root)

        logger.warning(step.name, f"Ralph loop reached max iterations ({max_iterations}) without completion")
        deactivate_ralph_state(progress.workflow_id, step.name, self.repo_root)
        combined_output = "\n\n---\n\n".join(all_outputs)
        output_summary = f"Max iterations ({max_iterations}) reached without completion promise"
        update_step_completed(progress, step.name, output_summary, combined_output)
        console.ralph_max_iterations(step.name, max_iterations)

    def _execute_parallel_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        console: ConsoleOutput,
    ) -> None:
        """Execute steps in parallel.

        Each step in the parallel block runs concurrently. Results are collected
        based on the merge strategy.

        When git.worktree is enabled, each branch runs in its own git worktree.
        When git.auto_pr is enabled with merge_mode=independent, each branch
        creates a PR on completion.
        """
        if not step.steps:
            logger.warning(step.name, "Parallel step has no sub-steps")
            update_step_completed(progress, step.name, "No sub-steps to execute")
            console.step_complete(step.name, "No sub-steps to execute")
            return

        use_worktree = step.git and step.git.worktree
        auto_pr = step.git and step.git.auto_pr

        logger.info(step.name, f"Starting parallel execution of {len(step.steps)} branches")
        if use_worktree:
            console.info(f"Parallel: starting {len(step.steps)} branches (worktree isolation)")
        else:
            console.info(f"Parallel: starting {len(step.steps)} branches")

        branch_results: dict[str, dict[str, Any]] = {}
        failed_branches: list[str] = []
        worktrees: dict[str, Worktree] = {}

        def execute_branch(branch_step: StepDefinition) -> tuple[str, bool, str, Worktree | None]:
            """Execute a single branch and return (name, success, output_summary, worktree)."""
            branch_context = context.copy()
            worktree: Worktree | None = None

            try:
                if use_worktree:
                    worktree = create_worktree(
                        workflow_name=progress.workflow_name,
                        step_name=branch_step.name,
                        repo_root=self.repo_root,
                    )
                    logger.info(branch_step.name, f"Created worktree: {worktree.path}")
                    console.info(f"  Branch '{branch_step.name}' worktree: {worktree.branch}")
                    branch_context["worktree"] = worktree
                    branch_context["branch_cwd"] = worktree.path

                self._execute_branch_step(
                    branch_step, progress, branch_context, logger, console, cwd_override=worktree.path if worktree else None
                )

                if auto_pr and worktree and step.merge_mode == "independent":
                    self._create_branch_pr(branch_step.name, worktree, logger, console)

                return (branch_step.name, True, "completed", worktree)
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

        if step.merge_mode == "merge" and worktrees:
            self._merge_worktree_branches(step, worktrees, failed_branches, logger, console)

        if step.merge_mode == "independent" and worktrees:
            for name, worktree in worktrees.items():
                remove_worktree(worktree, self.repo_root, delete_branch=False)
                logger.info(name, f"Worktree removed, branch preserved: {worktree.branch}")

        if step.merge_strategy == "wait-all":
            if failed_branches and step.merge_mode != "independent":
                error_msg = f"Parallel branches failed: {', '.join(failed_branches)}"
                update_step_failed(progress, step.name, error_msg)
                console.step_failed(step.name, error_msg)
                progress.status = WorkflowStatus.FAILED.value
            else:
                completed = len(step.steps) - len(failed_branches)
                output_summary = f"Completed {completed}/{len(step.steps)} branches"
                if failed_branches:
                    output_summary += f" (failed: {', '.join(failed_branches)})"
                update_step_completed(progress, step.name, output_summary)
                console.step_complete(step.name, output_summary)
                logger.info(step.name, output_summary)

    def _create_branch_pr(
        self,
        branch_name: str,
        worktree: Worktree,
        logger: WorkflowLogger,
        console: ConsoleOutput,
    ) -> None:
        """Create a PR for a parallel branch."""
        try:
            result = run_claude_with_command(
                command="git-pr",
                args={"title": f"[Parallel] {branch_name}", "draft": "false"},
                cwd=worktree.path,
                model="haiku",
                timeout=120,
                print_output=False,
            )
            if result.success:
                console.info(f"  Branch '{branch_name}' PR created")
                logger.info(branch_name, "PR created successfully")
            else:
                logger.warning(branch_name, f"PR creation failed: {result.stderr}")
        except Exception as e:
            logger.warning(branch_name, f"PR creation failed: {e}")

    def _merge_worktree_branches(
        self,
        step: StepDefinition,
        worktrees: dict[str, Worktree],
        failed_branches: list[str],
        logger: WorkflowLogger,
        console: ConsoleOutput,
    ) -> None:
        """Merge successful worktree branches back to base branch."""
        from agentic_sdlc.git.worktree import _run_git

        console.info("Merging parallel branches...")

        for name, worktree in worktrees.items():
            if name in failed_branches:
                remove_worktree(worktree, self.repo_root, delete_branch=True)
                logger.info(name, "Failed branch worktree removed")
                continue

            try:
                _run_git(["checkout", worktree.base_branch], cwd=self.repo_root)
                _run_git(
                    ["merge", "--no-ff", "-m", f"Merge parallel branch: {name}", worktree.branch],
                    cwd=self.repo_root,
                )
                logger.info(name, f"Merged branch {worktree.branch} into {worktree.base_branch}")
                console.info(f"  Merged '{name}'")
            except Exception as e:
                logger.error(name, f"Merge failed: {e}")
                console.error(f"  Merge failed for '{name}': {e}")

            remove_worktree(worktree, self.repo_root, delete_branch=True)
            logger.info(name, "Worktree and branch cleaned up")

    def _execute_branch_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        console: ConsoleOutput,
        cwd_override: Path | None = None,
    ) -> None:
        """Execute a single step within a parallel or serial block.

        This is similar to _execute_step but doesn't update the main step progress,
        as the parent step handles progress tracking.

        Args:
            cwd_override: Optional working directory override (used for worktree execution)
        """
        logger.info(step.name, f"Starting branch step: {step.name}")

        cwd = cwd_override or context.get("branch_cwd") or self.repo_root

        if step.type == StepType.PROMPT:
            self._execute_prompt_step(step, progress, context, logger, console, cwd_override=cwd)
        elif step.type == StepType.COMMAND:
            self._execute_command_step(step, progress, context, logger, console, cwd_override=cwd)
        elif step.type == StepType.SERIAL:
            self._execute_serial_step(step, progress, context, logger, console, cwd_override=cwd)
        elif step.type == StepType.CONDITIONAL:
            self._execute_conditional_step(step, progress, context, logger, console, cwd_override=cwd)
        elif step.type == StepType.RALPH_LOOP:
            self._execute_ralph_loop_step(step, progress, context, logger, console)
        else:
            raise NotImplementedError(f"Step type not supported in branches: {step.type.value}")

    def _execute_serial_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        console: ConsoleOutput,
        cwd_override: Path | None = None,
    ) -> None:
        """Execute steps sequentially within a serial block.

        Each step runs one after another. If any step fails, subsequent steps are skipped.
        """
        if not step.steps:
            logger.warning(step.name, "Serial step has no sub-steps")
            update_step_completed(progress, step.name, "No sub-steps to execute")
            console.step_complete(step.name, "No sub-steps to execute")
            return

        logger.info(step.name, f"Starting serial execution of {len(step.steps)} steps")
        console.info(f"Serial: executing {len(step.steps)} steps in sequence")

        completed_count = 0

        for sub_step in step.steps:
            try:
                self._execute_branch_step(sub_step, progress, context, logger, console, cwd_override=cwd_override)
                completed_count += 1

                if progress.status == WorkflowStatus.FAILED.value:
                    logger.warning(step.name, f"Serial block stopped at step '{sub_step.name}' due to failure")
                    break

            except Exception as e:
                logger.error(sub_step.name, f"Step failed in serial block: {e}")
                update_step_failed(progress, step.name, f"Step '{sub_step.name}' failed: {e}")
                console.step_failed(step.name, f"Step '{sub_step.name}' failed")
                progress.status = WorkflowStatus.FAILED.value
                return

        if progress.status != WorkflowStatus.FAILED.value:
            output_summary = f"Completed {completed_count}/{len(step.steps)} steps"
            update_step_completed(progress, step.name, output_summary)
            console.step_complete(step.name, output_summary)
            logger.info(step.name, output_summary)

    def _execute_conditional_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        console: ConsoleOutput,
        cwd_override: Path | None = None,
    ) -> None:
        """Execute a conditional step based on condition evaluation.

        Evaluates the condition expression and executes either the 'then' or 'else' branch.
        """
        condition = step.condition or "false"
        logger.info(step.name, f"Evaluating condition: {condition}")

        if self.renderer.has_variables(condition):
            condition = self.renderer.render_string(condition, context)

        condition_result = self._evaluate_condition(condition, context)
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
            return

        logger.info(step.name, f"Executing '{branch_name}' branch with {len(steps_to_run)} steps")

        for sub_step in steps_to_run:
            try:
                self._execute_branch_step(sub_step, progress, context, logger, console, cwd_override=cwd_override)

                if progress.status == WorkflowStatus.FAILED.value:
                    logger.warning(step.name, f"Conditional '{branch_name}' branch stopped due to failure")
                    break

            except Exception as e:
                logger.error(sub_step.name, f"Step failed in conditional branch: {e}")
                update_step_failed(progress, step.name, f"Step '{sub_step.name}' failed: {e}")
                console.step_failed(step.name, f"Step '{sub_step.name}' failed")
                progress.status = WorkflowStatus.FAILED.value
                return

        if progress.status != WorkflowStatus.FAILED.value:
            output_summary = f"Executed '{branch_name}' branch ({len(steps_to_run)} steps)"
            update_step_completed(progress, step.name, output_summary)
            console.step_complete(step.name, output_summary)
            logger.info(step.name, output_summary)

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
