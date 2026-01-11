# Agentic Core

Foundational framework for AI agent orchestration - from 5-minute one-shot tasks to multi-day epic implementations. Built on Kafka, PostgreSQL, and a provider-agnostic CLI abstraction layer.

## Purpose

Agentic Core provides infrastructure for running AI agent workflows using consumer CLI subscriptions (Claude Max, Cursor Pro) without requiring API keys. It abstracts:

- Agent communication via Kafka message bus
- Persistent memory via PostgreSQL + pgvector
- CLI provider differences via unified abstraction layer
- Workflow orchestration via declarative YAML definitions
- State recovery via checkpoints and event replay

## Design Principles

| Principle            | Description                                              |
| -------------------- | -------------------------------------------------------- |
| Provider Agnostic    | Support Claude, Cursor, Codex, Copilot CLIs              |
| Workflow Flexibility | From 1-minute one-shots to multi-day epics               |
| Human-in-the-Loop    | Fully autonomous or with human checkpoints               |
| Observable           | Every message, decision, state change logged             |
| Recoverable          | Crash recovery via Kafka replay + PostgreSQL checkpoints |
| Self-Learning        | Semantic memory accumulates knowledge across workflows   |

## Architecture

**Data Flow**: User CLI -> Python Orchestrator -> CLI Provider Abstraction -> AI CLI Sessions (claude/cursor)

**Communication**: AI Sessions <-> Kafka Message Bus (workflow.events, agent.messages, control.signals, human.input)

**Persistence**: PostgreSQL stores workflows, step_outputs, agents, agent_sessions, checkpoints, messages, memory, telemetry

## Infrastructure (Docker Compose)

| Service    | Image                      | Port | Purpose                             |
| ---------- | -------------------------- | ---- | ----------------------------------- |
| Kafka      | apache/kafka:4.1.1 (KRaft) | 9094 | Message bus, infinite retention     |
| Kafka UI   | provectuslabs/kafka-ui     | 8080 | Debug interface                     |
| PostgreSQL | pgvector/pgvector:pg16     | 5432 | State, checkpoints, semantic memory |
| Redis      | redis:7-alpine             | 6379 | Future caching                      |

**Environment Variables**:

```bash
AGENTIC_DATABASE_URL=postgresql://agentic:agentic@localhost:5432/agentic
AGENTIC_KAFKA_URL=localhost:9094
AGENTIC_ENABLE_MEMORY=false
AGENTIC_LOG_LEVEL=INFO
```

## CLI Provider Abstraction

Unified interface supporting multiple AI CLIs with standardized result handling.

| Provider | CLI               | Session Resume | JSON Output | Tool Restrictions | Status    |
| -------- | ----------------- | -------------- | ----------- | ----------------- | --------- |
| Claude   | `claude -p`       | Yes            | Yes         | Yes               | Supported |
| Cursor   | `cursor-agent -p` | Yes            | Yes         | No                | Supported |
| Mock     | internal          | N/A            | Yes         | N/A               | Testing   |
| Codex    | `codex`           | TBD            | TBD         | TBD               | Planned   |
| Copilot  | `gh copilot`      | No             | TBD         | TBD               | Planned   |

**Provider Interface**:

- `build_command()` -> Build CLI command with prompt, system prompt, session ID, model, tools
- `parse_output()` -> Parse stdout/stderr into standardized InvocationResult
- `invoke()` -> Execute command and return result with content, session_id, tokens, duration
- `health_check()` -> Verify CLI availability

## Workflow Types

| Type     | Duration  | Use Case                                           |
| -------- | --------- | -------------------------------------------------- |
| one-shot | ~5 min    | Quick bugfixes, single tasks                       |
| feature  | ~30 min   | Multi-step feature development                     |
| epic     | Multi-day | Large projects with crash recovery                 |
| meeting  | ~15 min   | Multi-agent collaborative discussions              |
| analysis | ~20 min   | Security/architecture analysis with diverse inputs |

## Workflow Definition (YAML)

```yaml
name: feature-development
type: feature
version: "1.0"

settings:
  human_in_loop: false
  max_retries: 3
  timeout_minutes: 60
  git:
    enabled: true
    branch_prefix: "feature/"
    auto_commit: true
    auto_pr: false

agents:
  - name: developer
    provider: claude
    model: sonnet
    persona_file: personas/developer.md

inputs:
  - name: codebase
    type: codebase
    source: "src/**/*.ts"

steps:
  - name: plan
    agent: planner
    task:
      description: "Create implementation plan for: {{ feature_description }}"
    checkpoint: true

  - name: implement
    agent: developer
    task:
      description: "Implement the feature"
      context: ["{{ outputs.plan }}"]
    conditions:
      requires: [plan]
    checkpoint: true

outputs:
  - name: summary
    type: file
    path: docs/features/{{ feature_name }}.md
    template: templates/feature-summary.md
```

## CLI Commands

