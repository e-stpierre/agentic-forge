# Agentic SDLC

Agentic SDLC enables Claude Code to execute complex, multi-step tasks autonomously through YAML-based workflow orchestration. The framework provides fully independent operation with built-in resiliency, progress tracking, and error recovery across multi-session workflows.

## Overview

Execute complete development workflows from planning through implementation to validation, with support for parallel execution, conditional logic, and iterative refinement.

- `/plan Add user profile with avatar upload` - Generate implementation plan
- `/build --plan plan.md` - Implement the plan
- `/validate` - Run validation checks
- `agentic-sdlc run plan-build-validate.yaml --var "task=Add feature"` - Run complete workflow

## Commands

### Planning and Implementation (`commands/`)

| Command | Description |
|---------|-------------|
| `/agentic-sdlc:plan` | Create an implementation plan for a task |
| `/agentic-sdlc:build` | Implement changes following a plan |
| `/agentic-sdlc:validate` | Validate implementation against plan and quality standards |
| `/agentic-sdlc:orchestrate` | Evaluate workflow state and determine next action |
| `/agentic-sdlc:add-improvement` | Add a new improvement to the improvements tracking document |

### Analysis (`commands/analyze/`)

| Command | Description |
|---------|-------------|
| `/agentic-sdlc:analyze-bug` | Analyze codebase for bugs, logic errors, and runtime issues |
| `/agentic-sdlc:analyze-debt` | Identify technical debt, optimization opportunities, and refactoring needs |
| `/agentic-sdlc:analyze-doc` | Analyze documentation quality, accuracy, and completeness |
| `/agentic-sdlc:analyze-security` | Scan for security vulnerabilities, unsafe patterns, and dependency issues |
| `/agentic-sdlc:analyze-style` | Check code style, consistency, and best practices adherence |

### Git Operations (`commands/git/`)

| Command | Description |
|---------|-------------|
| `/agentic-sdlc:git-branch` | Create a git branch following naming convention |
| `/agentic-sdlc:git-commit` | Create a git commit with structured message |
| `/agentic-sdlc:git-pr` | Create a pull request with contextual title and description |

## Agents

| Agent | Description |
|-------|-------------|
| `agentic-sdlc:explorer` | Efficiently explores codebase to find relevant files and code |
| `agentic-sdlc:reviewer` | Reviews code for quality, correctness, and best practices |

## Skills

| Skill | Description |
|-------|-------------|
| `agentic-sdlc:create-checkpoint` | Create a checkpoint to track progress and share context |
| `agentic-sdlc:create-log` | Add a log entry to the workflow log |

## Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\agentic-sdlc"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/agentic-sdlc
```

## Python CLI

### CLI Commands

| Command | Description |
|---------|-------------|
| `agentic-sdlc run <workflow.yaml>` | Execute a workflow from YAML file |
| `agentic-sdlc one-shot <task>` | Complete a task end-to-end |
| `agentic-sdlc analyze` | Run codebase analysis (security, bugs, debt, style, docs) |
| `agentic-sdlc init` | Copy bundled workflows locally for customization |
| `agentic-sdlc list` | Show workflow execution history |
| `agentic-sdlc status <id>` | Check workflow execution status |
| `agentic-sdlc resume <id>` | Resume a paused or failed workflow |
| `agentic-sdlc input <id> <response>` | Provide human input for wait-for-human steps |
| `agentic-sdlc configure` | Interactive configuration setup |

### CLI Options

| Flag | Description |
|------|-------------|
| `--var key=value` | Set workflow variables |
| `--git` | Enable git operations |
| `--pr` | Create pull request on completion |
| `--type <type>` | Analysis type (security, bugs, debt, style, docs) |
| `--autofix <severity>` | Auto-fix issues at or above severity level |

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

Hybrid Python + Claude Orchestration:

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

Key Design Principles:

- Fresh Claude session per step (prevents context overflow)
- Python handles deterministic operations (parsing, I/O, timeouts)
- Claude handles intelligent decisions (conditions, error recovery)
- File-based state (progress.json, checkpoints, logs)
- Git worktrees for parallel step isolation

Directory Structure:

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

## Complete Examples

### /agentic-sdlc:plan

**Arguments:**
- `[type]` - Plan type: feature, bug, chore, auto (default: auto)
- `[output_dir]` - Directory to write plan.md file
- `[template]` - Custom template path
- `<context>` - Task description or issue reference (required)

**Examples:**

```bash
# Auto-detect plan type
/plan Add user authentication with OAuth support

