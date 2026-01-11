# Agentic SDLC

Agentic SDLC enables Claude Code to execute complex, multi-step tasks with high success rates through YAML-based workflow orchestration. The framework allows Claude Code to work fully independently with resiliency and accuracy in multi-session workflows, supporting parallel execution, conditional logic, retry mechanisms, and persistent memory across sessions.

## Overview

Agentic SDLC provides a complete framework for automating software development tasks from simple one-shot operations to complex multi-step workflows. The plugin combines a Python CLI orchestrator with Claude Code commands, agents, and skills to enable fully autonomous task execution with built-in error recovery and progress tracking.

Key capabilities:

- YAML workflow definitions with variables, conditions, and parallel execution
- Hybrid Python + Claude orchestration model for reliability
- Git worktree isolation for parallel task execution
- Persistent memory system for cross-session learning
- Progress tracking and checkpoint management

Quick examples:

- `agentic-sdlc run plan-build-validate.yaml` - Run bundled workflow (works immediately)
- `agentic-sdlc init` - Copy bundled workflows locally to customize
- `agentic-sdlc one-shot "Add user authentication"` - Complete a task end-to-end with PR
- `agentic-sdlc analyse --type security` - Run security analysis on codebase
- `/plan --type feature` - Generate a feature implementation plan
- `/build --plan plan.md` - Implement changes following a plan

## Commands

### Core Commands

| Command        | Description                                                   |
| -------------- | ------------------------------------------------------------- |
| `/plan`        | Generate implementation plans for features, bugs, or chores   |
| `/build`       | Implement changes following a plan file                       |
| `/validate`    | Run validation checks on implementation                       |
| `/analyse`     | Analyze codebase for issues (bug, debt, doc, security, style) |
| `/orchestrate` | Evaluate workflow state and determine next action             |

### Git Commands (`commands/git/`)

| Command       | Description                                      |
| ------------- | ------------------------------------------------ |
| `/git-branch` | Create and manage git branches                   |
| `/git-commit` | Create commits with structured messages          |
| `/git-pr`     | Create pull requests with generated descriptions |

## Agents

| Agent      | Description                                                           |
| ---------- | --------------------------------------------------------------------- |
| `explorer` | Explores codebase efficiently to find relevant files and line numbers |
| `reviewer` | Validates tests, reviews code quality, and ensures correctness        |

## Skills

| Skill                | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| `/create-memory`     | Create persistent memory documents for patterns and learnings |
| `/search-memory`     | Search existing memories by category, tags, or content        |
| `/create-checkpoint` | Create checkpoint entries in workflow checkpoint file         |
| `/create-log`        | Add log entries to workflow log file                          |

## Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\agentic-sdlcs"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/agentic-sdlcs
```

## Python CLI

### CLI Commands

| Command                  | Description                                  |
| ------------------------ | -------------------------------------------- |
| `agentic-sdlc run`       | Execute a workflow from YAML file            |
| `agentic-sdlc init`      | Copy bundled workflow templates locally      |
| `agentic-sdlc resume`    | Resume a paused or failed workflow           |
| `agentic-sdlc status`    | Check workflow execution status              |
| `agentic-sdlc cancel`    | Cancel a running workflow                    |
| `agentic-sdlc list`      | List workflow executions                     |
| `agentic-sdlc input`     | Provide human input for wait-for-human steps |
| `agentic-sdlc one-shot`  | Execute a single task end-to-end             |
| `agentic-sdlc analyse`   | Run codebase analysis                        |
| `agentic-sdlc configure` | Interactive configuration setup              |
| `agentic-sdlc config`    | Get or set configuration values              |
| `agentic-sdlc memory`    | Manage memory documents                      |

### CLI Options

| Flag                | Description                                     |
| ------------------- | ----------------------------------------------- |
| `--var key=value`   | Pass variables to workflow                      |
| `--from-step`       | Resume from specific step                       |
| `--terminal-output` | Output verbosity: `base` or `all`               |
| `--type`            | Analysis type: bug, debt, doc, security, style  |
| `--autofix`         | Auto-fix severity: none, minor, major, critical |
| `--git`             | Enable git operations                           |
| `--pr`              | Create pull request on completion               |

## Configuration

Configuration is stored in `agentic/config.json`. Use the CLI or `/configure` command to modify settings.

```json
{
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
    "directory": "agentic/memory"
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

## Architecture

The framework uses a hybrid Python + Claude orchestration model:

```
Python Orchestrator -> Parse YAML -> Initialize Progress -> Loop:
  -> Claude Orchestrator Command (decide next step)
  -> Execute Step (new Claude session)
  -> Update Progress -> Handle Errors/Retries
-> Generate Output
```

Key architectural decisions:

- **New session per step**: Each workflow step runs in a fresh Claude session to prevent context accumulation
- **Python handles deterministic operations**: Parsing, file I/O, timeouts, process management
- **Claude handles intelligent decisions**: Next step selection, condition evaluation, error recovery
- **Git worktrees for parallelism**: Parallel steps execute in isolated worktrees to prevent conflicts
- **File-based state**: Progress tracked in `progress.json`, memories in markdown with frontmatter

### Workflow Step Types

| Type             | Description                                                                       |
| ---------------- | --------------------------------------------------------------------------------- |
| `prompt`         | Execute a prompt in a Claude session                                              |
| `command`        | Execute a Claude command with arguments                                           |
| `parallel`       | Execute nested steps concurrently in git worktrees                                |
| `conditional`    | Execute steps based on Jinja2 condition                                           |
| `ralph-loop`     | Repeat a prompt until completion promise or max iterations (Ralph Wiggum pattern) |
| `wait-for-human` | Pause workflow for human input                                                    |

### Output Directory Structure

```
agentic/
├── config.json           # Global configuration
├── workflows/            # Workflow executions
│   └── {workflow-id}/
│       ├── progress.json # Workflow progress
│       ├── checkpoint.md # Checkpoints
│       └── logs.ndjson   # Structured logs
├── memory/               # Persistent memories
│   ├── decisions/
│   ├── patterns/
│   └── index.md          # Memory index
└── analysis/             # Analysis outputs
    ├── bug.md
    ├── debt.md
    ├── doc.md
    ├── security.md
    └── style.md
```

## Limitations

- Parallel steps require git repository (uses worktrees for isolation)
- Each step starts a new session (no context accumulation across steps)
- Memory search uses keyword matching (no semantic/vector search)

## Complete Examples

### agentic-sdlc run

**Arguments:**

- `<workflow.yaml>` - Path to workflow YAML file (required)
- `--var key=value` - Pass variable to workflow (repeatable)
- `--from-step <step>` - Resume from specific step
- `--terminal-output <level>` - Output verbosity: `base` (default) or `all`

**Path Resolution:**

The `run` command automatically resolves workflow paths in this order:

1. Exact path (absolute or relative to current directory)
2. `agentic/workflows/<name>` (local project workflows)
3. Bundled plugin workflows (included with the plugin)

This means bundled workflows work immediately without copying files locally.

**Examples:**

```bash
# Run a bundled workflow directly (no setup needed)
agentic-sdlc run plan-build-validate.yaml

# Run with variables
agentic-sdlc run one-shot.yaml --var "task=Add login feature"

# Run a local workflow
agentic-sdlc run agentic/workflows/my-custom-workflow.yaml

# Resume from a specific step
agentic-sdlc run workflow.yaml --from-step validate

# Show all Claude output
agentic-sdlc run workflow.yaml --terminal-output all
```

### agentic-sdlc init

**Arguments:**

- `--list` - List available bundled workflows without copying
- `--force` - Overwrite existing workflow files

**Examples:**

```bash
# List available bundled workflows
agentic-sdlc init --list

# Copy all bundled workflows to agentic/workflows/
agentic-sdlc init

# Overwrite existing local workflows with bundled versions
agentic-sdlc init --force
```

### agentic-sdlc resume

**Arguments:**

- `<workflow-id>` - ID of workflow to resume (required)

**Examples:**

```bash
# Resume a paused workflow
agentic-sdlc resume abc123

# Resume after fixing an issue
agentic-sdlc resume plan-build-validate-2024-01-15
```

### agentic-sdlc status

**Arguments:**

- `<workflow-id>` - ID of workflow to check (required)

**Examples:**

```bash
# Check workflow status
agentic-sdlc status abc123
```

### agentic-sdlc list

**Arguments:**

- `--status <status>` - Filter by status: running, completed, failed, paused

**Examples:**

```bash
# List all workflows
agentic-sdlc list

# List only running workflows
agentic-sdlc list --status running

# List failed workflows
agentic-sdlc list --status failed
```

### agentic-sdlc cancel

**Arguments:**

- `<workflow-id>` - ID of workflow to cancel (required)

**Examples:**

```bash
# Cancel a running workflow
agentic-sdlc cancel abc123
```

### agentic-sdlc input

**Arguments:**

- `<workflow-id>` - ID of workflow waiting for input (required)
- `<response>` - Human response text (required)

**Examples:**

```bash
# Provide input to a waiting workflow
agentic-sdlc input abc123 "Approved. Proceed with implementation."

# Provide feedback on a plan
agentic-sdlc input abc123 "Please also add input validation for the email field."
```

### agentic-sdlc one-shot

**Arguments:**

- `<prompt>` - Task description (required)
- `--git` - Enable git operations (branch, commit)
- `--pr` - Create pull request on completion

**Examples:**

```bash
# Complete a task with PR
agentic-sdlc one-shot "Add user authentication with JWT tokens" --git --pr

# Complete a task without PR
agentic-sdlc one-shot "Fix the null pointer exception in UserService" --git

# Simple task without git
agentic-sdlc one-shot "Update the README with installation instructions"
```

### agentic-sdlc analyse

**Arguments:**

- `--type <type>` - Analysis type: bug, debt, doc, security, style (default: all)
- `--autofix <level>` - Auto-fix severity: none, minor, major, critical

**Examples:**

```bash
# Run all analysis types in parallel
agentic-sdlc analyse

# Run security analysis only
agentic-sdlc analyse --type security

# Run analysis with auto-fix for major issues
agentic-sdlc analyse --autofix major

# Run specific analysis with auto-fix
agentic-sdlc analyse --type debt --autofix minor
```

### agentic-sdlc configure

Interactive configuration wizard. No arguments required.

```bash
agentic-sdlc configure
```

### agentic-sdlc config

**Subcommands:**

- `get <key>` - Get configuration value
- `set <key> <value>` - Set configuration value

**Examples:**

```bash
# Get a configuration value
agentic-sdlc config get defaults.maxRetry

# Set a configuration value
agentic-sdlc config set defaults.maxRetry 5
agentic-sdlc config set git.mainBranch develop
agentic-sdlc config set logging.level Warning
```

### agentic-sdlc memory

**Subcommands:**

- `list [--category <cat>]` - List memories, optionally filtered by category
- `search <query>` - Search memories by keywords
- `prune [--older-than <duration>]` - Remove old memories

**Examples:**

```bash
# List all memories
agentic-sdlc memory list

# List memories by category
agentic-sdlc memory list --category pattern
agentic-sdlc memory list --category error

# Search memories
agentic-sdlc memory search "authentication middleware"

# Prune old memories
agentic-sdlc memory prune --older-than 30d
```

### /plan

**Arguments:**

- `--type <type>` - Plan type: feature, bug, chore (required)
- `--spec <path>` - Path to specification file
- `--output <path>` - Output file path

**Examples:**

```bash
# Generate a feature plan
/plan --type feature Add user profile page with avatar upload

# Generate a bug fix plan
/plan --type bug Fix login timeout issue in production

# Generate a chore plan
/plan --type chore Update all npm dependencies to latest versions
```

### /build

**Arguments:**

- `--plan <path>` - Path to plan file (required)
- `--milestone <n>` - Implement specific milestone only

**Examples:**

```bash
# Implement all milestones from a plan
/build --plan agentic/outputs/abc123/plan.md

# Implement specific milestone
/build --plan plan.md --milestone 2
```

### /validate

**Arguments:**

- `--severity <level>` - Minimum severity to report: minor, major, critical

**Examples:**

```bash
# Run full validation
/validate

# Report only major and critical issues
/validate --severity major
```

### /analyse

**Arguments:**

- `--type <type>` - Analysis type: bug, debt, doc, security, style
- `--template <path>` - Custom output template

**Examples:**

```bash
# Run security analysis
/analyse --type security

# Run code style analysis
/analyse --type style

# Run with custom template
/analyse --type debt --template templates/custom-debt.md.j2
```

### /create-memory

**Arguments:**

- `--category <cat>` - Memory category: pattern, lesson, error, decision, context
- `--tags <tags>` - Comma-separated tags for searchability

**Examples:**

```bash
# Create a pattern memory
/create-memory --category pattern --tags "authentication,middleware"
Discovered custom middleware chain pattern in src/middleware/

# Create an error memory
/create-memory --category error --tags "timeout,database"
Database connection timeout solution: increase pool size
```

### /search-memory

**Arguments:**

- `--category <cat>` - Filter by category
- `--tags <tags>` - Filter by tags
- `<query>` - Search keywords

**Examples:**

```bash
# Search by keywords
/search-memory authentication middleware

# Search by category
/search-memory --category pattern

# Search by tags
/search-memory --tags "database,optimization"
```

### /create-checkpoint

**Arguments:**

- `--step <name>` - Current step name
- `--status <status>` - Checkpoint status: in_progress, completed

**Examples:**

```bash
# Create checkpoint for current progress
/create-checkpoint --step build --status in_progress
Completed Milestone 1 and 2. Starting Milestone 3.

# Create completion checkpoint
/create-checkpoint --step validate --status completed
All validation checks passed.
```

### /create-log

**Arguments:**

- `--level <level>` - Log level: Critical, Error, Warning, Information
- `--step <name>` - Step name for context

**Examples:**

```bash
# Log informational message
/create-log --level Information --step build
Completed implementation of authentication module

# Log warning
/create-log --level Warning --step validate
Test coverage below 80% threshold

# Log error
/create-log --level Error --step build
Failed to compile TypeScript: missing type definitions
```

### Workflow YAML Structure

**Basic structure:**

```yaml
name: workflow-name
version: "1.0"
description: What this workflow does

settings:
  max-retry: 3
  timeout-minutes: 60
  track-progress: true
  git:
    enabled: true
    auto-commit: true
    auto-pr: true

variables:
  - name: task
    type: string
    required: true
    description: Task to complete

steps:
  - name: step-name
    type: prompt
    prompt: |
      {{ variables.task }}
    model: sonnet
```

**Parallel execution:**

```yaml
steps:
  - name: parallel-analysis
    type: parallel
    merge-strategy: wait-all
    steps:
      - name: security
        type: command
        command: analyse
        args:
          type: security
      - name: style
        type: command
        command: analyse
        args:
          type: style
```

**Conditional execution:**

```yaml
steps:
  - name: fix-issues
    type: conditional
    condition: "{{ outputs.validate['issues_count'] > 0 }}"
    then:
      - name: apply-fixes
        type: command
        command: build
        args:
          plan: fix-plan.md
```

**Ralph Loop (iterative prompt with completion detection):**

````yaml
steps:
  - name: implement-iteratively
    type: ralph-loop
    prompt: |
      Follow the plan in agentic/plan.md and implement the next incomplete task.
      After implementing, mark it complete in the plan.

      When ALL tasks are complete, output:
      ```json
      {"ralph_complete": true, "promise": "COMPLETE"}
      ```
    max-iterations: 10
    completion-promise: "COMPLETE"
    model: sonnet
````

The Ralph Loop pattern creates a fresh Claude session for each iteration, repeating the same prompt until Claude outputs a JSON completion signal or max iterations is reached. State is tracked in `agentic/outputs/{id}/ralph-{step}.md`.
