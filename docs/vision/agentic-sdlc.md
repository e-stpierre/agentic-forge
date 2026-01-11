# Agentic SDLC

## Goal

The agentic workflows goal is to enable Claude Code to execute any type of task with a high success rate. The framework allows Claude Code to work fully independently, with resiliency and accuracy, in a multi-session workflow.

## Guiding Principles

### Core Philosophy

- Composed of highly flexible, reusable building blocks
- Able to complete short and long-running tasks with high success rate
- Mainly used for software development tasks, but not limited to this domain
- Support any task size: chore, bug, task, story, epic
- Use Jinja2 for all template resolution (YAML and output templates)

### Workflow Execution

- YAML workflows are the top-level entity, supporting arguments:
  - `autofix`: severity level for automatic fixes (none, minor, major, critical)
  - `max-retry`: maximum retries per step before workflow stops
  - `timeout-minutes`: maximum timeout for workflow or individual steps
  - `track-progress`: enable progress tracking in the workflow progress document
- Steps can be executed in series, in parallel, and support conditional execution
- Steps are always dependent on previous steps, except for parallel blocks
- Each workflow step starts a new Claude Code session (no session resume)
- Support retry on error and recurring loops to improve result quality
- Workflows can be used in any scenario: feature development, code analysis, bug fixes, brainstorming, technical analysis, pentesting, QA, product management, etc.

### Terminal Monitoring

- **IMPORTANT**: Users must be able to monitor workflow progress from the terminal
- The terminal used to launch a workflow stays active and runs the main orchestrator loop
- The orchestrator prints information based on the selected log granularity:
  - **base**: Only important progress (step completion, step error, waiting for human input, workflow status changes)
  - **all**: Include Claude session output streamed to terminal (sequential display, parallel output with prefixes for interleaving)
- Python orchestrator captures Claude's stdout in real-time using `subprocess.Popen()` with line-by-line iteration and `flush=True` for immediate display
- Silent capture mode (without streaming) uses `subprocess.run()` with `capture_output=True` for structured JSON parsing in workflow steps

### State Management

- Base output folder: `agentic/` (relative to repository root) for all framework outputs
- Support integrated checkpoint system (on-demand via skill invocation)
- Support full logging at configurable levels (info, warning, error, critical)
- Every Claude session can add logs to the workflow's log file

### Git Integration

- Support fully automated git workflows and GitHub interactions (issues, PRs)
- Git worktree support with two modes:
  - **Root-level `worktree: true`**: Entire workflow runs in a dedicated worktree (create worktree first, then execute workflow inside it)
  - **Parallel steps**: Always use git worktrees for isolation (mandatory)
- Worktree naming convention:
  - Path: `.worktrees/agentic-{workflow_name}-{step_name}-{random_6_char}` (inside repo, add to `.gitignore`)
  - Branch: `agentic/{workflow_name}-{step_name}-{random_6_char}`
  - Names truncated to 30 chars each to avoid Windows path length issues
- Worktree lifecycle:
  - Worktrees are immediately cleaned up after workflow completes (once branch and PR are ready)
  - Failed parallel step worktrees are also cleaned up (not preserved for debugging)
  - Orphaned worktrees from crashed workflows are cleaned up at next workflow start using `git worktree prune`
- Parallel execution merge modes:
  - **independent**: Each parallel branch creates its own PR; user merges and resolves conflicts manually in preferred order
  - **merge**: Sequential merge with auto-resolve; branches merged one-by-one; if conflicts occur, spawn a Claude session to resolve them before continuing. If resolution fails after max-retry, workflow pauses for human intervention
- Support permissions management per step or globally (`bypass-permissions` flag)

### Extensibility

- Workflows support custom steps and commands written by users
- Support global JSON configuration with `/configure` command
- Include CLAUDE.example.md with sections users can add to their CLAUDE.md

### Self-Learning

- Claude sessions can create memory documents in `agentic/memory/` when discovering patterns, errors, or learnings
- Memory creation is controlled by:
  - Explicit workflow prompt/command indication, OR
  - User's CLAUDE.md section instructing Claude when to create/search memories
- Memories can eventually be used to update CLAUDE.md or create Skills

### Code Standards

- IMPORTANT: Only add comments in code when necessary to identify something unusual
- Do not use comments for normal code paths

## Workflow Execution Lifecycle

### Workflow States

```
pending ──start──> running ──complete──> completed
                      │
                      ├──fail──> failed
                      │
                      ├──pause──> paused ──resume──> running
                      │
                      └──cancel──> cancelled
```

### Step States

```
pending ──start──> running ──complete──> completed
                      │
                      ├──fail──> failed ──retry──> running (if retries left)
                      │              └──(max retries)──> failed (workflow aborts)
                      │
                      └──skip──> skipped
```

**Note:** Steps remain in `failed` status when max retries are reached. The workflow status changes to `failed`.

## Error Types

The framework categorizes errors to enable appropriate handling:

| Error Type      | Description                                       | Action                                                                               |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Transient**   | Network timeout, rate limit, temporary failures   | Retry with same prompt, new session                                                  |
| **Recoverable** | Test failure, validation error, fixable issues    | New session with: original prompt + error message + affected files + fix instruction |
| **Fatal**       | Invalid workflow definition, missing dependencies | Abort workflow                                                                       |
| **Blocking**    | Human input required, ambiguous decision          | Pause workflow                                                                       |

When max-retry is reached for a step, the error is promoted to fatal and the workflow stops.

## Workflow YAML Schema