# Specify plan type
/plan bug Fix null pointer exception in UserService

# With output directory
/plan --output_dir agentic/outputs/workflow-123 Add dark mode toggle
```

### /agentic-sdlc:build

**Arguments:**
- `[plan]` - Path to plan document or plan JSON
- `[milestone]` - Specific milestone to implement
- `[context]` - Additional context or instructions

**Examples:**

```bash
# Build from plan
/build --plan agentic/outputs/workflow-123/plan.md

# Build specific milestone
/build --plan plan.md --milestone 2

# Build with additional context
/build --plan plan.md Focus on error handling first
```

### /agentic-sdlc:validate

**Arguments:**
- `[plan]` - Path to plan document
- `[severity]` - Minimum severity to report: minor, major, critical (default: minor)

**Examples:**

```bash
# Basic validation
/validate

# Validate against plan
/validate --plan agentic/outputs/workflow-123/plan.md

# Only report major issues
/validate --severity major
```

### /agentic-sdlc:analyze-*

**Arguments:**
- `[paths...]` - Space-separated list of files or directories to analyze

**Examples:**

```bash
# Analyze entire codebase
/analyze-security

# Analyze specific paths
/analyze-bug src/auth src/api

# Multiple analysis types
/analyze-debt src/legacy
/analyze-style src/components
/analyze-doc docs/
```

### /agentic-sdlc:git-branch

**Arguments:**
- `[category]` - Branch type: poc, feature, fix, chore, doc, refactor (default: feature)
- `[name]` - Short kebab-case description
- `[base]` - Base branch to create from

**Examples:**

```bash
# Create feature branch
/git-branch feature add-user-auth

# Create from specific base
/git-branch fix login-bug main

# With issue reference (inferred from context)
/git-branch feature oauth-integration  # Creates feature/123_oauth-integration if issue #123 mentioned
```

### /agentic-sdlc:git-commit

**Arguments:**
- `[message]` - Override commit title
- `[files]` - Specific files to commit
- `[plan_step]` - Reference to plan step being completed

**Examples:**

```bash
# Auto-generate message from changes
/git-commit

# With custom message
/git-commit "Add OAuth callback handler"

# With plan step reference
/git-commit --plan_step "Task 3"
```

### /agentic-sdlc:git-pr

**Arguments:**
- `[title]` - PR title (auto-generated if not provided)
- `[body]` - PR body/description (auto-generated if not provided)
- `[base]` - Target branch (default: main)
- `[--draft]` - Create as draft PR

**Examples:**

```bash
# Auto-generate PR
/git-pr

# With custom title
/git-pr "Add OAuth authentication support"

# Create draft PR
/git-pr --draft

# Target specific base branch
/git-pr --base develop
```

### agentic-sdlc run (Python CLI)

**Options:**
- `<workflow.yaml>` - Path to workflow file (required)
- `--var key=value` - Set workflow variables (repeatable)

**Examples:**

```bash
# Run feature workflow
agentic-sdlc run plan-build-validate.yaml --var "task=Add user authentication"

# Run with multiple variables
agentic-sdlc run workflows/custom.yaml --var "task=Add feature" --var "priority=high"
```

### agentic-sdlc one-shot (Python CLI)

**Options:**
- `<task>` - Task description (required)
- `--git` - Enable git operations
- `--pr` - Create pull request on completion

**Examples:**

```bash
# Quick task
agentic-sdlc one-shot "Fix null pointer in UserService"

# With git and PR
agentic-sdlc one-shot "Add input validation to signup form" --git --pr
```

### agentic-sdlc analyze (Python CLI)

**Options:**
- `--type <type>` - Analysis type: security, bugs, debt, style, docs (default: all)
- `--autofix <severity>` - Auto-fix issues at or above severity: minor, major, critical

**Examples:**

```bash
# Run all analysis types
agentic-sdlc analyze

# Security analysis only
agentic-sdlc analyze --type security

# With auto-fix
agentic-sdlc analyze --type style --autofix major
```
