"""Facilitator strategies for meeting orchestration."""

from dataclasses import dataclass
from typing import Optional

from agentic_core.meetings.state import MeetingState


@dataclass
class FacilitatorAction:
    """Action determined by facilitator."""

    action_type: str  # open, select_speaker, end_round, await_user, end_meeting
    speaker: Optional[str] = None
    prompt: str = ""
    metadata: dict = None


class FacilitatorStrategy:
    """Base facilitator strategy for orchestrating meetings."""

    def __init__(self, strategy_type: str = "default"):
        """Initialize facilitator.

        Args:
            strategy_type: Type of facilitation (default, brainstorm, decision)
        """
        self.strategy_type = strategy_type

    def get_opening(self, state: MeetingState) -> FacilitatorAction:
        """Get the opening action for the meeting.

        Args:
            state: Current meeting state

        Returns:
            FacilitatorAction for opening
        """
        prompt = f"""We're starting a meeting on: {state.config.topic}

Participants: {', '.join(state.config.agents)}

Please introduce the topic and invite the first participant to share their thoughts."""

        return FacilitatorAction(
            action_type="open",
            prompt=prompt,
        )

    def select_next_speaker(self, state: MeetingState) -> FacilitatorAction:
        """Select the next speaker based on strategy.

        Args:
            state: Current meeting state

        Returns:
            FacilitatorAction with selected speaker
        """
        # Get agents who haven't spoken this round
        round_speakers = {
            msg.agent_name
            for msg in state.transcript
            if msg.metadata.get("round") == state.current_round
        }

        # Find next speaker (round-robin within round)
        for agent in state.config.agents:
            if agent not in round_speakers:
                # Build prompt based on recent discussion
                recent = state.get_transcript_text(last_n=5)
                prompt = f"""Based on the recent discussion:

{recent}

Please share your perspective on the topic: {state.config.topic}

Focus on adding new insights or building on what others have said."""

                return FacilitatorAction(
                    action_type="select_speaker",
                    speaker=agent,
                    prompt=prompt,
                )

        # All agents have spoken this round
        return self.end_round(state)

    def end_round(self, state: MeetingState) -> FacilitatorAction:
        """End the current round.

        Args:
            state: Current meeting state

        Returns:
            FacilitatorAction for ending round
        """
        # Check if we should end the meeting
        if state.current_round >= state.config.max_rounds - 1:
            return self.end_meeting(state)

        # Check for human-in-loop
        if state.config.interactive and (state.current_round + 1) % 2 == 0:
            return FacilitatorAction(
                action_type="await_user",
                prompt="The discussion has paused for your input. What would you like to add?",
            )

        return FacilitatorAction(
            action_type="end_round",
            prompt=f"Round {state.current_round + 1} complete. Starting round {state.current_round + 2}.",
        )

    def end_meeting(self, state: MeetingState) -> FacilitatorAction:
        """End the meeting.

        Args:
            state: Current meeting state

        Returns:
            FacilitatorAction for ending meeting
        """
        return FacilitatorAction(
            action_type="end_meeting",
            prompt="""The meeting is concluding. Please provide:
1. A brief summary of key points discussed
2. Any decisions that were made
3. Action items with assigned owners""",
        )

    def parse_control_signal(self, content: str) -> Optional[FacilitatorAction]:
        """Parse control signals from facilitator response.

        Args:
            content: Facilitator response content

        Returns:
            FacilitatorAction if control signal found
        """
        content_upper = content.upper()

        if "[MEETING_END]" in content_upper:
            return FacilitatorAction(action_type="end_meeting")

        if "[ROUND_COMPLETE]" in content_upper:
            return FacilitatorAction(action_type="end_round")

        if "[AWAIT_USER]" in content_upper:
            return FacilitatorAction(action_type="await_user")

        # Parse [NEXT_SPEAKER: name]
        if "[NEXT_SPEAKER:" in content_upper:
            import re
            match = re.search(r"\[NEXT_SPEAKER:\s*(\w+)\]", content, re.IGNORECASE)
            if match:
                return FacilitatorAction(
                    action_type="select_speaker",
                    speaker=match.group(1),
                )

        return None

    def extract_decisions(self, content: str) -> list[str]:
        """Extract decisions from content.

        Handles multiple formats:
        - Bullet lists under "Decision" headers
        - Markdown tables with Decision/Outcome columns
        - Numbered lists of decisions

        Args:
            content: Content to parse

        Returns:
            List of decisions found
        """
        import re

        decisions = []
        lines = content.split("\n")

        # Pattern 1: Standard list items under decision headers
        in_decisions = False
        for i, line in enumerate(lines):
            line_stripped = line.strip()
            line_lower = line_stripped.lower()

            # Check for decision section headers
            if any(
                pattern in line_lower
                for pattern in [
                    "## decision",
                    "### decision",
                    "decisions made",
                    "decisions:",
                    "decision:",
                ]
            ):
                in_decisions = True
                continue

            # Check for section end (new header or empty line after content)
            if in_decisions:
                if line_stripped.startswith("#") and "decision" not in line_lower:
                    in_decisions = False
                    continue

                # Extract list items
                if line_stripped.startswith(("-", "*")) or re.match(
                    r"^\d+\.", line_stripped
                ):
                    decision = re.sub(r"^[-*\d.]+\s*", "", line_stripped)
                    # Skip if it's a checkbox marker
                    decision = re.sub(r"^\[[ x]\]\s*", "", decision)
                    if decision and len(decision) > 5:
                        decisions.append(decision)

        # Pattern 2: Extract from markdown tables
        table_pattern = r"\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|"
        for match in re.finditer(table_pattern, content):
            col1, col2 = match.group(1).strip(), match.group(2).strip()
            # Skip header rows and separator rows
            if "---" in col1 or "---" in col2:
                continue
            if col1.lower() in ("decision", "item", "#", "question"):
                continue
            # If first column looks like a decision topic
            if col2 and len(col2) > 3 and col1 and len(col1) > 3:
                if "decision" in content[: match.start()].lower()[-200:]:
                    decisions.append(f"{col1}: {col2}")

        return list(dict.fromkeys(decisions))  # Deduplicate while preserving order

    def extract_action_items(self, content: str) -> list[str]:
        """Extract action items from content.

        Handles multiple formats:
        - Bullet lists under "Action Items" headers
        - Checkbox lists (- [ ] items)
        - Markdown tables with Action/Owner columns
        - "Next Steps" sections

        Args:
            content: Content to parse

        Returns:
            List of action items found
        """
        import re

        actions = []
        lines = content.split("\n")

        # Pattern 1: Standard list items under action headers
        in_actions = False
        for i, line in enumerate(lines):
            line_stripped = line.strip()
            line_lower = line_stripped.lower()

            # Check for action section headers
            if any(
                pattern in line_lower
                for pattern in [
                    "## action",
                    "### action",
                    "action items",
                    "next steps",
                    "## next",
                    "### next",
                    "tasks:",
                    "## tasks",
                ]
            ):
                in_actions = True
                continue

            # Check for section end (new header)
            if in_actions:
                if (
                    line_stripped.startswith("#")
                    and "action" not in line_lower
                    and "next" not in line_lower
                    and "task" not in line_lower
                ):
                    in_actions = False
                    continue

                # Extract list items (including checkboxes)
                if line_stripped.startswith(("-", "*")) or re.match(
                    r"^\d+\.", line_stripped
                ):
                    action = re.sub(r"^[-*\d.]+\s*", "", line_stripped)
                    # Handle checkbox format: - [ ] or - [x]
                    action = re.sub(r"^\[[ x]\]\s*", "", action)
                    if action and len(action) > 5:
                        actions.append(action)

        # Pattern 2: Extract from markdown tables with Action/Owner columns
        table_pattern = r"\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|"
        in_action_table = False
        for match in re.finditer(table_pattern, content):
            col1, col2 = match.group(1).strip(), match.group(2).strip()
            # Skip separator rows
            if "---" in col1 or "---" in col2:
                continue
            # Detect header row
            if col1.lower() in ("action", "task", "#", "item"):
                in_action_table = True
                continue
            if in_action_table and col1 and len(col1) > 3:
                if col2:
                    actions.append(f"{col1} (Owner: {col2})")
                else:
                    actions.append(col1)

        return list(dict.fromkeys(actions))  # Deduplicate while preserving order
