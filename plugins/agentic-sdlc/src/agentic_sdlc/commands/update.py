"""Update command handler."""

from __future__ import annotations

import importlib.metadata
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import tomllib

if TYPE_CHECKING:
    import argparse


def _get_marketplace_path() -> Path:
    """Get the marketplace installation path for agentic-sdlc.

    Returns:
        Path to the agentic-sdlc plugin in the marketplace directory
    """
    if sys.platform == "win32":
        base = Path.home() / ".claude" / "plugins" / "marketplaces"
    else:
        base = Path.home() / ".claude" / "plugins" / "marketplaces"

    return base / "agentic-forge" / "plugins" / "agentic-sdlc"


def _get_marketplace_version(marketplace_path: Path) -> str | None:
    """Read version from pyproject.toml in the marketplace directory.

    Args:
        marketplace_path: Path to the plugin in the marketplace

    Returns:
        Version string or None if not found
    """
    pyproject_path = marketplace_path / "pyproject.toml"
    if not pyproject_path.exists():
        return None

    try:
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)
        return data.get("project", {}).get("version")
    except Exception:
        return None


def _compare_versions(current: str, available: str) -> int:
    """Compare two version strings.

    Args:
        current: Current installed version
        available: Available version in marketplace

    Returns:
        -1 if current < available, 0 if equal, 1 if current > available
    """

    def parse_version(v: str) -> tuple[int, ...]:
        return tuple(int(x) for x in v.split("."))

    try:
        current_parts = parse_version(current)
        available_parts = parse_version(available)

        if current_parts < available_parts:
            return -1
        elif current_parts > available_parts:
            return 1
        return 0
    except (ValueError, AttributeError):
        # If parsing fails, assume different versions
        return -1 if current != available else 0


def cmd_update(args: argparse.Namespace) -> None:
    """Update agentic-sdlc to the latest version from the local marketplace.

    Args:
        args: Parsed command line arguments with optional --check flag
    """
    package_name = "agentic-sdlc"

    # Get current installed version
    try:
        current_version = importlib.metadata.version(package_name)
    except importlib.metadata.PackageNotFoundError:
        print(f"Error: {package_name} is not installed")
        sys.exit(1)

    # Get marketplace path
    marketplace_path = _get_marketplace_path()
    if not marketplace_path.exists():
        print(f"Error: Marketplace not found at {marketplace_path}")
        print("Please ensure the marketplace is installed:")
        print("  /plugin marketplace add e-stpierre/agentic-forge")
        sys.exit(1)

    # Get available version from marketplace
    available_version = _get_marketplace_version(marketplace_path)
    if not available_version:
        print(f"Error: Could not read version from {marketplace_path / 'pyproject.toml'}")
        sys.exit(1)

    # Check for available updates
    if args.check:
        print(f"Current version: {current_version}")
        print(f"Available version: {available_version}")
        comparison = _compare_versions(current_version, available_version)
        if comparison < 0:
            print("A new version is available. Run 'agentic-sdlc update' to install.")
        elif comparison == 0:
            print("You are running the latest version.")
        else:
            print("You are running a newer version than available in the marketplace.")
        return

    # Check if update is needed
    comparison = _compare_versions(current_version, available_version)
    if comparison >= 0:
        print(f"Current version: {current_version}")
        print(f"Available version: {available_version}")
        if comparison == 0:
            print("Already at the latest version.")
        else:
            print("You are running a newer version than available in the marketplace.")
        return

    # Perform update
    print(f"Current version: {current_version}")
    print(f"Updating to version {available_version}...")

    # Use uv to reinstall from local path
    if shutil.which("uv"):
        success = _update_with_uv(marketplace_path)
    else:
        print("Error: uv is required for updating agentic-sdlc")
        print("Please install uv: https://docs.astral.sh/uv/")
        sys.exit(1)

    if success:
        # Verify new version
        try:
            # Clear the metadata cache by reloading
            importlib.invalidate_caches()
            new_version = importlib.metadata.version(package_name)
            if new_version == available_version:
                print(f"Successfully updated to version {new_version}")
            else:
                print(f"Update completed. Version: {new_version}")
        except importlib.metadata.PackageNotFoundError:
            print("Update completed, but unable to verify new version")
    else:
        print("Update failed")
        sys.exit(1)


def _update_with_uv(marketplace_path: Path) -> bool:
    """Update package using uv tool install from local path.

    Args:
        marketplace_path: Path to the plugin in the marketplace

    Returns:
        True if update succeeded, False otherwise
    """
    try:
        result = subprocess.run(
            ["uv", "tool", "install", "--force", str(marketplace_path)],
            check=False,
        )
        return result.returncode == 0
    except Exception as e:
        print(f"Error running uv: {e}")
        return False
