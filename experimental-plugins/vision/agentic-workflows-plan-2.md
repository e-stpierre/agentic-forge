# Agentic Workflows - Implementation Plan 2

## Full Orchestration & State Management

### Overview

This plan implements the complete workflow engine with all step types, the orchestration loop, memory system, checkpoints, and error handling. It builds on Plan 1's foundation to enable complex multi-step workflows with parallel execution, conditionals, loops, and human-in-the-loop interactions.

### Prerequisites

- Plan 1 completed and functional
- All Plan 1 tests passing

### Deliverable

A complete workflow engine that can:

- Execute all step types (parallel, conditional, recurring, wait-for-human)
- Orchestrate workflows using Claude for decision-making
- Manage memory documents with frontmatter search
- Create and read checkpoints
- Handle errors with retry logic and graceful shutdown
- Resume cancelled/failed workflows

---

## Directory Structure Additions

```
experimental-plugins/agentic-workflows/
├── commands/
│   └── orchestrate.md              # Claude orchestrator command
├── skills/
│   ├── create-memory.md
│   ├── search-memory.md
│   ├── create-checkpoint.md
│   └── create-log.md
├── templates/
│   ├── checkpoint.md.j2
│   └── memory.md.j2
├── schemas/
│   └── orchestrator-response.schema.json
└── src/agentic_workflows/
    ├── orchestrator.py             # Main orchestration loop
    ├── memory/
    │   ├── __init__.py
    │   ├── manager.py
    │   └── search.py
    └── checkpoints/
        ├── __init__.py
        └── manager.py
```

---

## Implementation Tasks

### Task 1: Orchestrator Response Schema

**File: `schemas/orchestrator-response.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "OrchestratorResponse",
  "description": "Response from Claude orchestrator command",
  "type": "object",
  "required": ["workflow_status", "next_action", "reasoning"],
  "properties": {
    "workflow_status": {
      "type": "string",
      "enum": ["in_progress", "completed", "failed", "blocked"]
    },
    "next_action": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "execute_step",
            "retry_step",
            "wait_for_human",
            "complete",
            "abort"
          ]
        },
        "step_name": {
          "type": "string"
        },
        "context_to_pass": {
          "type": "string"
        },
        "error_context": {
          "type": "string"
        }
      }
    },
    "reasoning": {
      "type": "string"
    },
    "progress_update": {
      "type": "string"
    }
  }
}
```

---

### Task 2: Orchestrate Command

**File: `commands/orchestrate.md`**

````markdown
---
name: orchestrate
description: Evaluate workflow state and determine next action
output: json
---

# Orchestrator Command

You are the workflow orchestrator. Your job is to evaluate the current workflow state and determine what action should be taken next.

## Input

You will receive:

1. The workflow definition (YAML)
2. The current progress document (JSON)
3. The last step output (if any)

## Your Task

Analyze the workflow state and return a JSON response with your decision.

## Decision Rules

1. **Check for completion**: If all steps are completed, return `workflow_status: completed`
2. **Check for failures**: If a step failed and max retries reached, return `workflow_status: failed`
3. **Check for blocking**: If human input is required, return `workflow_status: blocked`
4. **Determine next step**: Based on step dependencies and conditions, identify the next step to execute
5. **Handle errors**: If the last step failed but retries remain, return `retry_step`

## Condition Evaluation

For conditional steps, evaluate the Jinja2 condition using the available context:

- `outputs.{step_name}` - Previous step outputs
- `variables.{var_name}` - Workflow variables

## Response Format

```json
{
  "workflow_status": "in_progress | completed | failed | blocked",
  "next_action": {
    "type": "execute_step | retry_step | wait_for_human | complete | abort",
    "step_name": "name of step to execute (if applicable)",
    "context_to_pass": "context string for the step",
    "error_context": "error details for retry (if retrying)"
  },
  "reasoning": "Brief explanation of why this decision was made",
  "progress_update": "What to record in progress document"
}
```
````

## Examples

### Example 1: Execute Next Step

```json
{
  "workflow_status": "in_progress",
  "next_action": {
    "type": "execute_step",
    "step_name": "implement",
    "context_to_pass": "Implement the feature based on the plan in step 'plan'"
  },
  "reasoning": "Plan step completed successfully, proceeding to implementation",
  "progress_update": "Starting implementation phase"
}
```

### Example 2: Workflow Complete

```json
{
  "workflow_status": "completed",
  "next_action": {
    "type": "complete"
  },
  "reasoning": "All steps completed successfully, PR created",
  "progress_update": "Workflow completed successfully"
}
```

### Example 3: Retry Failed Step

```json
{
  "workflow_status": "in_progress",
  "next_action": {
    "type": "retry_step",
    "step_name": "validate",
    "error_context": "Test failures in auth.test.ts - fix the mock setup"
  },
  "reasoning": "Validation failed with test errors, 2 retries remaining",
  "progress_update": "Retrying validation after fixing test issues"
}
```

