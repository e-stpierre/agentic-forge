"""Init and configure command handlers."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def get_bundled_workflows_dir() -> Path:
    """Get the directory containing bundled workflow templates."""
    return Path(__file__).parent.parent / "workflows"


def cmd_init(args: Namespace) -> None:
    """Copy bundled workflow templates and config to local project."""
    bundled_dir = get_bundled_workflows_dir()
    if not bundled_dir.exists():
        print("Error: Bundled workflows directory not found.", file=sys.stderr)
        sys.exit(1)

    bundled_workflows = sorted(bundled_dir.glob("*.yaml"))
    if not bundled_workflows:
        print("No bundled workflows found.", file=sys.stderr)
        sys.exit(1)

    # List only mode
    if args.list_only:
        print("Available bundled workflows:")
        print()
        for wf in bundled_workflows:
            print(f"  {wf.name}")
        print()
        print("Use 'agentic-forge init' to copy these to agentic/workflows/")
        return

    # Copy workflows to local directory
    target_dir = Path.cwd() / "agentic" / "workflows"
    target_dir.mkdir(parents=True, exist_ok=True)

    copied = []
    skipped = []
    for wf in bundled_workflows:
        target_path = target_dir / wf.name
        if target_path.exists() and not args.force:
            skipped.append(wf.name)
        else:
            shutil.copy2(wf, target_path)
            copied.append(wf.name)

    if copied:
        print(f"Copied {len(copied)} workflow(s) to {target_dir}/")
        for name in copied:
            print(f"  + {name}")

    if skipped:
        print(f"\nSkipped {len(skipped)} existing workflow(s):")
        for name in skipped:
            print(f"  - {name}")
        print("\nUse --force to overwrite existing files.")

    # Create config.json next to workflows
    _init_config(target_dir.parent, force=args.force)

    if copied:
        print("\nYou can now run workflows with:")
        print("  agentic-forge run agentic/workflows/<workflow>.yaml")


def _init_config(agentic_dir: Path, *, force: bool = False) -> None:
    """Create config.json in the agentic directory if it doesn't exist."""
    from agentic_forge.config import get_default_config

    config_path = agentic_dir / "config.json"
    if config_path.exists() and not force:
        print(f"\nConfig already exists: {config_path}")
        return

    config = get_default_config()
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    print(f"\nCreated config: {config_path}")


def cmd_configure(args: Namespace) -> None:
    """Interactive configuration wizard."""
    from agentic_forge.config import load_config

    config = load_config()
    print("Agentic Workflows Configuration")
    print("=" * 40)
    print("\nCurrent settings:")
    print(json.dumps(config, indent=2))
    print("\nUse 'agentic-forge config set <key> <value>' to modify settings.")
    print("Example: agentic-forge config set defaults.maxRetry 5")
