"""Update command handler."""

from __future__ import annotations

import importlib.metadata
import shutil
import subprocess
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import argparse


def cmd_update(args: argparse.Namespace) -> None:
    """Update agentic-sdlc to the latest version.

    Args:
        args: Parsed command line arguments with optional --check flag
    """
    package_name = "agentic-sdlc"

    # Get current version
    try:
        current_version = importlib.metadata.version(package_name)
    except importlib.metadata.PackageNotFoundError:
        print(f"Error: {package_name} is not installed")
        sys.exit(1)

    # Check for available updates
    if args.check:
        print(f"Current version: {current_version}")
        print("Checking for updates...")
        _check_for_updates(package_name, current_version)
        return

    # Perform update
    print(f"Current version: {current_version}")
    print("Updating to the latest version...")

    # Prefer uv if available, fallback to pip
    if shutil.which("uv"):
        success = _update_with_uv(package_name)
    else:
        print("Warning: uv not found, falling back to pip")
        success = _update_with_pip(package_name)

    if success:
        # Get new version
        try:
            new_version = importlib.metadata.version(package_name)
            if new_version == current_version:
                print(f"Already at the latest version ({current_version})")
            else:
                print(f"Successfully updated from {current_version} to {new_version}")
        except importlib.metadata.PackageNotFoundError:
            print("Update completed, but unable to verify new version")
    else:
        print("Update failed")
        sys.exit(1)


def _check_for_updates(package_name: str, current_version: str) -> None:
    """Check for available updates without installing.

    Args:
        package_name: Name of the package to check
        current_version: Current installed version
    """
    if shutil.which("uv"):
        # Use uv to check for latest version
        try:
            result = subprocess.run(
                ["uv", "pip", "index", "versions", package_name],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode == 0:
                # Parse output to find latest version
                # Format: "Available versions: 0.2.0, 0.1.0" or similar
                lines = result.stdout.strip().split("\n")
                for line in lines:
                    if "available versions" in line.lower() or "versions" in line.lower():
                        # Extract first version mentioned (usually latest)
                        import re

                        versions = re.findall(r"\d+\.\d+\.\d+", line)
                        if versions:
                            latest = versions[0]
                            if latest != current_version:
                                print(f"New version available: {latest}")
                            else:
                                print("You are running the latest version")
                            return
                print("Unable to determine latest version from uv output")
            else:
                print("Unable to check for updates")
        except Exception as e:
            print(f"Error checking for updates: {e}")
    else:
        # Fallback: use pip to check
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "index", "versions", package_name],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode == 0:
                # Parse pip index output
                import re

                versions = re.findall(r"\d+\.\d+\.\d+", result.stdout)
                if versions:
                    latest = versions[0]
                    if latest != current_version:
                        print(f"New version available: {latest}")
                    else:
                        print("You are running the latest version")
                    return
            print("Unable to check for updates (try installing uv for better update checks)")
        except Exception as e:
            print(f"Error checking for updates: {e}")


def _update_with_uv(package_name: str) -> bool:
    """Update package using uv tool upgrade.

    Args:
        package_name: Name of the package to update

    Returns:
        True if update succeeded, False otherwise
    """
    try:
        result = subprocess.run(
            ["uv", "tool", "upgrade", package_name],
            check=False,
        )
        return result.returncode == 0
    except Exception as e:
        print(f"Error running uv: {e}")
        return False


def _update_with_pip(package_name: str) -> bool:
    """Update package using pip.

    Args:
        package_name: Name of the package to update

    Returns:
        True if update succeeded, False otherwise
    """
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--upgrade", package_name],
            check=False,
        )
        return result.returncode == 0
    except Exception as e:
        print(f"Error running pip: {e}")
        return False
