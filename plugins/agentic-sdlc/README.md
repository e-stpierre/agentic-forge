# Agentic SDLC

Agentic SDLC enables Claude Code to execute complex, multi-step tasks autonomously through YAML-based workflow orchestration. The framework provides fully independent operation with built-in resiliency, progress tracking, and error recovery across multi-session workflows.

## Overview

Execute complete development workflows from planning through implementation to validation, with support for parallel execution, conditional logic, and iterative refinement.

**Quick Examples:**

```bash
# Run a complete feature workflow
agentic-sdlc run plan-build-validate.yaml --var "task=Add user authentication"

# Quick one-shot task completion
agentic-sdlc one-shot "Fix null pointer in UserService" --git --pr

# Run security analysis
agentic-sdlc analyse --type security --autofix major
```

**Inside Claude Code:**

```bash
/plan Add user profile with avatar upload    # Generate implementation plan
/build --plan plan.md                         # Implement the plan
/validate                                     # Run validation checks
/git-pr                                       # Create pull request
```

## Key Features

- **YAML Workflows**: Define complex multi-step processes with variables, conditions, and loops
- **Hybrid Orchestration**: Python handles deterministic operations, Claude makes intelligent decisions
- **Git Worktree Isolation**: Execute parallel tasks in isolated git worktrees
- **Progress Tracking**: Resume from checkpoints after interruptions or errors
- **Built-in Commands**: Plan, build, validate, analyze, and git operations
- **Error Recovery**: Automatic retry with configurable strategies

## Documentation

- **[Quick Start](docs/QuickStart.md)** - Get running in 5 minutes
- **[Workflow Builder Guide](docs/WorkflowBuilder.md)** - Complete workflow authoring documentation
- **[Workflow Example](docs/workflow-example.yaml)** - Annotated reference with all options
- **[Contributing](docs/Contributing.md)** - Development and testing guidelines

## Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\agentic-sdlc"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/agentic-sdlc
```

## Common Workflows

### Plan -> Build -> Validate -> PR

```bash
agentic-sdlc run plan-build-validate.yaml --var "task=Add feature description"
```

This executes:
1. Generate implementation plan
2. Implement changes incrementally
3. Run validation (tests + code review)
4. Create pull request

### One-Shot Task Completion

```bash
agentic-sdlc one-shot "Your task description" --git --pr
```

Complete a task end-to-end with automatic git operations and PR creation.

### Codebase Analysis

```bash
# Run all analysis types in parallel
agentic-sdlc analyse

# Specific analysis with auto-fix
agentic-sdlc analyse --type security --autofix major
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `run <workflow.yaml>` | Execute a workflow from YAML file |
| `one-shot <task>` | Complete a task end-to-end |
| `analyse` | Run codebase analysis (security, bugs, debt, style, docs) |
| `init` | Copy bundled workflows locally for customization |
| `list` | Show workflow execution history |
| `status <id>` | Check workflow execution status |
| `resume <id>` | Resume a paused or failed workflow |
| `input <id> <response>` | Provide human input for wait-for-human steps |
| `configure` | Interactive configuration setup |

See [Quick Start](docs/QuickStart.md) for detailed command examples.

## Claude Commands

Available in Claude Code sessions:

**Planning & Implementation:**
- `/plan` - Generate implementation plans (feature, bug, chore)
- `/build` - Implement changes following a plan
- `/validate` - Run validation checks

**Analysis:**
- `/analyse-bug` - Find bugs and logic errors
- `/analyse-debt` - Identify technical debt
- `/analyse-doc` - Check documentation quality
- `/analyse-security` - Security vulnerability scan
- `/analyse-style` - Code style and best practices

**Git Operations:**
- `/git-branch` - Create git branch
- `/git-commit` - Create structured commit
- `/git-pr` - Create pull request

## Workflow Structure

Basic workflow anatomy:

```yaml
name: my-workflow
version: "1.0"
description: What this workflow does

settings:
  max-retry: 3
  timeout-minutes: 60
  git:
    enabled: true

variables:
  - name: task
    type: string
    required: true

steps:
  - name: generate-plan
    type: command
    command: agentic-sdlc:plan
    args:
      context: "{{ variables.task }}"

  - name: implement
    type: ralph-loop
    prompt: "Implement next milestone from plan"
    max-iterations: 10

  - name: validate
    type: command
    command: agentic-sdlc:validate
```

See [Workflow Builder Guide](docs/WorkflowBuilder.md) for complete documentation and [workflow-example.yaml](docs/workflow-example.yaml) for an annotated reference.

## Configuration

Configure via CLI or edit `agentic/config.json`:

```bash
# Interactive configuration
agentic-sdlc configure

# Get/set specific values
agentic-sdlc config get defaults.maxRetry
agentic-sdlc config set defaults.maxRetry 5
```

Default configuration:

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
  "defaults": {
    "maxRetry": 3,
    "timeoutMinutes": 60
  }
}
```

## Architecture

**Hybrid Python + Claude Orchestration:**

```
Python CLI -> Parse YAML -> Initialize Progress
   |
   v
Loop: Claude Orchestrator (decides next step)
   -> Execute Step (fresh Claude session)
   -> Update Progress
   -> Handle Errors/Retries
   |
   v
Generate Outputs
```

**Key Design Principles:**
- Fresh Claude session per step (prevents context overflow)
- Python handles deterministic operations (parsing, I/O, timeouts)
- Claude handles intelligent decisions (conditions, error recovery)
- File-based state (progress.json, checkpoints, logs)
- Git worktrees for parallel step isolation

## Directory Structure

```
agentic/
├── config.json           # Configuration
├── workflows/            # Custom workflows (created with 'init')
├── outputs/              # Workflow execution state
│   └── {workflow-id}/
│       ├── progress.json
│       ├── checkpoint.md
│       └── logs.ndjson
└── analysis/             # Analysis outputs
```

## Testing

```bash
# Run tests
uv run --extra dev pytest

# With coverage
uv run --extra dev pytest --cov --cov-report=term-missing
```

See [Contributing](docs/Contributing.md) for development guidelines.