---

## Workflow Definition

```yaml
{ { workflow_yaml } }
```

## Current Progress

```json
{{ progress_json }}
```

{% if last_step_output %}

## Last Step Output

Step: {{ last_step_name }}
Output:

```
{{ last_step_output }}
```

{% endif %}

---

Analyze the workflow state and provide your JSON response:

````

---

### Task 3: Main Orchestrator Loop

**File: `src/agentic_workflows/orchestrator.py`**

```python
"""Async workflow orchestration with Claude decision loop."""

import json
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agentic_workflows.config import load_config
from agentic_workflows.executor import WorkflowExecutor
from agentic_workflows.git.worktree import (
    create_worktree, remove_worktree, prune_orphaned, Worktree
)
from agentic_workflows.logging.logger import WorkflowLogger, LogLevel
from agentic_workflows.parser import (
    WorkflowDefinition, StepDefinition, StepType, WorkflowParser
)
from agentic_workflows.progress import (
    WorkflowProgress, WorkflowStatus, StepStatus,
    load_progress, save_progress, update_step_started,
    update_step_completed, update_step_failed, ParallelBranch,
)
from agentic_workflows.runner import run_claude
from agentic_workflows.templates.renderer import TemplateRenderer


@dataclass
class OrchestratorAction:
    """Parsed action from orchestrator response."""
    type: str  # execute_step, retry_step, wait_for_human, complete, abort
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

        # Register signal handlers
        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)

    def _handle_shutdown(self, signum, frame):
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
        # Clean up orphaned worktrees from previous runs
        prune_orphaned(self.repo_root)

        variables = variables or {}

        # Create or resume progress
        progress = self._init_progress(workflow, variables, from_step)
        logger = WorkflowLogger(progress.workflow_id, self.repo_root)

        # Main orchestration loop
        while not self._shutdown_requested:
            # Get orchestrator decision
            decision = self._get_orchestrator_decision(workflow, progress, logger)

            if decision is None:
                logger.error("orchestrator", "Failed to get orchestrator decision")
                progress.status = WorkflowStatus.FAILED.value
                break

            # Log decision
            logger.info("orchestrator", decision.reasoning)

            # Handle decision
            if decision.workflow_status == "completed":
                progress.status = WorkflowStatus.COMPLETED.value
                break
            elif decision.workflow_status == "failed":
                progress.status = WorkflowStatus.FAILED.value
                break
            elif decision.workflow_status == "blocked":
                progress.status = WorkflowStatus.PAUSED.value
                break

            # Execute action
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
                break  # Pause workflow
            elif decision.action.type == "abort":
                progress.status = WorkflowStatus.FAILED.value
                break

            save_progress(progress, self.repo_root)

            # Check for shutdown
            if self._shutdown_requested:
                self._handle_graceful_shutdown(progress, logger)
                break

        # Finalize
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

        # Merge variables with defaults
        for var in workflow.variables:
            if var.name not in variables:
                if var.required and var.default is None:
                    raise ValueError(f"Missing required variable: {var.name}")
                variables[var.name] = var.default

        progress = WorkflowProgress(
            workflow_id=workflow_id,
            workflow_name=workflow.name,
            status=WorkflowStatus.RUNNING.value,
            started_at=datetime.now(timezone.utc).isoformat(),
            pending_steps=step_names,
            variables=variables,
        )

        if from_step:
            # Mark prior steps as completed
            skip = True
            new_pending = []
            for name in step_names:
                if name == from_step:
                    skip = False
                if skip:
                    progress.completed_steps.append({
                        "name": name,
                        "status": "skipped",
                        "output_summary": "Skipped (resumed from later step)",
                    })
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
        # Load orchestrate command template
        cmd_path = Path(__file__).parent.parent / "commands" / "orchestrate.md"
        if not cmd_path.exists():
            logger.error("orchestrator", "Orchestrate command not found")
            return None

        cmd_template = cmd_path.read_text()

        # Build context
        import yaml
        workflow_yaml = yaml.dump(self._workflow_to_dict(workflow))
        progress_json = json.dumps(self._progress_to_dict(progress), indent=2)

        # Get last step output
        last_step_name = None
        last_step_output = None
        if progress.completed_steps:
            last = progress.completed_steps[-1]
            if isinstance(last, dict):
                last_step_name = last.get("name")
            else:
                last_step_name = last.name
            last_step_output = progress.step_outputs.get(last_step_name, "")

        # Render prompt
        prompt = self.renderer.render_string(cmd_template, {
            "workflow_yaml": workflow_yaml,
            "progress_json": progress_json,
            "last_step_name": last_step_name,
            "last_step_output": last_step_output[:2000] if last_step_output else None,
        })

        # Call Claude
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
                logger.warning("orchestrator", f"Orchestrator call failed: {result.stderr}")
                continue

            # Parse JSON response
            try:
                response = self._parse_orchestrator_response(result.stdout)
                return response
            except Exception as e:
                logger.warning("orchestrator", f"Failed to parse response: {e}")
                continue

        return None

    def _parse_orchestrator_response(self, output: str) -> OrchestratorDecision:
        """Parse Claude's JSON response."""
        # Extract JSON from output (may have markdown code blocks)
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
            self._execute_parallel_step(workflow, step, progress, logger, terminal_output)
        elif step.type == StepType.CONDITIONAL:
            self._execute_conditional_step(workflow, step, progress, logger, terminal_output)
        elif step.type == StepType.RECURRING:
            self._execute_recurring_step(workflow, step, progress, logger, terminal_output)
        elif step.type == StepType.WAIT_FOR_HUMAN:
            self._execute_wait_for_human_step(step, progress, logger)
        else:
            # Use base executor for prompt/command
            print_output = terminal_output == "all"
            context = {"variables": progress.variables, "outputs": progress.step_outputs}
            self.executor._execute_step(step, progress, progress.variables, logger, print_output)

    def _execute_parallel_step(
        self,
        workflow: WorkflowDefinition,
        step: StepDefinition,
        progress: WorkflowProgress,
        logger: WorkflowLogger,
        terminal_output: str,
    ) -> None:
        """Execute parallel steps in separate worktrees."""
        logger.info(step.name, f"Starting parallel execution with {len(step.steps)} branches")
        update_step_started(progress, step.name)

        max_workers = self.config["execution"]["maxWorkers"]
        worktrees: list[Worktree] = []
        branch_progresses: dict[str, WorkflowProgress] = {}

        try:
            # Create worktrees for each parallel branch
            for sub_step in step.steps:
                wt = create_worktree(
                    workflow.name,
                    sub_step.name,
                    repo_root=self.repo_root,
                )
                worktrees.append(wt)

                # Record branch in progress
                branch = ParallelBranch(
                    branch_id=sub_step.name,
                    status="running",
                    worktree_path=str(wt.path),
                    progress_file=str(wt.path / "agentic" / "workflows" / progress.workflow_id / "progress.json"),
                )
                progress.parallel_branches.append(branch)

            save_progress(progress, self.repo_root)

            # Execute in parallel using thread pool
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {}
                for wt, sub_step in zip(worktrees, step.steps):
                    future = executor.submit(
                        self._execute_in_worktree,
                        workflow, sub_step, progress, wt, logger, terminal_output
                    )
                    futures[future] = (wt, sub_step)

                # Collect results
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

            # Update progress based on merge strategy
            if all_success:
                update_step_completed(progress, step.name, "All parallel branches completed")
                logger.info(step.name, "Parallel execution completed successfully")
            else:
                update_step_failed(progress, step.name, "One or more parallel branches failed")

        finally:
            # Clean up worktrees
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
        # Create executor for worktree
        wt_executor = WorkflowExecutor(worktree.path)
        wt_logger = WorkflowLogger(parent_progress.workflow_id, worktree.path)

        try:
            print_output = terminal_output == "all"
            context = {"variables": parent_progress.variables, "outputs": parent_progress.step_outputs}
            wt_executor._execute_step(step, parent_progress, parent_progress.variables, wt_logger, print_output)
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

        # Evaluate condition using Jinja2
        context = {"outputs": progress.step_outputs, "variables": progress.variables}
        try:
            condition_result = self.renderer.render_string(
                "{{ " + step.condition + " }}", context
            )
            is_true = condition_result.lower() in ("true", "1", "yes")
        except Exception as e:
            logger.error(step.name, f"Condition evaluation failed: {e}")
            update_step_failed(progress, step.name, f"Condition error: {e}")
            return

        # Execute appropriate branch
        steps_to_run = step.then_steps if is_true else step.else_steps
        logger.info(step.name, f"Condition {'met' if is_true else 'not met'}, executing {len(steps_to_run)} steps")

        print_output = terminal_output == "all"
        for sub_step in steps_to_run:
            self.executor._execute_step(sub_step, progress, progress.variables, logger, print_output)
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
        logger.info(step.name, f"Starting recurring step (max {step.max_iterations} iterations)")
        update_step_started(progress, step.name)

        print_output = terminal_output == "all"
        iteration = 0

        while iteration < step.max_iterations:
            iteration += 1
            logger.info(step.name, f"Iteration {iteration}/{step.max_iterations}")

            # Execute nested steps
            for sub_step in step.steps:
                self.executor._execute_step(sub_step, progress, progress.variables, logger, print_output)
                if progress.status == WorkflowStatus.FAILED.value:
                    return

            # Check until condition
            if step.until:
                context = {"outputs": progress.step_outputs, "variables": progress.variables}
                try:
                    result = self.renderer.render_string("{{ " + step.until + " }}", context)
                    if result.lower() in ("true", "1", "yes"):
                        logger.info(step.name, f"Until condition met after {iteration} iterations")
                        break
                except Exception as e:
                    logger.warning(step.name, f"Until condition error: {e}")

        update_step_completed(progress, step.name, f"Completed after {iteration} iterations")

    def _execute_wait_for_human_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        logger: WorkflowLogger,
    ) -> None:
        """Set up wait-for-human step."""
        logger.info(step.name, f"Waiting for human input: {step.message}")
        update_step_started(progress, step.name)

        # Store waiting state
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
        print(f"HUMAN INPUT REQUIRED")
        print(f"{'='*60}")
        print(f"\n{step.message}\n")
        print(f"Provide input with: agentic-workflow input {progress.workflow_id} \"<your response>\"")
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

        # Add error context to prompt
        if action.error_context and step.prompt:
            step.prompt = f"{step.prompt}\n\nPrevious attempt failed:\n{action.error_context}"

        # Re-execute
        print_output = terminal_output == "all"
        self.executor._execute_step(step, progress, progress.variables, logger, print_output)

    def _wait_for_human_action(
        self,
        progress: WorkflowProgress,
        action: OrchestratorAction,
        logger: WorkflowLogger,
    ) -> None:
        """Handle wait for human action from orchestrator."""
        progress.status = WorkflowStatus.PAUSED.value
        logger.info("orchestrator", "Workflow paused waiting for human input")

    def _find_step(self, steps: list[StepDefinition], name: str) -> StepDefinition | None:
        """Find step by name recursively."""
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

        # Clean up worktrees
        prune_orphaned(self.repo_root)

    def _workflow_to_dict(self, workflow: WorkflowDefinition) -> dict:
        """Convert workflow to dict for YAML serialization."""
        # Simplified conversion for orchestrator context
        return {
            "name": workflow.name,
            "steps": [{"name": s.name, "type": s.type.value} for s in workflow.steps],
        }

    def _progress_to_dict(self, progress: WorkflowProgress) -> dict:
        """Convert progress to dict for JSON serialization."""
        from agentic_workflows.progress import _progress_to_dict
        return _progress_to_dict(progress)


def process_human_input(workflow_id: str, response: str, repo_root: Path | None = None) -> bool:
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

    # Store human input
    progress.current_step["human_input"] = response
    progress.status = WorkflowStatus.RUNNING.value
    save_progress(progress, repo_root)

    print(f"Input received. Resume workflow with: agentic-workflow resume {workflow_id}")
    return True
````

---

### Task 4: Memory Manager

**File: `src/agentic_workflows/memory/manager.py`**

```python
"""File-based memory management with frontmatter search."""

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from agentic_workflows.config import load_config