```yaml
# Workflow Schema v1.0
name: string                      # Workflow identifier
version: string                   # Schema version (e.g., "1.0")
description: string               # Human-readable description

settings:
  max-retry: number               # Default: 3, retries per step
  timeout-minutes: number         # Default: 60, workflow timeout
  track-progress: boolean         # Default: true
  autofix: string                 # "none" | "minor" | "major" | "critical"
  terminal-output: string         # "base" | "all" - terminal log granularity
  git:
    enabled: boolean              # Enable git operations
    worktree: boolean             # If true, entire workflow runs in dedicated worktree
    auto-commit: boolean          # Commit after milestones
    auto-pr: boolean              # Create PR on completion
    branch-prefix: string         # e.g., "feature/"
  bypass-permissions: boolean     # Run with --dangerously-skip-permissions

variables:                        # Input variables
  - name: string
    type: string | number | boolean
    required: boolean
    default: any
    description: string

# Variables example:
# variables:
#   - name: feature_name
#     type: string
#     required: true
#     description: Name of the feature to implement
#   - name: priority
#     type: string
#     default: medium
#     description: Task priority level

steps:
  - name: string                  # Step identifier (required)
    type: prompt | command | parallel | conditional | recurring | wait-for-human

    # For type: prompt
    prompt: string                # Jinja2 template with {{ variables }}
    agent: string                 # Optional agent file path

    # For type: command
    command: string               # Command to execute (e.g., "plan", "build")
    args: object                  # Command arguments as key-value pairs

    # For type: parallel
    steps: []                     # Nested steps to run in parallel
    merge-strategy: string        # How to combine results: "wait-all" (Phase 1 only)
    merge-mode: string            # "independent" | "merge" - how to handle branches
    # NOTE: Parallel steps ALWAYS use git worktrees for isolation (mandatory)
    # Nested steps can have depends-on: step_name to wait for another step within the parallel block

    # For type: conditional
    condition: string             # Jinja2 expression evaluated by orchestrator
    then: []                      # Steps if condition is true
    else: []                      # Steps if condition is false (optional)

    # For type: recurring (Ralph-Wiggum pattern)
    max-iterations: number        # Maximum loop iterations
    until: string                 # Jinja2 expression for completion
    steps: []                     # Steps to repeat

    # For type: wait-for-human
    message: string               # Message to display to user (what input is needed)
    polling-interval: number      # Polling interval in seconds (default: 15)
    timeout-minutes: number       # Timeout for human input (default: 5)
    on-timeout: continue | abort  # Action if human never responds (default: abort)
    # Workflow pauses until human provides input in progress.json for this step
    # The orchestrator polls progress.json until human_input field is populated
    # Human input is a multi-line string that acts as a prompt (like answering a Claude question)

    # Wait-for-human example:
    # - name: review-plan
    #   type: wait-for-human
    #   message: "Please review the generated plan and provide feedback."
    #   polling-interval: 15
    #   timeout-minutes: 30
    #   on-timeout: abort

    # Common options (all step types)
    model: string                 # Model to use: "sonnet" (default) | "haiku" | "opus"
    timeout-minutes: number       # Override workflow timeout
    max-retry: number             # Override workflow max-retry
    on-error: retry | skip | fail # Error handling strategy
    checkpoint: boolean           # Create checkpoint after this step
    depends-on: string            # Step name to wait for (within parallel blocks)

outputs:
  - name: string                  # Output identifier
    template: string              # Template file path (Jinja2)
    path: string                  # Output file path
    when: completed | failed      # When to generate (default: completed)
```

### Output Template Resolution

Output templates are rendered by **Python (Jinja2)** at **workflow completion** (not incrementally). This ensures:

- Deterministic output (same context produces same result)
- No token cost for template rendering
- Templates can access final aggregated data

**Template context object:**

```python
template_context = {
    # Workflow metadata
    "workflow": {
        "name": "feature-implementation",
        "started_at": "2024-01-09T10:00:00Z",
        "completed_at": "2024-01-09T10:45:00Z",
    },
    # Step results (keyed by step id)
    "steps": {
        "plan": {"status": "completed", "output": "...", "files_changed": [...]},
        "implement": {"status": "completed", "output": "...", "files_changed": [...]},
        "test": {"status": "completed", "test_results": {"passed": 12, "failed": 0}},
    },
    # Aggregated data
    "files_changed": ["src/auth.ts", "src/auth.test.ts"],
    "branches": ["feature/auth-impl"],
    "pull_requests": [{"number": 42, "url": "..."}],
    # User inputs
    "inputs": {"feature_name": "authentication", "priority": "high"},
}
```

### Step Dependency

Steps are executed sequentially and each step can access outputs from all previous steps via the `{{ outputs.step_name }}` variable. The Python orchestrator stores step outputs and provides them to subsequent steps.

For parallel blocks, all nested steps execute concurrently in separate git worktrees. The orchestrator polls each parallel worktree's `progress.json` file until all report `completed` or `failed` status (polling interval: `execution.pollingIntervalSeconds`, default 5 seconds). The parallel block completes when all nested steps complete (or based on merge-strategy).

### Conditional Execution

The `condition` key at the step level is a Jinja2 expression evaluated by the Claude Orchestrator. Examples:

```yaml
- name: fix-issues
  type: command
  condition: "{{ outputs.validate['issues_count'] > 0 }}"
  command: fix
  args:
    severity: major
```

Note: Conditions use standard Jinja2 syntax. For nested property access, use bracket notation: `outputs.step_name['property']`.

## Output Directory Structure

All framework outputs are stored under the `agentic/` directory (relative to repository root):

