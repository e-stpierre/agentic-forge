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

    # memory commands
    memory_parser = subparsers.add_parser("memory", help="Memory management")
    memory_subparsers = memory_parser.add_subparsers(dest="memory_command")
    memory_list = memory_subparsers.add_parser("list", help="List memories")
    memory_list.add_argument(
        "--category",
        choices=["pattern", "lesson", "error", "decision", "context"],
        help="Filter by category",
    )
    memory_search = memory_subparsers.add_parser("search", help="Search memories")
    memory_search.add_argument("query", help="Search query")
    memory_prune = memory_subparsers.add_parser("prune", help="Prune old memories")
    memory_prune.add_argument("--older-than", default="30d", help="Age threshold (e.g., 30d)")

    # config get/set commands
    config_parser = subparsers.add_parser("config", help="Get or set configuration")
    config_subparsers = config_parser.add_subparsers(dest="config_command")
    config_get = config_subparsers.add_parser("get", help="Get config value")
    config_get.add_argument("key", help="Configuration key (dot notation)")
    config_set = config_subparsers.add_parser("set", help="Set config value")
    config_set.add_argument("key", help="Configuration key (dot notation)")
    config_set.add_argument("value", help="Value to set")

    # one-shot convenience command
    oneshot_parser = subparsers.add_parser("one-shot", help="Execute a single task end-to-end")
    oneshot_parser.add_argument("prompt", help="Task description")
    oneshot_parser.add_argument("--git", action="store_true", help="Enable git integration")
    oneshot_parser.add_argument("--pr", action="store_true", help="Create PR on completion")
    oneshot_parser.add_argument(
        "--terminal-output",
        choices=["base", "all"],
        default="base",
        help="Terminal output granularity",
    )

    # analyse convenience command
    analyse_parser = subparsers.add_parser("analyse", help="Analyze codebase")
    analyse_parser.add_argument(
        "--type",
        choices=["bug", "debt", "doc", "security", "style", "all"],
        default="all",
        help="Analysis type",
    )
    analyse_parser.add_argument(
        "--autofix",
        choices=["none", "minor", "major", "critical"],
        default="none",
        help="Auto-fix severity level",
    )
    analyse_parser.add_argument(
        "--terminal-output",
        choices=["base", "all"],
        default="base",
        help="Terminal output granularity",
    )

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
    elif args.command == "memory":
        cmd_memory(args)
    elif args.command == "one-shot":
        cmd_oneshot(args)
    elif args.command == "analyse":
        cmd_analyse(args)
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
    from agentic_workflows.progress import load_progress, save_progress, WorkflowStatus

    progress = load_progress(args.workflow_id)
    if progress is None:
        print(f"Error: Workflow not found: {args.workflow_id}", file=sys.stderr)
        sys.exit(1)

    if progress.status not in [
        WorkflowStatus.PAUSED.value,
        WorkflowStatus.FAILED.value,
        WorkflowStatus.CANCELLED.value,
    ]:
        print(
            f"Error: Cannot resume workflow in '{progress.status}' status",
            file=sys.stderr,
        )
        sys.exit(1)

    progress.status = WorkflowStatus.RUNNING.value
    if progress.current_step:
        step_name = progress.current_step.get("name")
        if step_name and step_name not in progress.pending_steps:
            progress.pending_steps.insert(0, step_name)
        progress.current_step = None

    save_progress(progress)
    print(f"Workflow {args.workflow_id} resumed. Run workflow again to continue.")


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
    from agentic_workflows.orchestrator import process_human_input

    if process_human_input(args.workflow_id, args.response):
        print(f"Input recorded for workflow: {args.workflow_id}")
    else:
        sys.exit(1)


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


