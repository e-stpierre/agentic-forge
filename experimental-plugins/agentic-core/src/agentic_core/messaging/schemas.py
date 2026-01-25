"""Kafka message schemas."""

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Optional
from uuid import UUID


def json_serializer(obj: Any) -> str:
    """Serialize objects to JSON."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, UUID):
        return str(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


@dataclass
class BaseMessage:
    """Base message schema."""

    message_id: str
    timestamp: str
    # Use kw_only to allow subclasses to have required fields after this default
    workflow_id: Optional[str] = field(default=None, kw_only=True)

    def to_json(self) -> str:
        """Serialize to JSON."""
        return json.dumps(asdict(self), default=json_serializer)

    @classmethod
    def from_json(cls, data: str) -> "BaseMessage":
        """Deserialize from JSON."""
        return cls(**json.loads(data))


@dataclass
class WorkflowEvent(BaseMessage):
    """Workflow lifecycle event."""

    event_type: str  # started, step_completed, completed, failed, paused, resumed
    workflow_name: str = ""
    step_name: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None
    metadata: Optional[dict] = None


@dataclass
class AgentMessage(BaseMessage):
    """Agent-to-agent message."""

    from_agent: str
    to_agent: Optional[str]  # None = broadcast
    content: str
    message_type: str = "chat"  # chat, request, response, decision
    metadata: Optional[dict] = None


@dataclass
class ControlSignal(BaseMessage):
    """Orchestrator control signal."""

    signal_type: str  # pause, resume, cancel, checkpoint
    target_step: Optional[str] = None
    reason: Optional[str] = None


@dataclass
class HumanInput(BaseMessage):
    """Human-in-the-loop response."""

    input_type: str  # approval, rejection, text, selection
    content: str
    step_name: Optional[str] = None
    metadata: Optional[dict] = None


@dataclass
class TelemetryEvent(BaseMessage):
    """Telemetry/audit event."""

    event_type: str
    agent_name: Optional[str] = None
    provider: Optional[str] = None
    duration_ms: Optional[int] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    success: bool = True
    error: Optional[str] = None
    metadata: Optional[dict] = None
