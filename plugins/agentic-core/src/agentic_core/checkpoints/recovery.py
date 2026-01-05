"""Checkpoint management and crash recovery."""

import asyncio
import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Optional, TypeVar
from uuid import UUID

T = TypeVar("T")


@dataclass
class RetryStrategy:
    """Configuration for retry behavior."""

    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 60.0
    exponential_base: float = 2.0
    jitter: bool = True

    def get_delay(self, attempt: int) -> float:
        """Calculate delay for a retry attempt.

        Args:
            attempt: Attempt number (0-indexed)

        Returns:
            Delay in seconds
        """
        delay = min(
            self.base_delay * (self.exponential_base ** attempt),
            self.max_delay,
        )
        if self.jitter:
            delay *= random.uniform(0.5, 1.5)
        return delay

    async def execute_with_retry(
        self,
        fn: Callable[..., T],
        *args,
        **kwargs,
    ) -> T:
        """Execute a function with retry logic.

        Args:
            fn: Function to execute (can be async)
            *args: Positional arguments
            **kwargs: Keyword arguments

        Returns:
            Function result

        Raises:
            Last exception if all retries exhausted
        """
        last_error = None

        for attempt in range(self.max_retries + 1):
            try:
                if asyncio.iscoroutinefunction(fn):
                    return await fn(*args, **kwargs)
                return fn(*args, **kwargs)
            except Exception as e:
                last_error = e
                if attempt < self.max_retries:
                    delay = self.get_delay(attempt)
                    await asyncio.sleep(delay)

        raise last_error


@dataclass
class RecoveryResult:
    """Result of a recovery operation."""

    success: bool
    workflow_id: Optional[str] = None
    step_name: Optional[str] = None
    completed_steps: list[str] = field(default_factory=list)
    state: dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


class CheckpointManager:
    """Manages checkpoints and crash recovery."""

    def __init__(self, db=None, kafka=None):
        """Initialize checkpoint manager.

        Args:
            db: Database instance
            kafka: Kafka client instance
        """
        self.db = db
        self.kafka = kafka

    async def create_checkpoint(
        self,
        workflow_id: str,
        step_name: str,
        status: str,
        state: dict[str, Any],
    ) -> Optional[str]:
        """Create a checkpoint.

        Args:
            workflow_id: Workflow ID
            step_name: Current step name
            status: Checkpoint status
            state: State to save

        Returns:
            Checkpoint ID if successful
        """
        if not self.db:
            return None

        # Get current Kafka offset if available
        kafka_offset = None
        if self.kafka:
            try:
                from agentic_core.messaging.topics import Topics
                kafka_offset = self.kafka.get_latest_offset(Topics.WORKFLOW_EVENTS)
            except Exception:
                pass

        checkpoint_id = await self.db.create_checkpoint(
            workflow_id=UUID(workflow_id),
            step_name=step_name,
            status=status,
            state=state,
            kafka_offset=kafka_offset,
        )

        return str(checkpoint_id)

    async def get_latest_checkpoint(
        self,
        workflow_id: str,
    ) -> Optional[RecoveryResult]:
        """Get the latest checkpoint for a workflow.

        Args:
            workflow_id: Workflow ID

        Returns:
            RecoveryResult if checkpoint exists
        """
        if not self.db:
            return None

        checkpoint = await self.db.get_latest_checkpoint(UUID(workflow_id))
        if not checkpoint:
            return None

        return RecoveryResult(
            success=True,
            workflow_id=workflow_id,
            step_name=checkpoint.step_name,
            completed_steps=checkpoint.state.get("completed_steps", []),
            state=checkpoint.state,
        )

    async def recover_workflow(
        self,
        workflow_id: str,
    ) -> RecoveryResult:
        """Recover workflow state from checkpoint and Kafka.

        Args:
            workflow_id: Workflow ID to recover

        Returns:
            RecoveryResult with recovered state
        """
        if not self.db:
            return RecoveryResult(
                success=False,
                error="Database not available",
            )

        # Get latest checkpoint
        checkpoint = await self.db.get_latest_checkpoint(UUID(workflow_id))
        if not checkpoint:
            return RecoveryResult(
                success=False,
                workflow_id=workflow_id,
                error="No checkpoint found",
            )

        # Replay Kafka messages if offset is available
        additional_messages = []
        if self.kafka and checkpoint.kafka_offset:
            try:
                from agentic_core.messaging.topics import Topics
                messages = self.kafka.consume_from_offset(
                    Topics.WORKFLOW_EVENTS,
                    offset=checkpoint.kafka_offset,
                    group_id=f"recovery-{workflow_id}",
                )
                additional_messages = messages
            except Exception:
                pass

        # Merge state from checkpoint and Kafka
        state = checkpoint.state.copy()

        # Process additional messages to update state
        for msg in additional_messages:
            try:
                import json
                event = json.loads(msg.value)
                if event.get("event_type") == "step_completed":
                    step = event.get("step_name")
                    if step and step not in state.get("completed_steps", []):
                        state.setdefault("completed_steps", []).append(step)
            except Exception:
                continue

        return RecoveryResult(
            success=True,
            workflow_id=workflow_id,
            step_name=checkpoint.step_name,
            completed_steps=state.get("completed_steps", []),
            state=state,
        )

    async def list_checkpoints(
        self,
        workflow_id: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """List checkpoints for a workflow.

        Args:
            workflow_id: Workflow ID
            limit: Maximum number to return

        Returns:
            List of checkpoint info dicts
        """
        if not self.db:
            return []

        # This would require a database method to list checkpoints
        # For now, just return the latest
        checkpoint = await self.db.get_latest_checkpoint(UUID(workflow_id))
        if checkpoint:
            return [{
                "id": str(checkpoint.id),
                "step_name": checkpoint.step_name,
                "status": checkpoint.status,
                "created_at": checkpoint.created_at.isoformat(),
            }]
        return []


def handle_failure(on_failure: str, step_name: str, error: str) -> dict[str, Any]:
    """Handle step failure based on failure mode.

    Args:
        on_failure: Failure handling mode (retry, skip, abort, pause)
        step_name: Name of failed step
        error: Error message

    Returns:
        Dict with action and metadata
    """
    if on_failure == "retry":
        return {
            "action": "retry",
            "should_continue": True,
            "message": f"Retrying step {step_name}",
        }
    elif on_failure == "skip":
        return {
            "action": "skip",
            "should_continue": True,
            "message": f"Skipping step {step_name}: {error}",
        }
    elif on_failure == "abort":
        return {
            "action": "abort",
            "should_continue": False,
            "message": f"Aborting workflow at step {step_name}: {error}",
        }
    else:  # pause
        return {
            "action": "pause",
            "should_continue": False,
            "message": f"Paused at step {step_name}: {error}",
            "requires_approval": True,
        }