def cmd_memory(args: Namespace) -> None:
    """Memory management commands."""
    from agentic_workflows.memory import MemoryManager, search_memories

    if args.memory_command == "list":
        manager = MemoryManager()
        memories = manager.list_memories(category=args.category, limit=20)
        if not memories:
            print("No memories found.")
            return
        print(f"{'ID':<35} {'Category':<12} {'Title':<30}")
        print("-" * 80)
        for mem in memories:
            print(f"{mem.id:<35} {mem.category:<12} {mem.title[:30]:<30}")

    elif args.memory_command == "search":
        results = search_memories(args.query, limit=10)
        if not results:
            print(f"No memories found for: {args.query}")
            return
        print(f"Found {len(results)} memories:\n")
        for mem in results:
            print(f"[{mem.category}] {mem.title}")
            print(f"  ID: {mem.id}")
            print(f"  Tags: {', '.join(mem.tags)}")
            print()

    elif args.memory_command == "prune":
        manager = MemoryManager()
        older_than_str = args.older_than
        days = 30
        if older_than_str.endswith("d"):
            days = int(older_than_str[:-1])
        elif older_than_str.endswith("w"):
            days = int(older_than_str[:-1]) * 7
        elif older_than_str.endswith("m"):
            days = int(older_than_str[:-1]) * 30
        else:
            try:
                days = int(older_than_str)
            except ValueError:
                print(f"Invalid format: {older_than_str}. Use format like 30d, 4w, or 2m.", file=sys.stderr)
                sys.exit(1)

        deleted = manager.prune(older_than_days=days)
        if deleted:
            print(f"Pruned {len(deleted)} memories older than {days} days:")
            for mem_id in deleted:
                print(f"  - {mem_id}")
        else:
            print(f"No memories older than {days} days found.")

    else:
        print("Usage: agentic-workflow memory list|search|prune", file=sys.stderr)
        sys.exit(1)


def cmd_oneshot(args: Namespace) -> None:
    """Execute a single task end-to-end using the one-shot workflow."""
    from agentic_workflows.executor import WorkflowExecutor
    from agentic_workflows.parser import WorkflowParser, WorkflowParseError

    # Find the one-shot workflow
    plugin_dir = Path(__file__).parent.parent
    workflow_path = plugin_dir / "workflows" / "one-shot.yaml"

    if not workflow_path.exists():
        print(f"Error: one-shot workflow not found at {workflow_path}", file=sys.stderr)
        sys.exit(1)

    # Build variables
    variables = {
        "task": args.prompt,
        "create_pr": args.pr,
    }

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
            terminal_output=args.terminal_output,
        )
        print(f"\nWorkflow {progress.status}: {progress.workflow_id}")
        if progress.errors:
            print("\nErrors:")
            for error in progress.errors:
                print(f"  - {error['step']}: {error['error']}")
    except Exception as e:
        print(f"Error running workflow: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_analyse(args: Namespace) -> None:
    """Analyze codebase using the analyse-codebase workflow."""
    from agentic_workflows.executor import WorkflowExecutor
    from agentic_workflows.parser import WorkflowParser, WorkflowParseError

    plugin_dir = Path(__file__).parent.parent

    if args.type != "all":
        workflow_path = plugin_dir / "workflows" / "analyse-single.yaml"
        variables = {
            "analysis_type": args.type,
            "autofix": args.autofix,
        }
        print(f"Running {args.type} analysis...")
    else:
        workflow_path = plugin_dir / "workflows" / "analyse-codebase.yaml"
        variables = {
            "autofix": args.autofix,
        }
        print("Running comprehensive analysis (all types)...")

    if not workflow_path.exists():
        print(f"Error: workflow not found at {workflow_path}", file=sys.stderr)
        sys.exit(1)

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
            terminal_output=args.terminal_output,
        )
        print(f"\nAnalysis {progress.status}: {progress.workflow_id}")
        if progress.errors:
            print("\nErrors:")
            for error in progress.errors:
                print(f"  - {error['step']}: {error['error']}")
    except Exception as e:
        print(f"Error running analysis: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
