# Agentic Core Implementation Plan

A detailed implementation plan for building the Agentic Core framework - a foundational infrastructure for orchestrating AI agents across diverse workflows.

---

## Table of Contents

1. [Overview](#overview)
2. [Technical Stack](#technical-stack)
3. [Implementation Phases](#implementation-phases)
4. [Milestone 1: Project Foundation](#milestone-1-project-foundation)
5. [Milestone 2: Infrastructure Layer](#milestone-2-infrastructure-layer)
6. [Milestone 3: CLI Provider Abstraction](#milestone-3-cli-provider-abstraction)
7. [Milestone 4: Workflow Engine Core](#milestone-4-workflow-engine-core)
8. [Milestone 5: Step Execution and Outputs](#milestone-5-step-execution-and-outputs)
9. [Milestone 6: Memory System](#milestone-6-memory-system)
10. [Milestone 7: Meeting Orchestration](#milestone-7-meeting-orchestration)
11. [Milestone 8: CLI Interface](#milestone-8-cli-interface)
12. [Milestone 9: Testing and Validation](#milestone-9-testing-and-validation)
13. [Validation Criteria](#validation-criteria)
14. [Risk Assessment](#risk-assessment)

---

## Overview

### Goals

Build a production-ready framework that enables:

- **One-shot tasks**: Quick bugfixes in ~5 minutes
- **Feature development**: Multi-step workflows in ~30 minutes
- **Epic implementations**: Multi-day projects with crash recovery
- **Analysis sessions**: Multi-agent collaboration on security, architecture, etc.
- **Meetings**: AI-facilitated discussions with optional human participation

### Key Capabilities

| Capability           | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| Provider Agnostic    | Support Claude, Cursor, Codex, Copilot CLIs                 |
| Workflow Flexibility | Declarative YAML workflows from one-shot to multi-day epics |
| Crash Recovery       | Kafka replay + PostgreSQL checkpoints for full recovery     |
| Human-in-the-Loop    | Optional human approval at any checkpoint                   |
| Long-term Memory     | Semantic search over past learnings (optional pgvector)     |
| Full Observability   | Every message, decision, and state change logged            |

### Dependencies

```
Agentic Core (this plan)
    ├── Kafka (messaging)
    ├── PostgreSQL (storage)
    ├── sentence-transformers (embeddings, optional)
    └── AI CLIs (claude, cursor-agent, etc.)
```

---

## Technical Stack

### Core Technologies

| Component       | Technology                    | Version |
| --------------- | ----------------------------- | ------- |
| Python          | Python                        | 3.14+   |
| Async Runtime   | asyncio + asyncpg             | Latest  |
| Message Bus     | Apache Kafka (KRaft mode)     | 3.6+    |
| Kafka Client    | confluent-kafka-python        | Latest  |
| Database        | PostgreSQL                    | 16+     |
| Vector Search   | pgvector (optional)           | Latest  |
| CLI Framework   | typer                         | Latest  |
| YAML Parser     | ruamel.yaml                   | Latest  |
| Template Engine | Jinja2                        | Latest  |
| Embeddings      | sentence-transformers (local) | Latest  |

### Development Tools

| Tool           | Purpose                |
| -------------- | ---------------------- |
| uv             | Package management     |
| pytest         | Testing framework      |
| pytest-asyncio | Async test support     |
| Docker Compose | Local infrastructure   |
| ruff           | Linting and formatting |

### Environment Variables

```bash
# Required
AGENTIC_DATABASE_URL=postgresql://agentic:agentic@localhost:5432/agentic
AGENTIC_KAFKA_URL=localhost:9094

# Optional
AGENTIC_WORKING_DIR=/path/to/working/directory
AGENTIC_ENABLE_MEMORY=false  # Enable pgvector semantic memory
AGENTIC_LOG_LEVEL=INFO
```

---

## Implementation Phases

```
Phase 1 (This Plan)
├── Milestone 1: Project Foundation
├── Milestone 2: Infrastructure Layer
├── Milestone 3: CLI Provider Abstraction
├── Milestone 4: Workflow Engine Core
├── Milestone 5: Step Execution and Outputs
├── Milestone 6: Memory System (optional pgvector)
├── Milestone 7: Meeting Orchestration
├── Milestone 8: CLI Interface
└── Milestone 9: Testing and Validation

Phase 2 (Future)
├── Additional providers (Codex, Copilot)
├── Parallel step execution
├── Advanced RAG for codebase inputs
└── Learning extraction from workflows

Phase 3 (Future)
├── Web dashboard
├── Distributed execution
└── CI/CD integration
```

---

## Milestone 1: Project Foundation

**Goal**: Set up project structure, dependencies, and development environment.

### Tasks

#### 1.1 Create Python Package Structure

Create the plugin directory structure:

```
plugins/agentic-core/
├── pyproject.toml
├── README.md
├── docker/
│   ├── docker-compose.yml
│   └── init.sql
├── src/
│   └── agentic_core/
│       ├── __init__.py
│       └── cli.py
├── workflows/
├── personas/
├── templates/
└── tests/
    └── __init__.py
```

#### 1.2 Configure pyproject.toml

```toml
[project]
name = "agentic-core"
version = "0.1.0"
description = "Foundational framework for AI agent orchestration"
requires-python = ">=3.12"
dependencies = [
    "typer>=0.9.0",
    "ruamel.yaml>=0.18.0",
    "jinja2>=3.1.0",
    "asyncpg>=0.29.0",
    "confluent-kafka>=2.3.0",
    "rich>=13.0.0",
]

[project.optional-dependencies]
memory = [
    "sentence-transformers>=2.2.0",
    "numpy>=1.26.0",
]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
    "ruff>=0.1.0",
]

[project.scripts]
agentic = "agentic_core.cli:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

#### 1.3 Create Basic CLI Entry Point

```python
# src/agentic_core/cli.py
import typer

app = typer.Typer(
    name="agentic",
    help="Agentic Core - AI agent orchestration framework"
)

@app.command()
def version():
    """Show version information."""
    typer.echo("agentic-core v0.1.0")

if __name__ == "__main__":
    app()
```

#### 1.4 Set Up Development Environment

- Configure ruff for linting
- Set up pytest with asyncio support
- Create `.env.example` with required environment variables

### Validation

- [ ] `uv build` succeeds
- [ ] `uv tool install .` installs the CLI
- [ ] `agentic version` outputs version string
- [ ] `pytest` runs (empty test suite passes)

---

## Milestone 2: Infrastructure Layer

**Goal**: Set up Docker infrastructure and database connectivity.

### Tasks

#### 2.1 Create Docker Compose Configuration

Create `docker/docker-compose.yml` with:

- **Kafka** (KRaft mode, no Zookeeper)
- **Kafka UI** for debugging
- **PostgreSQL 16** with pgvector extension
- **Redis** (optional, for future caching)

Key settings:

- Kafka infinite retention for replay
- PostgreSQL with pgvector extension
- All data persisted in named volumes

#### 2.2 Create Database Schema

Create `docker/init.sql` with tables:

| Table              | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `workflows`        | Workflow instances and status             |
| `step_outputs`     | Canonical step output storage             |
| `agents`           | Registered agent definitions              |
| `agent_sessions`   | CLI session IDs for --resume              |
| `checkpoints`      | Recovery checkpoints with Kafka offsets   |
| `messages`         | Message log (mirror of Kafka for queries) |
| `embedding_models` | Configurable embedding dimensions         |
| `memory`           | Long-term semantic memory (pgvector)      |
| `telemetry`        | Performance and audit logging             |

Key design decisions:

- `memory.embedding` uses max dimension (1536) with actual size in metadata
- `step_outputs` stores small outputs inline, large outputs as file pointers
- All tables have proper indexes for performance

#### 2.3 Create Database Client Module

Create `src/agentic_core/storage/database.py`:

```python
# Async connection pool management
# Transaction helpers
# Query builders for common operations
```

Key functions:

- `create_pool()` - Initialize asyncpg connection pool
- `get_workflow()` - Fetch workflow by ID
- `save_step_output()` - Store step results
- `create_checkpoint()` - Save checkpoint with Kafka offset
- `get_latest_checkpoint()` - Retrieve for recovery

#### 2.4 Create Kafka Client Module

Create `src/agentic_core/messaging/client.py`:

```python
# Kafka producer/consumer abstraction
# Topic management
# Message serialization
```

Topics:

| Topic              | Purpose                      | Retention |
| ------------------ | ---------------------------- | --------- |
| `workflow.events`  | Workflow lifecycle events    | Infinite  |
| `agent.messages`   | Agent-to-agent communication | Infinite  |
| `control.signals`  | Orchestrator commands        | 7 days    |
| `human.input`      | Human-in-the-loop responses  | 7 days    |
| `telemetry.events` | Performance and audit events | 30 days   |

#### 2.5 Create Infrastructure CLI Commands

Add to CLI:

- `agentic infra up` - Start Docker Compose
- `agentic infra down` - Stop infrastructure
- `agentic infra status` - Show service status
- `agentic infra logs` - Tail logs

### Validation

- [ ] `agentic infra up` starts all services
- [ ] PostgreSQL is accessible and schema is created
- [ ] Kafka is running and topics are auto-created
- [ ] Kafka UI is accessible at <http://localhost:8080>
- [ ] `agentic infra status` shows healthy services

---

## Milestone 3: CLI Provider Abstraction

**Goal**: Create abstraction layer for multiple AI CLI providers.

### Tasks

#### 3.1 Define Provider Interface

Create `src/agentic_core/providers/base.py`:

```python
@dataclass
class ProviderCapabilities:
    session_resume: bool = False
    json_output: bool = False
    tool_restrictions: bool = False
    system_prompt: bool = True
    model_selection: bool = True

@dataclass
class InvocationResult:
    content: str
    session_id: Optional[str] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    duration_ms: Optional[int] = None
    raw_output: str = ""
    is_error: bool = False
    error_message: str = ""

class CLIProvider(ABC):
    name: str
    capabilities: ProviderCapabilities

    @abstractmethod
    def build_command(...) -> List[str]: ...

    @abstractmethod
    def parse_output(...) -> InvocationResult: ...

    def invoke(...) -> InvocationResult: ...
```

#### 3.2 Implement Claude Provider

Create `src/agentic_core/providers/claude.py`:

Full implementation including:

- Command building with all supported flags
- JSON output parsing (see Technical Decisions for format)
- Session ID extraction for `--resume`
- Token usage extraction
- Error handling

Supported flags:

- `-p` / `--prompt` - Main prompt
- `--output-format json` - Structured output
- `--append-system-prompt` - System prompt injection
- `--resume` - Session resumption
- `--model` - Model selection
- `--allowedTools` - Tool restrictions

#### 3.3 Implement Cursor Provider

Create `src/agentic_core/providers/cursor.py`:

Implementation for `cursor-agent` CLI:

- Similar structure to Claude
- Handle differences in flag syntax
- System prompt embedding (if no native flag)

#### 3.4 Create Mock Provider for Testing

Create `src/agentic_core/providers/mock.py`:

- Deterministic responses based on prompt patterns
- Configurable latency
- Error simulation
- Essential for CI/CD testing

#### 3.5 Create Provider Registry

Create `src/agentic_core/providers/__init__.py`:

```python
PROVIDERS: Dict[str, Type[CLIProvider]] = {}

def register_provider(name: str): ...
def get_provider(name: str) -> CLIProvider: ...
def list_providers() -> list[str]: ...
```

#### 3.6 Add Provider CLI Commands

Add to CLI:

- `agentic providers list` - Show available providers
- `agentic providers test <provider>` - Test provider connectivity

### Validation

- [ ] Claude provider builds correct CLI commands
- [ ] Claude provider parses JSON output correctly
- [ ] Claude provider extracts session_id for resume
- [ ] Cursor provider builds correct CLI commands
- [ ] Mock provider returns deterministic responses
- [ ] `agentic providers list` shows all registered providers
- [ ] `agentic providers test claude` succeeds (with real Claude CLI)

---

## Milestone 4: Workflow Engine Core

**Goal**: Build YAML workflow parser and execution engine.

### Tasks

#### 4.1 Define Workflow Schema

Create Pydantic models for workflow validation:

```python
# src/agentic_core/workflow/models.py

class WorkflowType(Enum):
    ONE_SHOT = "one-shot"
    FEATURE = "feature"
    EPIC = "epic"
    MEETING = "meeting"
    ANALYSIS = "analysis"
    CUSTOM = "custom"

@dataclass
class WorkflowSettings:
    human_in_loop: bool = False
    max_retries: int = 3
    timeout_minutes: int = 60
    working_dir: Optional[str] = None
    git: Optional[GitSettings] = None

@dataclass
class AgentDefinition:
    name: str
    provider: str = "claude"
    model: str = "sonnet"
    persona: Optional[str] = None
    tools: List[str] = field(default_factory=list)

@dataclass
class StepDefinition:
    name: str
    agent: str
    task: TaskDefinition
    conditions: Optional[StepConditions] = None
    checkpoint: bool = False
    human_approval: bool = False
    on_failure: str = "pause"
    timeout_minutes: Optional[int] = None

@dataclass
class WorkflowDefinition:
    name: str
    type: WorkflowType
    version: str = "1.0"
    settings: WorkflowSettings
    agents: List[AgentDefinition]
    inputs: List[InputDefinition] = field(default_factory=list)
    steps: List[StepDefinition]
    outputs: List[OutputDefinition] = field(default_factory=list)
```

#### 4.2 Create YAML Parser

Create `src/agentic_core/workflow/parser.py`:

- Parse YAML with ruamel.yaml (preserves comments)
- Validate against schema
- Resolve file references (persona files, templates)
- Support `{{ variable }}` placeholders (mark for later resolution)

#### 4.3 Create Template Resolver

Create `src/agentic_core/workflow/templates.py`:

Jinja2-based template resolution:

- `{{ variable }}` - From CLI arguments
- `{{ outputs.step_name }}` - Previous step outputs
- `{{ git.diff }}` - Git diff output
- `{{ inputs.name }}` - Input references

#### 4.4 Create Workflow Executor

Create `src/agentic_core/workflow/executor.py`:

```python
class WorkflowExecutor:
    async def run(self, workflow: WorkflowDefinition, variables: dict) -> WorkflowResult:
        # 1. Initialize workflow in database
        # 2. Process inputs
        # 3. Execute steps sequentially
        # 4. Handle checkpoints
        # 5. Generate outputs
        # 6. Return result
```

Key behaviors:

- Sequential step execution (parallel in Phase 2)
- Checkpoint after every step
- Named checkpoints when `checkpoint: true`
- Handle `conditions.requires` dependencies

#### 4.5 Create Step Executor

Create `src/agentic_core/workflow/step_executor.py`:

For each step:

1. Resolve template variables
2. Build agent prompt with context
3. Inject relevant memories (if enabled)
4. Invoke agent via provider
5. Parse and store output
6. Create checkpoint
7. Handle errors with retry logic

### Validation

- [ ] YAML parser loads valid workflow files
- [ ] Parser rejects invalid workflows with clear errors
- [ ] Template resolver handles all placeholder types
- [ ] Executor runs simple 2-step workflow
- [ ] Checkpoints are created after each step
- [ ] Step dependencies are respected

---

## Milestone 5: Step Execution and Outputs

**Goal**: Complete step execution with input processing, git integration, and output handling.

### Tasks

#### 5.1 Implement Input Processors

Create `src/agentic_core/inputs/`:

| Processor      | Implementation                                   |
| -------------- | ------------------------------------------------ |
| `file`         | Read file contents directly                      |
| `codebase`     | Glob files, create RAG index, retrieve relevant  |
| `url`          | Fetch URL, extract readable text (html2text)     |
| `github_issue` | Fetch via `gh` CLI or GitHub API                 |
| `video`        | Stub for Phase 2 (audio extraction + transcribe) |

RAG implementation for codebase:

- Chunk files into ~500 token segments
- Generate embeddings with sentence-transformers
- Store in temporary vector index
- Retrieve top-k relevant chunks per query

#### 5.2 Implement Git Integration

Create `src/agentic_core/git/`:

```python
async def get_diff(working_dir: Path) -> str: ...
async def create_branch(name: str, working_dir: Path) -> None: ...
async def commit(message: str, working_dir: Path) -> str: ...
async def push(working_dir: Path) -> None: ...
async def create_pr(title: str, body: str, working_dir: Path) -> str: ...
```

All operations shell out to git commands.

#### 5.3 Implement Output Handling

Create `src/agentic_core/outputs/`:

Step output storage strategy:

1. Small outputs (<10KB): Store in PostgreSQL `step_outputs.content`
2. Large outputs: Write to temp file, store path + SHA256 hash in database

Output processors:

- `file` - Write to specified path
- `message` - Log to console/Kafka
- `artifact` - Store in outputs directory

#### 5.4 Implement Retry Logic

Create `src/agentic_core/workflow/retry.py`:

```python
class RetryStrategy:
    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 60.0
    jitter: bool = True

    async def execute_with_retry(self, fn, *args, **kwargs): ...
```

Behaviors by `on_failure`:

- `retry` - Exponential backoff with jitter
- `skip` - Log warning, continue to next step
- `abort` - Fail workflow immediately
- `pause` - Create checkpoint, wait for human

#### 5.5 Implement Checkpoint Recovery

Create `src/agentic_core/checkpoints/`:

Recovery flow:

1. Load latest checkpoint from PostgreSQL
2. Get Kafka offset from checkpoint
3. Replay messages since offset
4. Rebuild workflow state
5. Resume from last completed step

### Validation

- [ ] File input reads content correctly
- [ ] Codebase input retrieves relevant chunks
- [ ] URL input extracts readable text
- [ ] Git diff is captured correctly
- [ ] Branch creation and commits work
- [ ] Large outputs stored as files with hashes
- [ ] Retry logic respects exponential backoff
- [ ] Workflow resumes from checkpoint after crash

---

## Milestone 6: Memory System

**Goal**: Implement optional long-term semantic memory with pgvector.

### Tasks

#### 6.1 Create Memory Manager

Create `src/agentic_core/memory/manager.py`:

```python
class MemoryManager:
    def __init__(self, db, embedding_provider: str = "local", enabled: bool = False):
        self.enabled = enabled
        # ...

    async def store(self, category: str, content: str, metadata: dict = None) -> MemoryEntry: ...
    async def search(self, query: str, category: str = None, limit: int = 5) -> List[MemoryEntry]: ...
    async def get_relevant_context(self, task: str, budget_tokens: int = 2000) -> str: ...
```

Memory categories:

- `lesson` - Learned from past mistakes
- `pattern` - Successful approaches to reuse
- `error` - Common errors and solutions
- `decision` - Architectural decisions
- `context` - Project-specific knowledge

#### 6.2 Create Embedding Provider

Create `src/agentic_core/memory/embeddings.py`:

Local embedding with sentence-transformers:

- Default model: `all-MiniLM-L6-v2` (384 dimensions)
- Configurable model via `embedding_models` table
- Store embedding dimension in metadata

#### 6.3 Create Learning Extractor

Create `src/agentic_core/memory/learning.py`:

On-demand learning extraction:

- Analyze workflow messages and telemetry
- Use agent to extract lessons, patterns, errors
- Store in memory with workflow reference

Not enabled by default - invoked via:

- `agentic memory extract <workflow-id>`
- Workflow setting `extract_learnings: true`

#### 6.4 Add Memory CLI Commands

Add to CLI:

- `agentic memory search "<query>"` - Search memories
- `agentic memory list --category lesson` - List by category
- `agentic memory add lesson "content"` - Add manually
- `agentic memory extract <workflow-id>` - Extract learnings
- `agentic memory export` - Export all memories

#### 6.5 Integrate Memory into Step Execution

Modify step executor to:

1. Check if memory is enabled
2. Search for relevant memories (budget: 1-2k tokens)
3. Format as context section in prompt
4. Inject before task description

### Validation

- [ ] Memory storage with embeddings works
- [ ] Semantic search returns relevant results
- [ ] Memory context injection respects token budget
- [ ] Learning extraction produces meaningful lessons
- [ ] CLI commands function correctly
- [ ] Memory features disabled when `AGENTIC_ENABLE_MEMORY=false`

---

## Milestone 7: Meeting Orchestration

**Goal**: Implement multi-agent meeting support with Kafka messaging.

### Tasks

#### 7.1 Create Agent Session Manager

Create `src/agentic_core/agents/session.py`:

```python
@dataclass
class AgentSession:
    config: AgentConfig
    session_id: Optional[str] = None
    provider: CLIProvider = None

    async def invoke(self, prompt: str, conversation_history: str) -> str: ...
```

Features:

- Load persona from file
- Maintain session_id for --resume (if supported)
- Build prompt with conversation history

#### 7.2 Create Agent Pool

Create `src/agentic_core/agents/pool.py`:

```python
class AgentPool:
    def __init__(self, agents_dir: Path): ...
    def get_agent(self, name: str) -> AgentSession: ...
    def create_agent_with_provider(self, name: str, provider: str, ...) -> AgentSession: ...
```

Parse agent files from `.claude/agents/` or `personas/` directory.

#### 7.3 Create Meeting State

Create `src/agentic_core/meetings/state.py`:

```python
@dataclass
class MeetingState:
    config: MeetingConfig
    current_round: int = 0
    active_agents: List[str] = field(default_factory=list)
    transcript: List[MeetingMessage] = field(default_factory=list)
    decisions: List[str] = field(default_factory=list)
    action_items: List[str] = field(default_factory=list)
    is_complete: bool = False
    awaiting_user: bool = False
```

#### 7.4 Create Meeting Orchestrator

Create `src/agentic_core/meetings/orchestrator.py`:

Facilitator-directed flow:

1. **Opening**: State topic, set agenda, invite first speakers
2. **Discussion rounds**: Facilitator selects speakers, captures points
3. **Closing**: Summarize, list decisions, assign action items

Control signals:

- `[NEXT_SPEAKER: agent_name]` - Who speaks next
- `[ROUND_COMPLETE]` - End of round
- `[AWAIT_USER]` - Request human input (interactive mode)
- `[MEETING_END]` - Conclude meeting

Meeting termination (configurable):

- Fixed number of rounds
- Facilitator decides `[MEETING_END]`
- Consensus detection

#### 7.5 Create Facilitator Strategy

Create `src/agentic_core/meetings/facilitator.py`:

Python orchestrator with rules (deterministic):

- Topic analysis to select relevant agents
- Round management
- Turn-taking enforcement
- Decision/action item extraction

Optional: Load facilitator templates from `templates/facilitator/`:

- `default.md` - Balanced discussion
- `brainstorm.md` - Creative ideation
- `decision.md` - Structured decision-making

#### 7.6 Create Human-in-the-Loop Handler

Create `src/agentic_core/meetings/human.py`:

Two modes:

1. **Default (async)**: Pause + wait for `agentic resume --approve`
2. **Interactive**: CLI prompts for immediate input

User input types:

- Free-text messages
- Selection from suggested options
- Approval/rejection

#### 7.7 Create Document Generator

Create `src/agentic_core/meetings/documents.py`:

Generate outputs from templates:

- `meeting-summary.md` - Executive summary
- `decision-record.md` - ADR-style decisions
- `action-items.md` - Task list

Use facilitator agent to fill templates with meeting content.

### Validation

- [ ] Agents load from persona files
- [ ] Meeting runs with 2+ agents
- [ ] Facilitator controls turn-taking
- [ ] Messages published to Kafka
- [ ] Meeting transcript captured
- [ ] Decisions and action items extracted
- [ ] Human-in-the-loop pauses for approval
- [ ] Interactive mode accepts user input
- [ ] Document generation produces valid output

---

## Milestone 8: CLI Interface

**Goal**: Complete CLI with all user-facing commands.

### Tasks

#### 8.1 Implement Core Commands

```bash
# Workflow execution
agentic run workflow.yaml                    # Run workflow
agentic run workflow.yaml --var key=value    # With variables
agentic run workflow.yaml --dry-run          # Validate only
agentic run workflow.yaml --from-step plan   # Resume from step

# Quick commands
agentic one-shot "Fix the login bug"         # Quick one-shot
agentic feature "Add dark mode"              # Feature development
agentic meeting "Sprint planning"            # Start meeting
agentic analysis "Security review"           # Analysis session
```

#### 8.2 Implement Workflow Management Commands

```bash
agentic list                                 # List all workflows
agentic status <workflow-id>                 # Workflow status
agentic resume <workflow-id>                 # Resume paused workflow
agentic resume <workflow-id> --approve       # Resume with approval
agentic cancel <workflow-id>                 # Cancel running workflow
agentic logs <workflow-id>                   # Show workflow logs
```

#### 8.3 Implement Agent Management Commands

```bash
agentic agents list                          # List registered agents
agentic agents add persona.md                # Register new agent
agentic agents test developer "Hello"        # Test an agent
```

#### 8.4 Implement Dry-Run Mode

`--dry-run` behavior:

1. Parse and validate YAML
2. Resolve all template variables
3. Display execution plan (steps, agents, dependencies)
4. Show estimated tokens/cost if possible
5. No actual execution

`--dry-run --with-mocks` behavior:

1. All of the above
2. Execute with mock provider
3. Validate output handling
4. Test checkpoint creation

#### 8.5 Implement Progress Display

Use `rich` for:

- Step progress bars
- Agent output streaming
- Error highlighting
- Checkpoint indicators

### Validation

- [ ] All commands have `--help` documentation
- [ ] `agentic run` executes workflow correctly
- [ ] `agentic one-shot` creates and runs one-shot workflow
- [ ] `agentic resume` continues from checkpoint
- [ ] `--dry-run` validates without executing
- [ ] Progress display is informative
- [ ] Error messages are clear and actionable

---

## Milestone 9: Testing and Validation

**Goal**: Comprehensive test suite and end-to-end validation.

### Tasks

#### 9.1 Unit Tests

Test coverage for:

- YAML parser validation
- Template resolution
- Provider command building
- Provider output parsing
- Database operations
- Kafka message serialization
- Checkpoint creation/recovery
- Memory search (if enabled)

#### 9.2 Integration Tests

Test scenarios:

- One-shot workflow end-to-end (mock provider)
- Multi-step feature workflow
- Workflow with checkpoint recovery
- Meeting with 2 agents
- Human-in-the-loop approval flow

#### 9.3 Provider Integration Tests

Separate test suite (requires real CLIs):

- Claude provider with real `claude` CLI
- Cursor provider with real `cursor-agent` CLI

Mark as `@pytest.mark.integration` for selective runs.

#### 9.4 Create Built-in Workflow Templates

Create `workflows/`:

- `one-shot.yaml` - Single-agent quick task
- `feature.yaml` - Plan → Implement → Validate
- `epic.yaml` - Multi-phase epic development
- `meeting.yaml` - Multi-agent discussion
- `analysis.yaml` - Security/architecture analysis

#### 9.5 Create Built-in Agent Personas

Create `personas/`:

- `developer.md` - Senior developer
- `planner.md` - Technical planner
- `tester.md` - QA engineer
- `architect.md` - System architect
- `facilitator.md` - Meeting facilitator
- `security-researcher.md` - Security analysis
- `pentester.md` - Penetration testing
- `appsec-developer.md` - AppSec remediation

#### 9.6 Create Output Templates

Create `templates/`:

- `pr-description.md` - Pull request template
- `feature-summary.md` - Feature documentation
- `epic-summary.md` - Epic documentation
- `security-report.md` - Security analysis report
- `meeting-summary.md` - Meeting summary
- `decision-record.md` - ADR template

#### 9.7 Documentation

Update `README.md` with:

- Installation instructions
- Quick start guide
- Configuration reference
- CLI command reference
- Workflow YAML schema
- Troubleshooting guide

### Validation

- [ ] Unit test coverage >80%
- [ ] All integration tests pass with mock provider
- [ ] Provider integration tests pass (when CLIs available)
- [ ] Built-in workflows execute successfully
- [ ] Documentation is complete and accurate

---

## Validation Criteria

### Milestone Completion Checklist

Each milestone is complete when:

1. [ ] All tasks implemented
2. [ ] Unit tests passing
3. [ ] Integration tests passing
4. [ ] Documentation updated
5. [ ] CLI commands working
6. [ ] No critical bugs

### End-to-End Scenarios

The framework is ready when these scenarios work:

#### Scenario 1: One-Shot Bugfix

```bash
agentic one-shot "Fix login timeout bug" --git --pr
# Creates branch, fixes bug, commits, creates PR
```

#### Scenario 2: Feature Development

```bash
agentic run workflows/feature.yaml --var feature="Add dark mode"
# Runs plan → implement → validate pipeline
```

#### Scenario 3: Crash Recovery

```bash
agentic run workflows/feature.yaml
# Simulate crash during implementation
agentic resume <workflow-id>
# Continues from last checkpoint
```

#### Scenario 4: Multi-Agent Meeting

```bash
agentic meeting "API versioning strategy" \
    --agents architect:claude developer:cursor pm:claude
# Runs facilitated discussion, generates summary
```

#### Scenario 5: Human-in-the-Loop

```bash
agentic run workflows/epic.yaml --human-in-loop
# Pauses at approval points
agentic resume <workflow-id> --approve
# Continues after approval
```

---

## Risk Assessment

### Technical Risks

| Risk                        | Mitigation                                      |
| --------------------------- | ----------------------------------------------- |
| CLI provider API changes    | Abstract via provider interface, easy to update |
| Kafka complexity            | Start with simple topics, add complexity later  |
| Embedding model performance | Make memory optional, test with small models    |
| Large workflow state        | Stream outputs to files, don't hold in memory   |

### Dependency Risks

| Risk                         | Mitigation                                 |
| ---------------------------- | ------------------------------------------ |
| Claude CLI not installed     | Clear error messages, mock for development |
| Docker not available         | Document requirements, test in CI          |
| PostgreSQL connection issues | Connection retry logic, health checks      |

### Scope Risks

| Risk                          | Mitigation                                 |
| ----------------------------- | ------------------------------------------ |
| Feature creep                 | Strict Phase 1 scope, defer to Phase 2     |
| Over-engineering              | Start simple, refactor when needed         |
| Parallel execution complexity | Sequential in Phase 1, parallel in Phase 2 |

---

## Summary

This implementation plan covers the complete Phase 1 development of Agentic Core:

| Milestone | Focus Area      | Key Deliverables                        |
| --------- | --------------- | --------------------------------------- |
| 1         | Foundation      | Package structure, CLI skeleton         |
| 2         | Infrastructure  | Docker, PostgreSQL, Kafka               |
| 3         | Providers       | Claude, Cursor, Mock providers          |
| 4         | Workflow Engine | YAML parser, executor, templates        |
| 5         | Step Execution  | Inputs, git, outputs, retry, recovery   |
| 6         | Memory          | Embeddings, semantic search, learning   |
| 7         | Meetings        | Multi-agent orchestration, facilitation |
| 8         | CLI             | All user-facing commands                |
| 9         | Testing         | Tests, templates, documentation         |

Upon completion, Agentic Core will support:

- One-shot tasks (~5 minutes)
- Feature development (~30 minutes)
- Epic implementations (multi-day with recovery)
- Multi-agent meetings and analysis sessions
- Full crash recovery via checkpoints
- Optional semantic memory for learning

The framework is designed for extensibility, with Phase 2 adding parallel execution, additional providers, and advanced RAG capabilities.
