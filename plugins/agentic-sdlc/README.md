# Agentic SDLC

## Overview

Agentic SDLC enables Claude Code to execute complex, multi-step tasks autonomously through YAML-based workflow orchestration. The framework provides fully independent operation with built-in resiliency, progress tracking, and error recovery across multi-session workflows.

Execute complete development workflows from planning through implementation to validation, with support for parallel execution, conditional logic, and iterative refinement.

- `/plan Add user profile with avatar upload` - Generate implementation plan
- `/validate` - Run validation checks
- `/analyze security` - Scan for security vulnerabilities
- `agentic-sdlc run plan-build-validate.yaml --var "task=Add feature"` - Run complete workflow

### Key Features

- **YAML Workflows**: Define complex multi-step processes with variables, conditions, and loops
- **Hybrid Orchestration**: Python handles deterministic operations, Claude makes intelligent decisions
- **Git Worktree Isolation**: Execute parallel tasks in isolated git worktrees
- **Progress Tracking**: Resume from checkpoints after interruptions or errors
- **Built-in Skills**: Plan, build, validate, analyze, and git operations
- **Error Recovery**: Automatic retry with configurable strategies

## Documentation

- **[Quick Start](docs/QuickStart.md)** - Get running in 5 minutes
- **[Workflow Builder Guide](docs/WorkflowBuilder.md)** - Complete workflow authoring documentation
- **[Workflow Example](docs/workflow-example.yaml)** - Annotated reference with all options
- **[Contributing](docs/Contributing.md)** - Development and testing guidelines

## Skills

### Planning and Validation

| Skill              | Description                                                 |
| ------------------ | ----------------------------------------------------------- |
| `/plan`            | Create an implementation plan for a task                    |
| `/validate`        | Validate implementation against plan and quality standards  |
| `/orchestrate`     | Evaluate workflow state and determine next action           |
| `/add-improvement` | Add a new improvement to the improvements tracking document |

### Analysis

| Skill               | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `/analyze bug`      | Analyze codebase for bugs, logic errors, and runtime issues                |
| `/analyze debt`     | Identify technical debt, optimization opportunities, and refactoring needs |
| `/analyze doc`      | Analyze documentation quality, accuracy, and completeness                  |
| `/analyze security` | Scan for security vulnerabilities, unsafe patterns, and dependency issues  |
| `/analyze style`    | Check code style, consistency, and best practices adherence                |

### Git Operations

| Skill         | Description                                                 |
| ------------- | ----------------------------------------------------------- |
| `/git-branch` | Create a git branch following naming convention             |
| `/git-commit` | Create a git commit with structured message                 |
| `/git-pr`     | Create a pull request with contextual title and description |

### Workflow Support

| Skill                | Description                                             |
| -------------------- | ------------------------------------------------------- |
| `/create-checkpoint` | Create a checkpoint to track progress and share context |
| `/create-log`        | Add a log entry to the workflow log                     |
| `/fix-analyze`       | Fix issues from an analysis document iteratively        |
| `/create-skill`      | Create a new Claude Code skill following best practices |

## Agents

| Agent      | Description                                                   |
| ---------- | ------------------------------------------------------------- |
| `explorer` | Efficiently explores codebase to find relevant files and code |
| `reviewer` | Reviews code for quality, correctness, and best practices     |

## Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\agentic-sdlc"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/agentic-sdlc
```

## Python CLI

### CLI Commands

| Command                              | Description                                      |
| ------------------------------------ | ------------------------------------------------ |
| `agentic-sdlc run <workflow.yaml>`   | Execute a workflow from YAML file                |
| `agentic-sdlc workflows`             | List available workflows with descriptions       |
| `agentic-sdlc init`                  | Copy bundled workflows locally for customization |
| `agentic-sdlc list`                  | Show workflow execution history                  |
| `agentic-sdlc status <id>`           | Check workflow execution status                  |
| `agentic-sdlc resume <id>`           | Resume a paused or failed workflow               |
| `agentic-sdlc input <id> <response>` | Provide human input for wait-for-human steps     |
| `agentic-sdlc configure`             | Interactive configuration setup                  |

### CLI Options

| Flag              | Description            |
| ----------------- | ---------------------- |
| `--var key=value` | Set workflow variables |
| `--verbose, -v`   | Show verbose output    |

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

### /plan

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

### /validate

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

### /analyze

**Arguments:**

- `<type>` - Analysis type: bug, debt, doc, security, style (required)
- `[paths...]` - Space-separated list of files or directories to analyze

**Examples:**

```bash
# Analyze entire codebase for security issues
/analyze security

# Analyze specific paths for bugs
/analyze bug src/auth src/api

# Multiple analysis types
/analyze debt src/legacy
/analyze style src/components
/analyze doc docs/
```

### /git-branch

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

### /git-commit

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

### /git-pr

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

# Run one-shot workflow for quick task completion
agentic-sdlc run one-shot.yaml --var "task=Fix null pointer in UserService"

# Run analysis workflow
agentic-sdlc run analyze-single.yaml --var "analysis_type=security" --var "autofix=major"
```

### agentic-sdlc workflows (Python CLI)

**Options:**

- `--verbose, -v` - Show workflow variables and full descriptions

**Examples:**

```bash
# List all available workflows
agentic-sdlc workflows

# Show detailed information including variables
agentic-sdlc workflows --verbose
```