MEMORY_CATEGORIES = ["pattern", "lesson", "error", "decision", "context"]


@dataclass
class MemoryEntry:
    """A memory document."""
    id: str
    category: str
    tags: list[str]
    title: str
    content: str
    source: dict[str, str] | None = None
    relevance: str = "medium"
    created: str | None = None
    path: Path | None = None


class MemoryManager:
    """Manages memory documents in the file system."""

    def __init__(self, repo_root: Path | None = None):
        self.repo_root = repo_root or Path.cwd()
        self.config = load_config(self.repo_root)
        self.memory_dir = self.repo_root / self.config["memory"]["directory"]

    def create(
        self,
        category: str,
        title: str,
        content: str,
        tags: list[str] | None = None,
        source: dict[str, str] | None = None,
        relevance: str = "medium",
    ) -> MemoryEntry:
        """Create a new memory document.

        Args:
            category: Memory category (pattern, lesson, error, decision, context)
            title: Memory title
            content: Memory content (markdown)
            tags: List of tags for searchability
            source: Source information (workflow, step)
            relevance: Relevance level (low, medium, high)

        Returns:
            Created MemoryEntry
        """
        if category not in MEMORY_CATEGORIES:
            raise ValueError(f"Invalid category: {category}. Valid: {MEMORY_CATEGORIES}")

        # Generate ID and filename
        timestamp = datetime.now(timezone.utc)
        date_str = timestamp.strftime("%Y-%m-%d")
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:50]
        memory_id = f"mem-{date_str}-{slug}"
        filename = f"{date_str}-{slug}.md"

        # Create category directory
        category_dir = self.memory_dir / f"{category}s"
        category_dir.mkdir(parents=True, exist_ok=True)

        # Build frontmatter
        frontmatter = {
            "id": memory_id,
            "created": timestamp.isoformat(),
            "category": category,
            "tags": tags or [],
            "relevance": relevance,
        }
        if source:
            frontmatter["source"] = source

        # Build document
        doc = f"---\n{yaml.dump(frontmatter, default_flow_style=False)}---\n\n# {title}\n\n{content}"

        # Write file
        file_path = category_dir / filename
        file_path.write_text(doc, encoding="utf-8")

        # Update index
        self._update_index()

        return MemoryEntry(
            id=memory_id,
            category=category,
            tags=tags or [],
            title=title,
            content=content,
            source=source,
            relevance=relevance,
            created=timestamp.isoformat(),
            path=file_path,
        )

    def list_memories(
        self,
        category: str | None = None,
        limit: int = 20,
    ) -> list[MemoryEntry]:
        """List memory entries.

        Args:
            category: Filter by category (None for all)
            limit: Maximum entries to return
        """
        entries = []

        if category:
            search_dirs = [self.memory_dir / f"{category}s"]
        else:
            search_dirs = [d for d in self.memory_dir.iterdir() if d.is_dir()]

        for dir_path in search_dirs:
            if not dir_path.exists():
                continue
            for file_path in sorted(dir_path.glob("*.md"), reverse=True):
                if len(entries) >= limit:
                    break
                entry = self._parse_memory_file(file_path)
                if entry:
                    entries.append(entry)

        return entries[:limit]

    def get(self, memory_id: str) -> MemoryEntry | None:
        """Get a memory by ID."""
        for md_file in self.memory_dir.rglob("*.md"):
            entry = self._parse_memory_file(md_file)
            if entry and entry.id == memory_id:
                return entry
        return None

    def delete(self, memory_id: str) -> bool:
        """Delete a memory by ID."""
        for md_file in self.memory_dir.rglob("*.md"):
            entry = self._parse_memory_file(md_file)
            if entry and entry.id == memory_id:
                md_file.unlink()
                self._update_index()
                return True
        return False

    def _parse_memory_file(self, path: Path) -> MemoryEntry | None:
        """Parse a memory markdown file."""
        try:
            content = path.read_text(encoding="utf-8")

            # Extract frontmatter
            if not content.startswith("---"):
                return None

            end_idx = content.find("---", 3)
            if end_idx == -1:
                return None

            frontmatter_str = content[3:end_idx].strip()
            frontmatter = yaml.safe_load(frontmatter_str)
            body = content[end_idx + 3:].strip()

            # Extract title from first heading
            title = ""
            for line in body.split("\n"):
                if line.startswith("# "):
                    title = line[2:].strip()
                    break

            return MemoryEntry(
                id=frontmatter.get("id", ""),
                category=frontmatter.get("category", ""),
                tags=frontmatter.get("tags", []),
                title=title,
                content=body,
                source=frontmatter.get("source"),
                relevance=frontmatter.get("relevance", "medium"),
                created=frontmatter.get("created"),
                path=path,
            )
        except Exception:
            return None

    def _update_index(self) -> None:
        """Update the memory index file."""
        index_path = self.memory_dir / "index.md"
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        lines = [
            "# Memory Index",
            "",
            f"Last updated: {datetime.now(timezone.utc).isoformat()}",
            "",
        ]

        for category in MEMORY_CATEGORIES:
            category_dir = self.memory_dir / f"{category}s"
            if not category_dir.exists():
                continue

            files = sorted(category_dir.glob("*.md"), reverse=True)
            if not files:
                continue

            lines.append(f"## {category.title()}s")
            lines.append("")

            for file_path in files[:10]:
                entry = self._parse_memory_file(file_path)
                if entry:
                    rel_path = file_path.relative_to(self.memory_dir)
                    lines.append(f"- [{file_path.name}]({rel_path}) - {entry.title}")

            lines.append("")

        index_path.write_text("\n".join(lines), encoding="utf-8")
