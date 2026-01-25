"""Workflows command handler."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from argparse import Namespace


def get_bundled_workflows_dir() -> Path:
    """Get the directory containing bundled workflow templates."""
    return Path(__file__).parent.parent / "workflows"


def get_user_workflows_dir() -> Path:
    """Get the user-global workflows directory."""
    from os import environ

    if sys.platform == "win32":
        base_dir = Path(environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base_dir = Path(environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))

    return base_dir / "agentic-sdlc" / "workflows"


def get_project_workflows_dir() -> Path:
    """Get the project-local workflows directory."""
    return Path.cwd() / "agentic" / "workflows"


def get_workflow_metadata(path: Path) -> dict:
    """Extract metadata from a workflow YAML file.

    Returns:
        Dict with name, description, and variables from the workflow.
    """
    try:
        with open(path, encoding="utf-8") as f:
            content = yaml.safe_load(f)
            if not isinstance(content, dict):
                return {}
            return {
                "name": content.get("name", path.stem),
                "description": content.get("description", ""),
                "variables": content.get("variables", []),
            }
    except Exception:
        return {"name": path.stem, "description": "", "variables": []}


def list_all_workflows() -> list[tuple[str, Path, str, dict]]:
    """List all available workflows with metadata.

    Returns:
        List of tuples: (workflow_name, path, location_type, metadata)
    """
    workflows: list[tuple[str, Path, str, dict]] = []

    search_locations = [
        (get_project_workflows_dir(), "project"),
        (get_user_workflows_dir(), "user"),
        (get_bundled_workflows_dir(), "bundled"),
    ]

    for directory, location_type in search_locations:
        if directory.exists():
            for workflow_path in sorted(directory.glob("*.yaml")):
                metadata = get_workflow_metadata(workflow_path)
                workflows.append((workflow_path.stem, workflow_path, location_type, metadata))

    return workflows


def cmd_workflows(args: Namespace) -> None:
    """List available workflows with descriptions."""
    workflows = list_all_workflows()

    if not workflows:
        print("No workflows found.")
        print("\nSearched locations:")
        print(f"  - Project: {get_project_workflows_dir()}")
        print(f"  - User:    {get_user_workflows_dir()}")
        print(f"  - Bundled: {get_bundled_workflows_dir()}")
        print("\nUse 'agentic-sdlc init' to copy bundled workflows locally.")
        return

    # Check for --verbose flag
    verbose = hasattr(args, "verbose") and args.verbose

    # Group by location
    by_location: dict[str, list[tuple[str, Path, dict]]] = {}
    for name, path, location, metadata in workflows:
        if location not in by_location:
            by_location[location] = []
        by_location[location].append((name, path, metadata))

    print("Available Workflows")
    print("=" * 50)
    print()

    # Display grouped results
    location_order = ["project", "user", "bundled"]
    location_labels = {"project": "Project", "user": "User", "bundled": "Bundled"}

    for location in location_order:
        if location not in by_location:
            continue

        print(f"{location_labels[location]}:")
        for name, _path, metadata in by_location[location]:
            desc = metadata.get("description", "")
            if desc:
                # Truncate long descriptions
                if len(desc) > 60 and not verbose:
                    desc = desc[:57] + "..."
                print(f"  {name:<25} {desc}")
            else:
                print(f"  {name}")

            # Show variables in verbose mode
            if verbose and metadata.get("variables"):
                vars_list = metadata["variables"]
                required_vars = [v["name"] for v in vars_list if v.get("required", False)]
                optional_vars = [v["name"] for v in vars_list if not v.get("required", False)]
                if required_vars:
                    print(f"    Required: {', '.join(required_vars)}")
                if optional_vars:
                    print(f"    Optional: {', '.join(optional_vars)}")

        print()

    print(f"Total: {len(workflows)} workflow(s)")
    print()
    print("Usage:")
    print("  agentic-sdlc run <workflow-name>")
    print("  agentic-sdlc run <workflow-name> --var key=value")
    print()
    print("Examples:")
    print("  agentic-sdlc run one-shot --var task=\"Add login button\"")
    print("  agentic-sdlc run analyze-single --var analysis_type=bug")
    print("  agentic-sdlc run plan-build-validate --var task=\"Refactor auth\"")
