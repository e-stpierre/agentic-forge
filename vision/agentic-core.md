# Agentic Core Framework

A foundational framework for orchestrating AI agents across diverse workflows - from simple one-shot tasks to complex multi-day epics. Built on Kafka, PostgreSQL, and a provider-agnostic CLI abstraction layer.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Concepts](#core-concepts)
4. [Infrastructure](#infrastructure)
5. [CLI Provider Abstraction](#cli-provider-abstraction)
6. [Workflow Definition (YAML)](#workflow-definition-yaml)
7. [Memory and Learning System](#memory-and-learning-system)
8. [State Management and Recovery](#state-management-and-recovery)
9. [Python Package Structure](#python-package-structure)
10. [CLI Interface](#cli-interface)
11. [Use Case Examples](#use-case-examples)
12. [Plugin Structure](#plugin-structure)
13. [Future Enhancements](#future-enhancements)

---

## Overview

### Purpose

Agentic Core provides the foundational infrastructure for running AI agent workflows using consumer CLI subscriptions (Claude Max, Cursor Pro, etc.) without requiring API keys. It abstracts away the complexity of:

- **Agent communication** via Kafka message bus
- **Persistent memory** via PostgreSQL + pgvector
- **CLI provider differences** via a unified abstraction layer
- **Workflow orchestration** via declarative YAML definitions
- **State recovery** via checkpoints and event replay

### Design Principles

| Principle                      | Description                                                 |
| ------------------------------ | ----------------------------------------------------------- |
| **Provider Agnostic**          | Support Claude, Cursor, Codex, Copilot, and future CLIs     |
| **Workflow Flexibility**       | From 1-minute one-shots to multi-day epics                  |
| **Human-in-the-Loop Optional** | Fully autonomous or with human checkpoints                  |
| **Observable**                 | Every message, decision, and state change is logged         |
| **Recoverable**                | Crash recovery via Kafka replay and PostgreSQL checkpoints  |
| **Self-Learning**              | Accumulate knowledge across workflows via semantic memory   |
| **Single Machine First**       | Docker Compose deployment, designed for future distribution |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           AGENTIC CORE FRAMEWORK                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              KAFKA MESSAGE BUS                                  │ │
│  │                                                                                 │ │
│  │   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │ │
│  │   │   workflow   │ │    agent     │ │   control    │ │    human     │          │ │
│  │   │   .events    │ │  .messages   │ │  .signals    │ │   .input     │          │ │
│  │   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘          │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│           ▲                    ▲                    ▲                    ▲          │
│           │                    │                    │                    │          │
│           ▼                    ▼                    ▼                    ▼          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐│
│  │                          PYTHON ORCHESTRATOR                                    ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            ││
│  │  │  Workflow   │  │   Agent     │  │   State     │  │   Memory    │            ││
│  │  │  Engine     │  │   Manager   │  │   Manager   │  │   Manager   │            ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            ││
│  └─────────────────────────────────────────────────────────────────────────────────┘│
│           │                    │                    │                    │          │
│           ▼                    ▼                    ▼                    ▼          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐│
│  │                       CLI PROVIDER ABSTRACTION                                  ││
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐               ││
│  │  │ Claude  │  │ Cursor  │  │  Codex  │  │ Copilot │  │ Custom  │               ││
│  │  │Provider │  │Provider │  │Provider │  │Provider │  │Provider │               ││
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘               ││
│  └─────────────────────────────────────────────────────────────────────────────────┘│
│           │                    │                    │                    │          │
│           ▼                    ▼                    ▼                    ▼          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐│
│  │                         AI CLI SESSIONS                                         ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            ││
│  │  │   claude    │  │cursor-agent │  │    codex    │  │ gh copilot  │            ││
│  │  │     -p      │  │     -p      │  │    exec     │  │   suggest   │            ││
│  │  │  --resume   │  │  --resume   │  │     ...     │  │     ...     │            ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            ││
│  └─────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                        POSTGRESQL + PGVECTOR                                    │ │
│  │                                                                                 │ │
│  │   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │ │
│  │   │  workflows   │ │    agents    │ │   memory     │ │  checkpoints │          │ │
│  │   │              │ │              │ │  (vectors)   │ │              │          │ │
│  │   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘          │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component                    | Responsibility                                                |
| ---------------------------- | ------------------------------------------------------------- |
| **Kafka Message Bus**        | Decoupled async communication, event sourcing, message replay |
| **Python Orchestrator**      | Workflow execution, agent coordination, state management      |
| **CLI Provider Abstraction** | Unified interface to multiple AI CLIs                         |
| **AI CLI Sessions**          | Actual AI reasoning (Claude, Cursor, etc.)                    |
| **PostgreSQL + pgvector**    | Structured state, semantic memory, checkpoints                |

---

## Core Concepts

### Workflow

A workflow is a complete unit of work with defined steps, agents, and outcomes.

```yaml
# Example: Simple one-shot workflow
name: bugfix-oneshot
type: one-shot
steps:
  - name: fix-bug
    agent: developer
    provider: claude
```

### Agent

An agent is an AI persona with a specific role, skills, and behavior.

```yaml
# Agent definition
name: developer
display_name: Senior Developer
icon: "💻"
provider: claude # default provider
model: sonnet
persona: |
  You are a senior developer focused on code quality and testing.
  Always write tests for your changes.
```

### Task

A task is a single unit of work assigned to an agent within a workflow step.

```yaml
# Task within a step
task:
  description: "Fix the authentication timeout bug"
  context:
    - file: src/auth/session.ts
    - issue: "#1234"
  expected_output: code_changes
```

### Session

A session is a persistent AI CLI conversation that can be resumed across invocations.

```python
# Session persistence
session = AgentSession(
    agent="developer",
    provider="claude",
    session_id="abc123"  # Resume previous conversation
)
```

### Checkpoint

A checkpoint is a recoverable state snapshot stored in PostgreSQL.

```python
# Checkpoint structure
checkpoint = {
    "workflow_id": "epic-auth-2024",
    "step": "feature-3",
    "status": "in_progress",
    "kafka_offset": 12456,
    "agent_sessions": {"developer": "sess-123", "tester": "sess-456"},
    "artifacts": ["plan.md", "feature-1.md"]
}
```

---

## Infrastructure

### Docker Compose

**`docker/docker-compose.yml`**

```yaml
version: "3.8"

services:
  # Kafka (KRaft mode - no Zookeeper)
  kafka:
    image: bitnami/kafka:3.6
    container_name: agentic-kafka
    ports:
      - "9092:9092"
      - "9094:9094"
    environment:
      - KAFKA_CFG_NODE_ID=1
      - KAFKA_CFG_PROCESS_ROLES=broker,controller
      - KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=1@kafka:9093
      - KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093,EXTERNAL://:9094
      - KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092,EXTERNAL://localhost:9094
      - KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,EXTERNAL:PLAINTEXT,PLAINTEXT:PLAINTEXT
      - KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER
      - KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE=true
      - KAFKA_CFG_LOG_RETENTION_HOURS=-1 # Infinite retention for replay
    volumes:
      - kafka-data:/bitnami/kafka

  # Kafka UI for debugging
  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    container_name: agentic-kafka-ui
    depends_on:
      - kafka
    ports:
      - "8080:8080"
    environment:
      KAFKA_CLUSTERS_0_NAME: agentic
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092

  # PostgreSQL with pgvector
  postgres:
    image: pgvector/pgvector:pg16
    container_name: agentic-postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: agentic
      POSTGRES_PASSWORD: agentic
      POSTGRES_DB: agentic
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql

  # Redis for caching (optional, future)
  redis:
    image: redis:7-alpine
    container_name: agentic-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  kafka-data:
  postgres-data:
  redis-data:
```

### Database Schema

**`docker/init.sql`**

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Workflows table
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,  -- one-shot, feature, epic, meeting
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    config JSONB NOT NULL,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Agents table (registered agents)
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    icon VARCHAR(10),
    provider VARCHAR(50) DEFAULT 'claude',
    model VARCHAR(100),
    persona TEXT,
    tools TEXT[],
    created_at TIMESTAMP DEFAULT NOW()
);

-- Agent sessions (for resume capability)
CREATE TABLE agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id),
    agent_name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    session_id VARCHAR(255),  -- CLI session ID for --resume
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP DEFAULT NOW()
);

-- Workflow checkpoints (for recovery)
CREATE TABLE checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id),
    step_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    kafka_offset BIGINT,
    state JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_checkpoints_workflow ON checkpoints(workflow_id, created_at DESC);

-- Messages log (mirror of Kafka for queryability)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id),
    agent_name VARCHAR(100),
    message_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    kafka_topic VARCHAR(100),
    kafka_offset BIGINT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_workflow ON messages(workflow_id, created_at);
CREATE INDEX idx_messages_agent ON messages(agent_name, created_at);

-- Long-term memory (semantic search via pgvector)
CREATE TABLE memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(100) NOT NULL,  -- lesson, pattern, error, decision
    content TEXT NOT NULL,
    embedding vector(1536),  -- OpenAI embedding dimension
    metadata JSONB,
    workflow_id UUID REFERENCES workflows(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_memory_embedding ON memory USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_memory_category ON memory(category);

-- Telemetry (detailed audit log)
CREATE TABLE telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id),
    event_type VARCHAR(100) NOT NULL,
    agent_name VARCHAR(100),
    provider VARCHAR(50),
    duration_ms INTEGER,
    tokens_in INTEGER,
    tokens_out INTEGER,
    success BOOLEAN,
    error TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_telemetry_workflow ON telemetry(workflow_id, created_at);
```

### Kafka Topics

| Topic              | Purpose                                           | Retention |
| ------------------ | ------------------------------------------------- | --------- |
| `workflow.events`  | Workflow lifecycle events (start, complete, fail) | Infinite  |
| `agent.messages`   | Agent-to-agent communication                      | Infinite  |
| `control.signals`  | Orchestrator commands (pause, resume, cancel)     | 7 days    |
| `human.input`      | Human-in-the-loop responses                       | 7 days    |
| `telemetry.events` | Performance and audit events                      | 30 days   |

---

## CLI Provider Abstraction

### Provider Interface

```python
"""Base interface for AI CLI providers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, List
from pathlib import Path


@dataclass
class ProviderCapabilities:
    """What this provider supports."""
    session_resume: bool = False
    json_output: bool = False
    tool_restrictions: bool = False
    system_prompt: bool = True
    model_selection: bool = True


@dataclass
class InvocationResult:
    """Standardized result from any provider."""
    content: str
    session_id: Optional[str] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    duration_ms: Optional[int] = None
    raw_output: str = ""
    is_error: bool = False
    error_message: str = ""


class CLIProvider(ABC):
    """Abstract base class for AI CLI providers."""

    name: str = "base"
    capabilities: ProviderCapabilities = ProviderCapabilities()

    @abstractmethod
    def build_command(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        model: Optional[str] = None,
        tools: Optional[List[str]] = None,
        working_dir: Optional[Path] = None,
        timeout: int = 300
    ) -> List[str]:
        """Build the CLI command for this provider."""
        pass

    @abstractmethod
    def parse_output(
        self,
        stdout: str,
        stderr: str,
        return_code: int,
        duration_ms: int
    ) -> InvocationResult:
        """Parse the CLI output into a standardized result."""
        pass

    def invoke(
        self,
        prompt: str,
        **kwargs
    ) -> InvocationResult:
        """Invoke the CLI and return result."""
        import subprocess
        import time

        cmd = self.build_command(prompt, **kwargs)
        working_dir = kwargs.get("working_dir", Path.cwd())
        timeout = kwargs.get("timeout", 300)

        start = time.time()
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=working_dir,
                timeout=timeout
            )
            duration_ms = int((time.time() - start) * 1000)

            return self.parse_output(
                result.stdout,
                result.stderr,
                result.returncode,
                duration_ms
            )
        except subprocess.TimeoutExpired:
            return InvocationResult(
                content="",
                is_error=True,
                error_message=f"Command timed out after {timeout}s"
            )
```

### Provider Registry

```python
"""Provider registry and factory."""

from typing import Dict, Type

PROVIDERS: Dict[str, Type[CLIProvider]] = {}


def register_provider(name: str):
    """Decorator to register a provider."""
    def decorator(cls: Type[CLIProvider]):
        PROVIDERS[name] = cls
        return cls
    return decorator


def get_provider(name: str) -> CLIProvider:
    """Get a provider instance by name."""
    if name not in PROVIDERS:
        raise ValueError(f"Unknown provider: {name}. Available: {list(PROVIDERS.keys())}")
    return PROVIDERS[name]()


# Built-in providers
@register_provider("claude")
class ClaudeProvider(CLIProvider):
    name = "claude"
    capabilities = ProviderCapabilities(
        session_resume=True,
        json_output=True,
        tool_restrictions=True,
        system_prompt=True,
        model_selection=True
    )
    # ... implementation


@register_provider("cursor")
class CursorProvider(CLIProvider):
    name = "cursor"
    capabilities = ProviderCapabilities(
        session_resume=True,
        json_output=True,
        tool_restrictions=False,
        system_prompt=True,
        model_selection=True
    )
    # ... implementation
```

---

## Workflow Definition (YAML)

### Schema Overview

```yaml
# workflow.yaml
name: string # Unique workflow name
type: one-shot | feature | epic | meeting | analysis | custom
version: "1.0"

# Global settings
settings:
  human_in_loop: boolean # Require human approval at checkpoints
  max_retries: integer # Retry failed steps (default: 3)
  timeout_minutes: integer # Overall workflow timeout
  working_dir: string # Base directory for file operations
  git:
    enabled: boolean
    branch_prefix: string # e.g., "feature/", "fix/"
    auto_commit: boolean
    auto_push: boolean
    auto_pr: boolean

# Agent definitions (or reference external files)
agents:
  - name: string
    provider: claude | cursor | codex | copilot
    model: string
    persona: string | file_reference
    tools: [string]

# Input sources (for analysis workflows)
inputs:
  - type: file | url | video | codebase | github_issue
    path: string # File path, URL, or glob pattern
    description: string # What this input contains

# Workflow steps
steps:
  - name: string
    agent: string # Reference to agent name
    provider: string # Override agent's default provider
    task:
      description: string
      context: [string | file_reference]
      expected_output: code | text | decision | plan | report
    conditions:
      requires: [step_name] # Dependencies
      if: expression # Conditional execution
    checkpoint: boolean # Create checkpoint after this step
    human_approval: boolean # Wait for human approval
    on_failure: retry | skip | abort

# Outputs
outputs:
  - name: string
    type: file | message | artifact
    path: string
    template: string # Optional template file
```

### One-Shot Workflow Example

```yaml
name: bugfix-quick
type: one-shot
version: "1.0"

settings:
  git:
    enabled: true
    branch_prefix: "fix/"
    auto_commit: true
    auto_push: true
    auto_pr: true

agents:
  - name: developer
    provider: claude
    model: sonnet
    persona: |
      You are a senior developer. Fix bugs efficiently with minimal changes.
      Always include a test that reproduces the bug.

steps:
  - name: analyze-and-fix
    agent: developer
    task:
      description: "{{ task_description }}"
      context:
        - "{{ issue_url }}"
      expected_output: code
    checkpoint: true

outputs:
  - name: pr-description
    type: file
    path: .github/pr-description.md
    template: templates/pr-description.md
```

### Feature Development Workflow

```yaml
name: feature-development
type: feature
version: "1.0"

settings:
  human_in_loop: false
  git:
    enabled: true
    branch_prefix: "feature/"
    auto_commit: true

agents:
  - name: planner
    provider: claude
    persona: personas/planner.md

  - name: developer
    provider: claude
    persona: personas/developer.md

  - name: validator
    provider: cursor # Different provider for diversity
    persona: personas/validator.md

steps:
  - name: plan
    agent: planner
    task:
      description: "Create implementation plan for: {{ feature_description }}"
      expected_output: plan
    checkpoint: true

  - name: implement
    agent: developer
    task:
      description: "Implement the feature according to the plan"
      context:
        - "{{ outputs.plan }}"
      expected_output: code
    conditions:
      requires: [plan]
    checkpoint: true

  - name: validate
    agent: validator
    task:
      description: "Review and test the implementation"
      context:
        - "{{ outputs.plan }}"
        - "{{ git.diff }}"
      expected_output: decision
    conditions:
      requires: [implement]
    on_failure: retry

outputs:
  - name: feature-summary
    type: file
    path: docs/features/{{ feature_name }}.md
```

### Epic Workflow Example

```yaml
name: epic-authentication
type: epic
version: "1.0"

settings:
  human_in_loop: true
  timeout_minutes: 480 # 8 hours
  git:
    enabled: true
    branch_prefix: "epic/"

agents:
  - name: architect
    provider: claude
    persona: personas/architect.md

  - name: pm
    provider: claude
    persona: personas/pm.md

  - name: developer
    provider: claude
    persona: personas/developer.md

  - name: tester
    provider: cursor
    persona: personas/tester.md

steps:
  # Phase 1: Brainstorm and Design
  - name: brainstorm
    type: meeting
    agents: [architect, pm, developer]
    task:
      description: "Brainstorm authentication approaches"
      template: meetings/brainstorm
    human_approval: true
    checkpoint: true

  - name: design
    agent: architect
    task:
      description: "Create technical design based on brainstorm"
      context:
        - "{{ outputs.brainstorm }}"
      expected_output: plan
    conditions:
      requires: [brainstorm]
    human_approval: true
    checkpoint: true

  # Phase 2: Break into features
  - name: create-features
    agent: pm
    task:
      description: "Break epic into implementable features"
      context:
        - "{{ outputs.design }}"
      expected_output: plan
    conditions:
      requires: [design]
    checkpoint: true

  # Phase 3: Implement features (dynamic loop)
  - name: implement-features
    type: foreach
    items: "{{ outputs.create-features.features }}"
    workflow: feature-development # Reference another workflow
    settings:
      git:
        branch_prefix: "epic/auth/"
    checkpoint: true

  # Phase 4: Integration testing
  - name: integration-test
    agent: tester
    task:
      description: "Run integration tests across all features"
      expected_output: decision
    conditions:
      requires: [implement-features]
    checkpoint: true

outputs:
  - name: epic-summary
    type: file
    path: docs/epics/authentication.md
    template: templates/epic-summary.md
```

### Analysis Workflow Example

Analysis workflows support 1-5 agents collaborating to analyze a topic with diverse inputs (code, videos, web references, documents).

```yaml
name: security-analysis
type: analysis
version: "1.0"

settings:
  human_in_loop: true # Human decides when agents disagree
  max_rounds: 10 # Maximum discussion rounds
  output_dir: reports/security/

# Diverse input sources
inputs:
  - type: codebase
    path: "src/auth/**/*.ts"
    description: "Authentication module source code"

  - type: url
    path: "https://owasp.org/Top10/"
    description: "OWASP Top 10 reference"

  - type: file
    path: "docs/architecture.md"
    description: "System architecture documentation"

  - type: video
    path: "recordings/auth-demo.mp4"
    description: "Authentication flow walkthrough"

# Security-focused agents
agents:
  - name: security-researcher
    provider: claude
    persona: personas/security-researcher.md
    tools: [read, grep, web_search]

  - name: pentester
    provider: claude
    persona: personas/pentester.md
    tools: [read, grep, bash]

  - name: appsec-developer
    provider: cursor
    persona: personas/appsec-developer.md
    tools: [read, grep, edit]

steps:
  # Phase 1: Individual Analysis
  - name: threat-modeling
    agent: security-researcher
    task:
      description: "Analyze the codebase for potential threat vectors"
      context:
        - "{{ inputs.codebase }}"
        - "{{ inputs.architecture }}"
      expected_output: report
    checkpoint: true

  - name: vulnerability-scan
    agent: pentester
    task:
      description: "Identify specific vulnerabilities and attack vectors"
      context:
        - "{{ inputs.codebase }}"
        - "{{ outputs.threat-modeling }}"
      expected_output: report
    conditions:
      requires: [threat-modeling]

  - name: remediation-plan
    agent: appsec-developer
    task:
      description: "Create remediation plan with code fixes"
      context:
        - "{{ outputs.vulnerability-scan }}"
        - "{{ inputs.owasp }}"
      expected_output: plan
    conditions:
      requires: [vulnerability-scan]

  # Phase 2: Collaborative Discussion
  - name: review-meeting
    type: meeting
    agents: [security-researcher, pentester, appsec-developer]
    task:
      description: "Review findings and prioritize remediation"
      template: meetings/security-review
    human_approval: true # Human decides final priorities
    checkpoint: true

outputs:
  - name: security-report
    type: file
    path: "{{ settings.output_dir }}/{{ analysis_name }}-report.md"
    template: templates/security-report.md

  - name: remediation-tasks
    type: file
    path: "{{ settings.output_dir }}/{{ analysis_name }}-tasks.md"
    template: templates/remediation-tasks.md
```

### Pentest Planning Workflow Example

```yaml
name: pentest-planning
type: analysis
version: "1.0"

settings:
  human_in_loop: true
  max_rounds: 8

inputs:
  - type: url
    path: "{{ target_url }}"
    description: "Target web application"

  - type: file
    path: "{{ scope_document }}"
    description: "Pentest scope and rules of engagement"

agents:
  - name: security-researcher
    provider: claude
    persona: |
      You are a security researcher specializing in reconnaissance
      and threat intelligence. Focus on attack surface mapping.

  - name: pentester
    provider: claude
    persona: |
      You are an experienced penetration tester. Focus on practical
      exploitation techniques and proof-of-concept development.

steps:
  - name: reconnaissance
    agent: security-researcher
    task:
      description: "Perform passive reconnaissance on {{ target_url }}"
      expected_output: report

  - name: attack-planning
    agent: pentester
    task:
      description: "Develop attack plan based on reconnaissance"
      context:
        - "{{ outputs.reconnaissance }}"
        - "{{ inputs.scope }}"
      expected_output: plan
    conditions:
      requires: [reconnaissance]

  - name: methodology-review
    type: meeting
    agents: [security-researcher, pentester]
    task:
      description: "Review and refine the pentest methodology"
      template: meetings/brainstorm
    human_approval: true

outputs:
  - name: pentest-plan
    type: file
    path: reports/pentest-plan-{{ target_name }}.md
```

---

## Memory and Learning System

### Memory Categories

| Category   | Purpose                        | Example                                                    |
| ---------- | ------------------------------ | ---------------------------------------------------------- |
| `lesson`   | Learned from past mistakes     | "Always check for null before accessing nested properties" |
| `pattern`  | Successful approaches to reuse | "For auth features, always implement rate limiting"        |
| `error`    | Common errors and solutions    | "ModuleNotFoundError: install missing dependency first"    |
| `decision` | Architectural decisions (ADRs) | "Chose JWT over sessions for stateless scaling"            |
| `context`  | Project-specific knowledge     | "This project uses pnpm, not npm"                          |

### Memory Storage

```python
"""Memory manager with semantic search."""

from dataclasses import dataclass
from typing import List, Optional
import numpy as np


@dataclass
class MemoryEntry:
    id: str
    category: str
    content: str
    embedding: Optional[np.ndarray] = None
    metadata: dict = None
    workflow_id: Optional[str] = None


class MemoryManager:
    """Manages long-term memory with semantic search."""

    def __init__(self, db_connection, embedding_provider: str = "local"):
        self.db = db_connection
        self.embedding_provider = embedding_provider

    async def store(
        self,
        category: str,
        content: str,
        metadata: dict = None,
        workflow_id: str = None
    ) -> MemoryEntry:
        """Store a memory with embedding for semantic search."""
        embedding = await self._generate_embedding(content)

        entry = MemoryEntry(
            id=generate_uuid(),
            category=category,
            content=content,
            embedding=embedding,
            metadata=metadata or {},
            workflow_id=workflow_id
        )

        await self.db.execute("""
            INSERT INTO memory (id, category, content, embedding, metadata, workflow_id)
            VALUES ($1, $2, $3, $4, $5, $6)
        """, entry.id, category, content, embedding.tolist(), metadata, workflow_id)

        return entry

    async def search(
        self,
        query: str,
        category: Optional[str] = None,
        limit: int = 5,
        threshold: float = 0.7
    ) -> List[MemoryEntry]:
        """Semantic search for relevant memories."""
        query_embedding = await self._generate_embedding(query)

        sql = """
            SELECT id, category, content, metadata, workflow_id,
                   1 - (embedding <=> $1) as similarity
            FROM memory
            WHERE 1 - (embedding <=> $1) > $2
        """
        params = [query_embedding.tolist(), threshold]

        if category:
            sql += " AND category = $3"
            params.append(category)

        sql += " ORDER BY similarity DESC LIMIT $" + str(len(params) + 1)
        params.append(limit)

        rows = await self.db.fetch(sql, *params)
        return [MemoryEntry(**row) for row in rows]

    async def get_relevant_context(
        self,
        task_description: str,
        categories: List[str] = None
    ) -> str:
        """Get relevant memories formatted as context for an agent."""
        memories = await self.search(
            task_description,
            limit=10
        )

        if not memories:
            return ""

        context_parts = ["## Relevant Knowledge from Past Workflows\n"]
        for mem in memories:
            context_parts.append(f"### {mem.category.title()}\n{mem.content}\n")

        return "\n".join(context_parts)
```

### Learning from Workflows

```python
"""Extract learnings from completed workflows."""

class LearningExtractor:
    """Extracts lessons and patterns from workflow execution."""

    def __init__(self, memory_manager: MemoryManager, provider: CLIProvider):
        self.memory = memory_manager
        self.provider = provider

    async def extract_learnings(self, workflow_id: str):
        """Analyze a completed workflow and extract learnings."""
        # Get workflow transcript
        messages = await self.db.fetch("""
            SELECT * FROM messages WHERE workflow_id = $1 ORDER BY created_at
        """, workflow_id)

        # Get telemetry (errors, retries)
        telemetry = await self.db.fetch("""
            SELECT * FROM telemetry WHERE workflow_id = $1
        """, workflow_id)

        # Use an agent to analyze and extract learnings
        prompt = f"""
        Analyze this workflow execution and extract learnings.

        ## Messages
        {format_messages(messages)}

        ## Telemetry (errors, retries)
        {format_telemetry(telemetry)}

        Extract:
        1. LESSONS: What should be done differently next time?
        2. PATTERNS: What approaches worked well and should be reused?
        3. ERRORS: What errors occurred and how were they resolved?

        Format as JSON:
        {{
            "lessons": ["..."],
            "patterns": ["..."],
            "errors": [{{"error": "...", "solution": "..."}}]
        }}
        """

        result = await self.provider.invoke(prompt)
        learnings = json.loads(result.content)

        # Store each learning
        for lesson in learnings.get("lessons", []):
            await self.memory.store("lesson", lesson, workflow_id=workflow_id)

        for pattern in learnings.get("patterns", []):
            await self.memory.store("pattern", pattern, workflow_id=workflow_id)

        for error in learnings.get("errors", []):
            content = f"Error: {error['error']}\nSolution: {error['solution']}"
            await self.memory.store("error", content, workflow_id=workflow_id)
```

---

## State Management and Recovery

### Checkpoint System

```python
"""Workflow checkpoint and recovery system."""

from dataclasses import dataclass
from typing import Dict, Any, Optional
from datetime import datetime


@dataclass
class Checkpoint:
    workflow_id: str
    step_name: str
    status: str
    kafka_offset: int
    state: Dict[str, Any]
    created_at: datetime


class CheckpointManager:
    """Manages workflow checkpoints for crash recovery."""

    def __init__(self, db_connection, kafka_client):
        self.db = db_connection
        self.kafka = kafka_client

    async def create(
        self,
        workflow_id: str,
        step_name: str,
        state: Dict[str, Any]
    ) -> Checkpoint:
        """Create a checkpoint after a step completes."""
        # Get current Kafka offset
        offset = await self.kafka.get_latest_offset("workflow.events")

        checkpoint = Checkpoint(
            workflow_id=workflow_id,
            step_name=step_name,
            status="completed",
            kafka_offset=offset,
            state=state,
            created_at=datetime.utcnow()
        )

        await self.db.execute("""
            INSERT INTO checkpoints (workflow_id, step_name, status, kafka_offset, state)
            VALUES ($1, $2, $3, $4, $5)
        """, workflow_id, step_name, "completed", offset, json.dumps(state))

        return checkpoint

    async def get_latest(self, workflow_id: str) -> Optional[Checkpoint]:
        """Get the latest checkpoint for a workflow."""
        row = await self.db.fetchrow("""
            SELECT * FROM checkpoints
            WHERE workflow_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        """, workflow_id)

        if row:
            return Checkpoint(**row)
        return None

    async def recover(self, workflow_id: str) -> Dict[str, Any]:
        """Recover workflow state from the latest checkpoint."""
        checkpoint = await self.get_latest(workflow_id)

        if not checkpoint:
            raise ValueError(f"No checkpoint found for workflow {workflow_id}")

        # Replay Kafka messages since checkpoint
        messages = await self.kafka.consume_from_offset(
            "workflow.events",
            checkpoint.kafka_offset
        )

        # Rebuild state from checkpoint + replayed messages
        state = checkpoint.state.copy()
        for msg in messages:
            state = self._apply_message(state, msg)

        return state
```

### Recovery Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      CRASH RECOVERY FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Orchestrator starts                                          │
│          │                                                       │
│          ▼                                                       │
│  2. Check PostgreSQL for incomplete workflows                    │
│          │                                                       │
│          ▼                                                       │
│  3. For each incomplete workflow:                                │
│     ┌──────────────────────────────────────┐                    │
│     │ a. Load latest checkpoint            │                    │
│     │ b. Get Kafka offset from checkpoint  │                    │
│     │ c. Replay messages since offset      │                    │
│     │ d. Rebuild workflow state            │                    │
│     │ e. Resume from last completed step   │                    │
│     └──────────────────────────────────────┘                    │
│          │                                                       │
│          ▼                                                       │
│  4. Continue workflow execution                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Python Package Structure

```
plugins/agentic-core/
├── pyproject.toml
├── README.md
│
├── docker/
│   ├── docker-compose.yml
│   └── init.sql
│
├── src/
│   └── agentic_core/
│       ├── __init__.py
│       ├── cli.py                    # CLI entry points
│       │
│       ├── providers/                # CLI provider abstraction
│       │   ├── __init__.py
│       │   ├── base.py
│       │   ├── claude.py
│       │   ├── cursor.py
│       │   ├── codex.py
│       │   └── copilot.py
│       │
│       ├── messaging/                # Kafka integration
│       │   ├── __init__.py
│       │   ├── client.py
│       │   ├── topics.py
│       │   └── schemas.py
│       │
│       ├── storage/                  # PostgreSQL integration
│       │   ├── __init__.py
│       │   ├── database.py
│       │   ├── models.py
│       │   └── migrations/
│       │
│       ├── memory/                   # Long-term memory system
│       │   ├── __init__.py
│       │   ├── manager.py
│       │   ├── embeddings.py
│       │   └── learning.py
│       │
│       ├── workflow/                 # Workflow engine
│       │   ├── __init__.py
│       │   ├── engine.py
│       │   ├── parser.py             # YAML parsing
│       │   ├── executor.py
│       │   └── validators.py
│       │
│       ├── agents/                   # Agent management
│       │   ├── __init__.py
│       │   ├── session.py
│       │   ├── pool.py
│       │   └── personas/             # Built-in personas
│       │       ├── developer.md
│       │       ├── planner.md
│       │       ├── tester.md
│       │       ├── architect.md
│       │       ├── security-researcher.md
│       │       ├── pentester.md
│       │       └── appsec-developer.md
│       │
│       ├── checkpoints/              # State recovery
│       │   ├── __init__.py
│       │   └── manager.py
│       │
│       └── telemetry/                # Observability
│           ├── __init__.py
│           ├── logger.py
│           └── metrics.py
│
├── workflows/                        # Built-in workflow templates
│   ├── one-shot.yaml
│   ├── feature.yaml
│   ├── epic.yaml
│   ├── meeting.yaml
│   └── analysis.yaml
│
└── tests/
    ├── test_providers.py
    ├── test_workflow.py
    └── test_memory.py
```

---

## CLI Interface

### Installation

```bash
# Install as uv tool
uv tool install plugins/agentic-core

# Or from git
uv tool install git+https://github.com/user/agentic-forge#subdirectory=plugins/agentic-core
```

### Commands

```bash
# Infrastructure management
agentic infra up          # Start Docker Compose (Kafka, Postgres, etc.)
agentic infra down        # Stop infrastructure
agentic infra status      # Show infrastructure status
agentic infra logs        # Tail infrastructure logs

# Workflow execution
agentic run workflow.yaml                    # Run a workflow
agentic run workflow.yaml --var key=value   # With variables
agentic run workflow.yaml --dry-run         # Validate without executing
agentic run workflow.yaml --from-step plan  # Resume from specific step

# Built-in quick commands
agentic one-shot "Fix the login bug"        # Quick one-shot workflow
agentic feature "Add dark mode"             # Feature development
agentic meeting "Sprint planning"           # Start a meeting
agentic analysis "Security review of auth"  # Start an analysis session

# Workflow management
agentic list                                # List all workflows
agentic status <workflow-id>                # Get workflow status
agentic resume <workflow-id>                # Resume paused/failed workflow
agentic cancel <workflow-id>                # Cancel running workflow
agentic logs <workflow-id>                  # Show workflow logs

# Memory management
agentic memory search "authentication"      # Search memories
agentic memory list --category lesson       # List by category
agentic memory add lesson "Always test..."  # Add memory manually
agentic memory export                       # Export all memories

# Agent management
agentic agents list                         # List registered agents
agentic agents add persona.md               # Register new agent
agentic agents test developer "Hello"       # Test an agent

# Provider management
agentic providers list                      # List available providers
agentic providers test claude               # Test provider connectivity
```

### Example Usage

```bash
# Start infrastructure
agentic infra up

# Run a quick bugfix
agentic one-shot "Fix issue #1234: login timeout on Safari" \
  --git --pr

# Run feature development
agentic run workflows/feature.yaml \
  --var feature_description="Add user preferences page" \
  --var git_branch="feature/user-prefs"

# Run an epic with human-in-the-loop
agentic run workflows/epic.yaml \
  --var epic_name="Authentication Overhaul" \
  --human-in-loop

# Resume a failed workflow
agentic resume wf-abc123 --from-step implement

# Search past learnings
agentic memory search "authentication patterns"
```

---

## Use Case Examples

### Use Case 1: One-Shot Bugfix

```
User: agentic one-shot "Fix issue #1234" --git --pr

┌─────────────────────────────────────────────────────────────┐
│                     ONE-SHOT WORKFLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Create git branch: fix/issue-1234                        │
│          │                                                   │
│          ▼                                                   │
│  2. Load relevant memories (past similar bugs)               │
│          │                                                   │
│          ▼                                                   │
│  3. Invoke developer agent (Claude)                          │
│     - Analyze issue                                          │
│     - Make code changes                                      │
│     - Write tests                                            │
│          │                                                   │
│          ▼                                                   │
│  4. Commit changes                                           │
│          │                                                   │
│          ▼                                                   │
│  5. Push and create PR                                       │
│          │                                                   │
│          ▼                                                   │
│  6. Extract learnings → store in memory                      │
│                                                              │
│  Duration: ~5 minutes                                        │
│  Agents: 1 (developer:claude)                                │
└─────────────────────────────────────────────────────────────┘
```

### Use Case 2: Meeting/Brainstorm

```
User: agentic meeting "API versioning strategy" \
        --agents architect:claude developer:cursor pm:claude

┌─────────────────────────────────────────────────────────────┐
│                     MEETING WORKFLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Start Kafka message bus for agent communication          │
│          │                                                   │
│          ▼                                                   │
│  2. Initialize 3 independent AI sessions                     │
│     - Architect (Claude)                                     │
│     - Developer (Cursor)                                     │
│     - PM (Claude)                                            │
│          │                                                   │
│          ▼                                                   │
│  3. Facilitator orchestrates discussion (5 rounds)           │
│     ┌──────────────────────────────────────┐                │
│     │  Round N:                            │                │
│     │  - Facilitator selects speakers      │                │
│     │  - Each agent responds via Kafka     │                │
│     │  - All messages logged to Postgres   │                │
│     └──────────────────────────────────────┘                │
│          │                                                   │
│          ▼                                                   │
│  4. Generate meeting summary and decision record             │
│          │                                                   │
│          ▼                                                   │
│  5. Store decisions in long-term memory                      │
│                                                              │
│  Duration: ~15 minutes                                       │
│  Agents: 3 (mixed providers)                                 │
└─────────────────────────────────────────────────────────────┘
```

### Use Case 3: Feature Development

```
User: agentic run feature.yaml --var feature="Add OAuth login"

┌─────────────────────────────────────────────────────────────┐
│                   FEATURE WORKFLOW                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Step 1: PLAN (planner:claude)                               │
│  ├─ Create implementation plan                               │
│  ├─ Checkpoint saved                                         │
│  └─ Output: plan.md                                          │
│          │                                                   │
│          ▼                                                   │
│  Step 2: IMPLEMENT (developer:claude)                        │
│  ├─ Read plan, make code changes                             │
│  ├─ Commit incrementally                                     │
│  ├─ Checkpoint saved                                         │
│  └─ Output: code changes                                     │
│          │                                                   │
│          ▼                                                   │
│  Step 3: VALIDATE (tester:cursor)                            │
│  ├─ Review code, run tests                                   │
│  ├─ If fail → retry implement step                           │
│  └─ Output: validation report                                │
│          │                                                   │
│          ▼                                                   │
│  Output: Feature complete, PR ready                          │
│                                                              │
│  Duration: ~30 minutes                                       │
│  Agents: 3 (planner, developer, tester)                      │
└─────────────────────────────────────────────────────────────┘
```

### Use Case 4: Epic Development (Multi-Day)

```
User: agentic run epic.yaml \
        --var epic="User Authentication System" \
        --human-in-loop

┌─────────────────────────────────────────────────────────────┐
│                     EPIC WORKFLOW                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 1: BRAINSTORM (Day 1, Hour 1)                         │
│  ├─ Meeting with architect, pm, developer                    │
│  ├─ [HUMAN APPROVAL REQUIRED]                                │
│  └─ Checkpoint: brainstorm complete                          │
│          │                                                   │
│          ▼                                                   │
│  Phase 2: DESIGN (Day 1, Hour 2)                             │
│  ├─ Architect creates technical design                       │
│  ├─ [HUMAN APPROVAL REQUIRED]                                │
│  └─ Checkpoint: design complete                              │
│          │                                                   │
│          ▼                                                   │
│  Phase 3: PLAN FEATURES (Day 1, Hour 3)                      │
│  ├─ PM breaks epic into 5 features                           │
│  └─ Checkpoint: features defined                             │
│          │                                                   │
│          ▼                                                   │
│  Phase 4: IMPLEMENT FEATURES (Day 1-2)                       │
│  ┌──────────────────────────────────────┐                   │
│  │  For each feature (sequential):      │                   │
│  │  ├─ Create branch from previous      │                   │
│  │  ├─ Run feature.yaml workflow        │                   │
│  │  ├─ Checkpoint after each feature    │                   │
│  │  └─ [Crash recovery possible]        │                   │
│  └──────────────────────────────────────┘                   │
│          │                                                   │
│          ▼                                                   │
│  Phase 5: INTEGRATION TEST (Day 2)                           │
│  ├─ Tester validates all features together                   │
│  └─ Output: Epic complete                                    │
│                                                              │
│  Duration: ~8 hours (spread over 2 days)                     │
│  Agents: 5+ (architect, pm, developer, tester, etc.)         │
│  Checkpoints: 10+ (full crash recovery)                      │
└─────────────────────────────────────────────────────────────┘
```

### Use Case 5: Security Analysis

```
User: agentic analysis "Auth module security review" \
        --agents security-researcher pentester appsec-developer \
        --inputs "src/auth/**" "docs/architecture.md" \
        --human-in-loop

┌─────────────────────────────────────────────────────────────┐
│                   ANALYSIS WORKFLOW                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Load inputs                                              │
│     ├─ Codebase: src/auth/**/*.ts (45 files)                │
│     ├─ Documentation: docs/architecture.md                  │
│     └─ External: OWASP Top 10 reference                     │
│          │                                                   │
│          ▼                                                   │
│  2. THREAT MODELING (security-researcher:claude)            │
│     ├─ Analyze attack surface                               │
│     ├─ Identify threat vectors                              │
│     └─ Checkpoint saved                                     │
│          │                                                   │
│          ▼                                                   │
│  3. VULNERABILITY SCAN (pentester:claude)                   │
│     ├─ Review code for vulnerabilities                      │
│     ├─ Map to CWE/CVE references                            │
│     └─ Output: vulnerability-report.md                      │
│          │                                                   │
│          ▼                                                   │
│  4. REMEDIATION PLAN (appsec-developer:cursor)              │
│     ├─ Create fix recommendations                           │
│     ├─ Prioritize by severity                               │
│     └─ Output: remediation-tasks.md                         │
│          │                                                   │
│          ▼                                                   │
│  5. REVIEW MEETING (all 3 agents)                           │
│     ├─ Discuss findings and priorities                      │
│     ├─ [HUMAN DECIDES FINAL PRIORITIES]                     │
│     └─ Output: security-report.md                           │
│                                                              │
│  Duration: ~20 minutes                                       │
│  Agents: 3 (security-researcher, pentester, appsec-dev)     │
│  Inputs: codebase + docs + external references              │
└─────────────────────────────────────────────────────────────┘
```

### Use Case 6: Pentest Planning

```
User: agentic run analysis.yaml \
        --var target_url="https://example.com" \
        --var scope_document="scope.md" \
        --human-in-loop

┌─────────────────────────────────────────────────────────────┐
│                  PENTEST PLANNING WORKFLOW                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Load scope and target information                        │
│     ├─ Target: https://example.com                          │
│     └─ Scope: Defined rules of engagement                   │
│          │                                                   │
│          ▼                                                   │
│  2. RECONNAISSANCE (security-researcher:claude)             │
│     ├─ Passive information gathering                        │
│     ├─ Technology stack identification                      │
│     ├─ Attack surface mapping                               │
│     └─ Output: recon-report.md                              │
│          │                                                   │
│          ▼                                                   │
│  3. ATTACK PLANNING (pentester:claude)                      │
│     ├─ Develop attack methodology                           │
│     ├─ Identify potential entry points                      │
│     ├─ Plan exploitation techniques                         │
│     └─ Output: attack-plan.md                               │
│          │                                                   │
│          ▼                                                   │
│  4. METHODOLOGY REVIEW (meeting: both agents)               │
│     ├─ Review and refine approach                           │
│     ├─ [HUMAN APPROVAL REQUIRED]                            │
│     └─ Output: pentest-plan.md                              │
│                                                              │
│  Duration: ~15 minutes                                       │
│  Agents: 2 (security-researcher, pentester)                 │
│  Output: Complete pentest methodology document              │
└─────────────────────────────────────────────────────────────┘
```

---

## Plugin Structure

The agentic-core plugin will be located in `plugins/agentic-core/`:

```
plugins/agentic-core/
├── README.md                         # Plugin documentation
├── CHANGELOG.md                      # Version history
├── pyproject.toml                    # Python package config
│
├── docker/                           # Infrastructure
│   ├── docker-compose.yml
│   ├── init.sql
│   └── kafka-config/
│
├── src/agentic_core/                 # Python source
│   └── ...
│
├── workflows/                        # Built-in workflows
│   ├── one-shot.yaml
│   ├── feature.yaml
│   ├── epic.yaml
│   ├── meeting.yaml
│   └── analysis.yaml
│
├── personas/                         # Built-in agent personas
│   ├── developer.md
│   ├── architect.md
│   ├── tester.md
│   ├── planner.md
│   ├── facilitator.md
│   ├── security-researcher.md
│   ├── pentester.md
│   └── appsec-developer.md
│
├── templates/                        # Output templates
│   ├── pr-description.md
│   ├── feature-summary.md
│   ├── epic-summary.md
│   ├── security-report.md
│   ├── remediation-tasks.md
│   └── pentest-plan.md
│
└── skills/                           # Claude Code skills
    ├── run.md                        # /agentic-core:run
    ├── one-shot.md                   # /agentic-core:one-shot
    ├── meeting.md                    # /agentic-core:meeting
    └── analysis.md                   # /agentic-core:analysis
```

---

## Future Enhancements

### Phase 1 (Current)

- [x] Core architecture design
- [x] Analysis workflow type with multi-input support
- [x] Security agent personas (security-researcher, pentester, appsec-developer)
- [ ] CLI provider abstraction (Claude, Cursor)
- [ ] Kafka messaging layer
- [ ] PostgreSQL + pgvector storage
- [ ] YAML workflow parser
- [ ] Basic workflow execution (sequential steps)
- [ ] Checkpoint/recovery system
- [ ] CLI interface

**Design Decision**: Phase 1 implements sequential step execution only. The architecture uses a step dependency graph (`conditions.requires`) that naturally supports parallel execution in Phase 2 without structural changes.

### Phase 2

- [ ] Additional providers (Codex, Copilot)
- [ ] Meeting orchestration integration
- [ ] Advanced memory search (RAG)
- [ ] Learning extraction from workflows
- [ ] **Parallel step execution** (execute independent steps concurrently based on dependency graph)

### Phase 3

- [ ] Web dashboard for monitoring
- [ ] Distributed execution (multi-machine)
- [ ] Workflow marketplace
- [ ] Custom provider SDK
- [ ] Integration with CI/CD pipelines

---

## Summary

Agentic Core provides a **production-ready foundation** for AI agent orchestration:

| Component           | Technology                           | Purpose                                     |
| ------------------- | ------------------------------------ | ------------------------------------------- |
| **Messaging**       | Kafka                                | Decoupled agent communication, event replay |
| **Storage**         | PostgreSQL + pgvector                | State, checkpoints, semantic memory         |
| **CLI Abstraction** | Python providers                     | Support Claude, Cursor, Codex, Copilot      |
| **Workflow Engine** | YAML + Python                        | Declarative workflow definition             |
| **Recovery**        | Kafka offsets + Postgres checkpoints | Full crash recovery                         |
| **Learning**        | pgvector embeddings                  | Semantic search over past experiences       |
| **CLI**             | uv tool                              | `agentic run`, `agentic one-shot`, etc.     |

This framework enables workflows ranging from 5-minute bugfixes to multi-day epic implementations to security analysis sessions, all with full observability, crash recovery, and continuous learning.

**Workflow Types**:
- `one-shot`: Quick single-agent tasks
- `feature`: Multi-step feature development
- `epic`: Multi-day, multi-feature projects
- `meeting`: Collaborative agent discussions
- `analysis`: Multi-agent analysis with diverse inputs (code, docs, videos, web)
