"""Keyword-based memory search using frontmatter."""

from __future__ import annotations

from pathlib import Path

from agentic_workflows.memory.manager import MemoryManager, MemoryEntry


COMMON_WORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "through", "during", "before", "after",
    "above", "below", "between", "under", "again", "further", "then", "once",
    "here", "there", "when", "where", "why", "how", "all", "each", "few",
    "more", "most", "other", "some", "such", "no", "nor", "not", "only",
    "own", "same", "so", "than", "too", "very", "just", "and", "but", "if",
    "or", "because", "until", "while", "this", "that", "these", "those",
    "i", "you", "he", "she", "it", "we", "they", "what", "which", "who",
}


def search_memories(
    query: str,
    category: str | None = None,
    tags: list[str] | None = None,
    limit: int = 10,
    repo_root: Path | None = None,
) -> list[MemoryEntry]:
    """Search memories by keyword matching.

    Searches in:
    - Tags (any match)
    - Title (contains)
    - Content (contains)

    Args:
        query: Search query string
        category: Filter by category
        tags: Filter by tags (any match)
        limit: Maximum results
        repo_root: Repository root

    Returns:
        List of matching MemoryEntry objects
    """
    manager = MemoryManager(repo_root)
    all_memories = manager.list_memories(category=category, limit=1000)

    query_lower = query.lower()
    query_words = query_lower.split()

    results: list[tuple[int, MemoryEntry]] = []
    for memory in all_memories:
        score = 0

        if tags:
            matching_tags = set(t.lower() for t in memory.tags) & set(
                t.lower() for t in tags
            )
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