```
agentic/
├── config.json                   # Global plugin configuration
├── workflows/                    # Workflow executions
│   └── {workflow-id}/            # One directory per execution
│       ├── progress.json         # Workflow progress (machine-readable)
│       ├── checkpoint.md         # Checkpoints (on-demand)
│       ├── logs.ndjson           # Workflow logs (NDJSON format)
│       └── plan.md               # Generated plan (if applicable)
├── memory/                       # Persistent memories (shared across workflows)
│   ├── pattern-auth-middleware.md
│   ├── lesson-rate-limiting.md
│   └── error-timeout-handling.md
└── analysis/                     # Analysis outputs
    ├── bug.md
    ├── debt.md
    ├── doc.md
    ├── security.md
    └── style.md
```

## Python Package Structure

**Dependencies:** `pyyaml`, `jinja2`, `filelock` (for cross-platform file locking)

```
plugins/agentic-sdlc/
├── pyproject.toml                # Python 3.10+, uv tool installable
├── CLAUDE.example.md             # Example CLAUDE.md sections for users
├── workflows/                    # Built-in workflow definitions
│   ├── analyse-codebase.yaml
│   ├── one-shot.yaml
│   └── plan-build-validate.yaml
├── templates/                    # Output templates (Jinja2)
│   ├── progress.json.j2
│   ├── checkpoint.md.j2
│   ├── memory.md.j2
│   ├── plan-feature.md.j2
│   ├── plan-bug.md.j2
│   ├── plan-chore.md.j2
│   └── analysis/
│       ├── bug.md.j2
│       ├── debt.md.j2
│       ├── doc.md.j2
│       ├── security.md.j2
│       └── style.md.j2
├── commands/                     # Claude commands (markdown prompts)
│   ├── orchestrate.md            # Evaluate state, return next action
│   ├── plan.md
│   ├── build.md
│   ├── validate.md
│   ├── analyse.md
│   └── git/
│       ├── branch.md
│       ├── commit.md
│       └── pr.md
├── agents/                       # Agent definitions (markdown with frontmatter)
│   ├── explorer.md               # Explores codebase efficiently, returns files/line numbers of interest
│   └── reviewer.md               # Validates tests, reviews code quality, ensures correctness
├── skills/                       # Skills for Claude sessions
│   ├── create-memory.md
│   ├── search-memory.md
│   ├── create-checkpoint.md
│   └── create-log.md
├── schemas/                      # JSON schemas for validation
│   ├── workflow.schema.json
│   ├── config.schema.json
│   ├── progress.schema.json
│   ├── orchestrator-response.schema.json
│   └── step-output.schema.json
└── src/agentic_sdlc/        # Python source code
    ├── __init__.py
    ├── cli.py                    # Entry point: agentic-sdlc
    ├── runner.py                 # Claude session execution
    ├── orchestrator.py           # Async workflow orchestration
    ├── parser.py                 # YAML workflow parsing
    ├── executor.py               # Step execution engine
    ├── memory/
    │   ├── __init__.py
    │   ├── manager.py            # Memory CRUD operations
    │   └── search.py             # Frontmatter keyword search
    ├── checkpoints/
    │   ├── __init__.py
    │   └── manager.py            # Checkpoint read/write
    ├── logging/
    │   ├── __init__.py
    │   └── logger.py             # NDJSON structured logging
    ├── git/
    │   ├── __init__.py
    │   └── worktree.py           # Git worktree management
    └── templates/
        ├── __init__.py
        └── renderer.py           # Jinja2 template rendering
```

### Installation

agentic-sdlc is **both**:

- A **Claude Code plugin** (commands installed via marketplace)
- A **standalone CLI tool** (installed via `uv tool install`)

### CLI Entry Point

Single CLI command installed via `uv tool install`.

```bash
# Workflow execution
agentic-sdlc run <workflow.yaml> [--var key=value]... [--from-step step] [--terminal-output base|all]
agentic-sdlc resume <workflow-id>
agentic-sdlc status <workflow-id>
agentic-sdlc cancel <workflow-id>
agentic-sdlc list [--status running|completed|failed]

# Human input (for wait-for-human steps)
agentic-sdlc input <workflow-id> "<response>"

# One-shot convenience
agentic-sdlc one-shot "<prompt>" [--git] [--pr]
agentic-sdlc analyse [--type bug|debt|doc|security|style] [--autofix level]

# Configuration
agentic-sdlc configure
agentic-sdlc config get <key>
agentic-sdlc config set <key> <value>

# Memory management
agentic-sdlc memory list [--category pattern|lesson|error]
agentic-sdlc memory search "<query>"
agentic-sdlc memory prune [--older-than 30d]
```

Note: Checkpoints are only used for agents to track their progress or share details with other agents. They are not used to resume workflows - use `agentic-sdlc resume` for that.

## Configuration Schema

Global configuration stored in `agentic/config.json`.

