"""Config command handler."""

from __future__ import annotations

import json
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def cmd_config(args: Namespace) -> None:
    """Get or set configuration values."""
    from agentic_sdlc.config import get_config_value, set_config_value

    if args.config_command == "get":
        value = get_config_value(args.key)
        if value is None:
            print(f"Key not found: {args.key}", file=sys.stderr)
            sys.exit(1)
        if isinstance(value, dict):
            print(json.dumps(value, indent=2))
        else:
            print(value)
    elif args.config_command == "set":
        set_config_value(args.key, args.value)
        print(f"Set {args.key} = {args.value}")
    else:
        print("Usage: agentic-sdlc config get|set <key> [value]", file=sys.stderr)
        sys.exit(1)