```

---

### Task 5: Memory Search

**File: `src/agentic_workflows/memory/search.py`**

```python
"""Keyword-based memory search using frontmatter."""

from pathlib import Path

from agentic_workflows.memory.manager import MemoryManager, MemoryEntry


def search_memories(
    query: str,
    category: str | None = None,
    tags: list[str] | None = None,
    limit: int = 10,
    repo_root: Path | None = None,
) -> list[MemoryEntry]:
    """Search memories by keyword matching.

    Searches in:
    - Tags (any match)
    - Title (contains)
    - Content (contains)

    Args:
        query: Search query string
        category: Filter by category
        tags: Filter by tags (any match)
        limit: Maximum results
        repo_root: Repository root

    Returns:
        List of matching MemoryEntry objects
    """
    manager = MemoryManager(repo_root)
    all_memories = manager.list_memories(category=category, limit=1000)

    query_lower = query.lower()
    query_words = query_lower.split()

    results = []
    for memory in all_memories:
        score = 0

        # Tag matching (highest weight)
        if tags:
            matching_tags = set(t.lower() for t in memory.tags) & set(t.lower() for t in tags)
            if matching_tags:
                score += len(matching_tags) * 10

        # Tag keyword matching
        for tag in memory.tags:
            if query_lower in tag.lower():
                score += 5

        # Title matching
        title_lower = memory.title.lower()
        if query_lower in title_lower:
            score += 8
        else:
            for word in query_words:
                if word in title_lower:
                    score += 3

        # Content matching
        content_lower = memory.content.lower()
        if query_lower in content_lower:
            score += 4
        else:
            for word in query_words:
                if word in content_lower:
                    score += 1

        if score > 0:
            results.append((score, memory))

    # Sort by score descending
    results.sort(key=lambda x: x[0], reverse=True)

    return [memory for _, memory in results[:limit]]


