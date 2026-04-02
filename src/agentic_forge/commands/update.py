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
    """Update agentic-forge to the latest version.

    Args:
        args: Parsed command line arguments with optional --check flag
    """
    package_name = "agentic-forge"

    # Get current installed version
    try:
        current_version = importlib.metadata.version(package_name)
    except importlib.metadata.PackageNotFoundError:
        print(f"Error: {package_name} is not installed")
        sys.exit(1)

    if not shutil.which("uv"):
        print("Error: uv is required for updating agentic-forge")
        print("Please install uv: https://docs.astral.sh/uv/")
        sys.exit(1)

    if args.check:
        print(f"Current version: {current_version}")
        result = subprocess.run(
            ["uv", "tool", "upgrade", package_name, "--dry-run"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            print(result.stdout.strip() if result.stdout.strip() else "Already at the latest version.")
        else:
            print(result.stderr.strip() if result.stderr.strip() else "Could not check for updates.")
    else:
        print(f"Current version: {current_version}")
        print("Upgrading...")
        result = subprocess.run(
            ["uv", "tool", "upgrade", package_name],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            # Verify new version
            importlib.invalidate_caches()
            try:
                new_version = importlib.metadata.version(package_name)
                if new_version != current_version:
                    print(f"Successfully updated to version {new_version}")
                else:
                    print("Already at the latest version.")
            except importlib.metadata.PackageNotFoundError:
                print("Update completed, but unable to verify new version.")
        else:
            print(result.stderr.strip() if result.stderr.strip() else "Update failed.")
            sys.exit(1)
