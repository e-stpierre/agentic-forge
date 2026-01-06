"""Meeting state management."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


@dataclass
class MeetingMessage:
    """A message in a meeting transcript."""

    agent_name: str
    content: str
    timestamp: datetime = field(default_factory=datetime.utcnow)
    message_type: str = "chat"  # chat, decision, action_item, summary
    metadata: dict[str, Any] = field(default_factory=dict)

    def format(self) -> str:
        """Format message for display."""
        return f"**{self.agent_name}**: {self.content}"


@dataclass
class MeetingConfig:
    """Configuration for a meeting."""

    topic: str
    agents: list[str]
    facilitator: str = "facilitator"
    max_rounds: int = 5
    interactive: bool = False
    outputs: list[str] = field(default_factory=lambda: ["summary", "decisions", "transcript"])


@dataclass
class MeetingState:
    """Runtime state of a meeting."""

    config: MeetingConfig
    meeting_id: str = ""
    current_round: int = 0
    active_agents: list[str] = field(default_factory=list)
    transcript: list[MeetingMessage] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    action_items: list[str] = field(default_factory=list)
    is_complete: bool = False
    awaiting_user: bool = False
    user_input: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

    def add_message(
        self,
        agent_name: str,
        content: str,
        message_type: str = "chat",
        metadata: dict[str, Any] = None,
    ) -> MeetingMessage:
        """Add a message to the transcript.

        Args:
            agent_name: Name of the speaking agent
            content: Message content
            message_type: Type of message
            metadata: Additional metadata

        Returns:
            The created MeetingMessage
        """
        message = MeetingMessage(
            agent_name=agent_name,
            content=content,
            message_type=message_type,
            metadata=metadata or {},
        )
        self.transcript.append(message)
        return message

    def add_decision(self, decision: str) -> None:
        """Add a decision to the list."""
        if decision not in self.decisions:
            self.decisions.append(decision)

    def add_action_item(self, action: str) -> None:
        """Add an action item to the list."""
        if action not in self.action_items:
            self.action_items.append(action)

    def get_transcript_text(self, last_n: Optional[int] = None) -> str:
        """Get transcript as formatted text.

        Args:
            last_n: Only include last N messages

        Returns:
            Formatted transcript
        """
        messages = self.transcript[-last_n:] if last_n else self.transcript
        return "\n\n".join(msg.format() for msg in messages)

    def get_round_summary(self, round_num: int) -> str:
        """Get summary of a specific round."""
        # Find messages for this round
        round_messages = [msg for msg in self.transcript if msg.metadata.get("round") == round_num]
        return "\n".join(msg.format() for msg in round_messages)

    def mark_complete(self) -> None:
        """Mark meeting as complete."""
        self.is_complete = True
        self.ended_at = datetime.utcnow()
