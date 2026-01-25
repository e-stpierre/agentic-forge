"""Meeting orchestrator for multi-agent discussions."""

from datetime import datetime
from pathlib import Path
from typing import Callable, Optional
from uuid import uuid4

from agentic_core.agents.pool import AgentPool
from agentic_core.meetings.documents import DocumentGenerator
from agentic_core.meetings.facilitator import FacilitatorStrategy
from agentic_core.meetings.state import MeetingConfig, MeetingMessage, MeetingState

# Type alias for message callback
MessageCallback = Callable[[MeetingMessage], None]


class MeetingOrchestrator:
    """Orchestrates multi-agent meetings."""

    def __init__(
        self,
        agent_pool: AgentPool,
        kafka=None,
        working_dir: Optional[Path] = None,
        on_message: Optional[MessageCallback] = None,
    ):
        """Initialize orchestrator.

        Args:
            agent_pool: Pool of available agents
            kafka: Kafka client for messaging (optional)
            working_dir: Working directory
            on_message: Callback invoked when a message is added to the transcript
        """
        self.agent_pool = agent_pool
        self.kafka = kafka
        self.working_dir = working_dir or Path.cwd()
        self.on_message = on_message
        self.facilitator_strategy = FacilitatorStrategy()
        self.document_generator = DocumentGenerator()

    def _emit_message(self, state: MeetingState, message: MeetingMessage) -> None:
        """Add a message to state and notify listeners.

        Args:
            state: Current meeting state
            message: Message to add
        """
        state.transcript.append(message)

        # Notify callback if set
        if self.on_message:
            self.on_message(message)

        # Publish to Kafka if connected
        if self.kafka:
            self.kafka.publish_agent_message(
                workflow_id=state.meeting_id,
                from_agent=message.agent_name,
                content=message.content,
                message_type=message.message_type,
            )

    async def run_meeting(
        self,
        topic: str,
        agents: list[str],
        max_rounds: int = 5,
        interactive: bool = False,
        facilitator: str = "facilitator",
    ) -> MeetingState:
        """Run a complete meeting.

        Args:
            topic: Meeting topic
            agents: List of agent names to participate
            max_rounds: Maximum discussion rounds
            interactive: Enable human-in-the-loop
            facilitator: Name of facilitator agent

        Returns:
            Final MeetingState with transcript and outputs
        """
        # Create meeting config
        config = MeetingConfig(
            topic=topic,
            agents=agents,
            facilitator=facilitator,
            max_rounds=max_rounds,
            interactive=interactive,
        )

        # Initialize state
        state = MeetingState(
            config=config,
            meeting_id=str(uuid4()),
            active_agents=agents.copy(),
            started_at=datetime.utcnow(),
        )

        # Ensure facilitator exists
        self.agent_pool.create_agent(
            name=facilitator,
            persona=self._get_facilitator_persona(config),
        )

        # Ensure all participant agents exist
        for agent_name in agents:
            self.agent_pool.get_session(agent_name)

        # Publish meeting start event
        if self.kafka:
            self.kafka.publish_workflow_event(
                workflow_id=state.meeting_id,
                event_type="meeting_started",
                metadata={"topic": topic, "agents": agents},
            )

        # Opening phase
        await self._run_opening(state)

        # Discussion rounds
        while not state.is_complete and state.current_round < max_rounds:
            await self._run_round(state)
            state.current_round += 1

            # Check for meeting end
            if state.is_complete:
                break

            # Handle human-in-loop
            if state.awaiting_user:
                # In async mode, we would pause here
                # For now, just mark as waiting
                break

        # Closing phase
        if not state.awaiting_user:
            await self._run_closing(state)

        # Publish meeting end event
        if self.kafka:
            self.kafka.publish_workflow_event(
                workflow_id=state.meeting_id,
                event_type="meeting_completed",
                metadata={
                    "decisions": state.decisions,
                    "action_items": state.action_items,
                },
            )
            self.kafka.flush()

        return state

    async def _run_opening(self, state: MeetingState) -> None:
        """Run the opening phase."""
        # Get facilitator opening
        action = self.facilitator_strategy.get_opening(state)

        # Have facilitator open the meeting
        facilitator = self.agent_pool.get_session(state.config.facilitator)
        response = await facilitator.invoke(
            prompt=action.prompt,
            context=f"Topic: {state.config.topic}\nParticipants: {', '.join(state.config.agents)}",
        )

        message = MeetingMessage(
            agent_name=state.config.facilitator,
            content=response,
            message_type="opening",
            metadata={"round": 0},
        )
        self._emit_message(state, message)

    async def _run_round(self, state: MeetingState) -> None:
        """Run a single discussion round."""
        # Each agent speaks once per round
        for agent_name in state.config.agents:
            if state.is_complete:
                break

            # Get next speaker action
            action = self.facilitator_strategy.select_next_speaker(state)

            if action.action_type == "end_meeting":
                state.mark_complete()
                break

            if action.action_type == "await_user":
                state.awaiting_user = True
                break

            if action.action_type == "end_round":
                break

            # Invoke the selected agent
            agent = self.agent_pool.get_session(action.speaker)
            conversation = state.get_transcript_text(last_n=10)

            response = await agent.invoke(
                prompt=action.prompt,
                conversation_history=conversation,
                context=f"Meeting topic: {state.config.topic}",
            )

            # Add to transcript and notify listeners
            message = MeetingMessage(
                agent_name=action.speaker,
                content=response,
                message_type="chat",
                metadata={"round": state.current_round},
            )
            self._emit_message(state, message)

    async def _run_closing(self, state: MeetingState) -> None:
        """Run the closing phase."""
        # Get facilitator to summarize
        action = self.facilitator_strategy.end_meeting(state)

        facilitator = self.agent_pool.get_session(state.config.facilitator)
        transcript = state.get_transcript_text()

        response = await facilitator.invoke(
            prompt=action.prompt,
            conversation_history=transcript,
        )

        message = MeetingMessage(
            agent_name=state.config.facilitator,
            content=response,
            message_type="summary",
        )
        self._emit_message(state, message)

        # Extract decisions and action items
        decisions = self.facilitator_strategy.extract_decisions(response)
        for decision in decisions:
            state.add_decision(decision)

        actions = self.facilitator_strategy.extract_action_items(response)
        for action_item in actions:
            state.add_action_item(action_item)

        state.mark_complete()

    async def resume_meeting(
        self,
        state: MeetingState,
        user_input: Optional[str] = None,
    ) -> MeetingState:
        """Resume a paused meeting.

        Args:
            state: Meeting state to resume
            user_input: Optional user input

        Returns:
            Updated MeetingState
        """
        if user_input:
            message = MeetingMessage(
                agent_name="user",
                content=user_input,
                message_type="input",
            )
            self._emit_message(state, message)
            state.user_input = user_input

        state.awaiting_user = False

        # Continue discussion rounds
        while not state.is_complete and state.current_round < state.config.max_rounds:
            await self._run_round(state)
            state.current_round += 1

            if state.awaiting_user:
                break

        # Run closing if complete
        if not state.awaiting_user and not state.is_complete:
            await self._run_closing(state)

        return state

    def _get_facilitator_persona(self, config: MeetingConfig) -> str:
        """Get facilitator persona for the meeting type."""
        return f"""You are a skilled meeting facilitator. Your role is to:
1. Keep the discussion on topic: {config.topic}
2. Ensure all participants have a chance to contribute
3. Summarize key points and identify decisions
4. Track action items and their owners
5. ENFORCE CONCISENESS - redirect verbose participants to focus on key points

Participants in this meeting: {", ".join(config.agents)}

CRITICAL: Keep all responses brief and focused. Aim for 200-400 words maximum per message.
Encourage participants to be concise and avoid repetition.

When appropriate, use these control signals:
- [NEXT_SPEAKER: name] - Indicate who should speak next
- [ROUND_COMPLETE] - End the current round
- [AWAIT_USER] - Pause for human input
- [MEETING_END] - Conclude the meeting"""

    async def generate_outputs(
        self,
        state: MeetingState,
        output_dir: Optional[Path] = None,
    ) -> dict[str, str]:
        """Generate meeting output documents.

        Args:
            state: Meeting state
            output_dir: Directory for output files

        Returns:
            Dict of output name to file path
        """
        output_dir = output_dir or self.working_dir / ".agentic" / "meetings"
        output_dir.mkdir(parents=True, exist_ok=True)

        outputs = {}

        if "summary" in state.config.outputs:
            summary = self.document_generator.generate_summary(state)
            path = output_dir / f"{state.meeting_id}_summary.md"
            path.write_text(summary)
            outputs["summary"] = str(path)

        if "decisions" in state.config.outputs:
            decisions = self.document_generator.generate_decision_record(state)
            path = output_dir / f"{state.meeting_id}_decisions.md"
            path.write_text(decisions)
            outputs["decisions"] = str(path)

        if "transcript" in state.config.outputs:
            transcript = self.document_generator.generate_transcript(state)
            path = output_dir / f"{state.meeting_id}_transcript.md"
            path.write_text(transcript)
            outputs["transcript"] = str(path)

        return outputs
