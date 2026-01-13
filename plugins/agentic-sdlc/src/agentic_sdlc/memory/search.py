"""Keyword-based memory search using frontmatter with caching."""

from __future__ import annotations

import time
from functools import lru_cache
from pathlib import Path

from agentic_sdlc.memory.manager import MemoryEntry, MemoryManager

COMMON_WORDS = {
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "just",
    "and",
    "but",
    "if",
    "or",
    "because",
    "until",
    "while",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "what",
    "which",
    "who",
}


@lru_cache(maxsize=128)
def _get_memory_list_cached(
    category: str | None,
    repo_root_str: str,
    cache_key: float,
) -> tuple[MemoryEntry, ...]:
    """Cached memory list retrieval.

    Args:
        category: Filter by category
        repo_root_str: Repository root as string (for hashability)
        cache_key: Cache invalidation key based on directory mtime

    Returns:
        Tuple of MemoryEntry objects (tuple for hashability)

    Note:
        This is an internal function. Use search_memories() instead.
    """
    manager = MemoryManager(Path(repo_root_str) if repo_root_str else None)
    memories = manager.list_memories(category=category, limit=1000)
    return tuple(memories)


def _get_cache_key(repo_root: Path | None) -> float:
    """Get cache invalidation key based on memory directory modification time.

    Args:
        repo_root: Repository root path

    Returns:
        Modification timestamp to use as cache key
    """
    from agentic_sdlc.config import load_config

    config = load_config(repo_root)
    memory_dir = Path(config["memory"]["directory"])
    if not memory_dir.is_absolute():
        memory_dir = (repo_root or Path.cwd()) / memory_dir

    if memory_dir.exists():
        return memory_dir.stat().st_mtime
    return 0.0


def search_memories(
    query: str,
    category: str | None = None,
    tags: list[str] | None = None,
    limit: int = 10,
    repo_root: Path | None = None,
) -> list[MemoryEntry]:
    """Search memories by keyword matching with caching.

    Searches in:
    - Tags (any match)
    - Title (contains)
    - Content (contains)

    Results are scored based on:
    - Tag filter match: +10 points per matching tag
    - Tag contains query: +5 points
    - Title exact match: +8 points
    - Title word match: +3 points per word
    - Content exact match: +4 points
    - Content word match: +1 point per word

    Args:
        query: Search query string
        category: Filter by category
        tags: Filter by tags (any match)
        limit: Maximum results
        repo_root: Repository root

    Returns:
        List of matching MemoryEntry objects sorted by score (descending)

    Note:
        Memory list is cached based on directory modification time.
        Cache is automatically invalidated when memories are added/removed.
    """
    cache_key = _get_cache_key(repo_root)
    repo_root_str = str(repo_root) if repo_root else ""
    all_memories = list(_get_memory_list_cached(category, repo_root_str, cache_key))

    query_lower = query.lower()
    query_words = query_lower.split()

    results: list[tuple[int, MemoryEntry]] = []
    for memory in all_memories:
        score = 0

        if tags:
            matching_tags = {t.lower() for t in memory.tags} & {t.lower() for t in tags}
            if matching_tags:
                score += len(matching_tags) * 10

        for tag in memory.tags:
            if query_lower in tag.lower():
                score += 5

        title_lower = memory.title.lower()
        if query_lower in title_lower:
            score += 8
        else:
            for word in query_words:
                if word in title_lower:
                    score += 3

        content_lower = memory.content.lower()
        if query_lower in content_lower:
            score += 4
        else:
            for word in query_words:
                if word in content_lower:
                    score += 1

        if score > 0:
            results.append((score, memory))

    results.sort(key=lambda x: x[0], reverse=True)

    return [memory for _, memory in results[:limit]]


def find_related_memories(
    context: str,
    category: str | None = None,
    limit: int = 5,
    repo_root: Path | None = None,
) -> list[MemoryEntry]:
    """Find memories related to a context/task.

    Extracts keywords from context and searches memories.

    Args:
        context: Task or situation description
        category: Filter by category
        limit: Maximum results
        repo_root: Repository root

    Returns:
        List of related MemoryEntry objects
    """
    words = context.lower().split()
    keywords = [w for w in words if w not in COMMON_WORDS and len(w) > 2]

    if not keywords:
        return []

    query = " ".join(keywords[:5])
    return search_memories(query, category=category, limit=limit, repo_root=repo_root)
