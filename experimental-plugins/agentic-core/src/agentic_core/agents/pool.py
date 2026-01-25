"""Agent pool for managing multiple agents."""

from pathlib import Path
from typing import Optional

from agentic_core.agents.session import AgentConfig, AgentSession


class AgentPool:
    """Manages a pool of agent sessions."""

    def __init__(
        self,
        agents_dir: Optional[Path] = None,
        working_dir: Optional[Path] = None,
    ):
        """Initialize agent pool.

        Args:
            agents_dir: Directory containing agent persona files
            working_dir: Working directory for agents
        """
        self.agents_dir = agents_dir
        self.working_dir = working_dir or Path.cwd()
        self._configs: dict[str, AgentConfig] = {}
        self._sessions: dict[str, AgentSession] = {}

    def register(self, config: AgentConfig) -> None:
        """Register an agent configuration.

        Args:
            config: Agent configuration
        """
        self._configs[config.name] = config

    def load_from_directory(self) -> None:
        """Load agent configurations from persona files."""
        if not self.agents_dir or not self.agents_dir.exists():
            return

        for file in self.agents_dir.glob("*.md"):
            name = file.stem
            persona = file.read_text()

            # Parse frontmatter if present
            provider = "claude"
            model = "sonnet"
            icon = ""

            if persona.startswith("---"):
                end = persona.find("---", 3)
                if end != -1:
                    frontmatter = persona[3:end]
                    persona = persona[end + 3 :].strip()

                    # Simple YAML parsing
                    for line in frontmatter.strip().split("\n"):
                        if ":" in line:
                            key, value = line.split(":", 1)
                            key = key.strip()
                            value = value.strip()
                            if key == "provider":
                                provider = value
                            elif key == "model":
                                model = value
                            elif key == "icon":
                                icon = value

            self._configs[name] = AgentConfig(
                name=name,
                provider=provider,
                model=model,
                persona=persona,
                icon=icon,
            )

    def get_session(self, name: str) -> AgentSession:
        """Get or create a session for an agent.

        Args:
            name: Agent name

        Returns:
            AgentSession instance

        Raises:
            ValueError: If agent not found
        """
        if name not in self._sessions:
            config = self._configs.get(name)
            if not config:
                # Create default config
                config = AgentConfig(name=name)
                self._configs[name] = config

            self._sessions[name] = AgentSession(
                config=config,
                working_dir=self.working_dir,
            )

        return self._sessions[name]

    def get_config(self, name: str) -> Optional[AgentConfig]:
        """Get agent configuration by name."""
        return self._configs.get(name)

    def list_agents(self) -> list[str]:
        """List registered agent names."""
        return list(self._configs.keys())

    def create_agent(
        self,
        name: str,
        provider: str = "claude",
        model: str = "sonnet",
        persona: Optional[str] = None,
        tools: list[str] = None,
    ) -> AgentSession:
        """Create a new agent with custom configuration.

        Args:
            name: Agent name
            provider: Provider name
            model: Model name
            persona: Custom persona
            tools: Allowed tools

        Returns:
            AgentSession instance
        """
        config = AgentConfig(
            name=name,
            provider=provider,
            model=model,
            persona=persona,
            tools=tools or [],
        )
        self.register(config)
        return self.get_session(name)

    def clear_all_sessions(self) -> None:
        """Clear all session histories."""
        for session in self._sessions.values():
            session.clear_history()
