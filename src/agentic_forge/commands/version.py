"""Version command handler."""

from __future__ import annotations

import importlib.metadata
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import argparse


def cmd_version(args: argparse.Namespace | None = None) -> None:
    """Display the version of agentic-forge.

    Args:
        args: Parsed command line arguments (unused, for consistency with other commands)
    """
    try:
        version = importlib.metadata.version("agentic-forge")
        print(f"agentic-forge {version}")
    except importlib.metadata.PackageNotFoundError:
        print("agentic-forge version unknown (package not installed)")
