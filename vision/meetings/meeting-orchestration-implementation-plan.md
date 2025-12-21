# Implementation Plan: Multi-Agent Meeting Orchestration System

This document outlines how to replicate BMAD's Party Mode meeting orchestration using Claude Code sessions, programmatic execution (`claude -p`), and Python scripts with live monitoring and documentation generation.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Component Design](#3-component-design)
4. [Implementation Phases](#4-implementation-phases)
5. [Code Examples](#5-code-examples)
6. [File Structure](#6-file-structure)
7. [Deployment Considerations](#7-deployment-considerations)

---

## 1. Architecture Overview

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Meeting Orchestration System                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   Agent      │    │   Session    │    │   Live Monitor       │  │
│  │   Registry   │───▶│   Manager    │───▶│   (WebSocket/CLI)    │  │
│  │   (YAML)     │    │   (Python)   │    │                      │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│         │                   │                      │                │
│         ▼                   ▼                      ▼                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   Persona    │    │   Claude     │    │   Transcript         │  │
│  │   Loader     │    │   SDK/CLI    │    │   Recorder           │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│                             │                      │                │
│                             ▼                      ▼                │
│                      ┌──────────────┐    ┌──────────────────────┐  │
│                      │   Hooks &    │    │   Document           │  │
│                      │   Events     │    │   Generator          │  │
│                      └──────────────┘    └──────────────────────┘  │
│                                                    │                │
│                                                    ▼                │
│                                          ┌──────────────────────┐  │
│                                          │   Output: Markdown   │  │
│                                          │   JSON, HTML         │  │
│                                          └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Concepts

| Concept | BMAD Implementation | Our Implementation |
|---------|---------------------|-------------------|
| Agent Personas | YAML files + XML manifest | YAML files + Python dataclasses |
| Orchestration | Prompt-based (single LLM) | Python SDK with session chaining |
| Live Monitoring | TTS hooks (optional) | WebSocket + CLI streaming |
| Output Recording | Retrospective workflow | Automatic transcript + Markdown generator |
| Context Sharing | Same LLM context window | Session resume (`--resume`) or SDK client |

---

## 2. Technology Stack

### Required Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Python 3.11+ | Core orchestration logic |
| Claude Integration | `claude-agent-sdk` | Programmatic Claude access |
| CLI Fallback | `claude -p` (subprocess) | Alternative execution method |
| Live Streaming | `asyncio` + WebSocket | Real-time monitoring |
| Agent Definitions | YAML | Agent persona storage |
| Output | Markdown + JSON | Meeting documentation |
| Optional: Web UI | FastAPI + WebSocket | Browser-based monitoring |

### Installation

```bash
# Core dependencies
pip install claude-agent-sdk pyyaml asyncio aiofiles websockets

# Optional: Web UI
pip install fastapi uvicorn jinja2

# Optional: Rich CLI output
pip install rich
```

---

## 3. Component Design

### 3.1 Agent Registry

Stores agent personas in a format similar to BMAD's agent YAML files.

**Schema:**
```yaml
# agents/architect.yaml
agent:
  id: architect
  name: Winston
  title: System Architect
  icon: "🏗️"
  persona:
    role: "Designs scalable system architectures with focus on maintainability"
    identity: "Senior architect with 15+ years experience in distributed systems"
    communication_style: "Methodical, visual thinker, uses diagrams and analogies"
    principles:
      - "Scalability over premature optimization"
      - "Document decisions with ADRs"
      - "Consider operational complexity"
```

### 3.2 Session Manager

Handles Claude SDK/CLI interactions with context preservation.

**Key Responsibilities:**
- Load agent personas into system prompts
- Manage session IDs for context chaining
- Route between SDK and CLI execution
- Handle retries and error recovery

### 3.3 Live Monitor

Streams agent responses in real-time.

**Approaches:**
1. **CLI Streaming:** `--output-format stream-json` piped to processor
2. **SDK Streaming:** Async iterator with event callbacks
3. **WebSocket:** Push updates to connected clients

### 3.4 Transcript Recorder

Captures complete conversation history.

**Recorded Data:**
- Agent messages with timestamps
- Tool usage (what tools, inputs, outputs)
- Decisions made (extracted via patterns or structured output)
- Session metadata (duration, cost, tokens)

### 3.5 Document Generator

Produces meeting documentation.

**Output Formats:**
- Markdown report (human-readable)
- JSON transcript (machine-parseable)
- HTML (optional, for web viewing)

---

## 4. Implementation Phases

### Phase 1: Core Infrastructure (Foundation)

**Deliverables:**
- Agent registry with YAML loader
- Basic session manager (CLI-based)
- Simple transcript recorder
- Markdown output generator

**Tasks:**
1. Create agent YAML schema and loader
2. Implement CLI wrapper for `claude -p`
3. Build transcript data structure
4. Create Markdown template renderer

### Phase 2: SDK Integration (Enhanced)

**Deliverables:**
- Python SDK integration
- Session chaining for context preservation
- Hook-based monitoring
- Structured output capture

**Tasks:**
1. Migrate from CLI to `claude-agent-sdk`
2. Implement `ClaudeSDKClient` session management
3. Add pre/post tool hooks for monitoring
4. Support structured JSON output schemas

### Phase 3: Live Monitoring (Real-time)

**Deliverables:**
- Real-time CLI display (Rich library)
- WebSocket server for remote monitoring
- Event-based architecture

**Tasks:**
1. Implement async streaming processor
2. Create Rich-based CLI dashboard
3. Add WebSocket server (FastAPI)
4. Build simple web client

### Phase 4: Advanced Features (Polish)

**Deliverables:**
- Multi-agent parallel execution
- Decision extraction with NLP
- Custom MCP tools for meeting actions
- Integration with external services (Slack, GitHub)

**Tasks:**
1. Implement parallel agent orchestration
2. Create MCP server for meeting-specific tools
3. Add Slack/GitHub integrations
4. Build decision/action-item extractors

---

## 5. Code Examples

### 5.1 Agent Registry

```python
# src/agents/registry.py
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
import yaml

@dataclass
class AgentPersona:
    role: str
    identity: str
    communication_style: str
    principles: list[str] = field(default_factory=list)

@dataclass
class Agent:
    id: str
    name: str
    title: str
    icon: str
    persona: AgentPersona

    def to_system_prompt(self) -> str:
        """Generate system prompt for this agent."""
        principles_text = "\n".join(f"- {p}" for p in self.persona.principles)
        return f"""You are {self.name}, {self.title}.

## Your Role
{self.persona.role}

## Your Background
{self.persona.identity}

## Communication Style
{self.persona.communication_style}

## Guiding Principles
{principles_text}

Always respond in character as {self.name}. Use your icon {self.icon} when introducing yourself.
"""

class AgentRegistry:
    def __init__(self, agents_dir: Path):
        self.agents_dir = agents_dir
        self._agents: dict[str, Agent] = {}
        self._load_agents()

    def _load_agents(self):
        """Load all agent YAML files."""
        for yaml_file in self.agents_dir.glob("*.yaml"):
            with open(yaml_file) as f:
                data = yaml.safe_load(f)

            agent_data = data.get("agent", {})
            persona_data = agent_data.get("persona", {})

            agent = Agent(
                id=agent_data.get("id", yaml_file.stem),
                name=agent_data.get("name", "Agent"),
                title=agent_data.get("title", "AI Assistant"),
                icon=agent_data.get("icon", "🤖"),
                persona=AgentPersona(
                    role=persona_data.get("role", ""),
                    identity=persona_data.get("identity", ""),
                    communication_style=persona_data.get("communication_style", ""),
                    principles=persona_data.get("principles", [])
                )
            )
            self._agents[agent.id] = agent

    def get(self, agent_id: str) -> Optional[Agent]:
        return self._agents.get(agent_id)

    def list_agents(self) -> list[Agent]:
        return list(self._agents.values())
```

### 5.2 Session Manager (CLI-based)

```python
# src/session/cli_manager.py
import subprocess
import json
from dataclasses import dataclass
from typing import Optional, Iterator
from pathlib import Path

@dataclass
class SessionResult:
    result: str
    session_id: str
    duration_ms: int
    total_cost_usd: float
    num_turns: int
    is_error: bool

class CLISessionManager:
    """Manages Claude sessions using CLI subprocess."""

    def __init__(self, working_dir: Path = None):
        self.working_dir = working_dir or Path.cwd()
        self._current_session: Optional[str] = None

    def run_agent(
        self,
        prompt: str,
        system_prompt: str = None,
        resume_session: str = None,
        allowed_tools: list[str] = None,
        stream: bool = False
    ) -> SessionResult:
        """Execute agent via CLI."""

        cmd = ["claude", "-p", prompt, "--output-format", "json"]

        if system_prompt:
            cmd.extend(["--system-prompt", system_prompt])

        if resume_session:
            cmd.extend(["--resume", resume_session])
        elif self._current_session:
            cmd.extend(["--resume", self._current_session])

        if allowed_tools:
            cmd.extend(["--allowedTools", ",".join(allowed_tools)])

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=self.working_dir
        )

        if result.returncode != 0:
            return SessionResult(
                result=result.stderr,
                session_id="",
                duration_ms=0,
                total_cost_usd=0,
                num_turns=0,
                is_error=True
            )

        data = json.loads(result.stdout)
        self._current_session = data.get("session_id")

        return SessionResult(
            result=data.get("result", ""),
            session_id=data.get("session_id", ""),
            duration_ms=data.get("duration_ms", 0),
            total_cost_usd=data.get("total_cost_usd", 0),
            num_turns=data.get("num_turns", 0),
            is_error=data.get("is_error", False)
        )

    def stream_agent(
        self,
        prompt: str,
        system_prompt: str = None,
        resume_session: str = None
    ) -> Iterator[dict]:
        """Stream agent output line by line."""

        cmd = ["claude", "-p", prompt, "--output-format", "stream-json"]

        if system_prompt:
            cmd.extend(["--system-prompt", system_prompt])

        if resume_session:
            cmd.extend(["--resume", resume_session])

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=self.working_dir
        )

        for line in process.stdout:
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    yield {"type": "raw", "content": line}

        process.wait()
```

### 5.3 Session Manager (SDK-based)

```python
# src/session/sdk_manager.py
import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Callable, Any

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    ResultMessage,
    ToolUseBlock,
    TextBlock,
    HookMatcher,
    HookContext
)

@dataclass
class AgentMessage:
    agent_id: str
    agent_name: str
    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    message_type: str = "text"
    tool_name: Optional[str] = None
    tool_input: Optional[dict] = None

@dataclass
class MeetingSession:
    session_id: Optional[str] = None
    messages: list[AgentMessage] = field(default_factory=list)
    tool_calls: list[dict] = field(default_factory=list)
    total_cost: float = 0.0
    total_duration_ms: int = 0

class SDKSessionManager:
    """Manages Claude sessions using Python SDK with hooks."""

    def __init__(
        self,
        on_message: Callable[[AgentMessage], None] = None,
        on_tool_use: Callable[[str, str, dict], None] = None
    ):
        self.on_message = on_message or (lambda m: None)
        self.on_tool_use = on_tool_use or (lambda a, t, i: None)
        self._session = MeetingSession()

    async def _tool_hook(
        self,
        agent_name: str,
        input_data: dict[str, Any],
        tool_use_id: str | None,
        context: HookContext
    ) -> dict[str, Any]:
        """Hook called before tool execution."""
        tool_name = input_data.get("tool_name", "unknown")
        tool_input = input_data.get("tool_input", {})

        self._session.tool_calls.append({
            "agent": agent_name,
            "tool": tool_name,
            "input": tool_input,
            "timestamp": datetime.now().isoformat()
        })

        self.on_tool_use(agent_name, tool_name, tool_input)
        return {}

    async def run_agent(
        self,
        agent_id: str,
        agent_name: str,
        prompt: str,
        system_prompt: str = None,
        resume_session: str = None,
        allowed_tools: list[str] = None
    ) -> MeetingSession:
        """Run agent with full monitoring."""

        # Create hook closure for this agent
        async def agent_hook(input_data, tool_id, context):
            return await self._tool_hook(agent_name, input_data, tool_id, context)

        options = ClaudeAgentOptions(
            system_prompt=system_prompt,
            allowed_tools=allowed_tools or ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            permission_mode="acceptEdits",
            resume=resume_session or self._session.session_id,
            hooks={
                "PreToolUse": [HookMatcher(hooks=[agent_hook])]
            }
        )

        async with ClaudeSDKClient(options=options) as client:
            await client.query(prompt)

            async for message in client.receive_messages():
                # Track session ID
                if hasattr(message, "session_id") and message.session_id:
                    self._session.session_id = message.session_id

                # Process assistant messages
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            agent_msg = AgentMessage(
                                agent_id=agent_id,
                                agent_name=agent_name,
                                content=block.text,
                                message_type="text"
                            )
                            self._session.messages.append(agent_msg)
                            self.on_message(agent_msg)

                        elif isinstance(block, ToolUseBlock):
                            agent_msg = AgentMessage(
                                agent_id=agent_id,
                                agent_name=agent_name,
                                content=f"Using tool: {block.name}",
                                message_type="tool_use",
                                tool_name=block.name,
                                tool_input=block.input
                            )
                            self._session.messages.append(agent_msg)
                            self.on_message(agent_msg)

                # Capture final result
                if isinstance(message, ResultMessage):
                    self._session.total_cost += message.total_cost_usd or 0
                    self._session.total_duration_ms += message.duration_ms or 0

        return self._session

    def get_session(self) -> MeetingSession:
        return self._session

    def reset_session(self):
        self._session = MeetingSession()
```

### 5.4 Meeting Orchestrator

```python
# src/orchestrator/meeting.py
import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from ..agents.registry import AgentRegistry, Agent
from ..session.sdk_manager import SDKSessionManager, AgentMessage, MeetingSession

@dataclass
class MeetingPhase:
    name: str
    agent_id: str
    prompt_template: str
    depends_on: Optional[str] = None  # Previous phase to build context from

@dataclass
class MeetingConfig:
    topic: str
    phases: list[MeetingPhase]
    output_dir: Path = field(default_factory=lambda: Path("./meeting_outputs"))

class MeetingOrchestrator:
    """Orchestrates multi-agent meeting discussions."""

    def __init__(
        self,
        config: MeetingConfig,
        agent_registry: AgentRegistry,
        on_message: Callable[[str, AgentMessage], None] = None,
        on_phase_complete: Callable[[str, MeetingSession], None] = None
    ):
        self.config = config
        self.registry = agent_registry
        self.on_message = on_message or (lambda p, m: print(f"[{p}] {m.agent_name}: {m.content[:100]}..."))
        self.on_phase_complete = on_phase_complete or (lambda p, s: print(f"Phase {p} complete"))

        self._session_manager: Optional[SDKSessionManager] = None
        self._phase_results: dict[str, MeetingSession] = {}
        self._start_time: Optional[datetime] = None

    async def run_meeting(self) -> dict:
        """Execute full meeting workflow."""
        self._start_time = datetime.now()

        print(f"\n{'='*60}")
        print(f"Starting Meeting: {self.config.topic}")
        print(f"{'='*60}\n")

        for phase in self.config.phases:
            await self._run_phase(phase)

        # Generate documentation
        report = await self._generate_report()

        print(f"\n{'='*60}")
        print(f"Meeting Complete: {self.config.topic}")
        print(f"Duration: {(datetime.now() - self._start_time).total_seconds():.1f}s")
        print(f"{'='*60}\n")

        return report

    async def _run_phase(self, phase: MeetingPhase):
        """Execute a single meeting phase."""
        print(f"\n--- Phase: {phase.name} ---\n")

        agent = self.registry.get(phase.agent_id)
        if not agent:
            raise ValueError(f"Agent not found: {phase.agent_id}")

        # Create session manager with callbacks
        def message_callback(msg: AgentMessage):
            self.on_message(phase.name, msg)

        def tool_callback(agent_name: str, tool: str, input_data: dict):
            print(f"  [{agent_name}] Tool: {tool}")

        self._session_manager = SDKSessionManager(
            on_message=message_callback,
            on_tool_use=tool_callback
        )

        # Get resume session from dependency
        resume_session = None
        if phase.depends_on and phase.depends_on in self._phase_results:
            resume_session = self._phase_results[phase.depends_on].session_id

        # Format prompt with topic
        prompt = phase.prompt_template.format(topic=self.config.topic)

        # Run agent
        session = await self._session_manager.run_agent(
            agent_id=agent.id,
            agent_name=agent.name,
            prompt=prompt,
            system_prompt=agent.to_system_prompt(),
            resume_session=resume_session
        )

        self._phase_results[phase.name] = session
        self.on_phase_complete(phase.name, session)

    async def _generate_report(self) -> dict:
        """Generate meeting documentation."""
        report = {
            "topic": self.config.topic,
            "start_time": self._start_time.isoformat(),
            "end_time": datetime.now().isoformat(),
            "duration_seconds": (datetime.now() - self._start_time).total_seconds(),
            "phases": {},
            "total_cost": 0.0,
            "total_messages": 0,
            "total_tool_calls": 0
        }

        for phase_name, session in self._phase_results.items():
            report["phases"][phase_name] = {
                "session_id": session.session_id,
                "messages": [
                    {
                        "agent": m.agent_name,
                        "content": m.content,
                        "timestamp": m.timestamp.isoformat(),
                        "type": m.message_type
                    }
                    for m in session.messages
                ],
                "tool_calls": session.tool_calls,
                "cost": session.total_cost,
                "duration_ms": session.total_duration_ms
            }
            report["total_cost"] += session.total_cost
            report["total_messages"] += len(session.messages)
            report["total_tool_calls"] += len(session.tool_calls)

        # Save JSON report
        self.config.output_dir.mkdir(parents=True, exist_ok=True)
        json_path = self.config.output_dir / f"meeting_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

        import json
        with open(json_path, "w") as f:
            json.dump(report, f, indent=2)

        # Generate Markdown report
        md_path = await self._generate_markdown(report)
        report["output_files"] = {
            "json": str(json_path),
            "markdown": str(md_path)
        }

        return report

    async def _generate_markdown(self, report: dict) -> Path:
        """Generate Markdown meeting summary."""
        md_lines = [
            f"# Meeting Report: {report['topic']}",
            "",
            f"**Date:** {report['start_time'][:10]}",
            f"**Duration:** {report['duration_seconds']:.1f} seconds",
            f"**Total Cost:** ${report['total_cost']:.4f}",
            "",
            "---",
            ""
        ]

        for phase_name, phase_data in report["phases"].items():
            md_lines.extend([
                f"## {phase_name}",
                "",
                f"*Session: {phase_data['session_id']}*",
                f"*Duration: {phase_data['duration_ms']}ms | Cost: ${phase_data['cost']:.4f}*",
                ""
            ])

            for msg in phase_data["messages"]:
                if msg["type"] == "text":
                    md_lines.extend([
                        f"### {msg['agent']}",
                        "",
                        msg["content"],
                        ""
                    ])

            if phase_data["tool_calls"]:
                md_lines.extend([
                    "#### Tool Usage",
                    ""
                ])
                for tool in phase_data["tool_calls"]:
                    md_lines.append(f"- **{tool['tool']}**: {list(tool['input'].keys())}")
                md_lines.append("")

        md_lines.extend([
            "---",
            "",
            f"*Generated: {datetime.now().isoformat()}*"
        ])

        md_path = self.config.output_dir / f"meeting_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        with open(md_path, "w") as f:
            f.write("\n".join(md_lines))

        return md_path
```

### 5.5 Live Monitor (CLI with Rich)

```python
# src/monitor/cli_monitor.py
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.layout import Layout
from datetime import datetime
from typing import Optional
from collections import deque

class CLIMonitor:
    """Rich-based CLI monitor for live meeting display."""

    def __init__(self, max_messages: int = 20):
        self.console = Console()
        self.messages = deque(maxlen=max_messages)
        self.current_phase = ""
        self.current_agent = ""
        self.tool_calls = []
        self.stats = {
            "phases_complete": 0,
            "messages": 0,
            "tool_calls": 0,
            "cost": 0.0
        }
        self._live: Optional[Live] = None

    def start(self):
        """Start live display."""
        self._live = Live(
            self._render(),
            console=self.console,
            refresh_per_second=4
        )
        self._live.start()

    def stop(self):
        """Stop live display."""
        if self._live:
            self._live.stop()

    def update_phase(self, phase: str):
        self.current_phase = phase
        self._refresh()

    def add_message(self, agent: str, content: str, msg_type: str = "text"):
        self.current_agent = agent
        self.messages.append({
            "time": datetime.now().strftime("%H:%M:%S"),
            "agent": agent,
            "content": content[:200] + "..." if len(content) > 200 else content,
            "type": msg_type
        })
        self.stats["messages"] += 1
        self._refresh()

    def add_tool_call(self, agent: str, tool: str):
        self.tool_calls.append({"agent": agent, "tool": tool})
        self.stats["tool_calls"] += 1
        self._refresh()

    def update_cost(self, cost: float):
        self.stats["cost"] += cost
        self._refresh()

    def phase_complete(self):
        self.stats["phases_complete"] += 1
        self._refresh()

    def _refresh(self):
        if self._live:
            self._live.update(self._render())

    def _render(self):
        layout = Layout()
        layout.split_column(
            Layout(name="header", size=3),
            Layout(name="body"),
            Layout(name="footer", size=3)
        )

        # Header
        layout["header"].update(Panel(
            f"[bold cyan]Meeting in Progress[/] | Phase: [yellow]{self.current_phase}[/] | Agent: [green]{self.current_agent}[/]"
        ))

        # Body - Messages table
        table = Table(show_header=True, header_style="bold magenta", expand=True)
        table.add_column("Time", width=10)
        table.add_column("Agent", width=15)
        table.add_column("Message", ratio=1)

        for msg in self.messages:
            style = "dim" if msg["type"] == "tool_use" else ""
            table.add_row(msg["time"], msg["agent"], msg["content"], style=style)

        layout["body"].update(Panel(table, title="Conversation"))

        # Footer - Stats
        layout["footer"].update(Panel(
            f"Phases: {self.stats['phases_complete']} | "
            f"Messages: {self.stats['messages']} | "
            f"Tools: {self.stats['tool_calls']} | "
            f"Cost: ${self.stats['cost']:.4f}"
        ))

        return layout
```

### 5.6 Main Entry Point

```python
# src/main.py
import asyncio
from pathlib import Path

from .agents.registry import AgentRegistry
from .orchestrator.meeting import MeetingOrchestrator, MeetingConfig, MeetingPhase
from .monitor.cli_monitor import CLIMonitor

async def run_meeting(topic: str, agents_dir: Path, output_dir: Path):
    """Run a complete meeting session."""

    # Load agents
    registry = AgentRegistry(agents_dir)

    # Configure meeting phases
    config = MeetingConfig(
        topic=topic,
        output_dir=output_dir,
        phases=[
            MeetingPhase(
                name="Requirements Analysis",
                agent_id="analyst",
                prompt_template="""Analyze the requirements for: {topic}

                Please:
                1. Identify key stakeholder needs
                2. List functional and non-functional requirements
                3. Document assumptions and constraints
                4. Highlight risks or concerns
                """
            ),
            MeetingPhase(
                name="Architecture Design",
                agent_id="architect",
                prompt_template="""Based on the requirements analysis, design the architecture for: {topic}

                Please:
                1. Propose high-level architecture
                2. Discuss technology choices
                3. Address identified risks
                4. Define key components and interactions
                """,
                depends_on="Requirements Analysis"
            ),
            MeetingPhase(
                name="Implementation Planning",
                agent_id="pm",
                prompt_template="""Based on the requirements and architecture, create an implementation plan for: {topic}

                Please:
                1. Create sprint breakdown
                2. Define milestones
                3. Identify dependencies
                4. Estimate team requirements
                """,
                depends_on="Architecture Design"
            ),
            MeetingPhase(
                name="Meeting Summary",
                agent_id="scrum_master",
                prompt_template="""Summarize the meeting discussion about: {topic}

                Please:
                1. Provide executive summary
                2. List all action items
                3. Identify open questions
                4. Create stakeholder summary
                """,
                depends_on="Implementation Planning"
            )
        ]
    )

    # Setup live monitor
    monitor = CLIMonitor()

    def on_message(phase: str, msg):
        monitor.add_message(msg.agent_name, msg.content, msg.message_type)

    def on_phase_complete(phase: str, session):
        monitor.phase_complete()
        monitor.update_cost(session.total_cost)

    # Create orchestrator
    orchestrator = MeetingOrchestrator(
        config=config,
        agent_registry=registry,
        on_message=on_message,
        on_phase_complete=on_phase_complete
    )

    # Run with live monitoring
    monitor.start()
    try:
        report = await orchestrator.run_meeting()
    finally:
        monitor.stop()

    print(f"\nReport saved to: {report['output_files']['markdown']}")
    return report


if __name__ == "__main__":
    asyncio.run(run_meeting(
        topic="Building a Real-Time Analytics Platform",
        agents_dir=Path("./agents"),
        output_dir=Path("./meeting_outputs")
    ))
```

---

## 6. File Structure

```
meeting-orchestrator/
├── src/
│   ├── __init__.py
│   ├── main.py                    # Entry point
│   ├── agents/
│   │   ├── __init__.py
│   │   └── registry.py            # Agent loader
│   ├── session/
│   │   ├── __init__.py
│   │   ├── cli_manager.py         # CLI-based sessions
│   │   └── sdk_manager.py         # SDK-based sessions
│   ├── orchestrator/
│   │   ├── __init__.py
│   │   └── meeting.py             # Meeting orchestration
│   ├── monitor/
│   │   ├── __init__.py
│   │   ├── cli_monitor.py         # Rich CLI display
│   │   └── websocket_server.py    # WebSocket for web UI
│   └── output/
│       ├── __init__.py
│       ├── transcript.py          # Transcript recorder
│       └── generator.py           # Markdown/HTML generator
├── agents/                         # Agent YAML definitions
│   ├── analyst.yaml
│   ├── architect.yaml
│   ├── pm.yaml
│   ├── developer.yaml
│   └── scrum_master.yaml
├── templates/                      # Output templates
│   ├── meeting_report.md.jinja2
│   └── meeting_report.html.jinja2
├── meeting_outputs/                # Generated reports
├── tests/
│   ├── test_registry.py
│   ├── test_session.py
│   └── test_orchestrator.py
├── requirements.txt
├── pyproject.toml
└── README.md
```

---

## 7. Deployment Considerations

### Development Environment

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows

# Install dependencies
pip install -e ".[dev]"

# Run a test meeting
python -m src.main
```

### CLI Usage

```bash
# Basic meeting
python -m src.main --topic "API Redesign" --output ./reports

# With specific agents
python -m src.main --topic "Bug Triage" --agents developer,tester

# Stream output only (no Rich UI)
python -m src.main --topic "Sprint Planning" --stream-only
```

### Environment Variables

```bash
# Required
export ANTHROPIC_API_KEY="sk-ant-..."

# Optional
export MEETING_AGENTS_DIR="./agents"
export MEETING_OUTPUT_DIR="./reports"
export MEETING_LOG_LEVEL="INFO"
```

### Cost Management

```python
# Add to MeetingConfig
max_budget_usd: float = 1.0  # Stop if exceeded
max_turns_per_phase: int = 10  # Limit agent iterations
```

### Integration Points

| Integration | Implementation |
|-------------|----------------|
| Slack | Post summaries via Slack API after meeting |
| GitHub | Create issues for action items |
| Calendar | Schedule follow-up meetings |
| Confluence | Publish meeting notes |

---

## Summary

This implementation plan provides a complete framework for replicating BMAD's Party Mode meeting orchestration with:

1. **Agent Personas** - YAML-based definitions similar to BMAD's `.agent.yaml` files
2. **Session Management** - Both CLI (`claude -p`) and SDK (`claude-agent-sdk`) approaches
3. **Live Monitoring** - Real-time streaming with Rich CLI or WebSocket
4. **Context Preservation** - Session chaining via `--resume` or SDK client
5. **Documentation Generation** - Automatic Markdown and JSON reports

The key difference from BMAD's approach: instead of a single LLM role-playing multiple personas, this system chains separate Claude sessions with context preservation, giving each "agent" its own dedicated system prompt while maintaining conversation continuity.
