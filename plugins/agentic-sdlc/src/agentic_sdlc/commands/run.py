"""Run command handler."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def get_bundled_workflows_dir() -> Path:
    """Get the directory containing bundled workflow templates."""
    return Path(__file__).parent.parent / "workflows"


def get_user_workflows_dir() -> Path:
    """Get the user-global workflows directory."""
    # Use ~/.config/agentic-sdlc/workflows on Unix, %APPDATA%/agentic-sdlc/workflows on Windows
    from os import environ

    if sys.platform == "win32":
        base_dir = Path(environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base_dir = Path(environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))

    return base_dir / "agentic-sdlc" / "workflows"


def get_project_workflows_dir() -> Path:
    """Get the project-local workflows directory."""
    return Path.cwd() / "agentic" / "workflows"


def discover_workflow(name: str) -> tuple[Path | None, str]:
    """Discover a workflow by name across all search locations.

    Searches in order:
    1. Project-local: ./agentic/workflows/
    2. User-global: ~/.config/agentic-sdlc/workflows/
    3. Bundled: package workflows directory

    Args:
        name: Workflow name (with or without .yaml extension)

    Returns:
        Tuple of (resolved_path or None, location_description)
    """
    # Ensure .yaml extension
    if not name.endswith(".yaml"):
        name = f"{name}.yaml"

    # Search order: project -> user -> bundled
    search_locations = [
        (get_project_workflows_dir(), "project-local"),
        (get_user_workflows_dir(), "user-global"),
        (get_bundled_workflows_dir(), "bundled"),
    ]

    for directory, location_type in search_locations:
        workflow_path = directory / name
        if workflow_path.exists():
            return workflow_path, location_type

    return None, "not found"


def list_available_workflows() -> list[tuple[str, Path, str]]:
    """List all available workflows across all search locations.

    Returns:
        List of tuples: (workflow_name, path, location_type)
    """
    workflows: list[tuple[str, Path, str]] = []

    search_locations = [
        (get_project_workflows_dir(), "project-local"),
        (get_user_workflows_dir(), "user-global"),
        (get_bundled_workflows_dir(), "bundled"),
    ]

    for directory, location_type in search_locations:
        if directory.exists():
            for workflow_path in sorted(directory.glob("*.yaml")):
                workflows.append((workflow_path.stem, workflow_path, location_type))

    return workflows


def resolve_workflow_path(workflow_arg: Path | str) -> tuple[Path, str]:
    """Resolve workflow path, checking local then bundled locations.

    Args:
        workflow_arg: Either a path or a workflow name

    Returns:
        Tuple of (resolved_path, location_type)
        location_type can be: "absolute", "relative", "project-local", "user-global", "bundled"
    """
    # Convert to Path if string
    if isinstance(workflow_arg, str):
        workflow_arg = Path(workflow_arg)

    # First check if it's an absolute path or exists as a file
    if workflow_arg.is_absolute():
        if workflow_arg.exists():
            return workflow_arg, "absolute"
        # Doesn't exist, but respect the explicit path
        return workflow_arg, "absolute"

    # Check if it exists as a relative path from cwd
    local_path = Path.cwd() / workflow_arg
    if local_path.exists():
        return local_path.resolve(), "relative"

    # If the input looks like a bare name (no path separators), try discovery
    if "/" not in str(workflow_arg) and "\\" not in str(workflow_arg):
        discovered_path, location_type = discover_workflow(str(workflow_arg))
        if discovered_path:
            return discovered_path, location_type

    # Fallback: return the original path (will fail with appropriate error)
    return workflow_arg.resolve(), "not found"


def cmd_run(args: Namespace) -> None:
    """Run a workflow."""
    # Handle --list flag
    if hasattr(args, "list_workflows") and args.list_workflows:
        print("Available workflows:\n")
        workflows = list_available_workflows()

        if not workflows:
            print("No workflows found.")
            print("\nSearched locations:")
            print(f"  - Project: {get_project_workflows_dir()}")
            print(f"  - User:    {get_user_workflows_dir()}")
            print(f"  - Bundled: {get_bundled_workflows_dir()}")
            return

        # Group by location
        by_location: dict[str, list[tuple[str, Path]]] = {}
        for name, path, location in workflows:
            if location not in by_location:
                by_location[location] = []
            by_location[location].append((name, path))

        # Display grouped results
        for location in ["project-local", "user-global", "bundled"]:
            if location in by_location:
                location_label = location.replace("-", " ").title()
                print(f"{location_label}:")
                for name, _path in by_location[location]:
                    print(f"  {name}")
                print()

        print(f"Total: {len(workflows)} workflow(s)")
        print("\nUsage: agentic-sdlc run <workflow-name>")
        return

    # Validate workflow argument is provided
    if not args.workflow:
        print("Error: workflow name or path is required", file=sys.stderr)
        print("Use 'agentic-sdlc run --list' to see available workflows", file=sys.stderr)
        sys.exit(1)

    from agentic_sdlc.executor import WorkflowExecutor
    from agentic_sdlc.parser import WorkflowParseError, WorkflowParser

    workflow_path, location_type = resolve_workflow_path(args.workflow)

    if not workflow_path.exists():
        print(f"Error: Workflow not found: {args.workflow}", file=sys.stderr)
        print("\nAvailable workflows:", file=sys.stderr)

        workflows = list_available_workflows()
        if workflows:
            for name, _, location in workflows[:10]:  # Show first 10
                print(f"  {name} ({location})", file=sys.stderr)
            if len(workflows) > 10:
                print(f"  ... and {len(workflows) - 10} more", file=sys.stderr)
        else:
            print("  (no workflows found)", file=sys.stderr)

        print("\nUse 'agentic-sdlc run --list' to see all workflows.", file=sys.stderr)
        print("Use 'agentic-sdlc init' to copy bundled workflows locally.", file=sys.stderr)
        sys.exit(1)

    # Show which workflow is being used
    if location_type in ["project-local", "user-global", "bundled"]:
        print(f"Using {location_type} workflow: {workflow_path.name}")

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
        )
        print(f"\nWorkflow {progress.status}: {progress.workflow_id}")
        if progress.errors:
            print("\nErrors:")
            for error in progress.errors:
                print(f"  - {error['step']}: {error['error']}")
    except Exception as e:
        print(f"Error running workflow: {e}", file=sys.stderr)
        sys.exit(1)