```bash
# Infrastructure
agentic infra up|down|status|logs|topics

# Workflow Execution
agentic run workflow.yaml [--var key=value] [--dry-run] [--from-step step] [--worktree]
agentic one-shot "task description" [--git] [--pr] [--worktree]
agentic meeting "topic" --agents architect,developer [--rounds 5] [--interactive]

# Workflow Management
agentic list|status|resume|cancel|logs <workflow-id>

# Memory (requires pgvector)
agentic memory search "query" [--category lesson]
agentic memory add <category> "content"
agentic memory list [--category lesson]

# Providers & Agents
agentic providers list|test <provider>
agentic agents list|test <agent> "prompt"
```

## Use Case Workflows

### One-Shot Bugfix

Create branch -> Load memories -> Invoke developer agent -> Commit -> Push + PR -> Extract learnings

### Feature Development

Plan (planner) -> Implement (developer) -> Validate (tester) -> Output PR

### Epic Development (Multi-Day)

Brainstorm meeting -> Design (architect) -> Break into features (PM) -> For each feature: run feature workflow -> Integration test -> Output epic summary

### Multi-Agent Meeting

Start Kafka bus -> Initialize agent sessions -> Facilitator orchestrates rounds -> Each agent responds via Kafka -> Generate summary + decisions -> Store in memory

### Security Analysis

Load inputs (codebase, OWASP, docs) -> Threat modeling (security-researcher) -> Vulnerability scan (pentester) -> Remediation plan (appsec-developer) -> Review meeting (all agents) -> Output security report

## Memory System

Categories: lesson, pattern, error, decision, context

**Storage**: PostgreSQL with pgvector for semantic search (all-MiniLM-L6-v2, 384 dimensions by default)

**Learning extraction**: On-demand via `agentic memory extract <workflow-id>` or `extract_learnings: true` in workflow settings

## State Management & Recovery

**Checkpoints**: Created after every step, stored in PostgreSQL with Kafka offset reference

**Recovery Flow**: Load latest checkpoint -> Get Kafka offset -> Replay messages since offset -> Rebuild state -> Resume from last completed step

## Database Schema

| Table          | Purpose                                             |
| -------------- | --------------------------------------------------- |
| workflows      | Workflow instances, status, config                  |
| step_outputs   | Step results (small inline, large as file pointers) |
| agents         | Registered agent definitions                        |
| agent_sessions | CLI session IDs for --resume                        |
| checkpoints    | Recovery checkpoints with Kafka offsets             |
| messages       | Mirror of Kafka for queries                         |
| memory         | Long-term semantic memory (pgvector)                |
| telemetry      | Performance and audit logging                       |

## Kafka Topics

| Topic            | Purpose                      | Retention |
| ---------------- | ---------------------------- | --------- |
| workflow.events  | Workflow lifecycle events    | Infinite  |
| agent.messages   | Agent-to-agent communication | Infinite  |
| control.signals  | Orchestrator commands        | 7 days    |
| human.input      | Human-in-the-loop responses  | 7 days    |
| telemetry.events | Performance/audit events     | 30 days   |

## Package Structure

```
plugins/agentic-core/
  pyproject.toml          # Python 3.12+, typer, asyncpg, confluent-kafka, pydantic
  docker/
    docker-compose.yml
    init.sql
  src/agentic_core/
    cli.py                # CLI entry point (agentic command)
    runner.py             # Claude execution wrapper
    providers/            # Claude, Cursor, Mock providers
    workflow/             # Parser, executor, models, templates
    messaging/            # Kafka client, topics, schemas
    storage/              # PostgreSQL client
    memory/               # Manager, embeddings, learning extraction
    agents/               # Session, pool management
    meetings/             # Orchestrator, state, facilitator, documents
    checkpoints/          # Recovery system
    git/                  # Worktree, operations
    inputs/               # File, codebase, URL processors
    outputs/              # Output handlers
  workflows/              # Built-in: one-shot, feature, meeting, analysis
  personas/               # Built-in: developer, architect, planner, tester, facilitator, security-researcher, pentester
  templates/              # pr-description, feature-summary, meeting-summary, security-report
  tests/
```

## Installation

```bash
# Install as uv tool
uv tool install plugins/agentic-core

# With memory support
uv tool install "plugins/agentic-core[memory]"
```

## Technical Decisions

| Decision            | Choice                        | Rationale                             |
| ------------------- | ----------------------------- | ------------------------------------- |
| Python Version      | 3.12+                         | Modern async support                  |
| Async Framework     | asyncio + asyncpg             | Native async throughout               |
| CLI Framework       | typer                         | Type-hinted, modern                   |
| YAML Parser         | ruamel.yaml                   | Preserves comments                    |
| Template Engine     | Jinja2                        | `{{ variable }}` resolution           |
| Embedding           | sentence-transformers (local) | No external API required              |
| Memory Context      | 1-2k tokens                   | Prefer fewer, higher-quality memories |
| Step Execution      | Sequential (Phase 1)          | Parallel in Phase 2                   |
| Git Operations      | Shell out to git              | Simple, portable                      |
| Meeting Facilitator | Python orchestrator           | Deterministic, auditable              |

## Future Enhancements

**Phase 2**: Additional providers (Codex, Copilot), parallel step execution, advanced RAG, learning extraction

**Phase 3**: Web dashboard, distributed execution, CI/CD integration, workflow marketplace
