# Agentic Core

Foundational framework for AI agent orchestration - from 5-minute one-shot tasks to multi-day epic implementations. Supports multiple AI providers (Claude, Cursor, Codex, Copilot), declarative YAML workflows, crash recovery, and optional human-in-the-loop checkpoints.

## Overview

The Agentic Core plugin provides infrastructure for running AI agent workflows at any scale. It handles provider abstraction, workflow execution, crash recovery, and optional long-term memory.

- `agentic one-shot "Fix the login bug" --git --pr` - Quick single-agent task
- `agentic run workflows/feature.yaml --var feature="Add dark mode"` - Run declarative workflow
- `agentic meeting "Sprint planning" --agents architect:claude developer:cursor` - Multi-agent discussion

## Features

- **Provider Agnostic**: Support for Claude, Cursor, Codex, and Copilot CLIs
- **Workflow Flexibility**: Declarative YAML workflows from one-shot to multi-day epics
- **Crash Recovery**: Full recovery via Kafka replay and PostgreSQL checkpoints
- **Human-in-the-Loop**: Optional human approval at any checkpoint
- **Long-term Memory**: Semantic search over past learnings (optional pgvector)
- **Full Observability**: Every message, decision, and state change logged

## Installation

```bash
# Install as uv tool
uv tool install plugins/agentic-core

# Or install with memory support
uv tool install "plugins/agentic-core[memory]"
```

## Quick Start

```bash
# Start infrastructure (Kafka, PostgreSQL)
agentic infra up

# Run a quick bugfix
agentic one-shot "Fix the login bug" --git --pr

# Run a feature workflow
agentic run workflows/feature.yaml --var feature="Add dark mode"

# Start a multi-agent meeting
agentic meeting "Sprint planning" --agents architect:claude developer:cursor
```

## Configuration

Set environment variables or create a `.env` file:

```bash
AGENTIC_DATABASE_URL=postgresql://agentic:agentic@localhost:5432/agentic
AGENTIC_KAFKA_URL=localhost:9094
AGENTIC_ENABLE_MEMORY=false
AGENTIC_LOG_LEVEL=INFO
```

## CLI Commands

```bash
# Infrastructure
agentic infra up|down|status|logs

# Workflow execution
agentic run workflow.yaml [--var key=value] [--dry-run]
agentic one-shot "task description"
agentic feature "feature description"
agentic meeting "topic" --agents agent1:provider agent2:provider

# Workflow management
agentic list
agentic status <workflow-id>
agentic resume <workflow-id>
agentic cancel <workflow-id>
agentic logs <workflow-id>

# Memory (requires memory extra)
agentic memory search "query"
agentic memory list --category lesson
agentic memory add lesson "content"

# Providers
agentic providers list
agentic providers test <provider>

# Agents
agentic agents list
agentic agents test <agent> "prompt"
```

## Workflow Types

- **one-shot**: Quick single-agent tasks (~5 minutes)
- **feature**: Multi-step feature development (~30 minutes)
- **epic**: Multi-day projects with crash recovery
- **meeting**: Collaborative agent discussions
- **analysis**: Multi-agent analysis with diverse inputs

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
