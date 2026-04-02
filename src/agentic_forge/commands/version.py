"""Version command handler."""

from __future__ import annotations

import importlib.metadata
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import argparse


def cmd_version(args: argparse.Namespace | None = None) -> None:
    """Display the version of agentic-sdlc.

    Args:
        args: Parsed command line arguments (unused, for consistency with other commands)
    """
    try:
        version = importlib.metadata.version("agentic-sdlc")
        print(f"agentic-sdlc {version}")
    except importlib.metadata.PackageNotFoundError:
        print("agentic-sdlc version unknown (package not installed)")
