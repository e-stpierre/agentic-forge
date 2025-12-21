"""
Agentic SDLC Orchestrator.

Provides utilities for orchestrating autonomous SDLC workflows
with JSON-based agent communication.

All commands use full namespace: /agentic-sdlc:command
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from claude_core import run_claude, get_logger

logger = get_logger(__name__)


@dataclass
class AgentMessage:
    """Message for agent-to-agent communication."""

    sender: str
    receiver: str
    content: dict[str, Any]
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sender": self.sender,
            "receiver": self.receiver,
            "content": self.content,
            "timestamp": self.timestamp,
        }


@dataclass
class WorkflowState:
    """State of an agentic workflow."""

    workflow_id: str
    status: str = "pending"  # pending, running, completed, failed
    current_phase: str = ""
    plan_file: str | None = None
    completed_tasks: list[str] = field(default_factory=list)
    commits: list[dict[str, str]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    messages: list[AgentMessage] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "status": self.status,
            "current_phase": self.current_phase,
            "plan_file": self.plan_file,
            "completed_tasks": self.completed_tasks,
            "commits": self.commits,
            "errors": self.errors,
            "messages": [m.to_dict() for m in self.messages],
        }


def run_agentic_command(
    command: str,
    json_input: dict[str, Any] | None = None,
    cwd: str | Path | None = None,
    timeout: int = 600,
) -> dict[str, Any]:
    """
    Run an agentic-sdlc command with JSON I/O.

    Args:
        command: Command name (e.g., "plan-feature", "implement")
        json_input: JSON input for the command
        cwd: Working directory
        timeout: Timeout in seconds

    Returns:
        Parsed JSON output from the command
    """
    # Always use full namespace
    full_command = f"/agentic-sdlc:{command}"

    if json_input:
        # Pass JSON via stdin
        input_str = json.dumps(json_input)
        prompt = f"{full_command} --json-stdin\n{input_str}"
    else:
        prompt = full_command

    logger.info(f"Running: {full_command}")

    result = run_claude(prompt, cwd=cwd, timeout=timeout)

    if not result.success:
        return {
            "success": False,
            "error": result.error or "Command failed",
            "error_code": "COMMAND_FAILED",
        }

    # Try to parse JSON from output
    try:
        # Look for JSON in the output
        output = result.output or ""
        # Find JSON block
        start = output.find("{")
        end = output.rfind("}") + 1
        if start >= 0 and end > start:
            json_str = output[start:end]
            return json.loads(json_str)
        else:
            return {
                "success": True,
                "output": output,
            }
    except json.JSONDecodeError:
        return {
            "success": True,
            "output": result.output,
        }


def agentic_plan(
    task_type: str,
    spec: dict[str, Any],
    cwd: str | Path | None = None,
) -> dict[str, Any]:
    """
    Invoke planning agent with JSON input.

    Args:
        task_type: "feature", "bug", or "chore"
        spec: Task specification
        cwd: Working directory

    Returns:
        Plan output with plan_file and plan_data
    """
    command = f"plan-{task_type}"
    spec["type"] = task_type
    return run_agentic_command(command, json_input=spec, cwd=cwd)


def agentic_build(
    plan_file: str | None = None,
    plan_data: dict[str, Any] | None = None,
    checkpoint: str | None = None,
    git_commit: bool = True,
    cwd: str | Path | None = None,
) -> dict[str, Any]:
    """
    Invoke build agent with plan JSON.

    Args:
        plan_file: Path to plan file
        plan_data: Plan data structure
        checkpoint: Resume from checkpoint
        git_commit: Whether to commit changes
        cwd: Working directory

    Returns:
        Build output with completed_tasks, changes, commits
    """
    input_data = {
        "git_commit": git_commit,
    }
    if plan_file:
        input_data["plan_file"] = plan_file
    if plan_data:
        input_data["plan_data"] = plan_data
    if checkpoint:
        input_data["checkpoint"] = checkpoint

    return run_agentic_command("implement", json_input=input_data, cwd=cwd)


def agentic_validate(
    files: list[str] | None = None,
    plan_file: str | None = None,
    cwd: str | Path | None = None,
) -> dict[str, Any]:
    """
    Invoke validation agents (review + test).

    Args:
        files: Files to review
        plan_file: Plan to verify compliance against
        cwd: Working directory

    Returns:
        Combined validation results
    """
    results = {}

    # Run review
    review_input = {}
    if files:
        review_input["files"] = files
    if plan_file:
        review_input["plan_file"] = plan_file

    review_result = run_agentic_command("review", json_input=review_input, cwd=cwd)
    results["review"] = review_result

    # Run tests
    test_input = {"coverage": True}
    test_result = run_agentic_command("test", json_input=test_input, cwd=cwd)
    results["test"] = test_result

    # Combine results
    return {
        "success": review_result.get("success", False) and test_result.get("success", False),
        "review": review_result,
        "test": test_result,
    }


def agentic_workflow(
    task_type: str,
    spec: dict[str, Any],
    auto_pr: bool = False,
    cwd: str | Path | None = None,
) -> WorkflowState:
    """
    Full end-to-end workflow orchestration.

    Args:
        task_type: "feature", "bug", or "chore"
        spec: Task specification
        auto_pr: Create PR on completion
        cwd: Working directory

    Returns:
        WorkflowState with full execution results
    """
    import uuid

    state = WorkflowState(workflow_id=str(uuid.uuid4()))
    state.status = "running"

    try:
        # Phase 1: Planning
        state.current_phase = "planning"
        logger.info(f"Phase 1: Planning {task_type}")

        plan_result = agentic_plan(task_type, spec, cwd=cwd)
        if not plan_result.get("success"):
            state.status = "failed"
            state.errors.append(plan_result.get("error", "Planning failed"))
            return state

        state.plan_file = plan_result.get("plan_file")

        # Phase 2: Building
        state.current_phase = "building"
        logger.info("Phase 2: Building")

        build_result = agentic_build(
            plan_file=state.plan_file,
            plan_data=plan_result.get("plan_data"),
            git_commit=True,
            cwd=cwd,
        )
        if not build_result.get("success"):
            state.status = "failed"
            state.errors.append(build_result.get("error", "Build failed"))
            return state

        state.completed_tasks = build_result.get("completed_tasks", [])
        state.commits = build_result.get("commits", [])

        # Phase 3: Validation
        state.current_phase = "validation"
        logger.info("Phase 3: Validation")

        validate_result = agentic_validate(
            plan_file=state.plan_file,
            cwd=cwd,
        )
        if not validate_result.get("success"):
            state.status = "failed"
            state.errors.append("Validation failed")
            return state

        # Phase 4: PR (if requested)
        if auto_pr:
            state.current_phase = "pr_creation"
            logger.info("Phase 4: Creating PR")
            # PR creation would go here

        state.status = "completed"
        state.current_phase = "done"

    except Exception as e:
        state.status = "failed"
        state.errors.append(str(e))
        logger.error(f"Workflow failed: {e}")

    return state


__all__ = [
    "AgentMessage",
    "WorkflowState",
    "run_agentic_command",
    "agentic_plan",
    "agentic_build",
    "agentic_validate",
    "agentic_workflow",
]
