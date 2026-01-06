"""Document generation for meetings."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agentic_core.meetings.state import MeetingState


class DocumentGenerator:
    """Generates documents from meeting state."""

    def generate_summary(self, state: "MeetingState") -> str:
        """Generate meeting summary document with full transcript.

        Args:
            state: Meeting state

        Returns:
            Markdown summary document with complete discussion
        """
        date_str = state.started_at.strftime("%Y-%m-%d %H:%M") if state.started_at else "N/A"
        lines = [
            f"# Meeting Summary: {state.config.topic}",
            "",
            f"**Date:** {date_str}",
            f"**Participants:** {', '.join(state.config.agents)}",
            f"**Rounds:** {state.current_round}",
            "",
        ]

        # Decisions section first (if any extracted)
        if state.decisions:
            lines.append("## Decisions Made")
            lines.append("")
            for i, decision in enumerate(state.decisions, 1):
                lines.append(f"{i}. {decision}")
            lines.append("")

        # Action items (if any extracted)
        if state.action_items:
            lines.append("## Action Items")
            lines.append("")
            for i, action in enumerate(state.action_items, 1):
                lines.append(f"- [ ] {action}")
            lines.append("")

        # Full discussion transcript
        lines.append("## Discussion")
        lines.append("")

        current_round = -1
        for msg in state.transcript:
            msg_round = msg.metadata.get("round", 0)

            # Add round header when round changes
            if msg_round != current_round:
                current_round = msg_round
                if current_round == 0:
                    lines.append("### Opening")
                else:
                    lines.append(f"### Round {current_round}")
                lines.append("")

            # Include FULL message content (no truncation)
            lines.append(f"**{msg.agent_name}:**")
            lines.append("")
            lines.append(msg.content)
            lines.append("")

        return "\n".join(lines)

    def generate_decision_record(self, state: "MeetingState") -> str:
        """Generate comprehensive decision record with full discussion.

        Args:
            state: Meeting state

        Returns:
            Markdown decision record with complete content
        """
        date_str = state.started_at.strftime("%Y-%m-%d") if state.started_at else "N/A"
        lines = [
            f"# Decision Record: {state.config.topic}",
            "",
            "## Status",
            "",
            "Accepted",
            "",
            "## Context",
            "",
            f"This decision was made during a meeting on {date_str}.",
            f"Participants: {', '.join(state.config.agents)}",
            f"Facilitator: {state.config.facilitator}",
            f"Rounds: {state.current_round}",
            "",
        ]

        # Decisions section
        lines.append("## Decisions")
        lines.append("")

        if state.decisions:
            for i, decision in enumerate(state.decisions, 1):
                lines.append(f"### Decision {i}")
                lines.append("")
                lines.append(decision)
                lines.append("")
        else:
            # If no extracted decisions, note that decisions are in discussion
            lines.append("*See Discussion section for detailed decisions and rationale.*")
            lines.append("")

        # Consequences / Action Items
        lines.append("## Consequences")
        lines.append("")

        if state.action_items:
            lines.append("The following action items were identified:")
            lines.append("")
            for action in state.action_items:
                lines.append(f"- [ ] {action}")
        else:
            lines.append("*See Discussion section for action items and next steps.*")
        lines.append("")

        # Full discussion - include ALL messages with FULL content
        lines.append("## Discussion")
        lines.append("")
        lines.append("Complete meeting transcript:")
        lines.append("")

        current_round = -1
        for msg in state.transcript:
            msg_round = msg.metadata.get("round", 0)

            # Add round header when round changes
            if msg_round != current_round:
                current_round = msg_round
                if current_round == 0:
                    lines.append("### Opening")
                else:
                    lines.append(f"### Round {current_round}")
                lines.append("")

            # Include FULL message content (no truncation)
            timestamp = msg.timestamp.strftime("%H:%M:%S") if msg.timestamp else ""
            if timestamp:
                lines.append(f"**{msg.agent_name}** [{timestamp}]:")
            else:
                lines.append(f"**{msg.agent_name}:**")
            lines.append("")
            lines.append(msg.content)
            lines.append("")

        return "\n".join(lines)

    def generate_transcript(self, state: "MeetingState") -> str:
        """Generate full meeting transcript.

        Args:
            state: Meeting state

        Returns:
            Markdown transcript
        """
        date_str = state.started_at.strftime("%Y-%m-%d %H:%M") if state.started_at else "N/A"
        lines = [
            f"# Meeting Transcript: {state.config.topic}",
            "",
            f"**Date:** {date_str}",
            f"**Participants:** {', '.join(state.config.agents)}",
            "",
            "---",
            "",
        ]

        current_round = -1
        for msg in state.transcript:
            msg_round = msg.metadata.get("round", 0)

            # Add round header
            if msg_round != current_round:
                current_round = msg_round
                if current_round == 0:
                    lines.append("## Opening")
                else:
                    lines.append(f"## Round {current_round}")
                lines.append("")

            # Add message
            timestamp = msg.timestamp.strftime("%H:%M:%S") if msg.timestamp else ""
            lines.append(f"### {msg.agent_name} [{timestamp}]")
            lines.append("")
            lines.append(msg.content)
            lines.append("")

        # Footer
        lines.extend(
            [
                "---",
                "*Transcript generated by Agentic Core*",
            ]
        )

        return "\n".join(lines)

    def generate_action_items(self, state: "MeetingState") -> str:
        """Generate action items document.

        Args:
            state: Meeting state

        Returns:
            Markdown action items
        """
        date_str = state.started_at.strftime("%Y-%m-%d") if state.started_at else "N/A"
        lines = [
            f"# Action Items: {state.config.topic}",
            "",
            f"**Meeting Date:** {date_str}",
            "",
            "## Tasks",
            "",
        ]

        for i, action in enumerate(state.action_items, 1):
            lines.append(f"- [ ] **Task {i}:** {action}")

        lines.extend(
            [
                "",
                "## Related Decisions",
                "",
            ]
        )

        for decision in state.decisions:
            lines.append(f"- {decision}")

        return "\n".join(lines)
