#!/usr/bin/env python3
"""
Orchestrator for parallel Claude workflow execution.

This module provides utilities for coordinating multiple Claude instances
running in parallel, typically in separate git worktrees.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from claude_core.logging import LogEntry, get_logger
from claude_core.runner import ClaudeResult, run_claude


@dataclass
class Task:
    """Represents a task to be executed by Claude."""

    prompt: str
    cwd: Path | None = None
    name: str = ""
    timeout: int = 300
    skip_permissions: bool = True

    def __post_init__(self) -> None:
        if not self.name:
            # Generate a name from the prompt
            self.name = self.prompt[:50].replace("\n", " ").strip()


@dataclass
class TaskResult:
    """Result from a task execution."""

    task: Task
    result: ClaudeResult
    duration_ms: int
    error: str | None = None

    @property
    def success(self) -> bool:
        """Return True if the task completed successfully."""
        return self.result.success and self.error is None


@dataclass
class Orchestrator:
    """
    Coordinates multiple Claude instances for parallel execution.

    Example usage:
        orchestrator = Orchestrator()
        orchestrator.add_task(Task(prompt="/plan-feature auth system", cwd=worktree_a))
        orchestrator.add_task(Task(prompt="/plan-feature api docs", cwd=worktree_b))
        results = orchestrator.run_parallel()
    """

    max_workers: int = 4
    log_file: Path | None = None
    _tasks: list[Task] = field(default_factory=list)
    _results: list[TaskResult] = field(default_factory=list)
    _on_task_complete: Callable[[TaskResult], None] | None = None

    def add_task(self, task: Task) -> None:
        """
        Add a task to the orchestrator.

        Args:
            task: Task to add
        """
        self._tasks.append(task)

    def add_tasks(self, tasks: list[Task]) -> None:
        """
        Add multiple tasks to the orchestrator.

        Args:
            tasks: List of tasks to add
        """
        self._tasks.extend(tasks)

    def clear_tasks(self) -> None:
        """Clear all pending tasks."""
        self._tasks.clear()

    def set_on_complete(self, callback: Callable[[TaskResult], None]) -> None:
        """
        Set a callback to be called when each task completes.

        Args:
            callback: Function that takes a TaskResult
        """
        self._on_task_complete = callback

    def _execute_task(self, task: Task) -> TaskResult:
        """
        Execute a single task.

        Args:
            task: Task to execute

        Returns:
            TaskResult with execution details
        """
        start_time = datetime.now(timezone.utc)
        error: str | None = None

        try:
            result = run_claude(
                prompt=task.prompt,
                cwd=task.cwd,
                timeout=task.timeout,
                skip_permissions=task.skip_permissions,
            )
        except Exception as e:
            error = str(e)
            result = ClaudeResult(
                returncode=1,
                stdout="",
                stderr=str(e),
                prompt=task.prompt,
                cwd=task.cwd,
            )

        end_time = datetime.now(timezone.utc)
        duration_ms = int((end_time - start_time).total_seconds() * 1000)

        task_result = TaskResult(
            task=task,
            result=result,
            duration_ms=duration_ms,
            error=error,
        )

        # Log the result if logging is configured
        if self.log_file:
            logger = get_logger(self.log_file)
            logger.log(
                LogEntry(
                    command=task.prompt.split()[0] if task.prompt else "",
                    args=" ".join(task.prompt.split()[1:]) if task.prompt else "",
                    cwd=str(task.cwd) if task.cwd else "",
                    duration_ms=duration_ms,
                    exit_code=result.returncode,
                    output_summary=result.stdout[:200] if result.stdout else "",
                )
            )

        return task_result

    def run_parallel(
        self,
        print_progress: bool = True,
    ) -> list[TaskResult]:
        """
        Execute all tasks in parallel.

        Args:
            print_progress: Whether to print progress updates

        Returns:
            List of TaskResults in completion order
        """
        if not self._tasks:
            return []

        self._results.clear()
        total = len(self._tasks)
        completed = 0

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Submit all tasks
            future_to_task: dict[Future[TaskResult], Task] = {executor.submit(self._execute_task, task): task for task in self._tasks}

            # Collect results as they complete
            for future in as_completed(future_to_task):
                task = future_to_task[future]
                completed += 1

                try:
                    task_result = future.result()
                    self._results.append(task_result)

                    if print_progress:
                        status = "OK" if task_result.success else "FAILED"
                        print(f"[{completed}/{total}] {task.name}: {status}")

                    # Call completion callback if set
                    if self._on_task_complete:
                        self._on_task_complete(task_result)

                except Exception as e:
                    # Handle unexpected errors
                    error_result = TaskResult(
                        task=task,
                        result=ClaudeResult(
                            returncode=1,
                            stdout="",
                            stderr=str(e),
                            prompt=task.prompt,
                            cwd=task.cwd,
                        ),
                        duration_ms=0,
                        error=str(e),
                    )
                    self._results.append(error_result)

                    if print_progress:
                        print(f"[{completed}/{total}] {task.name}: ERROR - {e}")

        # Clear tasks after execution
        self._tasks.clear()

        return self._results

    def run_sequential(
        self,
        print_progress: bool = True,
        stop_on_failure: bool = False,
    ) -> list[TaskResult]:
        """
        Execute all tasks sequentially.

        Args:
            print_progress: Whether to print progress updates
            stop_on_failure: Whether to stop execution on first failure

        Returns:
            List of TaskResults in execution order
        """
        if not self._tasks:
            return []

        self._results.clear()
        total = len(self._tasks)

        for i, task in enumerate(self._tasks, 1):
            task_result = self._execute_task(task)
            self._results.append(task_result)

            if print_progress:
                status = "OK" if task_result.success else "FAILED"
                print(f"[{i}/{total}] {task.name}: {status}")

            # Call completion callback if set
            if self._on_task_complete:
                self._on_task_complete(task_result)

            # Stop on failure if requested
            if stop_on_failure and not task_result.success:
                break

        # Clear tasks after execution
        self._tasks.clear()

        return self._results

    def get_results(self) -> list[TaskResult]:
        """
        Get all results from the last execution.

        Returns:
            List of TaskResults
        """
        return list(self._results)

    def get_summary(self) -> dict[str, Any]:
        """
        Get a summary of the last execution.

        Returns:
            Dictionary with execution summary
        """
        if not self._results:
            return {
                "total": 0,
                "successful": 0,
                "failed": 0,
                "total_duration_ms": 0,
            }

        successful = sum(1 for r in self._results if r.success)
        failed = len(self._results) - successful
        total_duration = sum(r.duration_ms for r in self._results)

        return {
            "total": len(self._results),
            "successful": successful,
            "failed": failed,
            "total_duration_ms": total_duration,
            "results": [
                {
                    "name": r.task.name,
                    "success": r.success,
                    "duration_ms": r.duration_ms,
                    "error": r.error,
                }
                for r in self._results
            ],
        }


def main() -> None:
    """CLI entry point for orchestrating parallel Claude tasks."""
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description="Orchestrate parallel Claude workflow execution",
        prog="claude-orchestrate",
    )
    parser.add_argument(
        "prompts",
        nargs="*",
        help="Prompts to execute (one per task)",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=4,
        help="Maximum parallel workers (default: 4)",
    )
    parser.add_argument(
        "--sequential",
        action="store_true",
        help="Run tasks sequentially instead of in parallel",
    )
    parser.add_argument(
        "--stop-on-failure",
        action="store_true",
        help="Stop on first failure (sequential mode only)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Timeout per task in seconds (default: 300)",
    )
    parser.add_argument(
        "--log-file",
        type=Path,
        help="Path to log file for structured logging",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON",
    )

    args = parser.parse_args()

    if not args.prompts:
        # Try reading from stdin
        import sys

        if not sys.stdin.isatty():
            prompts = [line.strip() for line in sys.stdin if line.strip()]
        else:
            parser.error("No prompts provided")
            return
    else:
        prompts = args.prompts

    orchestrator = Orchestrator(
        max_workers=args.max_workers,
        log_file=args.log_file,
    )

    for i, prompt in enumerate(prompts):
        orchestrator.add_task(
            Task(
                prompt=prompt,
                name=f"task-{i + 1}",
                timeout=args.timeout,
            )
        )

    if args.sequential:
        results = orchestrator.run_sequential(
            print_progress=not args.json,
            stop_on_failure=args.stop_on_failure,
        )
    else:
        results = orchestrator.run_parallel(print_progress=not args.json)

    summary = orchestrator.get_summary()

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"\nCompleted: {summary['successful']}/{summary['total']} successful")

    sys.exit(0 if summary["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
