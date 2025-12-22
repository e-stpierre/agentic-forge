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
/agentic-sdlc:build

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

## Plugin Dependencies

- **Core**: Foundation plugin, no dependencies. Provides common git workflows, code quality tools, and helper commands.
- **Interactive SDLC**: Depends on Core
- **Agentic SDLC**: Depends on Core
- **AppSec**: Integrates with both SDLC plugins

**Note**: Interactive SDLC and Agentic SDLC are independent and cannot be used together. They represent different approaches to AI-assisted development - one interactive with human guidance, the other fully autonomous.

## Plugins

### AppSec

Security-focused plugin for vulnerability scanning, threat modeling, and security best practices enforcement. Integrates OWASP guidelines and automated security checks into the development workflow.

### Core

Foundational utilities and shared components used across other plugins. Includes common git workflows, code quality tools, and helper commands.

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

### Agentic SDLC

Fully autonomous plugin for zero-interaction workflows.

**Philosophy**: No developer interaction during execution; suitable for CI/CD integration. Leverages Claude prompts (commands, agents, skills, hooks) and Python scripts for complete agentic workflows.

**Orchestrator Architecture**:

- **Python orchestrator**: Main loop (30s intervals) that monitors agent progress, validates status, handles retries, and stops on failures (3 attempts max)
- **Orchestrator agent**: Claude agent triggered by the main loop to validate progress and update orchestration.md

**Agents** (extensible):

| Development | AppSec | Architecture | Specialist | Product | Leadership |
|-------------|--------|--------------|------------|---------|------------|
| Developer | Pentester | Architect | Supabase Specialist | PM | Manager |
| UX Designer | Security Champion | | PostgreSQL Specialist | Analyst | |
| Tech Writer | | | NextJS Specialist | | |
| | | | React Specialist | | |
| | | | Kubernetes Specialist | | |
| | | | .NET Specialist | | |

**Building Blocks**:

- Requirement analysis
- Brainstorm
- Architecture
- Product requirement decision
- Epic planning
- Story planning
- Build
- Validate
- Analysis
- Git
- One-shot: Execute a single task in a git worktree; handles full workflow from branch creation, in-memory planning, implementation, commits, push, and pull request creation

**Workflows**:

All workflows are Python CLI tools invoked in the terminal. The Python scripts create Claude instances with specific requests. Agents communicate using JSON format, and each Claude session is a fresh instance.

**Main Command**: `build` triggers sub-workflows based on task complexity:

- Level 1: Product (full product scope)
- Level 2: Epic (feature set)
- Level 3: Chore, bug, feature (single items)

**Files** (default: `/specs/<feature-name>/`):

- `orchestration.md`: Main orchestrator plan, kept up to date to monitor progress and determine when the flow is complete
- `plan.md`: Main plan built during planning phase; not updated to track progress (checkpoint.md handles that)
- `checkpoint.md`: Initial section lists all tasks to complete; updated as tasks finish; agents write notes in the journal section for detailed progress
- `communication.md`: Agent-to-agent messages; orchestrator reads regularly and dispatches between agents; resolved conversations move to archive
- `communication-archive.md`: Resolved communication messages
- `logs.md` / `agent-<name>-logs.md`: Progress and error logs; agents write to base file or their specific log based on instructions

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

### Agentic SDLC Workflow Examples

**Autonomous bug fix in CI/CD**:

```bash
uv run agentic-workflow --type bug --spec bug-spec.md --auto-pr
```

**Epic-level feature development**:

```bash
uv run agentic-build --level epic --spec epic-user-management.md
```

**Single story with autonomous execution**:

```bash
uv run agentic-workflow --type feature --spec feature-2fa.md --worktree
```

### Cross-Domain Use Case Examples

**Kubernetes cluster hardening** (Agentic SDLC):

```bash
uv run agentic-workflow --type chore --spec k8s-security-audit.md
# Autonomous scan, planning, and remediation of security issues
```

**Homelab terraform refactoring** (Interactive SDLC):

```bash
/interactive-sdlc:plan-chore Refactor terraform modules for better reusability
/interactive-sdlc:build /specs/chore-terraform-refactor.md --git
```

**Pentest report automation** (Agentic SDLC):

```bash
uv run agentic-workflow --type feature --spec pentest-report-generator.md
# Autonomous implementation of report generation from scan results
```

## Future Ideas

Space for capturing improvement ideas and new directions.

- Metrics and telemetry for workflow optimization
