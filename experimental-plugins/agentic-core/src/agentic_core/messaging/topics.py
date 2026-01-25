"""Kafka topic definitions."""

from dataclasses import dataclass


@dataclass(frozen=True)
class TopicConfig:
    """Configuration for a Kafka topic."""

    name: str
    retention_hours: int  # -1 for infinite


class Topics:
    """Kafka topic definitions."""

    # Workflow lifecycle events (start, complete, fail)
    WORKFLOW_EVENTS = TopicConfig("workflow.events", retention_hours=-1)

    # Agent-to-agent communication
    AGENT_MESSAGES = TopicConfig("agent.messages", retention_hours=-1)

    # Orchestrator commands (pause, resume, cancel)
    CONTROL_SIGNALS = TopicConfig("control.signals", retention_hours=168)  # 7 days

    # Human-in-the-loop responses
    HUMAN_INPUT = TopicConfig("human.input", retention_hours=168)  # 7 days

    # Performance and audit events
    TELEMETRY_EVENTS = TopicConfig("telemetry.events", retention_hours=720)  # 30 days

    @classmethod
    def all_topics(cls) -> list[TopicConfig]:
        """Get all topic configurations."""
        return [
            cls.WORKFLOW_EVENTS,
            cls.AGENT_MESSAGES,
            cls.CONTROL_SIGNALS,
            cls.HUMAN_INPUT,
            cls.TELEMETRY_EVENTS,
        ]
