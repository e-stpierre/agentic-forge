# Vision

Internal development guide defining the goals and direction for the agentic-forge repository - a Claude Code plugin marketplace.
All design and implementation decisions must align with this document.

All plugins and workflows are technology agnostic, meaning that they can be used in a very wide range of use cases, and are not limited to specific programming language, framework, or system. Here's a few use-case examples:

- Software development (any language and tech stack)
- Security investigation, pentesting
- Kubernetes server creation, maintenance, improvement
- Homelab management (ssh, networking, application deployment)
- Creation and improvement of telemetry and monitoring systems
- Infrastructure creation using Terraform
- Product competition analysis, feature priorisation, go-to-market strategy
- UX design, improvement
- Unit tests, integration tests, smoke tests creation and improvement
- CI/CD

## Overview

A Claude Code plugin marketplace offering tools and automations to accelerate software development across the full SDLC:

- Planning and Requirements
- Architecture and Design
- Development
- Testing and Validation
- Deployment
- Maintenance

## Success Criteria & KPIs

**Success Rate**: Increase workflow completion success rate by providing clear, repeatable processes with validation gates at each step.

**Developer Involvement**: Minimize required developer interaction in workflows while maintaining quality and accuracy. Interactive SDLC reduces back-and-forth through smart context inference and targeted questions. Agentic SDLC eliminates interaction entirely for fully autonomous execution suitable for CI/CD integration.

## Technical Requirements

Cross-cutting principles that apply to all plugins.

### Command Namespacing

All commands use the `/<plugin>:<command>` format. Always use full namespace in documentation, scripts, and command references.

```bash
# Correct
/interactive-sdlc:plan-feature
/agentic-workflows:build

# Incorrect
/plan-feature
```

### Configuration

Plugins use `.claude/settings.json` (project scope, committed) with `.claude/settings.local.json` for personal overrides (gitignored).

### Plan File Principles

- Plans are static documentation, never modified during implementation
- No time estimates, deadlines, or scheduling
- Progress tracked via TodoWrite tool, not plan updates
- Content: requirements, architecture, tasks, validation criteria

### Context Arguments

Interactive commands support optional `[context]` as the last parameter to provide inline instructions and reduce interactive prompts.

### Agent Communication

Agentic workflows use JSON for structured, parseable communication between agents and Python orchestrators.

For multi-agent meetings, Kafka message bus provides decoupled pub/sub communication between independent AI sessions.

### AI Provider Abstraction

The system supports multiple AI CLI providers, enabling mixed-provider workflows where different agents use different AI backends:

| Provider    | CLI Command    | Status    | Session Resume | Notes                           |
| ----------- | -------------- | --------- | -------------- | ------------------------------- |
| **Claude**  | `claude`       | Supported | Yes            | Primary provider, full support  |
| **Cursor**  | `cursor-agent` | Supported | Yes            | Similar CLI structure to Claude |
| **Codex**   | `codex`        | Planned   | TBD            | OpenAI Codex CLI                |
| **Copilot** | `gh copilot`   | Planned   | No             | GitHub Copilot CLI              |

Agents specify their provider in configuration, enabling scenarios like:

- Facilitator (Claude) + Developer 1 (Claude) + Developer 2 (Cursor)
- Architect (Claude) + Security Reviewer (Cursor) + Tester (Claude)

## Plugin Dependencies

