# Agentic Workflows

Agentic workflow orchestration for Claude Code.

## Overview

Agentic Workflows enables Claude Code to execute complex, multi-step tasks with high success rates. The framework allows Claude Code to work fully independently, with resiliency and accuracy, in a multi-session workflow.

## Installation

```bash
uv tool install .
```

## Quick Start

Run a workflow:

```bash
agentic-workflow run workflow.yaml --var "key=value"
```

Check workflow status:

```bash
agentic-workflow status <workflow-id>
```

List workflows:

```bash
agentic-workflow list
```

## Features

- YAML-based workflow definitions
- Progress tracking with `progress.json`
- NDJSON structured logging
- Git worktree support for parallel execution
- Jinja2 template rendering
- Configurable retry and timeout settings

## Workflow Example

```yaml
name: simple-task
version: "1.0"
description: A simple workflow example

variables:
  - name: task
    type: string
    required: true

steps:
  - name: execute
    type: prompt
    prompt: |
      Execute the following task:
      {{ task }}
    model: sonnet
```

## Configuration

Configuration is stored in `agentic/config.json`:

```bash
agentic-workflow config set defaults.maxRetry 5
agentic-workflow config get defaults.maxRetry
```

## Status

This plugin is experimental (version 0.x).
