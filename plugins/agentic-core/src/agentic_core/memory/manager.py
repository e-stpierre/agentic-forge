"""Memory manager for semantic search and storage."""

import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from agentic_core.memory.embeddings import EmbeddingProvider, get_embedding_provider


@dataclass
class MemoryEntry:
    """A memory entry with content and metadata."""

    id: str
    category: str
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)
    similarity: float = 0.0
    created_at: Optional[datetime] = None


class MemoryManager:
    """Manages long-term semantic memory with pgvector."""

    # Memory categories
    CATEGORIES = {
        "lesson": "Learned from past mistakes",
        "pattern": "Successful approaches to reuse",
        "error": "Common errors and solutions",
        "decision": "Architectural decisions",
        "context": "Project-specific knowledge",
    }

    def __init__(
        self,
        db=None,
        embedding_provider: str = "local",
        enabled: bool = None,
    ):
        """Initialize memory manager.

        Args:
            db: Database instance
            embedding_provider: Embedding provider name (local, mock)
            enabled: Whether memory is enabled (defaults to env var)
        """
        self.db = db

        # Check if memory is enabled
        if enabled is None:
            enabled = os.environ.get("AGENTIC_ENABLE_MEMORY", "false").lower() == "true"
        self.enabled = enabled

        # Initialize embedding provider if enabled
        self._embedder: Optional[EmbeddingProvider] = None
        self._embedding_provider_name = embedding_provider

    def _get_embedder(self) -> EmbeddingProvider:
        """Get or create embedding provider."""
        if self._embedder is None:
            self._embedder = get_embedding_provider(self._embedding_provider_name)
        return self._embedder

    def is_connected(self) -> bool:
        """Check if database is connected.

        Returns:
            True if database is available and connected
        """
        if not self.enabled:
            return False
        return self.db is not None

    async def add(
        self,
        content: str,
        category: str = "context",
        metadata: dict[str, Any] = None,
    ) -> str:
        """Add a memory (convenience wrapper for store).

        Args:
            content: Memory content
            category: Memory category
            metadata: Additional metadata

        Returns:
            Memory ID
        """
        entry = await self.store(category=category, content=content, metadata=metadata)
        return entry.id if entry else ""

    async def list_memories(
        self,
        category: Optional[str] = None,
        limit: int = 20,
    ) -> list["MemoryEntry"]:
        """List memories, optionally filtered by category.

        Args:
            category: Filter by category (None for all)
            limit: Maximum results

        Returns:
            List of MemoryEntry objects
        """
        if not self.enabled or not self.db:
            return []

        async with self.db.acquire() as conn:
            if category:
                rows = await conn.fetch(
                    """
                    SELECT id, category, content, metadata, created_at
                    FROM memory
                    WHERE category = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                    """,
                    category,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT id, category, content, metadata, created_at
                    FROM memory
                    ORDER BY created_at DESC
                    LIMIT $1
                    """,
                    limit,
                )

            return [
                MemoryEntry(
                    id=str(row["id"]),
                    category=row["category"],
                    content=row["content"],
                    metadata=json.loads(row["metadata"]) if row["metadata"] else {},
                    created_at=row["created_at"],
                )
                for row in rows
            ]

    async def store(
        self,
        category: str,
        content: str,
        metadata: dict[str, Any] = None,
        workflow_id: Optional[str] = None,
    ) -> Optional[MemoryEntry]:
        """Store a memory with embedding.

        Args:
            category: Memory category (lesson, pattern, error, decision, context)
            content: Memory content
            metadata: Additional metadata
            workflow_id: Associated workflow ID

        Returns:
            MemoryEntry if successful
        """
        if not self.enabled:
            return None

        if category not in self.CATEGORIES:
            raise ValueError(f"Invalid category: {category}. Valid: {list(self.CATEGORIES.keys())}")

        # Generate embedding
        embedder = self._get_embedder()
        embedding = embedder.embed(content)

        memory_id = str(uuid4())
        metadata = metadata or {}
        metadata["embedding_model"] = embedder.name

        if self.db:
            # Store in database with pgvector
            await self._store_in_db(
                memory_id=memory_id,
                category=category,
                content=content,
                embedding=embedding,
                metadata=metadata,
                workflow_id=workflow_id,
            )

        return MemoryEntry(
            id=memory_id,
            category=category,
            content=content,
            metadata=metadata,
            created_at=datetime.utcnow(),
        )

    async def _store_in_db(
        self,
        memory_id: str,
        category: str,
        content: str,
        embedding: list[float],
        metadata: dict[str, Any],
        workflow_id: Optional[str],
    ) -> None:
        """Store memory in PostgreSQL with pgvector."""
        async with self.db.acquire() as conn:
            # Pad embedding to max dimensions (1536) for flexible storage
            padded_embedding = embedding + [0.0] * (1536 - len(embedding))

            await conn.execute(
                """
                INSERT INTO memory (id, category, content, embedding, embedding_model, metadata, workflow_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                UUID(memory_id),
                category,
                content,
                padded_embedding,
                metadata.get("embedding_model", "unknown"),
                json.dumps(metadata),
                UUID(workflow_id) if workflow_id else None,
            )

    async def search(
        self,
        query: str,
        category: Optional[str] = None,
        limit: int = 5,
        min_similarity: float = 0.5,
    ) -> list[MemoryEntry]:
        """Search memories by semantic similarity.

        Args:
            query: Search query
            category: Filter by category
            limit: Maximum results
            min_similarity: Minimum similarity threshold

        Returns:
            List of matching MemoryEntry objects
        """
        if not self.enabled:
            return []

        # Generate query embedding
        embedder = self._get_embedder()
        query_embedding = embedder.embed(query)

        if self.db:
            return await self._search_in_db(
                query_embedding=query_embedding,
                category=category,
                limit=limit,
                min_similarity=min_similarity,
            )

        return []

    async def _search_in_db(
        self,
        query_embedding: list[float],
        category: Optional[str],
        limit: int,
        min_similarity: float,
    ) -> list[MemoryEntry]:
        """Search in PostgreSQL using pgvector."""
        # Pad embedding to match stored dimensions
        padded_embedding = query_embedding + [0.0] * (1536 - len(query_embedding))

        async with self.db.acquire() as conn:
            if category:
                rows = await conn.fetch(
                    """
                    SELECT id, category, content, metadata, created_at,
                           1 - (embedding <=> $1) as similarity
                    FROM memory
                    WHERE category = $2
                      AND 1 - (embedding <=> $1) >= $3
                    ORDER BY embedding <=> $1
                    LIMIT $4
                    """,
                    padded_embedding,
                    category,
                    min_similarity,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT id, category, content, metadata, created_at,
                           1 - (embedding <=> $1) as similarity
                    FROM memory
                    WHERE 1 - (embedding <=> $1) >= $2
                    ORDER BY embedding <=> $1
                    LIMIT $3
                    """,
                    padded_embedding,
                    min_similarity,
                    limit,
                )

            return [
                MemoryEntry(
                    id=str(row["id"]),
                    category=row["category"],
                    content=row["content"],
                    metadata=json.loads(row["metadata"]) if row["metadata"] else {},
                    similarity=row["similarity"],
                    created_at=row["created_at"],
                )
                for row in rows
            ]

    async def get_relevant_context(
        self,
        task: str,
        categories: list[str] = None,
        budget_tokens: int = 2000,
    ) -> str:
        """Get relevant memory context for a task.

        Args:
            task: Task description to find relevant memories
            categories: Categories to search (all if None)
            budget_tokens: Token budget for context

        Returns:
            Formatted context string
        """
        if not self.enabled:
            return ""

        # Search for relevant memories
        memories = await self.search(task, limit=10)

        if not memories:
            return ""

        # Build context within token budget (rough estimate: 4 chars = 1 token)
        context_parts = ["## Relevant Context from Memory\n"]
        token_count = 10  # Header tokens

        for memory in memories:
            entry_text = f"\n### {memory.category.title()}\n{memory.content}\n"
            entry_tokens = len(entry_text) // 4

            if token_count + entry_tokens > budget_tokens:
                break

            context_parts.append(entry_text)
            token_count += entry_tokens

        return "".join(context_parts)

    async def list_by_category(
        self,
        category: str,
        limit: int = 20,
    ) -> list[MemoryEntry]:
        """List memories by category.

        Args:
            category: Memory category
            limit: Maximum results

        Returns:
            List of MemoryEntry objects
        """
        if not self.enabled or not self.db:
            return []

        async with self.db.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, category, content, metadata, created_at
                FROM memory
                WHERE category = $1
                ORDER BY created_at DESC
                LIMIT $2
                """,
                category,
                limit,
            )

            return [
                MemoryEntry(
                    id=str(row["id"]),
                    category=row["category"],
                    content=row["content"],
                    metadata=json.loads(row["metadata"]) if row["metadata"] else {},
                    created_at=row["created_at"],
                )
                for row in rows
            ]

    async def delete(self, memory_id: str) -> bool:
        """Delete a memory by ID.

        Args:
            memory_id: Memory ID to delete

        Returns:
            True if deleted
        """
        if not self.db:
            return False

        async with self.db.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM memory WHERE id = $1",
                UUID(memory_id),
            )
            return "DELETE 1" in result

    async def export_all(self) -> list[dict[str, Any]]:
        """Export all memories.

        Returns:
            List of memory dicts
        """
        if not self.db:
            return []

        async with self.db.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, category, content, metadata, created_at
                FROM memory
                ORDER BY created_at DESC
                """
            )

            return [
                {
                    "id": str(row["id"]),
                    "category": row["category"],
                    "content": row["content"],
                    "metadata": json.loads(row["metadata"]) if row["metadata"] else {},
                    "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                }
                for row in rows
            ]