- **Agentic Core**: Foundation framework for multi-agent meetings. Provides Kafka messaging, PostgreSQL storage, and CLI provider abstraction.
- **Agentic Workflows**: YAML-based workflow orchestration with parallel execution, conditional logic, retry mechanisms, and persistent memory. Standalone plugin with no external dependencies.
- **Interactive SDLC**: Human-in-the-loop workflows. Standalone plugin.
- **AppSec**: Security analysis plugin. Standalone plugin.
- **Multi-Agent Meetings**: Depends on Agentic Core. Collaborative agent discussions.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Agentic Core   │     │Agentic Workflows│     │ Interactive SDLC│
│  (Kafka, PG,    │     │  (YAML-based,   │     │  (Human-in-loop)│
│   Meetings)     │     │   Standalone)   │     │                 │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Multi-Agent     │
│ Meetings        │
└─────────────────┘
```

**Note**: Interactive SDLC and Agentic Workflows are independent and can be used separately or together. They represent different approaches to AI-assisted development - Interactive SDLC for guided development with human feedback, Agentic Workflows for fully autonomous YAML-driven execution.

## Plugins

### Agentic Core

Foundation framework providing infrastructure for all agent orchestration workflows. See [agentic-core.md](./agentic-core.md) for detailed documentation.

**Philosophy**: Provide a robust, provider-agnostic infrastructure layer that enables everything from 5-minute one-shot tasks to multi-day epic implementations.

**Infrastructure**:

- **Kafka**: Message bus for decoupled agent communication and event sourcing
- **PostgreSQL + pgvector**: Persistent state, checkpoints, and semantic memory
- **CLI Provider Abstraction**: Unified interface to Claude, Cursor, Codex, Copilot

**Key Features**:

- YAML-based declarative workflow definitions
- Crash recovery via Kafka replay and PostgreSQL checkpoints
- Long-term memory with semantic search (pgvector)
- Human-in-the-loop optional at any checkpoint
- Full telemetry and audit logging

**CLI Commands**:

```bash
agentic infra up              # Start infrastructure
agentic run workflow.yaml     # Run any workflow
agentic one-shot "Fix bug"    # Quick one-shot task
agentic meeting "Topic"       # Start agent meeting
agentic resume <workflow-id>  # Resume from checkpoint
```

### AppSec

Security-focused plugin for vulnerability scanning, threat modeling, and security best practices enforcement. Integrates OWASP guidelines and automated security checks into the development workflow.

### Interactive SDLC

Human-in-the-loop plugin for guided development within Claude Code sessions.

**Philosophy**: Interactive development with human guidance for accuracy through clarification and context-aware prompting.

**Commands** (all prefixed with `/interactive-sdlc:`):

- **Planning**: `plan-chore`, `plan-bug`, `plan-feature` - Create structured plans with templates and codebase exploration
- **Implementation**: `build` - Implement plan files with checkpoint support for resuming work
- **Validation**: `validate` - Comprehensive validation including tests, code review, build verification, and plan compliance
- **Workflows**:
  - `one-shot` - Quick tasks with in-memory planning, no saved plan files
  - `plan-build-validate` - Full guided workflow with optional git commits and PR creation
- **Documentation**: `document` - Generate/update markdown documentation with mermaid diagrams
- **Analysis**: `analyse-bug`, `analyse-doc`, `analyse-debt`, `analyse-style`, `analyse-security` - Comprehensive codebase analysis with criticality ratings

**Features**:

- Context arguments: All commands accept optional `[context]` parameter for inline instructions, reducing interactive prompts
- Smart prompting: Only asks questions when context doesn't provide sufficient information
- Checkpoint system: Resume long-running builds from specific milestones or tasks
- Configuration via `.claude/settings.json`: Customize plan directories, analysis directories, and explore agent counts

### Agentic Workflows

YAML-based workflow orchestration plugin for fully autonomous execution. Standalone plugin with no external dependencies.

**Philosophy**: Declarative YAML workflows with high resilience, persistent memory, and support for any task size from quick one-shots to multi-day epics.

**Key Features**:

- **YAML Workflows**: Declarative workflow definitions with parallel steps, conditional execution, and retry mechanisms
- **Python Orchestrator**: Hybrid architecture where Python handles deterministic operations and Claude makes intelligent decisions
- **Persistent Memory**: File-based memory system with YAML frontmatter for searchability (no database required)
- **Git Integration**: Full support for git worktrees, automated commits, and PR creation
- **Crash Recovery**: Resume workflows from last checkpoint after crashes

**Workflow Types**:

- `prompt`: Run Claude with a specific prompt
- `command`: Execute a plugin command with arguments
- `parallel`: Execute nested steps concurrently in git worktrees
- `conditional`: Execute steps based on Jinja2 expressions
- `recurring`: Loop steps until completion criteria met
- `wait-for-human`: Pause for human input when needed

**CLI Commands**:

```bash
agentic-workflow run <workflow.yaml>      # Run workflow
agentic-workflow resume <workflow-id>     # Resume from checkpoint
agentic-workflow one-shot "<prompt>"      # Quick one-shot task
agentic-workflow analyse --type security  # Run analysis
```

**Built-in Workflows**:

- `analyse-codebase.yaml`: Parallel analysis for bugs, debt, docs, security, style
- `one-shot.yaml`: Single task with git workflow
- `plan-build-validate.yaml`: Full SDLC workflow with planning, implementation, and validation

### Multi-Agent Meetings

Collaborative discussion system for complex decision-making, brainstorming, and planning sessions.

**Philosophy**: True multi-session architecture where each agent runs as an independent AI process with separate context windows, enabling genuine disagreement and independent reasoning. Supports both autonomous execution and interactive user participation.

**Infrastructure**: Kafka message bus for decoupled agent communication (Docker Compose provided for local development).

**Key Features**:

- **True multi-session**: Each agent runs as separate CLI process with own session
- **AI-agnostic**: Mix providers (Claude, Cursor, Codex, Copilot) in the same meeting
- **Interactive mode**: User participates via TUI when `--interactive` flag set
- **Autonomous mode**: Fully autonomous discussion without user input
- **Template-based**: Facilitator strategies (brainstorm, decision, planning) defined in templates
- **Document generation**: User selects output templates (meeting-summary, decision-record, etc.)

**Use Cases**:

- Architecture decision meetings
- Sprint planning sessions
- Brainstorming sessions
- Retrospectives
- Technical design reviews
- Cross-functional requirement discussions

**Integration**: Meeting outputs (decisions, action items) can feed into SDLC workflows:

- Decision records become input for `plan-feature`
- Action items become specs for `agentic-workflow run`
- Meeting transcripts provide context for implementation

## Examples

### Interactive SDLC Workflow Examples

**Quick bug fix with one-shot**:

```bash
/interactive-sdlc:one-shot --git Fix login timeout on Safari - users get blank page after OAuth redirect
```

**Feature development with full workflow**:

```bash
/interactive-sdlc:plan-build-validate --git --pr Add dark mode toggle in user settings with persistent preference storage
```

**Resume interrupted work**:

```bash
/interactive-sdlc:build /specs/feature-auth.md --checkpoint "Milestone 2" --git
```

**Security analysis**:

```bash
/interactive-sdlc:analyse-security Focus on authentication and session management
```

### Agentic Workflows Examples

**Autonomous bug fix in CI/CD**:

```bash
agentic-workflow run plan-build-validate.yaml --var type=bug --var spec=bug-spec.md
```

**One-shot task with git workflow**:

```bash
agentic-workflow one-shot "Fix login timeout on Safari" --git --pr
```

**Full codebase analysis**:

```bash
agentic-workflow run analyse-codebase.yaml --var autofix=major
```

### Cross-Domain Use Case Examples

**Kubernetes cluster hardening** (Agentic Workflows):

```bash
agentic-workflow run plan-build-validate.yaml --var type=chore --var spec=k8s-security-audit.md
# Autonomous scan, planning, and remediation of security issues
```

**Homelab terraform refactoring** (Interactive SDLC):

```bash
/interactive-sdlc:plan-chore Refactor terraform modules for better reusability
/interactive-sdlc:build /specs/chore-terraform-refactor.md --git
```

**Pentest report automation** (Agentic Workflows):

```bash
agentic-workflow one-shot "Generate pentest report from scan results" --git --pr
# Autonomous implementation of report generation
```

### Multi-Agent Meeting Examples

**Architecture decision meeting (autonomous)**:

```bash
uv run meeting \
  --topic "Microservices vs Monolith for MVP" \
  --agents architect:claude developer:claude pm:cursor \
  --template decision \
  --output-docs decision-record meeting-summary
```

**Sprint planning with user participation**:

```bash
uv run meeting \
  --topic "Sprint 12 Planning" \
  --agents pm:claude developer:claude designer:cursor tester:claude \
  --interactive \
  --template planning
```

**Brainstorming session (mixed providers)**:

```bash
uv run meeting \
  --topic "New Authentication Approaches" \
  --agents architect:claude developer:cursor security:claude \
  --template brainstorm \
  --output-docs meeting-summary
```

## Future Ideas

Space for capturing improvement ideas and new directions.

- Metrics and telemetry for workflow optimization
