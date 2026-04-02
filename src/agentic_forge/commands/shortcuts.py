"""Shortcut command handlers (input)."""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def cmd_input(args: Namespace) -> None:
    """Provide human input for a wait-for-human step."""
    from agentic_sdlc.orchestrator import process_human_input

    if process_human_input(args.workflow_id, args.response):
        print(f"Input recorded for workflow: {args.workflow_id}")
    else:
        sys.exit(1)
