"""Skills-dir command handler."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def cmd_skills_dir(args: Namespace) -> None:
    """Print the path to the bundled skills directory.

    Args:
        args: Parsed command line arguments (unused)
    """
    skills_dir = Path(__file__).parent.parent / "claude"
    print(skills_dir.resolve())
