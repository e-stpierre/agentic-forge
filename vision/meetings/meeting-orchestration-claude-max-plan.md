# Implementation Plan: Multi-Agent Meeting Orchestration

This plan describes how to build a **true multi-agent** meeting orchestration system where **independent AI sessions** communicate via Kafka messaging. The system is **AI-agnostic**, supporting multiple CLI providers (Claude, Cursor, Codex, Copilot) in the same meeting - no API keys required when using consumer subscriptions.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Infrastructure Setup](#2-infrastructure-setup)
3. [Phase 1: Agent Personas](#phase-1-agent-personas)
4. [Phase 2: Kafka Messaging Layer](#phase-2-kafka-messaging-layer)
5. [Phase 3: CLI Provider Abstraction](#phase-3-cli-provider-abstraction)
6. [Phase 4: Multi-Session Orchestrator](#phase-4-multi-session-orchestrator)
7. [Phase 5: Textual TUI](#phase-5-textual-tui)
8. [Phase 6: Facilitator Templates](#phase-6-facilitator-templates)
9. [Phase 7: Document Generation](#phase-7-document-generation)
10. [File Structure](#file-structure)
11. [Usage Examples](#usage-examples)

---

## 1. Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│              Multi-Agent Meeting System (AI-Agnostic, True Multi-Session)          │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐ │
│  │                            KAFKA MESSAGE BUS                                  │ │
│  │   Topics: meeting.messages | meeting.control | meeting.user-input             │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
│         ▲              ▲              ▲              ▲              ▲             │
│         │              │              │              │              │             │
│         ▼              ▼              ▼              ▼              ▼             │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐      │
│  │ Facilitator│ │  Agent 1   │ │  Agent 2   │ │  Agent N   │ │    User    │      │
│  │  (Claude)  │ │  (Claude)  │ │  (Cursor)  │ │  (Codex)   │ │   (TUI)    │      │
│  │            │ │            │ │            │ │            │ │            │      │
│  │ claude -p  │ │ claude -p  │ │cursor-agent│ │ codex exec │ │  Textual   │      │
│  │ --resume X │ │ --resume Y │ │ --resume Z │ │    ...     │ │    App     │      │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘      │
│         │              │              │              │              │             │
│         └──────────────┴──────────────┴──────────────┴──────────────┘             │
│                                       │                                            │
│                                       ▼                                            │
│                    ┌──────────────────────────────────┐                           │
│                    │       CLI Provider Abstraction    │                           │
│                    │  ┌────────┬────────┬───────────┐ │                           │
│                    │  │ Claude │ Cursor │  Codex    │ │                           │
│                    │  │Provider│Provider│ Provider  │ │                           │
│                    │  └────────┴────────┴───────────┘ │                           │
│                    └──────────────────────────────────┘                           │
│                                       │                                            │
│                                       ▼                                            │
│                          ┌────────────────────────┐                               │
│                          │   Python Orchestrator   │                               │
│                          │                        │                               │
│                          │  • Session management  │                               │
│                          │  • Turn coordination   │                               │
│                          │  • Transcript capture  │                               │
│                          │  • Document generation │                               │
│                          └────────────────────────┘                               │
│                                       │                                            │
│                                       ▼                                            │
│                          ┌────────────────────────┐                               │
│                          │       Outputs          │                               │
│                          │  • meeting-transcript  │                               │
│                          │  • generated-docs      │                               │
│                          │  • decisions.json      │                               │
│                          └────────────────────────┘                               │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Key Principles

| Principle                      | Implementation                                                           |
| ------------------------------ | ------------------------------------------------------------------------ |
| **AI-agnostic**                | Support multiple CLI providers (Claude, Cursor, Codex, Copilot)          |
| **True multi-session**         | Each agent runs as separate CLI process with own session                 |
| **Independent reasoning**      | Agents have separate context windows, can genuinely disagree             |
| **Kafka messaging**            | Decoupled communication via pub/sub topics                               |
| **Persistent sessions**        | Each agent maintains state via `--resume` across turns (if supported)    |
| **Sequential turn-taking**     | Agents respond one at a time, seeing full conversation history           |
| **Topic-based selection**      | Facilitator analyzes topic, selects relevant agents per round            |
| **Template-based facilitator** | Facilitator behavior defined in markdown templates                       |
| **Interactive mode flag**      | `--interactive` enables user participation, without it runs autonomously |

### Supported CLI Providers

| Provider    | CLI Command      | Status        | Session Resume | Output Format   |
| ----------- | ---------------- | ------------- | -------------- | --------------- |
| **Claude**  | `claude`         | ✅ Supported  | `--resume`     | `--output-format json` |
| **Cursor**  | `cursor-agent`   | ✅ Supported  | `--resume`     | `--output-format`      |
| **Codex**   | `codex`          | 🚧 Planned    | TBD            | TBD             |
| **Copilot** | `gh copilot`     | 🚧 Planned    | No             | Text only       |

---

## 2. Infrastructure Setup

### Docker Compose Configuration

**`docker/docker-compose.yml`**

```yaml
version: "3.8"

services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    container_name: meeting-zookeeper
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000
    ports:
      - "2181:2181"
    volumes:
      - zookeeper-data:/var/lib/zookeeper/data
      - zookeeper-logs:/var/lib/zookeeper/log

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    container_name: meeting-kafka
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"
      - "29092:29092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:9092
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
    volumes:
      - kafka-data:/var/lib/kafka/data

  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    container_name: meeting-kafka-ui
    depends_on:
      - kafka
    ports:
      - "8080:8080"
    environment:
      KAFKA_CLUSTERS_0_NAME: meeting-cluster
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:29092
      KAFKA_CLUSTERS_0_ZOOKEEPER: zookeeper:2181

volumes:
  zookeeper-data:
  zookeeper-logs:
  kafka-data:
```

### Quick Start

```bash
# Start infrastructure
cd docker
docker-compose up -d

# Verify Kafka is running
docker-compose logs kafka | grep "started"

# Access Kafka UI at http://localhost:8080

# Create required topics
docker exec meeting-kafka kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic meeting.messages \
  --partitions 1 \
  --replication-factor 1

docker exec meeting-kafka kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic meeting.control \
  --partitions 1 \
  --replication-factor 1

docker exec meeting-kafka kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic meeting.user-input \
  --partitions 1 \
  --replication-factor 1
```

---

## Phase 1: Agent Personas

Agent personas define independent Claude session personalities.

### 1.1 Directory Structure

```
.claude/
└── agents/
    ├── analyst.md
    ├── architect.md
    ├── pm.md
    ├── developer.md
    ├── designer.md
    ├── tester.md
    └── facilitator.md
```

### 1.2 Agent Template

```markdown
---
name: architect
description: System architect for technical design discussions
tools: Read,Grep,Glob,Bash
model: sonnet
---

# Winston - System Architect

You are **Winston**, a senior system architect participating in a multi-agent meeting.

## Your Identity

- **Name:** Winston
- **Icon:** 🏗️
- **Role:** System Architect
- **Expertise:** Distributed systems, cloud infrastructure, API design, scalability

## Communication Style

You are methodical and visual. You:

- Use diagrams and analogies to explain complex concepts
- Always consider scalability and maintainability
- Document decisions with clear rationale
- Ask probing questions before proposing solutions

## Meeting Participation Rules

1. You receive messages from other agents via the conversation history
2. Respond only when the Facilitator addresses you or the topic is in your domain
3. Reference other agents by name when building on their points
4. Be concise - meetings have limited time
5. Clearly state when you agree or disagree with other agents

## Response Format

Always format your responses as:
```

🏗️ **Winston (Architect):** [Your response]

```

## Guiding Principles

- Scalability over premature optimization
- Document decisions with Architecture Decision Records (ADRs)
- Consider operational complexity, not just development speed
- Prefer proven patterns over novel approaches
```

### 1.3 All Agent Definitions

**`.claude/agents/analyst.md`**

```markdown
---
name: analyst
description: Business analyst for requirements and stakeholder analysis
tools: Read,Grep,Glob
model: sonnet
---

# Mary - Business Analyst

You are **Mary**, a senior business analyst participating in a multi-agent meeting.

## Your Identity

- **Name:** Mary
- **Icon:** 📊
- **Role:** Business Analyst
- **Expertise:** Requirements gathering, user stories, process mapping, stakeholder analysis

## Communication Style

- Detail-oriented and empathetic
- Ask clarifying questions to uncover hidden requirements
- Translate technical concepts for non-technical stakeholders
- Focus on user outcomes, not just features

## Response Format

Always format: `📊 **Mary (Analyst):** [Your response]`
```

**`.claude/agents/pm.md`**

```markdown
---
name: pm
description: Product manager for prioritization and roadmap
tools: Read,Grep,Glob
model: sonnet
---

# John - Product Manager

You are **John**, a product manager participating in a multi-agent meeting.

## Your Identity

- **Name:** John
- **Icon:** 📋
- **Role:** Product Manager
- **Expertise:** Product strategy, prioritization, roadmaps, stakeholder management

## Communication Style

- Decisive and outcome-focused
- Frame discussions around user value and business impact
- Make trade-off decisions explicit
- Balance short-term wins with long-term vision

## Response Format

Always format: `📋 **John (PM):** [Your response]`
```

**`.claude/agents/developer.md`**

```markdown
---
name: developer
description: Senior developer for implementation and code quality
tools: Read,Write,Edit,Bash,Grep,Glob
model: sonnet
---

# Amelia - Senior Developer

You are **Amelia**, a senior developer participating in a multi-agent meeting.

## Your Identity

- **Name:** Amelia
- **Icon:** 💻
- **Role:** Senior Developer
- **Expertise:** Full-stack development, code quality, testing, CI/CD

## Communication Style

- Pragmatic and direct
- Speak in concrete code examples
- Highlight implementation challenges early
- Advocate for code quality and testing

## Response Format

Always format: `💻 **Amelia (Developer):** [Your response]`
```

**`.claude/agents/designer.md`**

```markdown
---
name: designer
description: UX designer for user experience and interface design
tools: Read,Grep,Glob
model: sonnet
---

# Sofia - UX Designer

You are **Sofia**, a UX designer participating in a multi-agent meeting.

## Your Identity

- **Name:** Sofia
- **Icon:** 🎨
- **Role:** UX Designer
- **Expertise:** User research, interaction design, prototyping, accessibility

## Communication Style

- User-centric and empathetic
- Advocate for accessibility and inclusivity
- Use visual language and metaphors
- Balance aesthetics with usability

## Response Format

Always format: `🎨 **Sofia (Designer):** [Your response]`
```

**`.claude/agents/tester.md`**

```markdown
---
name: tester
description: QA engineer for testing strategy and quality assurance
tools: Read,Bash,Grep,Glob
model: sonnet
---

# Marcus - QA Engineer

You are **Marcus**, a QA engineer participating in a multi-agent meeting.

## Your Identity

- **Name:** Marcus
- **Icon:** 🧪
- **Role:** QA Engineer
- **Expertise:** Test strategy, automation, edge cases, regression testing

## Communication Style

- Methodical and thorough
- Think about edge cases and failure modes
- Advocate for testability in design
- Question assumptions with "what if" scenarios

## Response Format

Always format: `🧪 **Marcus (Tester):** [Your response]`
```

**`.claude/agents/facilitator.md`**

```markdown
---
name: facilitator
description: Meeting facilitator who orchestrates multi-agent discussions
tools: Read,Write,Grep,Glob
model: sonnet
---

# Facilitator

You are the **Meeting Facilitator** responsible for orchestrating productive multi-agent discussions.

## Your Role

You coordinate discussions between specialized agents:

- Select which agents should respond based on the current topic
- Ensure discussions stay focused on the agenda
- Capture decisions and action items
- Synthesize different viewpoints
- Drive toward concrete outcomes

## Facilitation Protocol

1. **Open** - State the topic and invite relevant agents
2. **Explore** - Draw out different viewpoints, enable cross-talk
3. **Synthesize** - Summarize agreements and disagreements
4. **Decide** - Drive toward decisions or next steps
5. **Close** - Recap decisions and action items

## Response Format

Always format: `🎯 **Facilitator:** [Your response]`

## Agent Selection

When addressing agents, use format:
`@architect @developer - Please share your perspectives on [topic]`

## Control Commands

You emit control messages:

- `[NEXT_SPEAKER: agent_name]` - Indicate who should speak next
- `[ROUND_COMPLETE]` - Signal end of discussion round
- `[AWAIT_USER]` - Request user input (only in interactive mode)
- `[MEETING_END]` - Signal meeting conclusion
```

---

## Phase 2: Kafka Messaging Layer

Python module for Kafka communication between agents.

### 2.1 Message Schema

**`src/meeting/messages.py`**

```python
"""Message schemas for multi-agent meeting communication."""

from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from typing import Optional
import json
import uuid


class MessageType(Enum):
    """Types of messages in the meeting system."""
    AGENT_MESSAGE = "agent_message"      # Agent contribution to discussion
    CONTROL = "control"                   # Facilitator control signals
    USER_INPUT = "user_input"             # User participation
    SYSTEM = "system"                     # System events (join, leave, etc.)


class ControlSignal(Enum):
    """Control signals from Facilitator."""
    NEXT_SPEAKER = "next_speaker"
    ROUND_COMPLETE = "round_complete"
    AWAIT_USER = "await_user"
    MEETING_END = "meeting_end"
    MEETING_START = "meeting_start"


@dataclass
class MeetingMessage:
    """A message in the meeting conversation."""

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    sender: str = ""                      # Agent name or "user" or "system"
    sender_role: str = ""                 # Role title (e.g., "Architect")
    sender_icon: str = ""                 # Emoji icon
    message_type: str = MessageType.AGENT_MESSAGE.value
    content: str = ""                     # Message content
    control_signal: Optional[str] = None  # For control messages
    control_data: Optional[dict] = None   # Additional control data
    meeting_id: str = ""                  # Meeting session identifier
    round_number: int = 0                 # Current discussion round

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, json_str: str) -> "MeetingMessage":
        data = json.loads(json_str)
        return cls(**data)

    def to_markdown(self) -> str:
        """Format message for transcript."""
        if self.message_type == MessageType.CONTROL.value:
            return f"*[{self.control_signal}]*\n"

        timestamp = self.timestamp[:19].replace("T", " ")
        return f"{self.sender_icon} **{self.sender} ({self.sender_role}):** {self.content}\n"


@dataclass
class MeetingConfig:
    """Configuration for a meeting session."""

    meeting_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    topic: str = ""
    agents: list[str] = field(default_factory=list)  # List of agent names
    agent_providers: dict[str, str] = field(default_factory=dict)  # agent -> provider mapping
    interactive: bool = False             # Whether user can participate
    facilitator_template: str = "default" # Which facilitator template to use
    output_templates: list[str] = field(default_factory=list)  # Document templates
    max_rounds: int = 5
    output_dir: str = "./meeting_outputs"

    def get_provider(self, agent_name: str) -> str:
        """Get the provider for an agent, defaulting to 'claude'."""
        return self.agent_providers.get(agent_name, "claude")

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, json_str: str) -> "MeetingConfig":
        return cls(**json.loads(json_str))
```

### 2.2 Kafka Client

**`src/meeting/kafka_client.py`**

```python
"""Kafka client for meeting message bus."""

import json
from typing import Callable, Optional, Iterator
from dataclasses import dataclass
from confluent_kafka import Producer, Consumer, KafkaError
from confluent_kafka.admin import AdminClient, NewTopic

from .messages import MeetingMessage, MessageType


@dataclass
class KafkaConfig:
    """Kafka connection configuration."""
    bootstrap_servers: str = "localhost:9092"
    group_id: str = "meeting-orchestrator"
    auto_offset_reset: str = "earliest"


class MeetingKafkaClient:
    """Kafka client for meeting communication."""

    TOPIC_MESSAGES = "meeting.messages"
    TOPIC_CONTROL = "meeting.control"
    TOPIC_USER_INPUT = "meeting.user-input"

    def __init__(self, config: KafkaConfig = None):
        self.config = config or KafkaConfig()
        self._producer: Optional[Producer] = None
        self._consumer: Optional[Consumer] = None

    @property
    def producer(self) -> Producer:
        if self._producer is None:
            self._producer = Producer({
                'bootstrap.servers': self.config.bootstrap_servers,
                'client.id': 'meeting-producer'
            })
        return self._producer

    def create_consumer(self, group_suffix: str = "") -> Consumer:
        """Create a new consumer instance."""
        group_id = f"{self.config.group_id}-{group_suffix}" if group_suffix else self.config.group_id
        return Consumer({
            'bootstrap.servers': self.config.bootstrap_servers,
            'group.id': group_id,
            'auto.offset.reset': self.config.auto_offset_reset,
            'enable.auto.commit': True
        })

    def ensure_topics_exist(self):
        """Create Kafka topics if they don't exist."""
        admin = AdminClient({'bootstrap.servers': self.config.bootstrap_servers})

        topics = [
            NewTopic(self.TOPIC_MESSAGES, num_partitions=1, replication_factor=1),
            NewTopic(self.TOPIC_CONTROL, num_partitions=1, replication_factor=1),
            NewTopic(self.TOPIC_USER_INPUT, num_partitions=1, replication_factor=1),
        ]

        futures = admin.create_topics(topics)
        for topic, future in futures.items():
            try:
                future.result()
                print(f"Created topic: {topic}")
            except Exception as e:
                if "already exists" not in str(e).lower():
                    print(f"Failed to create topic {topic}: {e}")

    def publish_message(self, message: MeetingMessage, topic: str = None):
        """Publish a message to Kafka."""
        if topic is None:
            if message.message_type == MessageType.CONTROL.value:
                topic = self.TOPIC_CONTROL
            elif message.message_type == MessageType.USER_INPUT.value:
                topic = self.TOPIC_USER_INPUT
            else:
                topic = self.TOPIC_MESSAGES

        self.producer.produce(
            topic,
            key=message.meeting_id.encode('utf-8'),
            value=message.to_json().encode('utf-8')
        )
        self.producer.flush()

    def consume_messages(
        self,
        topics: list[str],
        meeting_id: str,
        timeout: float = 1.0
    ) -> Iterator[MeetingMessage]:
        """Consume messages for a specific meeting."""
        consumer = self.create_consumer(f"reader-{meeting_id}")
        consumer.subscribe(topics)

        try:
            while True:
                msg = consumer.poll(timeout)
                if msg is None:
                    continue
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
                    raise Exception(f"Kafka error: {msg.error()}")

                message = MeetingMessage.from_json(msg.value().decode('utf-8'))
                if message.meeting_id == meeting_id:
                    yield message
        finally:
            consumer.close()

    def get_conversation_history(
        self,
        meeting_id: str,
        since_round: int = 0
    ) -> list[MeetingMessage]:
        """Get all messages for a meeting since a given round."""
        messages = []
        consumer = self.create_consumer(f"history-{meeting_id}")
        consumer.subscribe([self.TOPIC_MESSAGES, self.TOPIC_USER_INPUT])

        # Read from beginning
        consumer.poll(0)  # Trigger assignment
        partitions = consumer.assignment()
        for partition in partitions:
            consumer.seek_to_beginning(partition)

        # Collect messages with timeout
        empty_polls = 0
        while empty_polls < 3:
            msg = consumer.poll(0.5)
            if msg is None:
                empty_polls += 1
                continue
            if msg.error():
                continue

            empty_polls = 0
            message = MeetingMessage.from_json(msg.value().decode('utf-8'))
            if message.meeting_id == meeting_id and message.round_number >= since_round:
                messages.append(message)

        consumer.close()
        return sorted(messages, key=lambda m: m.timestamp)

    def close(self):
        """Clean up resources."""
        if self._producer:
            self._producer.flush()
```

---

## Phase 3: CLI Provider Abstraction

Abstraction layer enabling multiple AI CLI providers in the same meeting.

### 3.1 Provider Interface

**`src/meeting/providers/base.py`**

```python
"""Base interface for AI CLI providers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from pathlib import Path


@dataclass
class ProviderResponse:
    """Standardized response from any provider."""
    content: str
    session_id: Optional[str] = None
    raw_output: str = ""
    is_error: bool = False
    error_message: str = ""


class CLIProvider(ABC):
    """Abstract base class for AI CLI providers."""

    name: str = "base"

    @abstractmethod
    def build_command(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        model: Optional[str] = None,
        tools: Optional[list[str]] = None,
        working_dir: Optional[Path] = None
    ) -> list[str]:
        """Build the CLI command for this provider."""
        pass

    @abstractmethod
    def parse_response(self, stdout: str, stderr: str, return_code: int) -> ProviderResponse:
        """Parse the CLI output into a standardized response."""
        pass

    @abstractmethod
    def supports_session_resume(self) -> bool:
        """Whether this provider supports session resumption."""
        pass

    @abstractmethod
    def supports_json_output(self) -> bool:
        """Whether this provider supports structured JSON output."""
        pass

    def supports_tools(self) -> bool:
        """Whether this provider supports tool/sandbox restrictions."""
        return False
```

### 3.2 Claude Provider

**`src/meeting/providers/claude.py`**

```python
"""Claude CLI provider implementation."""

import json
from typing import Optional
from pathlib import Path

from .base import CLIProvider, ProviderResponse


class ClaudeProvider(CLIProvider):
    """Provider for Anthropic's Claude CLI."""

    name = "claude"

    def build_command(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        model: Optional[str] = None,
        tools: Optional[list[str]] = None,
        working_dir: Optional[Path] = None
    ) -> list[str]:
        """Build claude CLI command."""
        cmd = ["claude", "-p", prompt, "--output-format", "json"]

        if system_prompt:
            cmd.extend(["--append-system-prompt", system_prompt])

        if session_id:
            cmd.extend(["--resume", session_id])

        if model:
            cmd.extend(["--model", model])

        if tools:
            cmd.extend(["--allowedTools", ",".join(tools)])

        return cmd

    def parse_response(self, stdout: str, stderr: str, return_code: int) -> ProviderResponse:
        """Parse Claude CLI JSON output."""
        if return_code != 0:
            return ProviderResponse(
                content="",
                is_error=True,
                error_message=stderr,
                raw_output=stdout
            )

        try:
            data = json.loads(stdout)
            return ProviderResponse(
                content=data.get("result", ""),
                session_id=data.get("session_id"),
                raw_output=stdout
            )
        except json.JSONDecodeError:
            return ProviderResponse(
                content=stdout,
                raw_output=stdout
            )

    def supports_session_resume(self) -> bool:
        return True

    def supports_json_output(self) -> bool:
        return True

    def supports_tools(self) -> bool:
        return True
```

### 3.3 Cursor Provider

**`src/meeting/providers/cursor.py`**

```python
"""Cursor CLI provider implementation."""

import json
from typing import Optional
from pathlib import Path

from .base import CLIProvider, ProviderResponse


class CursorProvider(CLIProvider):
    """Provider for Cursor's cursor-agent CLI."""

    name = "cursor"

    def build_command(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        model: Optional[str] = None,
        tools: Optional[list[str]] = None,
        working_dir: Optional[Path] = None
    ) -> list[str]:
        """Build cursor-agent CLI command."""
        cmd = ["cursor-agent", "-p", prompt]

        if model:
            cmd.extend(["--model", model])

        if session_id:
            cmd.extend([f"--resume={session_id}"])

        # Cursor uses --output-format similar to Claude
        cmd.extend(["--output-format", "text"])

        # Note: System prompt handling may differ - prepend to prompt if needed
        if system_prompt:
            # Cursor may not have --append-system-prompt, embed in prompt
            prompt_with_system = f"<system>{system_prompt}</system>\n\n{prompt}"
            cmd[2] = prompt_with_system

        return cmd

    def parse_response(self, stdout: str, stderr: str, return_code: int) -> ProviderResponse:
        """Parse Cursor CLI output."""
        if return_code != 0:
            return ProviderResponse(
                content="",
                is_error=True,
                error_message=stderr,
                raw_output=stdout
            )

        # Try to parse as JSON first
        try:
            data = json.loads(stdout)
            return ProviderResponse(
                content=data.get("result", data.get("response", stdout)),
                session_id=data.get("session_id", data.get("chat_id")),
                raw_output=stdout
            )
        except json.JSONDecodeError:
            # Fall back to plain text
            return ProviderResponse(
                content=stdout.strip(),
                raw_output=stdout
            )

    def supports_session_resume(self) -> bool:
        return True

    def supports_json_output(self) -> bool:
        return True  # Cursor supports --output-format

    def supports_tools(self) -> bool:
        return False  # Cursor doesn't have tool restrictions like Claude
```

### 3.4 Placeholder Providers (Future)

**`src/meeting/providers/codex.py`**

```python
"""OpenAI Codex CLI provider (placeholder)."""

from typing import Optional
from pathlib import Path

from .base import CLIProvider, ProviderResponse


class CodexProvider(CLIProvider):
    """Provider for OpenAI Codex CLI (placeholder implementation)."""

    name = "codex"

    def build_command(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        model: Optional[str] = None,
        tools: Optional[list[str]] = None,
        working_dir: Optional[Path] = None
    ) -> list[str]:
        """Build codex CLI command."""
        # Placeholder - adjust when Codex CLI is available
        cmd = ["codex", "exec", prompt]

        if model:
            cmd.extend(["--model", model])

        if system_prompt:
            cmd.extend(["--system", system_prompt])

        return cmd

    def parse_response(self, stdout: str, stderr: str, return_code: int) -> ProviderResponse:
        """Parse Codex CLI output."""
        if return_code != 0:
            return ProviderResponse(
                content="",
                is_error=True,
                error_message=stderr,
                raw_output=stdout
            )

        return ProviderResponse(
            content=stdout.strip(),
            raw_output=stdout
        )

    def supports_session_resume(self) -> bool:
        return False  # TBD

    def supports_json_output(self) -> bool:
        return False  # TBD
```

**`src/meeting/providers/copilot.py`**

```python
"""GitHub Copilot CLI provider (placeholder)."""

from typing import Optional
from pathlib import Path

from .base import CLIProvider, ProviderResponse


class CopilotProvider(CLIProvider):
    """Provider for GitHub Copilot CLI (placeholder implementation)."""

    name = "copilot"

    def build_command(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        model: Optional[str] = None,
        tools: Optional[list[str]] = None,
        working_dir: Optional[Path] = None
    ) -> list[str]:
        """Build gh copilot CLI command."""
        # GitHub Copilot CLI has limited capabilities
        cmd = ["gh", "copilot", "suggest", "-t", "shell", prompt]
        return cmd

    def parse_response(self, stdout: str, stderr: str, return_code: int) -> ProviderResponse:
        """Parse Copilot CLI output."""
        if return_code != 0:
            return ProviderResponse(
                content="",
                is_error=True,
                error_message=stderr,
                raw_output=stdout
            )

        return ProviderResponse(
            content=stdout.strip(),
            raw_output=stdout
        )

    def supports_session_resume(self) -> bool:
        return False  # Copilot doesn't support session resume

    def supports_json_output(self) -> bool:
        return False  # Copilot outputs text only
```

### 3.5 Provider Factory

**`src/meeting/providers/__init__.py`**

```python
"""CLI Provider factory and registry."""

from typing import Dict, Type

from .base import CLIProvider, ProviderResponse
from .claude import ClaudeProvider
from .cursor import CursorProvider
from .codex import CodexProvider
from .copilot import CopilotProvider


# Provider registry
PROVIDERS: Dict[str, Type[CLIProvider]] = {
    "claude": ClaudeProvider,
    "cursor": CursorProvider,
    "codex": CodexProvider,
    "copilot": CopilotProvider,
}


def get_provider(name: str) -> CLIProvider:
    """Get a provider instance by name."""
    provider_class = PROVIDERS.get(name.lower())
    if not provider_class:
        raise ValueError(
            f"Unknown provider: {name}. "
            f"Available: {', '.join(PROVIDERS.keys())}"
        )
    return provider_class()


def list_providers() -> list[str]:
    """List all available provider names."""
    return list(PROVIDERS.keys())


__all__ = [
    "CLIProvider",
    "ProviderResponse",
    "ClaudeProvider",
    "CursorProvider",
    "CodexProvider",
    "CopilotProvider",
    "get_provider",
    "list_providers",
    "PROVIDERS",
]
```

---

## Phase 4: Multi-Session Orchestrator

The orchestrator manages independent AI sessions for each agent using the provider abstraction.

### 4.1 Agent Session Manager

**`src/meeting/agent_session.py`**

```python
"""Manages individual AI CLI sessions for agents."""

import subprocess
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

from .providers import get_provider, CLIProvider


@dataclass
class AgentConfig:
    """Configuration for an agent."""
    name: str
    display_name: str
    role: str
    icon: str
    persona_path: Path
    provider: str = "claude"  # claude, cursor, codex, copilot
    tools: list[str] = field(default_factory=lambda: ["Read", "Grep", "Glob"])
    model: str = "sonnet"


@dataclass
class AgentSession:
    """Represents a persistent AI session for an agent."""

    config: AgentConfig
    session_id: Optional[str] = None
    working_dir: Path = field(default_factory=Path.cwd)
    _provider: Optional[CLIProvider] = field(default=None, repr=False)

    @property
    def provider(self) -> CLIProvider:
        """Get the CLI provider for this agent."""
        if self._provider is None:
            self._provider = get_provider(self.config.provider)
        return self._provider

    def invoke(
        self,
        prompt: str,
        conversation_history: str = "",
        timeout: int = 120
    ) -> str:
        """Invoke the agent with a prompt and return response."""

        # Build full prompt with conversation context
        full_prompt = self._build_prompt(prompt, conversation_history)

        # Read system prompt from persona file
        system_prompt = None
        if self.config.persona_path.exists():
            system_prompt = self.config.persona_path.read_text()

        # Build command using provider abstraction
        cmd = self.provider.build_command(
            prompt=full_prompt,
            system_prompt=system_prompt,
            session_id=self.session_id if self.provider.supports_session_resume() else None,
            model=self.config.model,
            tools=self.config.tools if self.provider.supports_tools() else None,
            working_dir=self.working_dir
        )

        # Execute
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=self.working_dir,
            timeout=timeout
        )

        # Parse response using provider abstraction
        response = self.provider.parse_response(
            result.stdout,
            result.stderr,
            result.returncode
        )

        if response.is_error:
            return f"[Error: {response.error_message}]"

        # Store session ID for future invocations (if supported)
        if response.session_id and self.provider.supports_session_resume():
            self.session_id = response.session_id

        return response.content

    def _build_prompt(self, prompt: str, conversation_history: str) -> str:
        """Build the full prompt with context."""
        parts = []

        if conversation_history:
            parts.append("## Conversation So Far\n")
            parts.append(conversation_history)
            parts.append("\n---\n")

        parts.append("## Your Turn\n")
        parts.append(prompt)

        return "\n".join(parts)


class AgentPool:
    """Manages a pool of agent sessions."""

    def __init__(self, agents_dir: Path = None):
        self.agents_dir = agents_dir or Path(".claude/agents")
        self.sessions: dict[str, AgentSession] = {}
        self._load_agents()

    def _load_agents(self):
        """Load agent configurations from disk."""
        if not self.agents_dir.exists():
            return

        for agent_file in self.agents_dir.glob("*.md"):
            config = self._parse_agent_file(agent_file)
            if config:
                self.sessions[config.name] = AgentSession(config=config)

    def _parse_agent_file(self, path: Path) -> Optional[AgentConfig]:
        """Parse an agent definition file."""
        content = path.read_text()

        # Parse YAML frontmatter
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                import yaml
                frontmatter = yaml.safe_load(parts[1])

                # Extract display name and icon from content
                body = parts[2]
                display_name = frontmatter.get("name", path.stem).title()
                icon = "🤖"

                # Try to find icon in content
                for line in body.split("\n"):
                    if "**Icon:**" in line:
                        icon = line.split("**Icon:**")[1].strip()
                        break
                    if "**Name:**" in line:
                        display_name = line.split("**Name:**")[1].strip()

                return AgentConfig(
                    name=frontmatter.get("name", path.stem),
                    display_name=display_name,
                    role=frontmatter.get("description", "Agent"),
                    icon=icon,
                    persona_path=path,
                    provider=frontmatter.get("provider", "claude"),  # NEW: provider field
                    tools=frontmatter.get("tools", "Read,Grep,Glob").split(","),
                    model=frontmatter.get("model", "sonnet")
                )
        return None

    def get_agent(self, name: str) -> Optional[AgentSession]:
        """Get an agent session by name."""
        return self.sessions.get(name)

    def list_agents(self) -> list[str]:
        """List available agent names."""
        return list(self.sessions.keys())

    def invoke_agent(
        self,
        agent_name: str,
        prompt: str,
        conversation_history: str = ""
    ) -> str:
        """Invoke a specific agent."""
        session = self.get_agent(agent_name)
        if not session:
            return f"[Error: Agent '{agent_name}' not found]"

        return session.invoke(prompt, conversation_history)

    def create_agent_with_provider(
        self,
        name: str,
        display_name: str,
        role: str,
        icon: str,
        provider: str,
        model: str = None,
        tools: list[str] = None
    ) -> AgentSession:
        """Create an agent dynamically with a specific provider."""
        config = AgentConfig(
            name=name,
            display_name=display_name,
            role=role,
            icon=icon,
            persona_path=Path(f".claude/agents/{name}.md"),
            provider=provider,
            model=model or "default",
            tools=tools or []
        )
        session = AgentSession(config=config)
        self.sessions[name] = session
        return session
```

### 4.2 Meeting Orchestrator

**`src/meeting/orchestrator.py`**

```python
"""Main orchestrator for multi-agent meetings."""

import re
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, Callable

from .messages import (
    MeetingMessage, MeetingConfig, MessageType, ControlSignal
)
from .kafka_client import MeetingKafkaClient, KafkaConfig
from .agent_session import AgentPool, AgentSession


@dataclass
class MeetingState:
    """Current state of a meeting."""
    config: MeetingConfig
    current_round: int = 0
    active_agents: list[str] = field(default_factory=list)
    transcript: list[MeetingMessage] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    action_items: list[str] = field(default_factory=list)
    is_complete: bool = False
    awaiting_user: bool = False


class MeetingOrchestrator:
    """Orchestrates multi-agent meeting discussions."""

    def __init__(
        self,
        config: MeetingConfig,
        kafka_config: KafkaConfig = None,
        agents_dir: Path = None,
        on_message: Callable[[MeetingMessage], None] = None
    ):
        self.config = config
        self.kafka = MeetingKafkaClient(kafka_config or KafkaConfig())
        self.agent_pool = AgentPool(agents_dir)
        self.state = MeetingState(config=config, active_agents=config.agents.copy())
        self.on_message = on_message or (lambda m: None)

        # Load facilitator
        self.facilitator = self.agent_pool.get_agent("facilitator")
        if not self.facilitator:
            raise ValueError("Facilitator agent not found")

    def run(self):
        """Run the complete meeting."""
        self.kafka.ensure_topics_exist()

        # Start meeting
        self._emit_control(ControlSignal.MEETING_START, {
            "topic": self.config.topic,
            "agents": self.config.agents,
            "interactive": self.config.interactive
        })

        # Opening round
        self._run_opening()

        # Discussion rounds
        while self.state.current_round < self.config.max_rounds and not self.state.is_complete:
            self.state.current_round += 1
            self._run_discussion_round()

            # Check if facilitator ended meeting
            if self.state.is_complete:
                break

            # Handle user input if interactive and requested
            if self.config.interactive and self.state.awaiting_user:
                self._emit_control(ControlSignal.AWAIT_USER)
                # TUI will handle user input and publish to Kafka
                user_msg = self._wait_for_user_input()
                if user_msg:
                    self._process_user_message(user_msg)
                self.state.awaiting_user = False

        # Closing
        self._run_closing()

        # Generate outputs
        self._generate_outputs()

        self._emit_control(ControlSignal.MEETING_END)

    def _run_opening(self):
        """Run the meeting opening."""
        prompt = f"""
You are facilitating a meeting about: **{self.config.topic}**

Participating agents: {', '.join(self.config.agents)}
Interactive mode: {'Yes - user can participate' if self.config.interactive else 'No - autonomous discussion'}

Open this meeting:
1. Welcome participants
2. State the topic and objectives
3. Set the agenda
4. Invite the first relevant agent(s) to share their perspective

Use [NEXT_SPEAKER: agent_name] to indicate who should speak.
"""
        response = self.facilitator.invoke(prompt)
        self._publish_agent_message("facilitator", "Facilitator", "🎯", response)

        # Parse and invoke next speakers
        self._handle_facilitator_response(response)

    def _run_discussion_round(self):
        """Run a single discussion round."""
        # Get conversation history
        history = self._format_conversation_history()

        # Ask facilitator to continue
        prompt = f"""
Continue the discussion (Round {self.state.current_round}/{self.config.max_rounds}).

Have agents:
- Build on previous points
- Offer different perspectives
- Identify areas of agreement/disagreement

{"End this round with [AWAIT_USER] if you need user input." if self.config.interactive else ""}
Use [NEXT_SPEAKER: agent_name] to call on specific agents.
Use [ROUND_COMPLETE] when this round is done.
Use [MEETING_END] if the discussion has reached a natural conclusion.
"""
        response = self.facilitator.invoke(prompt, history)
        self._publish_agent_message("facilitator", "Facilitator", "🎯", response)

        self._handle_facilitator_response(response)

    def _run_closing(self):
        """Run the meeting closing."""
        history = self._format_conversation_history()

        prompt = """
Close this meeting:
1. Summarize key points discussed
2. List decisions made
3. Assign action items with owners
4. Note any open questions
5. Thank participants

Format decisions as: `DECISION: [description]`
Format action items as: `ACTION: [description] - Owner: [agent]`
"""
        response = self.facilitator.invoke(prompt, history)
        self._publish_agent_message("facilitator", "Facilitator", "🎯", response)

        # Extract decisions and action items
        self._extract_outcomes(response)

    def _handle_facilitator_response(self, response: str):
        """Parse facilitator response and invoke agents."""

        # Check for control signals
        if "[MEETING_END]" in response:
            self.state.is_complete = True
            return

        if "[AWAIT_USER]" in response:
            self.state.awaiting_user = True

        if "[ROUND_COMPLETE]" in response:
            self._emit_control(ControlSignal.ROUND_COMPLETE, {
                "round": self.state.current_round
            })
            return

        # Find next speakers
        next_speakers = re.findall(r'\[NEXT_SPEAKER:\s*(\w+)\]', response)
        if not next_speakers:
            # Also check for @mentions
            next_speakers = re.findall(r'@(\w+)', response)

        # Invoke each speaker
        history = self._format_conversation_history()
        for speaker in next_speakers:
            if speaker in self.state.active_agents:
                self._invoke_agent(speaker, history)

    def _invoke_agent(self, agent_name: str, conversation_history: str):
        """Invoke a specific agent and publish their response."""
        session = self.agent_pool.get_agent(agent_name)
        if not session:
            return

        prompt = f"""
The Facilitator has called on you to contribute to the discussion.

Review the conversation and provide your perspective.
Be concise and focused. Reference other agents' points when relevant.
"""
        response = session.invoke(prompt, conversation_history)

        self._publish_agent_message(
            session.config.name,
            session.config.display_name,
            session.config.icon,
            response
        )

    def _publish_agent_message(
        self,
        agent_name: str,
        display_name: str,
        icon: str,
        content: str
    ):
        """Publish an agent message to Kafka."""
        message = MeetingMessage(
            sender=display_name,
            sender_role=agent_name,
            sender_icon=icon,
            message_type=MessageType.AGENT_MESSAGE.value,
            content=content,
            meeting_id=self.config.meeting_id,
            round_number=self.state.current_round
        )

        self.state.transcript.append(message)
        self.kafka.publish_message(message)
        self.on_message(message)

    def _emit_control(self, signal: ControlSignal, data: dict = None):
        """Emit a control signal."""
        message = MeetingMessage(
            sender="system",
            sender_role="control",
            message_type=MessageType.CONTROL.value,
            control_signal=signal.value,
            control_data=data or {},
            meeting_id=self.config.meeting_id,
            round_number=self.state.current_round
        )

        self.kafka.publish_message(message)
        self.on_message(message)

    def _format_conversation_history(self) -> str:
        """Format transcript as markdown for agent context."""
        lines = []
        for msg in self.state.transcript:
            lines.append(msg.to_markdown())
        return "\n".join(lines)

    def _wait_for_user_input(self, timeout: float = 300) -> Optional[MeetingMessage]:
        """Wait for user input from Kafka."""
        for message in self.kafka.consume_messages(
            [self.kafka.TOPIC_USER_INPUT],
            self.config.meeting_id,
            timeout=timeout
        ):
            if message.message_type == MessageType.USER_INPUT.value:
                self.state.transcript.append(message)
                return message
        return None

    def _process_user_message(self, message: MeetingMessage):
        """Process user input and continue discussion."""
        # Facilitator acknowledges user input
        history = self._format_conversation_history()
        prompt = f"""
The user (Project Lead) has provided input:

"{message.content}"

Acknowledge their input and continue the discussion appropriately.
"""
        response = self.facilitator.invoke(prompt, history)
        self._publish_agent_message("facilitator", "Facilitator", "🎯", response)
        self._handle_facilitator_response(response)

    def _extract_outcomes(self, closing_response: str):
        """Extract decisions and action items from closing."""
        # Extract decisions
        decisions = re.findall(r'DECISION:\s*(.+?)(?:\n|$)', closing_response)
        self.state.decisions.extend(decisions)

        # Extract action items
        actions = re.findall(r'ACTION:\s*(.+?)(?:\n|$)', closing_response)
        self.state.action_items.extend(actions)

    def _generate_outputs(self):
        """Generate meeting output documents."""
        output_dir = Path(self.config.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        date_str = datetime.now().strftime("%Y-%m-%d")
        topic_slug = self.config.topic.lower().replace(" ", "-")[:30]

        # Always save transcript
        transcript_path = output_dir / f"transcript-{topic_slug}-{date_str}.md"
        transcript_content = self._generate_transcript()
        transcript_path.write_text(transcript_content)

        # Generate requested document templates
        for template_name in self.config.output_templates:
            self._generate_from_template(template_name, output_dir, topic_slug, date_str)

    def _generate_transcript(self) -> str:
        """Generate full meeting transcript."""
        lines = [
            f"# Meeting Transcript: {self.config.topic}",
            f"",
            f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            f"**Participants:** {', '.join(self.config.agents)}",
            f"**Interactive:** {'Yes' if self.config.interactive else 'No'}",
            f"",
            "---",
            ""
        ]

        current_round = 0
        for msg in self.state.transcript:
            if msg.round_number > current_round:
                current_round = msg.round_number
                lines.append(f"\n## Round {current_round}\n")

            lines.append(msg.to_markdown())

        lines.extend([
            "",
            "---",
            "",
            "## Decisions",
            ""
        ])
        for i, decision in enumerate(self.state.decisions, 1):
            lines.append(f"{i}. {decision}")

        lines.extend([
            "",
            "## Action Items",
            ""
        ])
        for item in self.state.action_items:
            lines.append(f"- [ ] {item}")

        return "\n".join(lines)

    def _generate_from_template(
        self,
        template_name: str,
        output_dir: Path,
        topic_slug: str,
        date_str: str
    ):
        """Generate a document from a template."""
        template_path = Path(f".claude/templates/{template_name}.md")
        if not template_path.exists():
            return

        # Use facilitator to generate document based on template
        template_content = template_path.read_text()
        history = self._format_conversation_history()

        prompt = f"""
Generate a document based on this template:

{template_content}

Use the meeting discussion to fill in the template.
Decisions made: {self.state.decisions}
Action items: {self.state.action_items}
"""
        document = self.facilitator.invoke(prompt, history)

        output_path = output_dir / f"{template_name}-{topic_slug}-{date_str}.md"
        output_path.write_text(document)
```

---

## Phase 5: Textual TUI

Rich terminal UI for interactive meetings.

### 5.1 TUI Application

**`src/meeting/tui.py`**

```python
"""Textual TUI for interactive meeting participation."""

from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical, ScrollableContainer
from textual.widgets import Header, Footer, Static, Input, Button, Label, ListView, ListItem
from textual.reactive import reactive
from textual.message import Message
from rich.text import Text
from rich.markdown import Markdown
from pathlib import Path
from datetime import datetime
import threading

from .messages import MeetingMessage, MeetingConfig, MessageType
from .kafka_client import MeetingKafkaClient, KafkaConfig
from .orchestrator import MeetingOrchestrator


class MessageDisplay(Static):
    """Widget to display a single meeting message."""

    def __init__(self, message: MeetingMessage):
        super().__init__()
        self.message = message

    def compose(self) -> ComposeResult:
        formatted = f"{self.message.sender_icon} **{self.message.sender}:** {self.message.content}"
        yield Static(Markdown(formatted))


class ConversationView(ScrollableContainer):
    """Scrollable view of the meeting conversation."""

    def add_message(self, message: MeetingMessage):
        """Add a new message to the view."""
        widget = MessageDisplay(message)
        self.mount(widget)
        self.scroll_end(animate=False)


class AgentSelector(Container):
    """Widget for selecting meeting participants."""

    def __init__(self, available_agents: list[str]):
        super().__init__()
        self.available_agents = available_agents
        self.selected_agents: set[str] = set()

    def compose(self) -> ComposeResult:
        yield Label("Select Agents:")
        for agent in self.available_agents:
            yield Button(agent, id=f"agent-{agent}", variant="default")

    def on_button_pressed(self, event: Button.Pressed):
        agent_name = event.button.id.replace("agent-", "")
        if agent_name in self.selected_agents:
            self.selected_agents.discard(agent_name)
            event.button.variant = "default"
        else:
            self.selected_agents.add(agent_name)
            event.button.variant = "success"


class MeetingTUI(App):
    """Main TUI application for meeting orchestration."""

    CSS = """
    Screen {
        layout: grid;
        grid-size: 1 3;
        grid-rows: auto 1fr auto;
    }

    #header-container {
        height: 3;
        background: $primary;
        padding: 1;
    }

    #conversation {
        border: round $primary;
        padding: 1;
    }

    #input-container {
        height: 5;
        layout: horizontal;
        padding: 1;
    }

    #user-input {
        width: 80%;
    }

    #send-button {
        width: 20%;
    }

    .agent-button {
        margin: 1;
    }

    #status {
        dock: bottom;
        height: 1;
        background: $surface;
    }
    """

    BINDINGS = [
        ("ctrl+q", "quit", "Quit"),
        ("ctrl+s", "send", "Send"),
        ("escape", "cancel", "Cancel"),
    ]

    meeting_active = reactive(False)
    status_text = reactive("Ready")

    def __init__(
        self,
        config: MeetingConfig = None,
        kafka_config: KafkaConfig = None,
        agents_dir: Path = None
    ):
        super().__init__()
        self.config = config
        self.kafka_config = kafka_config or KafkaConfig()
        self.agents_dir = agents_dir or Path(".claude/agents")
        self.kafka = MeetingKafkaClient(self.kafka_config)
        self.orchestrator: MeetingOrchestrator = None
        self.orchestrator_thread: threading.Thread = None

    def compose(self) -> ComposeResult:
        yield Header()

        with Container(id="header-container"):
            yield Label(f"Meeting: {self.config.topic if self.config else 'New Meeting'}")

        yield ConversationView(id="conversation")

        with Horizontal(id="input-container"):
            yield Input(
                placeholder="Type your message (or leave empty to observe)...",
                id="user-input"
            )
            yield Button("Send", id="send-button", variant="primary")

        yield Footer()

    def on_mount(self):
        """Start meeting when mounted."""
        if self.config:
            self.start_meeting()

    def start_meeting(self):
        """Start the meeting orchestration in a background thread."""
        self.meeting_active = True
        self.status_text = "Meeting in progress..."

        self.orchestrator = MeetingOrchestrator(
            config=self.config,
            kafka_config=self.kafka_config,
            agents_dir=self.agents_dir,
            on_message=self._on_message
        )

        self.orchestrator_thread = threading.Thread(target=self._run_meeting)
        self.orchestrator_thread.daemon = True
        self.orchestrator_thread.start()

    def _run_meeting(self):
        """Run meeting in background thread."""
        try:
            self.orchestrator.run()
        except Exception as e:
            self.call_from_thread(self._show_error, str(e))
        finally:
            self.call_from_thread(self._meeting_complete)

    def _on_message(self, message: MeetingMessage):
        """Handle new message from orchestrator."""
        self.call_from_thread(self._add_message, message)

    def _add_message(self, message: MeetingMessage):
        """Add message to conversation view (main thread)."""
        conversation = self.query_one("#conversation", ConversationView)
        conversation.add_message(message)

        # Update status
        if message.control_signal == "await_user":
            self.status_text = "Awaiting your input..."

    def _meeting_complete(self):
        """Handle meeting completion."""
        self.meeting_active = False
        self.status_text = "Meeting complete. Press Ctrl+Q to exit."

    def _show_error(self, error: str):
        """Show error message."""
        self.status_text = f"Error: {error}"

    def on_button_pressed(self, event: Button.Pressed):
        """Handle send button."""
        if event.button.id == "send-button":
            self.action_send()

    def action_send(self):
        """Send user message."""
        input_widget = self.query_one("#user-input", Input)
        message_text = input_widget.value.strip()

        if message_text:
            # Publish user message to Kafka
            message = MeetingMessage(
                sender="You",
                sender_role="Project Lead",
                sender_icon="👤",
                message_type=MessageType.USER_INPUT.value,
                content=message_text,
                meeting_id=self.config.meeting_id,
                round_number=self.orchestrator.state.current_round if self.orchestrator else 0
            )

            self.kafka.publish_message(message)

            # Add to local view
            conversation = self.query_one("#conversation", ConversationView)
            conversation.add_message(message)

            # Clear input
            input_widget.value = ""
            self.status_text = "Message sent"

    def action_quit(self):
        """Quit the application."""
        self.exit()


def run_interactive_meeting(
    topic: str,
    agents: list[str],
    facilitator_template: str = "default",
    output_templates: list[str] = None,
    output_dir: str = "./meeting_outputs"
):
    """Run an interactive meeting with TUI."""

    config = MeetingConfig(
        topic=topic,
        agents=agents,
        interactive=True,
        facilitator_template=facilitator_template,
        output_templates=output_templates or [],
        output_dir=output_dir
    )

    app = MeetingTUI(config=config)
    app.run()
```

---

## Phase 6: Facilitator Templates

Template-based facilitator strategies for different meeting types.

### 6.1 Template Directory Structure

```
.claude/
└── templates/
    └── facilitator/
        ├── default.md
        ├── brainstorm.md
        ├── decision.md
        ├── retrospective.md
        └── planning.md
```

### 6.2 Default Template

**`.claude/templates/facilitator/default.md`**

```markdown
# Default Facilitator Template

## Meeting Type

General discussion with balanced participation

## Opening Protocol

1. Welcome all participants
2. State the topic clearly
3. Outline 2-3 key questions to address
4. Invite perspectives from most relevant agents first

## Discussion Protocol

- Ensure each agent speaks at least once per round
- Encourage cross-references between agents
- Summarize key points before moving to next topic
- Maximum 3 agents per exchange before synthesis

## Closing Protocol

1. Summarize major themes
2. Highlight areas of agreement
3. Note unresolved tensions
4. Propose concrete decisions
5. Assign action items

## Agent Selection Criteria

| Topic Category | Primary Agents       | Secondary Agents |
| -------------- | -------------------- | ---------------- |
| Requirements   | analyst, pm          | architect        |
| Technical      | architect, developer | tester           |
| Design         | designer, analyst    | developer        |
| Process        | pm, tester           | developer        |
```

### 6.3 Brainstorm Template

**`.claude/templates/facilitator/brainstorm.md`**

```markdown
# Brainstorm Facilitator Template

## Meeting Type

Creative ideation with divergent thinking

## Opening Protocol

1. State the challenge/opportunity
2. Establish "no bad ideas" principle
3. Set quantity over quality goal
4. Start with most creative agents (designer, analyst)

## Discussion Protocol

- Rapid-fire contributions (short responses)
- Build on others' ideas ("Yes, and...")
- Encourage wild ideas
- Defer judgment until closing
- Use "What if..." prompts

## Closing Protocol

1. Group similar ideas into themes
2. Identify top 3-5 ideas by novelty
3. Identify top 3-5 ideas by feasibility
4. Select ideas for further exploration
5. Assign owners for follow-up

## Special Rules

- No criticism during ideation
- Every agent must contribute at least 2 ideas
- Facilitator prompts with "building on that..." if energy drops
```

### 6.4 Decision Template

**`.claude/templates/facilitator/decision.md`**

```markdown
# Decision Facilitator Template

## Meeting Type

Structured decision-making with clear outcomes

## Opening Protocol

1. State the decision to be made
2. Present the options (if known)
3. Establish decision criteria
4. Assign advocates for different options

## Discussion Protocol

- Each option gets equal airtime
- Focus on trade-offs, not preferences
- Require evidence for claims
- Document pros/cons explicitly
- Check for missing alternatives

## Closing Protocol

1. Summarize each option's pros/cons
2. Apply decision criteria
3. Call for recommendation from each agent
4. Synthesize into final decision
5. Document rationale

## Decision Format
```

DECISION: [What was decided]
RATIONALE: [Why this option]
ALTERNATIVES CONSIDERED: [Other options]
RISKS: [Potential issues]
OWNER: [Who is responsible]

```

```

---

## Phase 7: Document Generation

Template system for meeting output documents.

### 7.1 Document Templates Directory

```
.claude/
└── templates/
    └── documents/
        ├── meeting-summary.md
        ├── action-items.md
        ├── decision-record.md
        ├── technical-spec.md
        └── retrospective-report.md
```

### 7.2 Meeting Summary Template

**`.claude/templates/documents/meeting-summary.md`**

```markdown
# Meeting Summary Template

## Document Type

Executive summary of meeting outcomes

## Template

# Meeting Summary: {{topic}}

**Date:** {{date}}
**Participants:** {{participants}}
**Duration:** {{duration}}

---

## Executive Summary

{{2-3 sentence summary of key outcomes}}

---

## Discussion Highlights

### {{subtopic_1}}

{{key points and perspectives}}

### {{subtopic_2}}

{{key points and perspectives}}

---

## Decisions Made

| #   | Decision | Rationale | Owner |
| --- | -------- | --------- | ----- |

{{decisions_table}}

---

## Action Items

{{action_items_checklist}}

---

## Open Questions

{{open_questions}}

---

## Next Steps

{{next_steps}}

---

_Generated by Meeting Orchestrator_
```

### 7.3 Decision Record Template (ADR Style)

**`.claude/templates/documents/decision-record.md`**

```markdown
# Decision Record Template

## Document Type

Architecture Decision Record (ADR) style

## Template

# ADR-{{number}}: {{title}}

**Date:** {{date}}
**Status:** Accepted
**Deciders:** {{participants}}

## Context

{{background and problem statement}}

## Decision

{{the decision that was made}}

## Rationale

{{why this decision was made}}

### Options Considered

#### Option 1: {{option_1_name}}

- Pros: {{pros}}
- Cons: {{cons}}

#### Option 2: {{option_2_name}}

- Pros: {{pros}}
- Cons: {{cons}}

### Decision Criteria Applied

{{how the decision was evaluated}}

## Consequences

### Positive

{{benefits of this decision}}

### Negative

{{trade-offs accepted}}

### Risks

{{potential issues to monitor}}

## Follow-up Actions

{{action_items}}
```

---

## File Structure

Complete project structure:

```
your-project/
├── docker/
│   └── docker-compose.yml          # Kafka + Zookeeper
│
├── .claude/
│   ├── agents/                      # Agent personas
│   │   ├── analyst.md
│   │   ├── architect.md
│   │   ├── pm.md
│   │   ├── developer.md
│   │   ├── designer.md
│   │   ├── tester.md
│   │   └── facilitator.md
│   │
│   ├── templates/
│   │   ├── facilitator/             # Facilitator strategies
│   │   │   ├── default.md
│   │   │   ├── brainstorm.md
│   │   │   ├── decision.md
│   │   │   └── retrospective.md
│   │   │
│   │   └── documents/               # Output document templates
│   │       ├── meeting-summary.md
│   │       ├── action-items.md
│   │       ├── decision-record.md
│   │       └── technical-spec.md
│   │
│   └── commands/
│       └── meeting.md               # /meeting slash command
│
├── src/
│   └── meeting/
│       ├── __init__.py
│       ├── messages.py              # Message schemas
│       ├── kafka_client.py          # Kafka communication
│       ├── agent_session.py         # Claude session management
│       ├── orchestrator.py          # Main orchestrator
│       └── tui.py                   # Textual TUI
│
├── scripts/
│   └── run_meeting.py               # CLI entry point
│
├── meeting_outputs/                 # Generated outputs
│   ├── transcript-*.md
│   └── *.md
│
├── pyproject.toml
└── README.md
```

---

## Usage Examples

### CLI Usage

```bash
# Start Kafka infrastructure
cd docker && docker-compose up -d

# Run autonomous meeting - all agents use Claude (default provider)
python scripts/run_meeting.py \
  --topic "API Redesign Discussion" \
  --agents architect developer tester \
  --template decision \
  --output-docs meeting-summary decision-record

# Run meeting with MIXED PROVIDERS (agent:provider syntax)
python scripts/run_meeting.py \
  --topic "Microservices Architecture" \
  --agents architect:claude developer:cursor tester:claude \
  --template decision \
  --output-docs decision-record

# Interactive meeting with TUI - mixed providers
python scripts/run_meeting.py \
  --topic "Sprint Planning" \
  --agents pm:claude analyst:claude developer:cursor designer:cursor \
  --interactive \
  --template default \
  --output-docs meeting-summary action-items

# Quick meeting with defaults (all Claude)
python scripts/run_meeting.py \
  --topic "Bug Triage" \
  --agents developer tester \
  --interactive

# All Cursor agents
python scripts/run_meeting.py \
  --topic "Code Review Session" \
  --agents developer:cursor reviewer:cursor \
  --template default
```

### Agent Syntax

Agents can be specified in two formats:

| Format | Description | Example |
|--------|-------------|---------|
| `agent_name` | Uses default provider (claude) | `architect` |
| `agent_name:provider` | Uses specified provider | `architect:cursor` |

Supported providers: `claude`, `cursor`, `codex` (planned), `copilot` (planned)

### CLI Entry Point

**`scripts/run_meeting.py`**

```python
#!/usr/bin/env python3
"""CLI entry point for meeting orchestration."""

import argparse
from pathlib import Path

from src.meeting.messages import MeetingConfig
from src.meeting.kafka_client import KafkaConfig
from src.meeting.orchestrator import MeetingOrchestrator
from src.meeting.tui import run_interactive_meeting
from src.meeting.providers import list_providers


def parse_agent_spec(spec: str) -> tuple[str, str]:
    """Parse agent:provider specification.

    Examples:
        'architect' -> ('architect', 'claude')
        'developer:cursor' -> ('developer', 'cursor')
    """
    if ':' in spec:
        agent, provider = spec.split(':', 1)
        return agent, provider
    return spec, 'claude'  # Default provider


def main():
    parser = argparse.ArgumentParser(description="Run a multi-agent meeting")
    parser.add_argument("--topic", "-t", required=True, help="Meeting topic")
    parser.add_argument(
        "--agents", "-a", nargs="+", required=True,
        help="Agents to participate. Format: 'agent' or 'agent:provider' "
             "(e.g., architect developer:cursor tester:claude)"
    )
    parser.add_argument(
        "--interactive", "-i", action="store_true",
        help="Enable interactive mode with TUI for user participation"
    )
    parser.add_argument(
        "--template", default="default",
        help="Facilitator template (default, brainstorm, decision, retrospective)"
    )
    parser.add_argument(
        "--output-docs", nargs="*", default=[],
        help="Document templates to generate (meeting-summary, decision-record, etc.)"
    )
    parser.add_argument(
        "--output-dir", "-o", default="./meeting_outputs",
        help="Output directory for generated documents"
    )
    parser.add_argument(
        "--kafka-server", default="localhost:9092",
        help="Kafka bootstrap server"
    )
    parser.add_argument(
        "--max-rounds", type=int, default=5,
        help="Maximum discussion rounds"
    )
    parser.add_argument(
        "--list-providers", action="store_true",
        help="List available AI providers and exit"
    )

    args = parser.parse_args()

    if args.list_providers:
        print("Available providers:", ", ".join(list_providers()))
        return

    # Parse agent specifications
    agent_specs = [parse_agent_spec(spec) for spec in args.agents]
    agent_names = [name for name, _ in agent_specs]
    agent_providers = {name: provider for name, provider in agent_specs}

    config = MeetingConfig(
        topic=args.topic,
        agents=agent_names,
        agent_providers=agent_providers,  # NEW: provider mapping
        interactive=args.interactive,
        facilitator_template=args.template,
        output_templates=args.output_docs,
        max_rounds=args.max_rounds,
        output_dir=args.output_dir
    )

    kafka_config = KafkaConfig(bootstrap_servers=args.kafka_server)

    if args.interactive:
        # Run with TUI
        run_interactive_meeting(
            topic=args.topic,
            agents=agent_names,
            agent_providers=agent_providers,
            facilitator_template=args.template,
            output_templates=args.output_docs,
            output_dir=args.output_dir
        )
    else:
        # Run autonomously (no user interaction)
        orchestrator = MeetingOrchestrator(
            config=config,
            kafka_config=kafka_config,
            on_message=lambda m: print(m.to_markdown())
        )
        orchestrator.run()
        print(f"\nMeeting complete. Outputs saved to: {args.output_dir}")


if __name__ == "__main__":
    main()
```

### Programmatic Usage

```python
from src.meeting.messages import MeetingConfig
from src.meeting.orchestrator import MeetingOrchestrator

# Autonomous meeting with MIXED PROVIDERS
config = MeetingConfig(
    topic="Authentication System Design",
    agents=["architect", "developer", "tester"],
    agent_providers={
        "architect": "claude",
        "developer": "cursor",  # Different provider
        "tester": "claude"
    },
    interactive=False,
    facilitator_template="decision",
    output_templates=["meeting-summary", "decision-record"],
    max_rounds=4
)

orchestrator = MeetingOrchestrator(config)
orchestrator.run()

# Access results
print(f"Decisions: {orchestrator.state.decisions}")
print(f"Actions: {orchestrator.state.action_items}")
```

### Agent Definition with Provider

Agents can also specify their default provider in the frontmatter:

**`.claude/agents/developer-cursor.md`**

```markdown
---
name: developer-cursor
description: Developer using Cursor AI
provider: cursor
model: gpt-4
tools: []
---

# Developer (Cursor)

You are a senior developer participating in a multi-agent meeting.
You use Cursor AI as your reasoning engine.

## Response Format

Always format: `💻 **Developer (Cursor):** [Your response]`
```

---

## Summary

This implementation provides **true multi-agent meetings** with:

| Feature                   | Implementation                                                    |
| ------------------------- | ----------------------------------------------------------------- |
| **AI-agnostic**           | Support for Claude, Cursor, Codex, Copilot via provider abstraction |
| **Independent sessions**  | Each agent runs as separate CLI process with own context          |
| **Mixed providers**       | Different agents can use different AI backends in same meeting    |
| **Kafka messaging**       | Decoupled pub/sub communication between agents                    |
| **Persistent state**      | Sessions maintained via `--resume` across turns (where supported) |
| **Interactive mode**      | `--interactive` flag enables TUI and user participation           |
| **Autonomous mode**       | Without flag, runs fully autonomous with no user input            |
| **Agent selection**       | User specifies agents with optional provider (`agent:provider`)   |
| **Facilitator templates** | Pluggable meeting strategies (brainstorm, decision, etc)          |
| **Document templates**    | User selects which output documents to generate                   |
| **Full transcript**       | Complete conversation saved to markdown                           |

**Key difference from BMAD Party Mode:** Each agent is a genuinely independent AI session with its own context window, enabling true disagreement and independent reasoning. Additionally, agents can use different AI providers (Claude, Cursor, etc.) in the same meeting for diverse perspectives.
