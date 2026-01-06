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

        Args:
            content: Content to parse

        Returns:
            List of decisions found
        """
        decisions = []
        lines = content.split("\n")

        in_decisions = False
        for line in lines:
            line = line.strip()
            if "decision" in line.lower() and ":" in line:
                in_decisions = True
                continue
            if in_decisions and line.startswith(("-", "*", "1", "2", "3")):
                decision = line.lstrip("-*123456789. ")
                if decision:
                    decisions.append(decision)
            elif in_decisions and not line:
                in_decisions = False

        return decisions

    def extract_action_items(self, content: str) -> list[str]:
        """Extract action items from content.

        Args:
            content: Content to parse

        Returns:
            List of action items found
        """
        actions = []
        lines = content.split("\n")

        in_actions = False
        for line in lines:
            line = line.strip()
            if "action" in line.lower() and "item" in line.lower():
                in_actions = True
                continue
            if in_actions and line.startswith(("-", "*", "1", "2", "3")):
                action = line.lstrip("-*123456789. ")
                if action:
                    actions.append(action)
            elif in_actions and not line:
                in_actions = False

        return actions
