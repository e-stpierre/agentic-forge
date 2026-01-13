"""Memory command handler."""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from argparse import Namespace


def cmd_memory(args: Namespace) -> None:
    """Memory management commands."""
    from agentic_sdlc.memory import MemoryManager, search_memories

    if args.memory_command == "list":
        manager = MemoryManager()
        memories = manager.list_memories(category=args.category, limit=20)
        if not memories:
            print("No memories found.")
            return
        print(f"{'ID':<35} {'Category':<12} {'Title':<30}")
        print("-" * 80)
        for mem in memories:
            print(f"{mem.id:<35} {mem.category:<12} {mem.title[:30]:<30}")

    elif args.memory_command == "search":
        results = search_memories(args.query, limit=10)
        if not results:
            print(f"No memories found for: {args.query}")
            return
        print(f"Found {len(results)} memories:\n")
        for mem in results:
            print(f"[{mem.category}] {mem.title}")
            print(f"  ID: {mem.id}")
            print(f"  Tags: {', '.join(mem.tags)}")
            print()

    elif args.memory_command == "prune":
        manager = MemoryManager()
        older_than_str = args.older_than
        days = 30
        if older_than_str.endswith("d"):
            days = int(older_than_str[:-1])
        elif older_than_str.endswith("w"):
            days = int(older_than_str[:-1]) * 7
        elif older_than_str.endswith("m"):
            days = int(older_than_str[:-1]) * 30
        else:
            try:
                days = int(older_than_str)
            except ValueError:
                print(f"Invalid format: {older_than_str}. Use format like 30d, 4w, or 2m.", file=sys.stderr)
                sys.exit(1)

        deleted = manager.prune(older_than_days=days)
        if deleted:
            print(f"Pruned {len(deleted)} memories older than {days} days:")
            for mem_id in deleted:
                print(f"  - {mem_id}")
        else:
            print(f"No memories older than {days} days found.")

    else:
        print("Usage: agentic-sdlc memory list|search|prune", file=sys.stderr)
        sys.exit(1)
