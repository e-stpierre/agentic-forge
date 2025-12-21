# Vision

Internal development guide defining the goals and direction for this Claude Code marketplace.
All design and implementation decisions must align with this document.

## Overview

A Claude Code plugin marketplace offering tools and automations to accelerate software development across the full SDLC:

- Planning and Requirements
- Architecture and Design
- Development
- Testing and Validation
- Deployment
- Maintenance

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

## Plugins

### AppSec

Security-focused plugin for vulnerability scanning, threat modeling, and security best practices enforcement. Integrates OWASP guidelines and automated security checks into the development workflow.

### Core

Foundational utilities and shared components used across other plugins. Includes common git workflows, code quality tools, and helper commands.

### Interactive SDLC

Human-in-the-loop plugin for guided development within Claude Code sessions.

**Philosophy**: Developer involvement yields more accurate results through interactive clarification.

**Building Blocks**:

- Planning (chore, bug, feature with templates)
- Build (implement plans with checkpoint support)
- Validate (tests, review, build verification, plan compliance)
- Analysis (bugs, docs, debt, style, security)
- Documentation (markdown with mermaid diagrams)

**Workflows**:

- One-shot: Quick tasks without saved plans
- Plan-build-validate: Full guided workflow with optional git/PR support

### Agentic SDLC

Human-out-of-the-loop plugin for fully autonomous workflows.

**Philosophy**: No developer interaction during execution; suitable for CI/CD integration. Leverages Claude prompts (commands, agents, skills, hooks) and Python scripts for complete agentic workflows.

**Agents** (extensible):

| Development | AppSec | Architecture | Specialist | Product | Leadership |
|-------------|--------|--------------|------------|---------|------------|
| Developer | Pentester | Architect | Supabase Specialist | PM | Orchestrator |
| UX Designer | Security Champion | | PostgreSQL Specialist | Analyst | Manager |
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

The orchestrator is the main Python process that validates agent status and progress in a loop with 30s intervals. It detects errors, handles retries, and stops the process if a step fails after 3 attempts.

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

## Future Ideas

Space for capturing improvement ideas and new directions.

- [ ] Plugin dependency system
- [ ] Shared schema validation library
- [ ] Cross-plugin workflow composition
- [ ] Metrics and telemetry for workflow optimization