**Note:** JSON config uses camelCase keys (e.g., `maxRetry`); YAML workflows use kebab-case (e.g., `max-retry`).

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "outputDirectory": "agentic",
  "logging": {
    "enabled": true,
    "level": "Error"
  },
  "git": {
    "mainBranch": "main",
    "autoCommit": true,
    "autoPr": true
  },
  "memory": {
    "enabled": true,
    "directory": "agentic/memory",
    "template": "default"
  },
  "checkpoint": {
    "directory": "agentic/workflows"
  },
  "defaults": {
    "maxRetry": 3,
    "timeoutMinutes": 60,
    "trackProgress": true
  },
  "execution": {
    "maxWorkers": 4,
    "pollingIntervalSeconds": 5
  }
}
```

| Setting                            | Type    | Default          | Description                              |
| ---------------------------------- | ------- | ---------------- | ---------------------------------------- |
| `outputDirectory`                  | string  | `agentic`        | Base directory for all outputs           |
| `logging.enabled`                  | boolean | `true`           | Enable workflow logging                  |
| `logging.level`                    | enum    | `Error`          | Critical, Error, Warning, Information    |
| `git.mainBranch`                   | string  | `main`           | Default branch name                      |
| `git.autoCommit`                   | boolean | `true`           | Auto-commit after milestones             |
| `git.autoPr`                       | boolean | `true`           | Auto-create PR on completion             |
| `memory.enabled`                   | boolean | `true`           | Enable memory system                     |
| `memory.directory`                 | string  | `agentic/memory` | Memory storage location                  |
| `memory.template`                  | string  | `default`        | Default memory template                  |
| `defaults.maxRetry`                | number  | `3`              | Default max retries per step             |
| `defaults.timeoutMinutes`          | number  | `60`             | Default workflow timeout                 |
| `defaults.trackProgress`           | boolean | `true`           | Enable progress tracking by default      |
| `defaults.terminalOutput`          | enum    | `base`           | Terminal output granularity              |
| `execution.maxWorkers`             | number  | `4`              | Max concurrent parallel Claude sessions  |
| `execution.pollingIntervalSeconds` | number  | `5`              | Polling interval for parallel completion |

## Memory Document Format

Memories are markdown files with YAML frontmatter for searchability:

````markdown
---
id: mem-2024-01-15-auth-pattern
created: 2024-01-15T10:30:00Z
category: pattern
tags: [authentication, middleware, typescript]
source:
  workflow: plan-build-validate
  step: implement
relevance: high
---

# Authentication Middleware Pattern

## Context

When implementing authentication in this codebase, discovered that the project uses a custom middleware chain pattern rather than the standard Express middleware.

## Learning

The project uses a custom middleware chain pattern located in `src/middleware/chain.ts`. All auth-related middleware should:

1. Extend the `BaseMiddleware` class
2. Implement the `handle()` method
3. Call `this.next()` to continue the chain

## Application

Use this pattern when:

- Adding new authentication providers
- Implementing authorization checks
- Creating rate limiting middleware

## Code Example

```typescript
export class AuthMiddleware extends BaseMiddleware {
  async handle(ctx: Context): Promise<void> {
    const token = ctx.headers.authorization;
    if (!token) {
      throw new UnauthorizedError();
    }
    ctx.user = await this.validateToken(token);
    await this.next(ctx);
  }
}
```
````

### Memory Categories

| Category   | When to Use                                             |
| ---------- | ------------------------------------------------------- |
| `pattern`  | Discovered code patterns, conventions, architectures    |
| `lesson`   | General learnings about the project or domain           |
| `error`    | Errors encountered and their solutions                  |
| `decision` | Decisions made during implementation with rationale     |
| `context`  | Project-specific context (dependencies, configurations) |

### Memory Search

Memory search uses simple keyword matching in frontmatter fields:

- Search by `category` (exact match)
- Search by `tags` (any tag matches)
- Search by content keywords (full-text search in title/content)

File glob patterns can also be used to find memories by naming convention.

## Self-Learning Process

### Memory Creation Control

Memory creation is **not automatic**. It is controlled by:

1. **Explicit workflow indication**: Workflow prompts or commands can explicitly instruct Claude to create a memory for important learnings
2. **User's CLAUDE.md section**: Users add a `## Memory Management` section to their CLAUDE.md with heuristics for when to create/search memories

The CLAUDE.example.md file provided by this plugin includes a recommended section:

```markdown
## Memory Management

Create memories using `/create-memory` when you encounter:

- Architectural decisions and their rationale
- User preferences expressed during sessions
- Patterns/conventions discovered in the codebase
- Errors encountered and their solutions

Before starting complex tasks, use `/search-memory` or check
`agentic/memory/index.md` for relevant context.
```

### Memory Directory Structure

The memory system uses a well-structured directory that makes glob/grep effective:

```
agentic/memory/
├── decisions/
│   ├── 2024-01-09-auth-approach.md
│   └── 2024-01-08-database-choice.md
├── patterns/
│   └── error-handling-convention.md
├── context/
│   └── project-architecture.md
└── index.md  # Summary/TOC Claude reads first
```

**index.md structure:**

```markdown
# Memory Index

Last updated: 2024-01-15T10:30:00Z

## Decisions

- [2024-01-09-auth-approach.md](decisions/2024-01-09-auth-approach.md) - OAuth vs JWT

## Patterns

- [error-handling-convention.md](patterns/error-handling-convention.md) - Error handling
```

**How Claude searches memories:**

1. Reads `index.md` to understand what's available
2. Uses grep for specific keywords
3. Reads relevant files

The `/create-memory` and `/search-memory` skills handle structured file creation, automatic `index.md` updates, and proper directory organization.

### When to Create Memory

Claude sessions should create memory when they:

