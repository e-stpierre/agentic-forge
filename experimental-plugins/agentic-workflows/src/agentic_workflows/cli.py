"""CLI entry point for agentic-workflow command."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def main() -> None:
    """Main entry point for the CLI."""
    parser = argparse.ArgumentParser(
        prog="agentic-workflow",
        description="Agentic workflow orchestration for Claude Code",
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # run command
    run_parser = subparsers.add_parser("run", help="Run a workflow")
    run_parser.add_argument("workflow", type=Path, help="Path to workflow YAML file")
    run_parser.add_argument(
        "--var",
        action="append",
        dest="vars",
        metavar="KEY=VALUE",
        help="Set workflow variable (can be used multiple times)",
    )
    run_parser.add_argument("--from-step", help="Resume from a specific step")
    run_parser.add_argument(
        "--terminal-output",
        choices=["base", "all"],
        default="base",
        help="Terminal output granularity",
    )
    run_parser.add_argument(
        "--dry-run", action="store_true", help="Validate without executing"
    )

    # resume command
    resume_parser = subparsers.add_parser("resume", help="Resume a workflow")
    resume_parser.add_argument("workflow_id", help="Workflow ID to resume")

    # status command
    status_parser = subparsers.add_parser("status", help="Show workflow status")
    status_parser.add_argument("workflow_id", help="Workflow ID")

    # cancel command
    cancel_parser = subparsers.add_parser("cancel", help="Cancel a workflow")
    cancel_parser.add_argument("workflow_id", help="Workflow ID to cancel")

    # list command
    list_parser = subparsers.add_parser("list", help="List workflows")
    list_parser.add_argument(
        "--status",
        choices=["running", "completed", "failed", "paused"],
        help="Filter by status",
    )

    # input command (for wait-for-human steps)
    input_parser = subparsers.add_parser("input", help="Provide human input")
    input_parser.add_argument("workflow_id", help="Workflow ID")
    input_parser.add_argument("response", help="Response to provide")

    # configure command
    subparsers.add_parser("configure", help="Configure plugin settings")

    # config get/set commands
    config_parser = subparsers.add_parser("config", help="Get or set configuration")
    config_subparsers = config_parser.add_subparsers(dest="config_command")
    config_get = config_subparsers.add_parser("get", help="Get config value")
    config_get.add_argument("key", help="Configuration key (dot notation)")
    config_set = config_subparsers.add_parser("set", help="Set config value")
    config_set.add_argument("key", help="Configuration key (dot notation)")
    config_set.add_argument("value", help="Value to set")

    args = parser.parse_args()

    if args.command == "run":
        cmd_run(args)
    elif args.command == "resume":
        cmd_resume(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "cancel":
        cmd_cancel(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "input":
        cmd_input(args)
    elif args.command == "configure":
        cmd_configure(args)
    elif args.command == "config":
        cmd_config(args)
    else:
        parser.print_help()
        sys.exit(1)


def cmd_run(args: Namespace) -> None:
    """Run a workflow."""
    from agentic_workflows.executor import WorkflowExecutor
    from agentic_workflows.parser import WorkflowParser, WorkflowParseError

    workflow_path = args.workflow.resolve()
    if not workflow_path.exists():
        print(f"Error: Workflow file not found: {workflow_path}", file=sys.stderr)
        sys.exit(1)

    # Parse variables
    variables: dict[str, str] = {}
    if args.vars:
        for var in args.vars:
            if "=" not in var:
                print(f"Error: Invalid variable format: {var}", file=sys.stderr)
                print("Expected format: KEY=VALUE", file=sys.stderr)
                sys.exit(1)
            key, value = var.split("=", 1)
            variables[key] = value

    try:
        parser = WorkflowParser()
        workflow = parser.parse_file(workflow_path)
    except WorkflowParseError as e:
        print(f"Error parsing workflow: {e}", file=sys.stderr)
        sys.exit(1)

    executor = WorkflowExecutor()
    try:
        progress = executor.run(
            workflow=workflow,
            variables=variables,
            from_step=args.from_step,
            terminal_output=args.terminal_output,
            dry_run=args.dry_run,
        )
        print(f"\nWorkflow {progress.status}: {progress.workflow_id}")
        if progress.errors:
            print("\nErrors:")
            for error in progress.errors:
                print(f"  - {error['step']}: {error['error']}")
    except Exception as e:
        print(f"Error running workflow: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_resume(args: Namespace) -> None:
    """Resume a paused or failed workflow."""
    from agentic_workflows.progress import load_progress, WorkflowStatus

    progress = load_progress(args.workflow_id)
    if progress is None:
        print(f"Error: Workflow not found: {args.workflow_id}", file=sys.stderr)
        sys.exit(1)

    if progress.status not in [WorkflowStatus.PAUSED.value, WorkflowStatus.FAILED.value]:
        print(
            f"Error: Cannot resume workflow in '{progress.status}' status",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Resuming workflow: {args.workflow_id}")
    print("Note: Full resume implementation in Plan 2")


def cmd_status(args: Namespace) -> None:
    """Show workflow status."""
    from agentic_workflows.progress import load_progress

    progress = load_progress(args.workflow_id)
    if progress is None:
        print(f"Error: Workflow not found: {args.workflow_id}", file=sys.stderr)
        sys.exit(1)

    print(f"Workflow: {progress.workflow_name}")
    print(f"ID: {progress.workflow_id}")
    print(f"Status: {progress.status}")
    print(f"Started: {progress.started_at}")
    if progress.completed_at:
        print(f"Completed: {progress.completed_at}")

    if progress.current_step:
        print(f"\nCurrent Step: {progress.current_step['name']}")
        print(f"  Retry Count: {progress.current_step.get('retry_count', 0)}")

    if progress.completed_steps:
        print("\nCompleted Steps:")
        for step in progress.completed_steps:
            status_icon = "+" if step.status == "completed" else "x"
            print(f"  [{status_icon}] {step.name}")

    if progress.pending_steps:
        print("\nPending Steps:")
        for step_name in progress.pending_steps:
            print(f"  [ ] {step_name}")

    if progress.errors:
        print("\nErrors:")
        for error in progress.errors:
            print(f"  - {error['step']}: {error['error']}")


def cmd_cancel(args: Namespace) -> None:
    """Cancel a running workflow."""
    from agentic_workflows.progress import load_progress, save_progress, WorkflowStatus
    from datetime import datetime, timezone

    progress = load_progress(args.workflow_id)
    if progress is None:
        print(f"Error: Workflow not found: {args.workflow_id}", file=sys.stderr)
        sys.exit(1)

    if progress.status not in [WorkflowStatus.RUNNING.value, WorkflowStatus.PAUSED.value]:
        print(
            f"Error: Cannot cancel workflow in '{progress.status}' status",
            file=sys.stderr,
        )
        sys.exit(1)

    progress.status = WorkflowStatus.CANCELLED.value
    progress.completed_at = datetime.now(timezone.utc).isoformat()
    save_progress(progress)

    print(f"Workflow cancelled: {args.workflow_id}")


def cmd_list(args: Namespace) -> None:
    """List workflows."""
    from pathlib import Path

    workflows_dir = Path.cwd() / "agentic" / "workflows"
    if not workflows_dir.exists():
        print("No workflows found.")
        return

    workflows = []
    for workflow_dir in workflows_dir.iterdir():
        if workflow_dir.is_dir():
            progress_file = workflow_dir / "progress.json"
            if progress_file.exists():
                with open(progress_file) as f:
                    data = json.load(f)
                    if args.status is None or data.get("status") == args.status:
                        workflows.append(data)

    if not workflows:
        print("No workflows found." + (f" (status={args.status})" if args.status else ""))
        return

    print(f"{'ID':<12} {'Name':<25} {'Status':<12} {'Started':<20}")
    print("-" * 70)
    for wf in workflows:
        started = wf.get("started_at", "")[:19] if wf.get("started_at") else ""
        print(
            f"{wf.get('workflow_id', ''):<12} "
            f"{wf.get('workflow_name', '')[:25]:<25} "
            f"{wf.get('status', ''):<12} "
            f"{started:<20}"
        )


def cmd_input(args: Namespace) -> None:
    """Provide human input for a wait-for-human step."""
    from agentic_workflows.progress import load_progress, save_progress

    progress = load_progress(args.workflow_id)
    if progress is None:
        print(f"Error: Workflow not found: {args.workflow_id}", file=sys.stderr)
        sys.exit(1)

    if not progress.current_step:
        print("Error: No step waiting for input", file=sys.stderr)
        sys.exit(1)

    step_name = progress.current_step.get("name", "")
    for step in progress.completed_steps:
        if step.name == step_name:
            step.human_input = args.response
            break
    else:
        from agentic_workflows.progress import StepProgress

        step = StepProgress(name=step_name, status="running", human_input=args.response)
        progress.completed_steps.append(step)

    save_progress(progress)
    print(f"Input recorded for step: {step_name}")


def cmd_configure(args: Namespace) -> None:
    """Interactive configuration wizard."""
    from agentic_workflows.config import load_config, save_config

    config = load_config()
    print("Agentic Workflows Configuration")
    print("=" * 40)
    print("\nCurrent settings:")
    print(json.dumps(config, indent=2))
    print("\nUse 'agentic-workflow config set <key> <value>' to modify settings.")
    print("Example: agentic-workflow config set defaults.maxRetry 5")


def cmd_config(args: Namespace) -> None:
    """Get or set configuration values."""
    from agentic_workflows.config import get_config_value, set_config_value

    if args.config_command == "get":
        value = get_config_value(args.key)
        if value is None:
            print(f"Key not found: {args.key}", file=sys.stderr)
            sys.exit(1)
        if isinstance(value, dict):
            print(json.dumps(value, indent=2))
        else:
            print(value)
    elif args.config_command == "set":
        set_config_value(args.key, args.value)
        print(f"Set {args.key} = {args.value}")
    else:
        print("Usage: agentic-workflow config get|set <key> [value]", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
