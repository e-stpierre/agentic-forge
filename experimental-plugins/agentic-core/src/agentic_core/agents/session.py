"""Agent session management."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from agentic_core.providers import CLIProvider, get_provider


@dataclass
class AgentConfig:
    """Configuration for an agent."""

    name: str
    provider: str = "claude"
    model: str = "sonnet"
    persona: Optional[str] = None
    persona_file: Optional[str] = None
    tools: list[str] = field(default_factory=list)
    icon: str = ""


class AgentSession:
    """Manages a conversation session with an agent."""

    def __init__(
        self,
        config: AgentConfig,
        working_dir: Optional[Path] = None,
    ):
        """Initialize agent session.

        Args:
            config: Agent configuration
            working_dir: Working directory for agent
        """
        self.config = config
        self.working_dir = working_dir or Path.cwd()
        self.session_id: Optional[str] = None
        self._provider: Optional[CLIProvider] = None
        self._conversation_history: list[tuple[str, str]] = []

    @property
    def provider(self) -> CLIProvider:
        """Get or create provider."""
        if self._provider is None:
            self._provider = get_provider(self.config.provider)
        return self._provider

    @property
    def system_prompt(self) -> str:
        """Get system prompt from persona or default."""
        if self.config.persona:
            return self.config.persona
        return f"You are {self.config.name}, participating in a collaborative discussion."

    def build_prompt(
        self,
        task: str,
        conversation_history: Optional[str] = None,
        context: Optional[str] = None,
    ) -> str:
        """Build prompt with context and history.

        Args:
            task: The task or question for the agent
            conversation_history: Optional formatted conversation history
            context: Additional context to include

        Returns:
            Full prompt string
        """
        parts = []

        # Add context
        if context:
            parts.append(f"## Context\n{context}\n")

        # Add conversation history
        if conversation_history:
            parts.append(f"## Discussion So Far\n{conversation_history}\n")

        # Add task
        parts.append(f"## Your Turn\n{task}")

        return "\n".join(parts)

    async def invoke(
        self,
        prompt: str,
        conversation_history: Optional[str] = None,
        context: Optional[str] = None,
        resume: bool = True,
    ) -> str:
        """Invoke the agent with a prompt.

        Args:
            prompt: The prompt/question
            conversation_history: Previous conversation
            context: Additional context
            resume: Whether to resume previous session if available

        Returns:
            Agent's response content
        """
        # Build full prompt
        full_prompt = self.build_prompt(prompt, conversation_history, context)

        # Use session resume if available
        session_id = self.session_id if resume else None

        # Invoke provider
        result = self.provider.invoke(
            prompt=full_prompt,
            system_prompt=self.system_prompt,
            session_id=session_id,
            model=self.config.model,
            tools=self.config.tools if self.config.tools else None,
            working_dir=self.working_dir,
            timeout=300,
        )

        # Store session ID for resume
        if result.session_id:
            self.session_id = result.session_id

        # Track conversation
        self._conversation_history.append(("user", prompt))
        if not result.is_error:
            self._conversation_history.append(("assistant", result.content))

        if result.is_error:
            return f"[Error: {result.error_message}]"

        return result.content

    def get_conversation_history(self, format: str = "chat") -> str:
        """Get formatted conversation history.

        Args:
            format: Format style (chat, markdown)

        Returns:
            Formatted conversation history
        """
        if format == "markdown":
            lines = []
            for role, content in self._conversation_history:
                if role == "user":
                    lines.append(f"**Question:** {content}")
                else:
                    lines.append(f"**{self.config.name}:** {content}")
            return "\n\n".join(lines)
        else:
            lines = []
            for role, content in self._conversation_history:
                name = "User" if role == "user" else self.config.name
                lines.append(f"{name}: {content}")
            return "\n".join(lines)

    def clear_history(self) -> None:
        """Clear conversation history."""
        self._conversation_history.clear()
        self.session_id = None