def find_related_memories(
    context: str,
    category: str | None = None,
    limit: int = 5,
    repo_root: Path | None = None,
) -> list[MemoryEntry]:
    """Find memories related to a context/task.

    Extracts keywords from context and searches memories.

    Args:
        context: Task or situation description
        category: Filter by category
        limit: Maximum results
        repo_root: Repository root

    Returns:
        List of related MemoryEntry objects
    """
    # Extract keywords (simple approach - filter common words)
    common_words = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "must", "to", "of", "in", "for", "on", "with",
        "at", "by", "from", "as", "into", "through", "during", "before", "after",
        "above", "below", "between", "under", "again", "further", "then", "once",
        "here", "there", "when", "where", "why", "how", "all", "each", "few",
        "more", "most", "other", "some", "such", "no", "nor", "not", "only",
        "own", "same", "so", "than", "too", "very", "just", "and", "but", "if",
        "or", "because", "until", "while", "this", "that", "these", "those",
        "i", "you", "he", "she", "it", "we", "they", "what", "which", "who",
    }

    words = context.lower().split()
    keywords = [w for w in words if w not in common_words and len(w) > 2]

    if not keywords:
        return []

    # Search with top keywords
    query = " ".join(keywords[:5])
    return search_memories(query, category=category, limit=limit, repo_root=repo_root)
