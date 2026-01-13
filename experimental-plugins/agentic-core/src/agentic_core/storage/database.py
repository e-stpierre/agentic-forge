"""PostgreSQL database client with async connection pool."""

import json
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from uuid import UUID

import asyncpg


@dataclass
class WorkflowRecord:
    """Workflow database record."""

    id: UUID
    name: str
    type: str
    status: str
    config: dict
    working_dir: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime


@dataclass
class CheckpointRecord:
    """Checkpoint database record."""

    id: UUID
    workflow_id: UUID
    step_name: str
    status: str
    kafka_offset: Optional[int]
    state: dict
    created_at: datetime


@dataclass
class StepOutputRecord:
    """Step output database record."""

    id: UUID
    workflow_id: UUID
    step_name: str
    output_type: str
    content: Optional[str]
    file_path: Optional[str]
    file_hash: Optional[str]
    metadata: Optional[dict]
    created_at: datetime


class Database:
    """Async PostgreSQL database client."""

    def __init__(self, connection_url: Optional[str] = None):
        """Initialize database with connection URL.

        Raises:
            ValueError: If no connection URL is provided via parameter or environment variable.
        """
        self.connection_url = connection_url or os.environ.get("AGENTIC_DATABASE_URL")
        if not self.connection_url:
            raise ValueError(
                "Database connection URL required. Set AGENTIC_DATABASE_URL environment variable "
                "or pass connection_url parameter. "
                "Example: postgresql://user:pass@localhost:5432/dbname"
            )
        self._pool: Optional[asyncpg.Pool] = None

    async def connect(self) -> None:
        """Create connection pool."""
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                self.connection_url,
                min_size=2,
                max_size=10,
            )

    async def disconnect(self) -> None:
        """Close connection pool."""
        if self._pool:
            await self._pool.close()
            self._pool = None

    @asynccontextmanager
    async def acquire(self):
        """Acquire a connection from the pool."""
        if self._pool is None:
            await self.connect()
        async with self._pool.acquire() as conn:
            yield conn

    @asynccontextmanager
    async def transaction(self):
        """Execute operations within a transaction."""
        async with self.acquire() as conn:
            async with conn.transaction():
                yield conn

    # Workflow operations

    async def create_workflow(
        self,
        name: str,
        workflow_type: str,
        config: dict,
        working_dir: Optional[str] = None,
    ) -> UUID:
        """Create a new workflow and return its ID."""
        async with self.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO workflows (name, type, config, working_dir, status)
                VALUES ($1, $2, $3, $4, 'pending')
                RETURNING id
                """,
                name,
                workflow_type,
                json.dumps(config),
                working_dir,
            )
            return row["id"]

    async def get_workflow(self, workflow_id: UUID) -> Optional[WorkflowRecord]:
        """Get workflow by ID."""
        async with self.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM workflows WHERE id = $1",
                workflow_id,
            )
            if row:
                return WorkflowRecord(
                    id=row["id"],
                    name=row["name"],
                    type=row["type"],
                    status=row["status"],
                    config=json.loads(row["config"]),
                    working_dir=row["working_dir"],
                    started_at=row["started_at"],
                    completed_at=row["completed_at"],
                    created_at=row["created_at"],
                )
            return None

    async def update_workflow_status(
        self,
        workflow_id: UUID,
        status: str,
        started_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
    ) -> None:
        """Update workflow status."""
        async with self.acquire() as conn:
            if started_at:
                await conn.execute(
                    """
                    UPDATE workflows SET status = $1, started_at = $2
                    WHERE id = $3
                    """,
                    status,
                    started_at,
                    workflow_id,
                )
            elif completed_at:
                await conn.execute(
                    """
                    UPDATE workflows SET status = $1, completed_at = $2
                    WHERE id = $3
                    """,
                    status,
                    completed_at,
                    workflow_id,
                )
            else:
                await conn.execute(
                    "UPDATE workflows SET status = $1 WHERE id = $2",
                    status,
                    workflow_id,
                )

    async def list_workflows(
        self,
        status: Optional[str] = None,
        limit: int = 50,
    ) -> list[WorkflowRecord]:
        """List workflows with optional status filter."""
        async with self.acquire() as conn:
            if status:
                rows = await conn.fetch(
                    """
                    SELECT * FROM workflows WHERE status = $1
                    ORDER BY created_at DESC LIMIT $2
                    """,
                    status,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    "SELECT * FROM workflows ORDER BY created_at DESC LIMIT $1",
                    limit,
                )
            return [
                WorkflowRecord(
                    id=row["id"],
                    name=row["name"],
                    type=row["type"],
                    status=row["status"],
                    config=json.loads(row["config"]),
                    working_dir=row["working_dir"],
                    started_at=row["started_at"],
                    completed_at=row["completed_at"],
                    created_at=row["created_at"],
                )
                for row in rows
            ]

    # Checkpoint operations

    async def create_checkpoint(
        self,
        workflow_id: UUID,
        step_name: str,
        status: str,
        state: dict,
        kafka_offset: Optional[int] = None,
    ) -> UUID:
        """Create a checkpoint and return its ID."""
        async with self.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO checkpoints (workflow_id, step_name, status, kafka_offset, state)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
                """,
                workflow_id,
                step_name,
                status,
                kafka_offset,
                json.dumps(state),
            )
            return row["id"]

    async def get_latest_checkpoint(
        self,
        workflow_id: UUID,
    ) -> Optional[CheckpointRecord]:
        """Get the latest checkpoint for a workflow."""
        async with self.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM checkpoints
                WHERE workflow_id = $1
                ORDER BY created_at DESC
                LIMIT 1
                """,
                workflow_id,
            )
            if row:
                return CheckpointRecord(
                    id=row["id"],
                    workflow_id=row["workflow_id"],
                    step_name=row["step_name"],
                    status=row["status"],
                    kafka_offset=row["kafka_offset"],
                    state=json.loads(row["state"]),
                    created_at=row["created_at"],
                )
            return None

    # Step output operations

    async def save_step_output(
        self,
        workflow_id: UUID,
        step_name: str,
        output_type: str,
        content: Optional[str] = None,
        file_path: Optional[str] = None,
        file_hash: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> UUID:
        """Save step output (upsert)."""
        async with self.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO step_outputs (
                    workflow_id, step_name, output_type, content,
                    file_path, file_hash, metadata
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (workflow_id, step_name)
                DO UPDATE SET
                    output_type = EXCLUDED.output_type,
                    content = EXCLUDED.content,
                    file_path = EXCLUDED.file_path,
                    file_hash = EXCLUDED.file_hash,
                    metadata = EXCLUDED.metadata,
                    created_at = NOW()
                RETURNING id
                """,
                workflow_id,
                step_name,
                output_type,
                content,
                file_path,
                file_hash,
                json.dumps(metadata) if metadata else None,
            )
            return row["id"]

    async def get_step_output(
        self,
        workflow_id: UUID,
        step_name: str,
    ) -> Optional[StepOutputRecord]:
        """Get step output."""
        async with self.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM step_outputs
                WHERE workflow_id = $1 AND step_name = $2
                """,
                workflow_id,
                step_name,
            )
            if row:
                return StepOutputRecord(
                    id=row["id"],
                    workflow_id=row["workflow_id"],
                    step_name=row["step_name"],
                    output_type=row["output_type"],
                    content=row["content"],
                    file_path=row["file_path"],
                    file_hash=row["file_hash"],
                    metadata=json.loads(row["metadata"]) if row["metadata"] else None,
                    created_at=row["created_at"],
                )
            return None

    # Message operations

    async def log_message(
        self,
        workflow_id: UUID,
        message_type: str,
        content: str,
        agent_name: Optional[str] = None,
        metadata: Optional[dict] = None,
        kafka_topic: Optional[str] = None,
        kafka_offset: Optional[int] = None,
    ) -> UUID:
        """Log a message to the database."""
        async with self.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO messages (
                    workflow_id, message_type, content, agent_name,
                    metadata, kafka_topic, kafka_offset
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
                """,
                workflow_id,
                message_type,
                content,
                agent_name,
                json.dumps(metadata) if metadata else None,
                kafka_topic,
                kafka_offset,
            )
            return row["id"]

    # Telemetry operations

    async def log_telemetry(
        self,
        event_type: str,
        workflow_id: Optional[UUID] = None,
        agent_name: Optional[str] = None,
        provider: Optional[str] = None,
        duration_ms: Optional[int] = None,
        tokens_in: Optional[int] = None,
        tokens_out: Optional[int] = None,
        success: bool = True,
        error: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> UUID:
        """Log telemetry event."""
        async with self.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO telemetry (
                    workflow_id, event_type, agent_name, provider, duration_ms,
                    tokens_in, tokens_out, success, error, metadata
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id
                """,
                workflow_id,
                event_type,
                agent_name,
                provider,
                duration_ms,
                tokens_in,
                tokens_out,
                success,
                error,
                json.dumps(metadata) if metadata else None,
            )
            return row["id"]

    # Health check

    async def health_check(self) -> bool:
        """Check database connectivity."""
        try:
            async with self.acquire() as conn:
                await conn.fetchval("SELECT 1")
            return True
        except Exception:
            return False


# Global database instance
_database: Optional[Database] = None


def get_database() -> Database:
    """Get or create the global database instance."""
    global _database
    if _database is None:
        _database = Database()
    return _database
