"""Release notes command handler."""

from __future__ import annotations

import importlib.metadata
import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import argparse


def cmd_release_notes(args: argparse.Namespace) -> None:
    """Display release notes from CHANGELOG.md.

    Args:
        args: Parsed command line arguments containing version/latest flags
    """
    # Find the CHANGELOG.md file - check multiple locations
    changelog_path = None

    # Try to find it relative to the package source
    try:
        # Get the path to the installed package
        dist = importlib.metadata.distribution("agentic-sdlc")
        # For editable installs, the package location points to src/
        # We need to go up to the plugin root to find CHANGELOG.md
        package_file = Path(__file__)
        # Go up from commands/release_notes.py -> commands/ -> agentic_sdlc/ -> src/ -> plugin root
        plugin_root = package_file.parent.parent.parent.parent
        candidate_path = plugin_root / "CHANGELOG.md"
        if candidate_path.exists():
            changelog_path = candidate_path
    except (importlib.metadata.PackageNotFoundError, AttributeError):
        pass

    # Fallback: try current directory
    if changelog_path is None:
        candidate_path = Path.cwd() / "CHANGELOG.md"
        if candidate_path.exists():
            changelog_path = candidate_path

    if changelog_path is None:
        print("CHANGELOG.md not found")
        return

    # Read the changelog content
    with open(changelog_path, encoding="utf-8") as f:
        content = f.read()

    # If a specific version is requested
    if hasattr(args, "specific_version") and args.specific_version:
        version_section = _extract_version_section(content, args.specific_version)
        if version_section:
            print(version_section.strip())
        else:
            print(f"Version {args.specific_version} not found in CHANGELOG.md")
        return

    # If --latest is requested, show only the most recent version
    if hasattr(args, "latest") and args.latest:
        latest_section = _extract_latest_version(content)
        if latest_section:
            print(latest_section.strip())
        else:
            print("No version information found in CHANGELOG.md")
        return

    # Otherwise, print the full changelog
    print(content)


def _extract_version_section(content: str, version: str) -> str | None:
    """Extract a specific version section from the changelog.

    Args:
        content: Full changelog content
        version: Version to extract (e.g., "0.1.0")

    Returns:
        The version section content, or None if not found
    """
    # Match version headers like "## [0.1.0] - 2026-01-11"
    version_pattern = re.compile(rf"^## \[{re.escape(version)}\].*$", re.MULTILINE)
    match = version_pattern.search(content)

    if not match:
        return None

    # Find the start of this version section
    start = match.start()

    # Find the next version header (or end of file)
    next_version_pattern = re.compile(r"^## \[[\d.]+\]", re.MULTILINE)
    next_match = next_version_pattern.search(content, match.end())

    if next_match:
        end = next_match.start()
    else:
        end = len(content)

    return content[start:end]


def _extract_latest_version(content: str) -> str | None:
    """Extract the most recent version section from the changelog.

    Args:
        content: Full changelog content

    Returns:
        The latest version section content, or None if not found
    """
    # Find the first version header
    version_pattern = re.compile(r"^## \[([\d.]+)\].*$", re.MULTILINE)
    match = version_pattern.search(content)

    if not match:
        return None

    version = match.group(1)
    return _extract_version_section(content, version)