```

---

### Task 6: Checkpoint Manager

**File: `src/agentic_workflows/checkpoints/manager.py`**

```python
"""Checkpoint management for workflow sessions."""

from datetime import datetime, timezone
from pathlib import Path

import yaml


def get_checkpoint_path(workflow_id: str, repo_root: Path | None = None) -> Path:
    """Get path to checkpoint file for a workflow."""
    if repo_root is None:
        repo_root = Path.cwd()
    return repo_root / "agentic" / "workflows" / workflow_id / "checkpoint.md"


def create_checkpoint(
    workflow_id: str,
    step: str,
    context: str,
    progress: str,
    notes: str = "",
    issues: str = "",
    repo_root: Path | None = None,
) -> str:
    """Create a checkpoint entry.

    Args:
        workflow_id: Workflow ID
        step: Current step name
        context: Context summary
        progress: Progress details (markdown checklist)
        notes: Notes for next session
        issues: Issues discovered
        repo_root: Repository root

    Returns:
        Checkpoint ID
    """
    checkpoint_path = get_checkpoint_path(workflow_id, repo_root)
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)

    # Generate checkpoint ID
    existing = read_checkpoints(workflow_id, repo_root)
    checkpoint_num = len(existing) + 1
    checkpoint_id = f"chk-{checkpoint_num:03d}"

    timestamp = datetime.now(timezone.utc).isoformat()

    # Build checkpoint entry
    frontmatter = {
        "checkpoint_id": checkpoint_id,
        "step": step,
        "created": timestamp,
        "workflow_id": workflow_id,
        "status": "in_progress",
    }

    entry_lines = [
        "---",
        yaml.dump(frontmatter, default_flow_style=False).strip(),
        "---",
        "",
        "## Context",
        "",
        context,
        "",
        "## Progress",
        "",
        progress,
        "",
    ]

    if notes:
        entry_lines.extend([
            "## Notes for Next Session",
            "",
            notes,
            "",
        ])

    if issues:
        entry_lines.extend([
            "## Issues Discovered",
            "",
            issues,
            "",
        ])

    entry_lines.append("---\n")
    entry = "\n".join(entry_lines)

    # Append to checkpoint file
    with open(checkpoint_path, "a", encoding="utf-8") as f:
        f.write(entry)

    return checkpoint_id


