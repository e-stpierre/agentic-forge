#!/usr/bin/env -S uv run python
"""
Update all plugins from the local marketplace.

This script:
1. Updates the marketplace from the local repository
2. Reinstalls all plugins defined in marketplace.json
3. Force reinstalls the Python tools (core, sdlc)

Usage:
    python .claude/update-plugins.py

    Or run from anywhere:
    python path/to/update-plugins.py
"""

import json
import subprocess
import sys
from pathlib import Path


def run_command(cmd: list[str], description: str, cwd: Path | None = None) -> bool:
    """Run a command and return success status."""
    print(f"\n{'='*60}")
    print(f"Running: {description}")
    print(f"Command: {' '.join(cmd)}")
    if cwd:
        print(f"Working directory: {cwd}")
    print("=" * 60)

    result = subprocess.run(cmd, cwd=cwd, shell=True)

    if result.returncode != 0:
        print(f"Warning: {description} returned non-zero exit code: {result.returncode}")
        return False
    return True


def main():
    # Get the repository root (parent of .claude directory)
    script_dir = Path(__file__).parent.resolve()
    repo_root = script_dir.parent
    marketplace_path = repo_root / ".claude-plugin" / "marketplace.json"

    print(f"Repository root: {repo_root}")
    print(f"Marketplace path: {marketplace_path}")

    # Load marketplace.json to get plugin names
    if not marketplace_path.exists():
        print(f"Error: marketplace.json not found at {marketplace_path}")
        sys.exit(1)

    with open(marketplace_path, "r") as f:
        marketplace = json.load(f)

    plugins = [p["name"] for p in marketplace.get("plugins", [])]
    print(f"\nFound plugins: {', '.join(plugins)}")

    # Step 1: Update the marketplace from local repository
    # This refreshes the marketplace cache from the local ./ path
    run_command(
        ["claude", "plugin", "marketplace", "update", "claude-plugins"],
        "Update marketplace from local repository",
        cwd=repo_root,
    )

    # Step 2: Reinstall each plugin (uninstall then install)
    # There's no "update" command for plugins, so we reinstall
    for plugin in plugins:
        # Uninstall first (ignore errors if not installed)
        run_command(
            ["claude", "plugin", "uninstall", plugin],
            f"Uninstall plugin: {plugin}",
        )
        # Install from local marketplace
        run_command(
            ["claude", "plugin", "install", plugin],
            f"Install plugin: {plugin}",
        )

    # Step 3: Force reinstall Python tools
    # Note: sdlc depends on core, so we need to:
    # 1. Build core first so it's available as a local package
    # 2. Install sdlc with --find-links pointing to core's dist directory
    core_path = repo_root / "plugins" / "core"
    sdlc_path = repo_root / "plugins" / "sdlc"

    # Build core package first
    if core_path.exists():
        # Clean and build core
        dist_dir = core_path / "dist"
        if dist_dir.exists():
            import shutil
            shutil.rmtree(dist_dir)

        run_command(
            ["uv", "build"],
            "Build core package",
            cwd=core_path,
        )

        # Install core tool
        run_command(
            ["uv", "tool", "install", "--force", str(core_path)],
            "Force install Python tool: core",
        )
    else:
        print(f"Warning: Python tool path not found: {core_path}")

    # Install sdlc with --find-links to locate core dependency
    if sdlc_path.exists():
        core_dist = core_path / "dist"
        if core_dist.exists():
            run_command(
                ["uv", "tool", "install", "--force", "--find-links", str(core_dist), str(sdlc_path)],
                "Force install Python tool: sdlc (with local core dependency)",
            )
        else:
            # Fallback: try installing without find-links (may fail if core not in registry)
            run_command(
                ["uv", "tool", "install", "--force", str(sdlc_path)],
                "Force install Python tool: sdlc",
            )
    else:
        print(f"Warning: Python tool path not found: {sdlc_path}")

    print("\n" + "=" * 60)
    print("Plugin update complete!")
    print("Restart Claude Code to load the updated plugins.")
    print("=" * 60)


if __name__ == "__main__":
    main()