1. Discover an unexpected pattern in the codebase
2. Find a workaround for a framework limitation
3. Encounter an error and find the solution
4. Learn something about the project's conventions
5. Make an assumption that worked (or didn't)

### Memory Creation Flow

1. Claude determines a learning is worth persisting (based on CLAUDE.md instructions or explicit prompt)
2. Invoke the `/create-memory` skill with:
   - Category: pattern | lesson | error | decision | context
   - Tags: relevant keywords for searchability
   - Content: what was learned
   - Application: when this knowledge applies
3. The skill validates the memory is not duplicated and is pertinent
4. Memory is saved with proper frontmatter

### When to Search Memory

Claude sessions should search memory when they:

1. Face an error or unexpected behavior
2. Are stuck on a problem
3. Need to understand project conventions
4. Are about to make architectural decisions

This behavior is configured via the user's CLAUDE.md section.

### Memory Lifecycle

Memories are **permanent** and accumulate over time. The goal is to increase the success rate of Claude's work in the repository. Developers can periodically review the `agentic/memory/` directory to:

- Clean up outdated or incorrect memories
- Consolidate related memories
- Graduate high-value memories into CLAUDE.md updates or Skills

## Building Blocks

### Python Scripts

The following python scripts are what I envision as the base scripts to build, that are used in the core of the framework (use by steps scripts) or that are used directly by a step in a workflow.

#### Runner

Base scripts to run Claude Code in a programmatic way. The runner accepts a `model` parameter to specify which Claude model to use:

- `sonnet` (default): Balanced performance and cost
- `haiku`: Faster and cheaper for simpler tasks
- `opus`: Most capable for complex reasoning

**Implementation**: Uses `subprocess.Popen()` for real-time output streaming or `subprocess.run()` with `capture_output=True` for structured JSON parsing. Supports timeout enforcement and process management.

#### Orchestrator

Run Claude instances in parallel with process management and result aggregation.

**Implementation**: Async orchestration using Python's `asyncio` with worker pool limiting (default: 4 concurrent sessions). Handles SIGINT/SIGTERM for graceful shutdown.

#### Memory

Use to create the memory about a specific topics that can be re-used later. Use clear fontmatter to help navigate and search in these .md files for a specific topic.
They are always stored as .md files

**Implementation**: File-based storage in `agentic/memory/` with YAML frontmatter for metadata (category, tags, relevance). Simple keyword matching for search.

#### Workflows

Scripts responsible of parsing and running the workflows

**Implementation**: YAML parsing with PyYAML, Jinja2 template rendering for variables, step execution engine with state tracking in `progress.json`.

### Agents

Workflow steps can be assigned to an agent. The plugin offers base agents, but a user can install and refer their own agents when creating new YAML workflows.

**Built-in agents:**

- **explorer.md**: Explores the codebase efficiently to find files for a specific task. Returns file paths and line numbers of interest.
- **reviewer.md**: Validates tests, reviews code quality, checks for issues, and ensures correctness of implementations.

Agent files use markdown with YAML frontmatter defining persona, capabilities, and instructions.

### Commands

The following commands can be explicitly called in workflows. Additional commands from other plugins can also be used if referenced in a workflow step. Commands are executed in agentic workflows without interaction with the developer - they must proceed to completion and have clear, fixed arguments and **JSON-only output structure**.

**Note:** agentic-sdlc creates its own commands that produce JSON output only. These are adapted from interactive-sdlc commands for agentic use. The agentic-sdlc plugin is **standalone** and does not depend on interactive-sdlc.

All commands output JSON conforming to `schemas/step-output.schema.json`. Commands must not produce non-JSON output.

#### Plan

Base on the type of task or requested template, create a plan that will be used to accomplished the requested task

#### Build

plugins\interactive-sdlc\commands\dev\build.md

#### Validate

plugins\interactive-sdlc\commands\dev\validate.md

#### Analyse

Same commands and interactive sdlc analyse commands, oriented for agentic use case, with fixed json output. The commands support a template argument as input, that is the template file to use, otherwise they fallback to the default, if a template is provided in the workflow step, it's passed to the command argument.

plugins\interactive-sdlc\commands\analyse

#### Git

Same commands and interactive sdlc git commands, oriented for agentic use case, with fixed json output.

plugins\interactive-sdlc\commands\git

#### GitHub

Same commands and interactive sdlc github commands, oriented for agentic use case, with fixed json output.

plugins\interactive-sdlc\commands\github

### Skills

Skills are automatically available to all Claude sessions invoked by the workflow. They can also be used independently outside of workflows.

Skills are the same as commands in this framework, the skills offered in this plugin are a good basis, claude session invoked by the workflow should be able to use them, but they can be extended by any skill installed by the user.

#### Create Memory

Skill use to create memory, refers to the plugin json configuration for:

- directory to persist memory in
- memory template to use

Have configured default if these are not provided.
Ask Claude to double check if the memory he's about to create is not duplicated and is pertinent.
Put emphasis on creating a clear frontmatter for the memory, that respect the required properties defined in the templated used.

#### Create Checkpoint

Checkpoints are scoped per workflow, the checkpoint file name must contain the workflow execution name
Skill used to create a checkpoint, refers to the plugin json configuration for:

- directory to persist checkpoint in
- memory template to use

#### Create Log

Add log entries to the workflow's log file (`agentic/workflows/{workflow-id}/logs.ndjson`). Uses NDJSON format (one JSON object per line) with fields: `timestamp`, `level`, `step`, `message`, `context`.

Log levels:

- **Critical**: Fatal error causing workflow to stop (e.g., max retries reached)
- **Error**: Any error that occurred
- **Warning**: Unexpected issue that may need attention
- **Information**: Regular progress logging

### Outputs

Other than expected framework outputs (modifying code, editing documents, etc.), workflow steps can be requested to create an output using a template. Same as other building blocks, the plugin will offer core output templates, but the user can use their own templates. Output templates must respect the following rules:

Templates use **Jinja2 syntax** with the following format:

```markdown
## {{ section_title }}

{{ content }}

{# Instructions:

- Replace {{ content }} with the actual content
- Additional guidance for this section
- Suggested elements (include others as needed):
  - Element 1
  - Element 2
    #}
```

**Key principles:**

- Use `{{ variable_name }}` for all placeholders (Jinja2 syntax)
- Use `{# comment #}` for template instructions
- Use `{% if condition %}...{% endif %}` for conditional content
- Use `{% for item in items %}...{% endfor %}` for loops
- Mark suggested elements as "include others as needed" to allow flexibility

Here are the base outputs that will be included in the plugin.

#### Workflow Progress

Generated at the start of the workflow if the track-progress argument is enabled. This is a **JSON document** (progress.json) that serves as the main document used to orchestrate long-running workflows. The format is machine-optimized but human-readable:

```json
{
  "schema_version": "1.0",
  "workflow_id": "uuid",
  "workflow_name": "plan-build-validate",
  "status": "running",
  "started_at": "2024-01-15T10:30:00Z",
  "current_step": {
    "name": "build",
    "retry_count": 0,
    "started_at": "2024-01-15T10:35:00Z"
  },
  "completed_steps": [
    {
      "name": "plan",
      "status": "completed",
      "started_at": "...",
      "completed_at": "...",
      "retry_count": 0,
      "output_summary": "Created plan with 3 milestones"
    }
  ],
  "pending_steps": ["validate", "create-pr"],
  "running_steps": [],
  "parallel_branches": [
    {
      "branch_id": "analyse-bug",
      "status": "running",
      "worktree_path": ".worktrees/workflow-analyse-abc123",
      "progress_file": ".worktrees/workflow-analyse-abc123/agentic/progress.json"
    }
  ],
  "errors": [],
  "variables": {}
}
```

Sessions note their progress in this document. The orchestrator selects which step to trigger next based on the workflow progress. This document is also how the orchestrator knows if an error must cause the workflow to stop (e.g., a session reached max retry) or if the workflow is completed.

**Concurrency:** File locking prevents race conditions when multiple parallel Claude sessions write to progress.json. Use the `filelock` library for cross-platform support (acquires exclusive lock before writing, releases immediately after).

**Human Input Handling:**

For `wait-for-human` steps, the orchestrator:

1. Displays the `message` to the terminal
2. Polls `progress.json` until `human_input` field is populated for that step
3. User provides input via CLI command: `agentic-sdlc input <workflow-id> "<response>"`
4. Spawns a Claude session with step context + human input to validate and act on feedback
5. Marks step complete and continues with subsequent steps

#### Checkpoint

A single **markdown document** per workflow (checkpoint.md) used to store checkpoints on-demand. Contains information about current progress, issues discovered, and data that should be communicated to another Claude session. The checkpoint acts as a notebook for sessions and enables basic communication between them.

Checkpoints are created on-demand via skill invocation or when explicitly specified in a prompt. Each checkpoint entry has a **YAML frontmatter header** for machine-parseable metadata, followed by human-readable markdown content:

```markdown
---
checkpoint_id: chk-001
step: build
created: 2024-01-15T14:30:00Z
workflow_id: abc-123
status: in_progress
---

## Context

Completed Milestone 1 and 2 of the implementation plan.

## Progress

- [x] Task 1.1: Setup OAuth configuration
- [x] Task 1.2: Add dependencies
- [x] Task 2.1: Create auth middleware
- [ ] Task 2.2: Add route protection (in progress)

## Notes for Next Session

The auth middleware uses the existing ErrorBoundary pattern.
See src/middleware/auth.ts for the implementation.

## Issues Discovered

Rate limiting may need to be added - not in original plan.

---

---

checkpoint_id: chk-002
step: validate
created: 2024-01-15T15:45:00Z
workflow_id: abc-123
status: completed

---

## Context

Validation phase completed with 2 minor issues found.

...
```

The YAML frontmatter enables:

- Machine-parseable metadata (checkpoint_id, step, timestamp)
- Easy querying by step or time
- Human-readable content in markdown body

#### Plans

Exact same plan as the interactive-sdlc plugin (only the plan section of the command)

plugins\interactive-sdlc\commands\plan

#### Analysis

Exact same template as the interactive-sdlc analyse commands templates

plugins\interactive-sdlc\commands\analyse

### Workflow Steps

The workflow steps are the blocks that can be defined in a .yaml workflow file.

#### Run Claude with a prompt

The most basic step, it simply is configured with a prompt, and this prompt is passed to a Claude Session.

#### Execute a command with Claude

Request Claude to execute a specific command, with provided arguments

#### Parallel step

Execute the nested steps in parallel

#### Conditional step

Execute the step nested in it only if the condition is met

#### Recurring step

Execute this step(s) embedded a specific amount of time, to increase success rate

### Workflows

Workflows are yaml files that re-use building blocks to create full set of automation, that will be executed by one or multiple sessions of Claude Code. The plugin will offers base workflows, but the main goal of this framework is to allow a user to create and customize it's own workflows. Here's a list of examples workflows that should be included in the plugin.

#### Analyse Codebase

Supported arguments:

- autofix "level" => --autofix "Major" => This will make the workflow trigger another claude session after each analyse command complete, to create a git branch, fix every issues at or above the selected level (major and critical in this case), commit and push the changes and open a PR.

Run in parallel all 5 analyse commands (bug, debt, doc, security, style), with one claude session per analyse command. One list of improvement is generated for each commands.

When autofix is enabled, the workflow is composed of 5 branches, that each have two steps (analyse + fix). The branches run in parallel, each in a dedicated git worktree to avoid conflict.

#### One Shot

A single step and session, use to complete a specific task, is a git worktree, from start to finish. Analyse the prompt request and code, create a git branch, make the changes, commit and push the code, create a PR

#### Plan Build Validate

Multiple steps, one Claude session per step:

- The python orchestrator uses the Claude orchestrator command to create the progress document initially. Then, the python orchestrator loops, using the Claude orchestrator command to know which step to execute next.
- Plan using the plan command and appropriate plan type.
- Build: create a branch, implement the changes following the plan, commit the changes after every milestone. Each milestone starts a new Claude session to ensure fresh context. Sessions update the workflow progress document upon completion and optionally create checkpoints for additional context that must be preserved.
- Validate the changes based on the plan and diff in the current branch
- Fix issues identified by the validation (default major+, configurable with argument)
- Create a PR

## Open Questions

The following questions need to be validated or clarified during implementation:

### Parallel Progress Document Sharing

For parallel steps using git worktrees, can they share a single progress.json file, or do they need separate files that merge at sync point?

**Current decision**: Use separate progress files per worktree branch, merged by the Python orchestrator when the parallel block completes.

## Future Development

The following elements are ideas for future development that must not be included in the implementation plan of the agentic workflows.

- Support other CLI tools such as Codex CLI, Cursor CLI and Copilot CLI
- Fine-grained permission framework that is permissive enough to allow agents to run without issue but does not provide every permission
- Memory embeddings for semantic search (optional pgvector integration)
- Web dashboard for workflow monitoring
- Distributed workflow execution across multiple machines
- Nested workflows: A step that runs a full existing workflow, enabling workflows within workflows
- Progress webhooks for CI/CD integration (on-step-complete, on-error notifications)
- `first-success` merge strategy for parallel steps (Phase 1 only implements `wait-all`)

## References

### Existing Agentic Plugins

#### agentic-core

docs/vision/agentic-core.md

This plugin is planned for multi-agent meeting functionality using Kafka and PostgreSQL. While some patterns can be referenced, agentic-sdlc is standalone and does not depend on it. Key differences:

- agentic-core uses Kafka for agent communication; agentic-sdlc uses file-based state
- agentic-core uses PostgreSQL + pgvector for memory; agentic-sdlc uses YAML frontmatter with file glob patterns
- agentic-core supports multi-agent meetings; agentic-sdlc focuses on YAML-driven workflow execution

## Design Decisions

This section documents key architectural decisions made during requirements definition.

### Orchestration Architecture: Hybrid Python + Claude

The main orchestrator uses a hybrid approach where Python handles deterministic operations and Claude makes intelligent decisions:

```
Python Orchestrator (outer loop)
├── Parse YAML workflow
├── Initialize workflow progress document
├── Loop until workflow complete:
│   ├── Call Claude "Orchestrator Command" with:
│   │   - Current workflow progress document
│   │   - Workflow definition
│   │   - Last step outputs
│   ├── Parse Claude's JSON response
│   ├── Execute the indicated step (new Claude session)
│   ├── Update workflow progress document
│   └── Handle errors/retries
└── Generate final output/report
```

**Responsibility Split:**

| Responsibility            | Owner  | Rationale          |
| ------------------------- | ------ | ------------------ |
| Parse YAML workflow       | Python | Deterministic      |
| Read/write progress.json  | Python | File I/O           |
| Decide next step          | Claude | Requires judgment  |
| Evaluate conditions       | Claude | May need context   |
| Spawn Claude sessions     | Python | Process management |
| Retry logic               | Python | Deterministic      |
| Timeout enforcement       | Python | Process management |
| Git worktree operations   | Python | Shell commands     |
| Merge conflict resolution | Claude | Requires judgment  |

**Rationale:**

1. Python handles deterministic workflow parsing, file I/O, parallelism, timeouts
2. Claude makes intelligent decisions about workflow state, error recovery, next steps
3. The JSON contract between Python and Claude is fixed and predictable
4. Claude Orchestrator doesn't execute - it only decides (avoids context bloat)
5. Each step runs in isolated sessions, preventing context accumulation

**Orchestrator JSON Response Schema:**

```json
{
  "workflow_status": "in_progress | completed | failed | blocked",
  "next_action": {
    "type": "execute_step | retry_step | wait_for_human | complete | abort",
    "step_name": "implement",
    "context_to_pass": "string context for the step"
  },
  "reasoning": "Why this decision was made",
  "progress_update": "What to add to progress document"
}
```

**Invalid response handling:** If Claude returns malformed JSON or an invalid `next_action.type`, the Python orchestrator retries up to the configured `max-retry` count, then fails the workflow.

### Session Management: New Session Per Step

Each workflow step starts a **new Claude Code session**. No session resume functionality is implemented to keep the architecture simple.

**Rationale:**

- Simplifies implementation (no session ID tracking)
- Avoids issues with session garbage collection
- Forces explicit context passing via checkpoints and progress documents
- Each step is self-contained and restartable

### Crash Recovery

If the Python orchestrator crashes mid-workflow:

1. **Orphaned worktrees**: Cleaned up at next workflow start using `git worktree prune` plus prefix-based cleanup for stale worktrees
2. **Resume from progress document**: The workflow progress document tracks state; on restart, `in_progress` steps are reset to `pending` and retried
3. **In-flight Claude sessions**: Die with the parent process; treated as failed steps and retried on resume

```python
def start_workflow():
    # Clean any orphaned worktrees from previous runs
    subprocess.run(["git", "worktree", "prune"])
    for wt in list_worktrees():
        if wt.startswith(".worktrees/agentic-") and is_stale(wt):
            subprocess.run(["git", "worktree", "remove", "--force", wt])

def resume_workflow(progress_file):
    progress = load_progress(progress_file)
    for step in progress.steps:
        if step.status == "completed":
            continue
        if step.status == "in_progress":
            step.status = "pending"  # Retry from scratch
        execute_step(step)
```

### Session Timeout

Claude session timeouts are enforced via Python-side process timeout using `subprocess` timeout parameters. If a session hangs without returning, it is killed and treated as a failed step.

### Context Management for Large Features

For large feature builds, context is managed through milestone-based decomposition:

1. **Plan produces discrete, independent milestones**: Each milestone should be completable without knowledge of other milestones' implementation details
2. **Orchestrator is the source of truth**: Tracks completed milestones, file changes, test results externally
3. **Each Claude invocation is a worker**: Gets task description + relevant file content, nothing more
4. **Context = task prompt + target files**: Not accumulated history

This mirrors how real teams work: developers don't need to know every line their teammates wrote, just the interfaces and their specific assignment.

Plan results include a first section with a short list of every milestone and task used to track progress. When an implementation session ends, it updates the plan with the progress made.

### Progress Document Format: JSON

The workflow progress document uses **JSON format** (not markdown) for machine-optimized parsing while remaining human-readable.

### Checkpoints: On-Demand Only

Checkpoints are created **on-demand via skill invocation** rather than automatically after every step. A single checkpoint.md file per workflow stores all checkpoints.

### Memory System: File-Based with Frontmatter

Memory uses **simple keyword matching** in YAML frontmatter or file glob patterns. No database or vector embeddings required. Memories are **permanent** and accumulate over time.

### Error Handling: Same Prompt, New Session

When a step fails and max-retry allows, the retry uses the **same prompt in a new session**. No exponential backoff between retries.

**Retry error context:** When retrying a failed step, the Python orchestrator captures and passes error context to the new session:

```
Previous attempt failed with error: {error_message}
Error type: {error_type}
Last checkpoint: {checkpoint_summary}
```

For **Recoverable** errors (test failures, validation errors), Claude auto-fixes the issues without external guidance.

### Parallel Execution: Git Worktrees

Parallel steps use **git worktrees** for isolation. Each parallel branch has its own progress file, merged by the Python orchestrator when the parallel block completes.

The orchestrator limits concurrent Claude sessions to `max_workers` (default: 4) to prevent resource exhaustion. Additional parallel steps queue until a slot is available.

### Graceful Shutdown

The Python orchestrator handles SIGINT/SIGTERM (Ctrl+C) by:

1. Setting workflow status to `cancelled`
2. Sending SIGTERM to running Claude processes
3. Waiting up to 30 seconds for graceful cleanup
4. Updating progress.json with final state
5. Running `git worktree prune` to clean orphaned worktrees

**Note:** On Windows, the orchestrator handles CTRL_C_EVENT and CTRL_BREAK_EVENT equivalently.

### Configuration Inheritance

Configuration follows a hierarchical override pattern:

**Precedence order (highest to lowest):**

1. Step-level settings (in workflow YAML)
2. Workflow-level settings (in workflow YAML `settings:` block)
3. Global configuration (`agentic/config.json`)

A single **global configuration** stored in `agentic/config.json`. Per-workflow and per-step configuration overrides via workflow YAML settings.

### Template Engine: Jinja2

All templates (YAML, outputs, prompts) use **Jinja2 syntax** for consistency.

**Security:** Dangerous Jinja2 features (exec, import) are disabled. Templates cannot access the filesystem or environment variables.

### Path Handling (Cross-Platform)

1. **Always use relative paths from repo root** (not absolute paths like `/agentic`)
2. **In YAML/JSON**: Always use forward slashes (`agentic/memory/`)
3. **In Python**: Use `pathlib.Path` consistently, never string concatenation
4. **When writing paths to YAML/JSON**: Use `Path.as_posix()` for forward slashes

### Step Output Format

Step outputs use **structured JSON** (max 10 KB for metadata). This is the **internal orchestrator format** for storing step results. Claude sessions may return free-form output that the orchestrator wraps in this structure:

```json
{
  "success": true,
  "output_type": "document",
  "document_path": "agentic/plans/feature.md",
  "summary": "Created feature plan with 3 milestones",
  "metrics": { "files_changed": 0, "lines_added": 0 },
  "next_step_context": "Optional context for next step"
}
```

This output is stored in the workflow progress document and passed as input to the next workflow step.

## Related Frameworks

| Framework       | Similarity                           | Key Difference                         |
| --------------- | ------------------------------------ | -------------------------------------- |
| BMAD            | Structured planning methodology      | Too much project management overhead   |
| GetShitDone     | Prompts-only simplicity              | No workflow orchestration              |
| Ralph-Wiggum    | Loop-until-complete pattern          | Single-step focus (inspired recurring) |
| Composio        | Workflow orchestration for AI agents | API-focused, external service          |
| LangGraph       | Graph-based agent workflows          | Python library, not CLI-focused        |
| AutoGen         | Multi-agent conversation             | More chat-oriented, less task-oriented |
| CrewAI          | Agent crews with roles               | Role-playing focus, not SDLC-oriented  |
| Prefect/Airflow | Workflow orchestration               | Traditional DAG, not AI-native         |
| Semantic Kernel | Microsoft's agentic framework        | Heavy SDK, not file-based              |

**Agentic-SDLC differentiator:** File-based state, CLI subscription focus (Claude Max), YAML workflows, checkpoint/resume, memory system without databases