def read_checkpoints(
    workflow_id: str,
    repo_root: Path | None = None,
) -> list[dict]:
    """Read all checkpoints for a workflow.

    Returns list of checkpoint dictionaries with frontmatter and content.
    """
    checkpoint_path = get_checkpoint_path(workflow_id, repo_root)

    if not checkpoint_path.exists():
        return []

    content = checkpoint_path.read_text(encoding="utf-8")
    checkpoints = []

    # Split by frontmatter boundaries
    parts = content.split("---")

    i = 1
    while i < len(parts) - 1:
        frontmatter_str = parts[i].strip()
        body = parts[i + 1].strip() if i + 1 < len(parts) else ""

        if frontmatter_str:
            try:
                frontmatter = yaml.safe_load(frontmatter_str)
                if frontmatter and "checkpoint_id" in frontmatter:
                    frontmatter["content"] = body
                    checkpoints.append(frontmatter)
            except yaml.YAMLError:
                pass

        i += 2

    return checkpoints


def get_latest_checkpoint(
    workflow_id: str,
    repo_root: Path | None = None,
) -> dict | None:
    """Get the most recent checkpoint for a workflow."""
    checkpoints = read_checkpoints(workflow_id, repo_root)
    return checkpoints[-1] if checkpoints else None
```

---

### Task 7: Skills

**File: `skills/create-memory.md`**

````markdown
---
name: create-memory
description: Create a memory document for future reference
---

# Create Memory

Use this skill to persist a learning, pattern, or discovery that should be remembered for future sessions.

## When to Use

Create memories when you:

- Discover an unexpected pattern in the codebase
- Find a workaround for a framework limitation
- Encounter an error and find the solution
- Learn something about the project's conventions
- Make an architectural decision with rationale

## How to Use

Invoke this skill with the following information:

1. **Category** (required): pattern | lesson | error | decision | context
2. **Title** (required): Brief descriptive title
3. **Tags** (required): List of searchable keywords
4. **Content** (required): The learning in markdown format

## Output Format

After creating the memory, confirm with:

```json
{
  "success": true,
  "memory_id": "mem-YYYY-MM-DD-slug",
  "path": "agentic/memory/category/filename.md"
}
```
````

## Guidelines

Before creating a memory:

1. Check if a similar memory already exists using `/search-memory`
2. Ensure the content is specific and actionable
3. Include code examples when relevant
4. Keep content concise but complete

## Example

````
/create-memory
Category: pattern
Title: Error Handling Convention
Tags: error, exception, typescript, middleware
Content:
This codebase uses a centralized error handling pattern where all errors
extend BaseError and are caught by the global error middleware.

## Pattern
- Define error classes in src/errors/
- Extend BaseError with appropriate status code
- Throw errors, let middleware handle response

## Code Example
```typescript
class ValidationError extends BaseError {
  constructor(message: string) {
    super(message, 400);
  }
}
````

```

```

**File: `skills/search-memory.md`**

````markdown
---
name: search-memory
description: Search memories for relevant context
---

# Search Memory

Search the memory system for relevant learnings, patterns, and context.

## When to Use

Search memories when you:

- Start working on a complex task
- Encounter an error or unexpected behavior
- Need to understand project conventions
- Are about to make architectural decisions

## How to Use

Provide a search query and optionally filter by category or tags.

## Parameters

- **query** (required): Keywords to search for
- **category** (optional): pattern | lesson | error | decision | context
- **tags** (optional): List of tags to filter by

## Output Format

Return matching memories:

```json
{
  "results": [
    {
      "id": "mem-2024-01-15-auth-pattern",
      "title": "Authentication Middleware Pattern",
      "category": "pattern",
      "relevance": "high",
      "summary": "First 200 chars of content..."
    }
  ],
  "count": 1
}
```
````

## Example 2

```
/search-memory authentication middleware
```

````

**File: `skills/create-checkpoint.md`**

```markdown
---
name: create-checkpoint
description: Create a checkpoint to track progress and share context
---

# Create Checkpoint

Create a checkpoint to record your progress and provide context for future sessions or other agents.

## When to Use

Create checkpoints when:
- Completing a milestone in the implementation
- About to hand off to another session
- Encountering issues that need documentation
- Reaching a natural pause point

## Parameters

- **context** (required): Summary of current situation
- **progress** (required): What has been completed (markdown checklist)
- **notes** (optional): Important information for next session
- **issues** (optional): Problems discovered that need attention

## Output Format

```json
{
  "success": true,
  "checkpoint_id": "chk-001",
  "workflow_id": "abc123"
}
````

## Example 3

```
/create-checkpoint
Context: Completed OAuth implementation, starting on session management.
Progress:
- [x] OAuth provider configuration
- [x] Callback endpoint implementation
- [x] Token storage in database
- [ ] Session creation from OAuth token
Notes: The existing session middleware in src/middleware/session.ts needs to be extended.
Issues: Rate limiting may conflict with OAuth flow - needs investigation.
```

````

**File: `skills/create-log.md`**

