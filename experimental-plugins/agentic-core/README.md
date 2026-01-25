# Agentic Core

Foundational framework for AI agent orchestration - from 5-minute one-shot tasks to multi-day epic implementations. Supports multiple AI providers (Claude, Cursor, Codex, Copilot), declarative YAML workflows, crash recovery, and optional human-in-the-loop checkpoints.

## Overview

The Agentic Core plugin provides infrastructure for running AI agent workflows at any scale. It handles provider abstraction, workflow execution, crash recovery, and optional long-term memory.

- `agentic one-shot "Fix the login bug" --git --pr` - Quick single-agent task
- `agentic run workflows/feature.yaml --var feature="Add dark mode"` - Run declarative workflow
- `agentic meeting "Sprint planning" --agents architect:claude developer:cursor` - Multi-agent discussion

## Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\experimental-plugins\agentic-core"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/experimental-plugins/agentic-core

# Or install with memory support
uv tool install "~/.claude/plugins/marketplaces/agentic-forge/experimental-plugins/agentic-core[memory]"
```

## Python CLI

### CLI Commands

| Command                                | Description                                     |
| -------------------------------------- | ----------------------------------------------- |
| `agentic infra up\|down\|status\|logs` | Manage infrastructure (Kafka, PostgreSQL)       |
| `agentic run <workflow.yaml>`          | Execute a declarative workflow                  |
| `agentic one-shot "<task>"`            | Quick single-agent task                         |
| `agentic feature "<description>"`      | Run feature workflow                            |
| `agentic meeting "<topic>"`            | Start multi-agent discussion                    |
| `agentic list`                         | List active workflows                           |
| `agentic status <id>`                  | Check workflow status                           |
| `agentic resume <id>`                  | Resume a paused workflow                        |
| `agentic cancel <id>`                  | Cancel a workflow                               |
| `agentic logs <id>`                    | View workflow logs                              |
| `agentic memory search "<query>"`      | Search long-term memory (requires memory extra) |
| `agentic providers list`               | List available providers                        |
| `agentic agents list`                  | List available agents                           |

### CLI Options

| Flag                        | Description                 |
| --------------------------- | --------------------------- |
| `--git`                     | Auto-commit changes         |
| `--pr`                      | Create pull request         |
| `--var key=value`           | Set workflow variables      |
| `--dry-run`                 | Preview without executing   |
| `--agents <agent:provider>` | Specify agents for meetings |

### Workflow Types

| Type       | Description                                  |
| ---------- | -------------------------------------------- |
| `one-shot` | Quick single-agent tasks (~5 minutes)        |
| `feature`  | Multi-step feature development (~30 minutes) |
| `epic`     | Multi-day projects with crash recovery       |
| `meeting`  | Collaborative agent discussions              |
| `analysis` | Multi-agent analysis with diverse inputs     |

## Configuration

Set environment variables or create a `.env` file:

```bash
AGENTIC_DATABASE_URL=postgresql://agentic:agentic@localhost:5432/agentic
AGENTIC_KAFKA_URL=localhost:9094
AGENTIC_ENABLE_MEMORY=false
AGENTIC_LOG_LEVEL=INFO
```

## Complete Examples

### agentic one-shot

**Arguments:**

- `<task>` - Task description
- `--git` - Auto-commit changes
- `--pr` - Create pull request

**Examples:**

```bash
# Quick fix with PR
agentic one-shot "Fix the login bug" --git --pr

# Simple task
agentic one-shot "Add input validation to signup form"

# With git only
agentic one-shot "Update dependencies" --git
```

### agentic run

**Arguments:**

- `<workflow.yaml>` - Path to workflow file
- `--var key=value` - Set workflow variables
- `--dry-run` - Preview without executing

**Examples:**

```bash
# Run feature workflow
agentic run workflows/feature.yaml --var feature="Add dark mode"

# Dry run to preview
agentic run workflows/epic.yaml --var epic="User management" --dry-run

# Multiple variables
agentic run workflows/bugfix.yaml --var issue=123 --var priority=high
```

### agentic meeting

**Arguments:**

- `<topic>` - Meeting topic
- `--agents <agent:provider>...` - Agents to include

**Examples:**

```bash
# Sprint planning
agentic meeting "Sprint planning" --agents architect:claude developer:cursor

# Design review
agentic meeting "API design review" --agents architect:claude reviewer:claude

# Code review
agentic meeting "Security review" --agents security:claude developer:cursor
```

### agentic infra

**Arguments:**

- `<action>` - One of: up, down, status, logs

**Examples:**

```bash
# Start infrastructure
agentic infra up

# Check status
agentic infra status

# View logs
agentic infra logs

# Stop infrastructure
agentic infra down
```
