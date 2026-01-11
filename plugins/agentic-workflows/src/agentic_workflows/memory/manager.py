"""File-based memory management with frontmatter search."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

from agentic_workflows.config import load_config

if TYPE_CHECKING:
    from typing import Any


MEMORY_CATEGORIES = ["pattern", "lesson", "error", "decision", "context"]


@dataclass
class MemoryEntry:
    """A memory document."""

    id: str
    category: str
    tags: list[str]
    title: str
    content: str
    source: dict[str, str] | None = None
    relevance: str = "medium"
    created: str | None = None
    path: Path | None = None


class MemoryManager:
    """Manages memory documents in the file system."""

    def __init__(self, repo_root: Path | None = None):
        self.repo_root = repo_root or Path.cwd()
        self.config = load_config(self.repo_root)
        self.memory_dir = self.repo_root / self.config["memory"]["directory"]

    def create(
        self,
        category: str,
        title: str,
        content: str,
        tags: list[str] | None = None,
        source: dict[str, str] | None = None,
        relevance: str = "medium",
    ) -> MemoryEntry:
        """Create a new memory document.

        Args:
            category: Memory category (pattern, lesson, error, decision, context)
            title: Memory title
            content: Memory content (markdown)
            tags: List of tags for searchability
            source: Source information (workflow, step)
            relevance: Relevance level (low, medium, high)

        Returns:
            Created MemoryEntry
        """
        if category not in MEMORY_CATEGORIES:
            raise ValueError(f"Invalid category: {category}. Valid: {MEMORY_CATEGORIES}")

        timestamp = datetime.now(timezone.utc)
        date_str = timestamp.strftime("%Y-%m-%d")
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:50]
        memory_id = f"mem-{date_str}-{slug}"
        filename = f"{date_str}-{slug}.md"

        category_dir = self.memory_dir / f"{category}s"
        category_dir.mkdir(parents=True, exist_ok=True)

        frontmatter: dict[str, Any] = {
            "id": memory_id,
            "created": timestamp.isoformat(),
            "category": category,
            "tags": tags or [],
            "relevance": relevance,
        }
        if source:
            frontmatter["source"] = source

        doc = f"---\n{yaml.dump(frontmatter, default_flow_style=False)}---\n\n# {title}\n\n{content}"

        file_path = category_dir / filename
        file_path.write_text(doc, encoding="utf-8")

        self._update_index()

        return MemoryEntry(
            id=memory_id,
            category=category,
            tags=tags or [],
            title=title,
            content=content,
            source=source,
            relevance=relevance,
            created=timestamp.isoformat(),
            path=file_path,
        )

    def list_memories(
        self,
        category: str | None = None,
        limit: int = 20,
    ) -> list[MemoryEntry]:
        """List memory entries.

        Args:
            category: Filter by category (None for all)
            limit: Maximum entries to return
        """
        entries: list[MemoryEntry] = []

        if not self.memory_dir.exists():
            return entries

        search_dirs = [self.memory_dir / f"{category}s"] if category else [d for d in self.memory_dir.iterdir() if d.is_dir()]

        for dir_path in search_dirs:
            if not dir_path.exists():
                continue
            for file_path in sorted(dir_path.glob("*.md"), reverse=True):
                if len(entries) >= limit:
                    break
                entry = self._parse_memory_file(file_path)
                if entry:
                    entries.append(entry)

        return entries[:limit]

    def get(self, memory_id: str) -> MemoryEntry | None:
        """Get a memory by ID."""
        if not self.memory_dir.exists():
            return None
        for md_file in self.memory_dir.rglob("*.md"):
            entry = self._parse_memory_file(md_file)
            if entry and entry.id == memory_id:
                return entry
        return None

    def delete(self, memory_id: str) -> bool:
        """Delete a memory by ID."""
        if not self.memory_dir.exists():
            return False
        for md_file in self.memory_dir.rglob("*.md"):
            entry = self._parse_memory_file(md_file)
            if entry and entry.id == memory_id:
                md_file.unlink()
                self._update_index()
                return True
        return False

    def prune(self, older_than_days: int = 30) -> list[str]:
        """Prune memories older than a specified number of days.

        Args:
            older_than_days: Delete memories created more than this many days ago

        Returns:
            List of deleted memory IDs
        """
        if not self.memory_dir.exists():
            return []

        deleted_ids: list[str] = []
        cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)

        for md_file in self.memory_dir.rglob("*.md"):
            if md_file.name == "index.md":
                continue
            entry = self._parse_memory_file(md_file)
            if not entry or not entry.created:
                continue

            try:
                created_dt = datetime.fromisoformat(entry.created.replace("Z", "+00:00"))
                if created_dt < cutoff:
                    md_file.unlink()
                    deleted_ids.append(entry.id)
            except (ValueError, TypeError):
                continue

        if deleted_ids:
            self._update_index()

        return deleted_ids

    def _parse_memory_file(self, path: Path) -> MemoryEntry | None:
        """Parse a memory markdown file."""
        try:
            content = path.read_text(encoding="utf-8")

            if not content.startswith("---"):
                return None

            end_idx = content.find("---", 3)
            if end_idx == -1:
                return None

            frontmatter_str = content[3:end_idx].strip()
            frontmatter = yaml.safe_load(frontmatter_str)
            body = content[end_idx + 3 :].strip()

            title = ""
            for line in body.split("\n"):
                if line.startswith("# "):
                    title = line[2:].strip()
                    break

            return MemoryEntry(
                id=frontmatter.get("id", ""),
                category=frontmatter.get("category", ""),
                tags=frontmatter.get("tags", []),
                title=title,
                content=body,
                source=frontmatter.get("source"),
                relevance=frontmatter.get("relevance", "medium"),
                created=frontmatter.get("created"),
                path=path,
            )
        except Exception:
            return None

    def _update_index(self) -> None:
        """Update the memory index file."""
        index_path = self.memory_dir / "index.md"
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        lines = [
            "# Memory Index",
            "",
            f"Last updated: {datetime.now(timezone.utc).isoformat()}",
            "",
        ]

        for category in MEMORY_CATEGORIES:
            category_dir = self.memory_dir / f"{category}s"
            if not category_dir.exists():
                continue

            files = sorted(category_dir.glob("*.md"), reverse=True)
            if not files:
                continue

            lines.append(f"## {category.title()}s")
            lines.append("")

            for file_path in files[:10]:
                entry = self._parse_memory_file(file_path)
                if entry:
                    rel_path = file_path.relative_to(self.memory_dir).as_posix()
                    lines.append(f"- [{file_path.name}]({rel_path}) - {entry.title}")

            lines.append("")

        index_path.write_text("\n".join(lines), encoding="utf-8")