```markdown
---
name: create-log
description: Add a log entry to the workflow log
---

# Create Log

Add a structured log entry to the workflow's NDJSON log file.

## When to Use

Create logs for:
- Important progress milestones
- Errors or warnings encountered
- Decisions made during execution
- Context that should be recorded

## Parameters

- **level** (required): Critical | Error | Warning | Information
- **message** (required): Log message
- **context** (optional): Additional context as key-value pairs

## Output Format

```json
{
  "success": true,
  "entry": {
    "timestamp": "2024-01-15T10:30:00Z",
    "level": "Information",
    "step": "implement",
    "message": "Completed milestone 1"
  }
}
````

## Log Levels

- **Critical**: Fatal error causing workflow to stop
- **Error**: Any error that occurred
- **Warning**: Unexpected issue that may need attention
- **Information**: Regular progress logging

````

---

### Task 8: Templates

**File: `templates/checkpoint.md.j2`**

```jinja2
---
checkpoint_id: {{ checkpoint_id }}
step: {{ step }}
created: {{ created }}
workflow_id: {{ workflow_id }}
status: {{ status }}
---

## Context

{{ context }}

## Progress

{{ progress }}

{% if notes %}
## Notes for Next Session

{{ notes }}
{% endif %}

{% if issues %}
## Issues Discovered

{{ issues }}
{% endif %}
````

**File: `templates/memory.md.j2`**

```jinja2
---
id: {{ id }}
created: {{ created }}
category: {{ category }}
tags: {{ tags | tojson }}
{% if source %}
source:
  workflow: {{ source.workflow }}
  step: {{ source.step }}
{% endif %}
relevance: {{ relevance }}
---

# {{ title }}

{{ content }}
```

---

### Task 9: CLI Additions

Update `cli.py` to add:

```python
# resume command
resume_parser = subparsers.add_parser("resume", help="Resume a paused workflow")
resume_parser.add_argument("workflow_id", help="Workflow ID to resume")

# cancel command
cancel_parser = subparsers.add_parser("cancel", help="Cancel a running workflow")
cancel_parser.add_argument("workflow_id", help="Workflow ID to cancel")

# input command
input_parser = subparsers.add_parser("input", help="Provide human input to a paused workflow")
input_parser.add_argument("workflow_id", help="Workflow ID")
input_parser.add_argument("response", help="Your response/input")
```

Implementation:

```python
def cmd_resume(args):
    """Resume a paused/cancelled workflow."""
    from agentic_workflows.progress import load_progress, WorkflowStatus
    from agentic_workflows.orchestrator import WorkflowOrchestrator
    from agentic_workflows.parser import WorkflowParser

    progress = load_progress(args.workflow_id)
    if not progress:
        print(f"Workflow not found: {args.workflow_id}")
        sys.exit(1)

    if progress.status not in [WorkflowStatus.PAUSED.value, WorkflowStatus.CANCELLED.value]:
        print(f"Workflow cannot be resumed: status is {progress.status}")
        sys.exit(1)

    # Find and parse original workflow
    # ... implementation details

    orchestrator = WorkflowOrchestrator()
    orchestrator.run(workflow, progress.variables, from_step=current_step)


def cmd_cancel(args):
    """Cancel a running workflow."""
    from agentic_workflows.progress import load_progress, save_progress, WorkflowStatus

    progress = load_progress(args.workflow_id)
    if not progress:
        print(f"Workflow not found: {args.workflow_id}")
        sys.exit(1)

    progress.status = WorkflowStatus.CANCELLED.value
    save_progress(progress)
    print(f"Workflow {args.workflow_id} cancelled")


def cmd_input(args):
    """Provide human input to a paused workflow."""
    from agentic_workflows.orchestrator import process_human_input

    if process_human_input(args.workflow_id, args.response):
        print("Input recorded successfully")
    else:
        sys.exit(1)
```

---

## Acceptance Criteria

1. **Orchestration Loop**: Claude orchestrator correctly decides next steps based on workflow state
2. **Parallel Execution**: Parallel steps run in separate worktrees concurrently
3. **Conditional Steps**: Conditions evaluate correctly using Jinja2
4. **Recurring Steps**: Steps repeat until condition met or max iterations
5. **Wait-for-Human**: Workflow pauses and accepts human input
6. **Error Handling**: Errors are classified and retried appropriately
7. **Graceful Shutdown**: SIGINT/SIGTERM cleanly stops workflow and cleans up
8. **Memory System**: Can create, list, search, and delete memories
9. **Checkpoints**: Can create and read checkpoint entries
10. **Resume/Cancel**: Can resume paused workflows and cancel running ones

---

## Integration Points

- Plan 1: Uses `runner.py`, `parser.py`, `executor.py` (prompt/command steps), `progress.py`, `logging/`, `git/worktree.py`
- Plan 3: Commands reference orchestrator, skills are used by Claude sessions
