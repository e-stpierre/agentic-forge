# Core Plugin

Python orchestration utilities for building Claude Code plugins and multi-session workflows. Provides `agentic-forge-core` package for running sessions in parallel, executing commands, and building automation pipelines.

## Overview

The Core plugin provides Python utilities for orchestrating Claude Code programmatically. Run prompts, execute slash commands, and manage parallel workflows.

- `run_claude("Explain this code", print_output=True)` - Run a single prompt
- `run_claude_with_command("interactive-sdlc:git-commit", args="Fix typo")` - Execute a command
- `orchestrator.run_parallel()` - Run multiple tasks in parallel

## Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\experimental-plugins\core"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/experimental-plugins/core
```

## Python CLI

### Library Usage

```python
from claude_core import (
    run_claude,
    run_claude_with_command,
    Orchestrator,
    Task,
    configure_logging,
)

# Run a prompt
result = run_claude("Explain this code", print_output=True)

# Run a slash command
result = run_claude_with_command("interactive-sdlc:git-commit", args="Fix typo")

# Parallel execution
orchestrator = Orchestrator()
orchestrator.add_task(Task(prompt="Task 1", cwd=path_a))
orchestrator.add_task(Task(prompt="Task 2", cwd=path_b))
results = orchestrator.run_parallel()

# Structured logging
configure_logging(log_file="workflow.log.json")
```

### API Reference

| Function/Class | Description |
|----------------|-------------|
| `run_claude(prompt, ...)` | Execute a single Claude Code session with a prompt |
| `run_claude_with_command(command, args=None, ...)` | Execute a slash command in Claude Code |
| `Orchestrator` | Manage multiple Claude Code sessions for parallel or sequential execution |
| `Task` | Represents a single task to be executed by the orchestrator |
| `configure_logging(log_file=None)` | Set up structured JSON logging for workflow debugging |

## Complete Examples

### run_claude

**Arguments:**

- `prompt` - The prompt to send
- `print_output` - Print output in real-time (default: False)
- `cwd` - Working directory (default: current)

**Examples:**

```python
from claude_core import run_claude

# Simple prompt
result = run_claude("Explain this code")

# With output printing
result = run_claude("Fix the bug in auth.ts", print_output=True)

# Specific directory
result = run_claude("Run tests", cwd="/path/to/project")
```

### run_claude_with_command

**Arguments:**

- `command` - Slash command name (without leading /)
- `args` - Command arguments (optional)

**Examples:**

```python
from claude_core import run_claude_with_command

# Git commit
run_claude_with_command("interactive-sdlc:git-commit", args="Fix typo")

# Create branch
run_claude_with_command("interactive-sdlc:git-branch", args="feature add-auth")

# Plan feature
run_claude_with_command("interactive-sdlc:plan-feature", args="Add OAuth")
```

### Orchestrator

**Methods:**

- `add_task(task)` - Add a task to the queue
- `run_parallel()` - Execute all tasks in parallel
- `run_sequential()` - Execute tasks one by one

**Examples:**

```python
from claude_core import Orchestrator, Task

# Parallel execution
orchestrator = Orchestrator()
orchestrator.add_task(Task(prompt="Fix auth bug", cwd="/path/a"))
orchestrator.add_task(Task(prompt="Update docs", cwd="/path/b"))
results = orchestrator.run_parallel()

# Sequential execution
orchestrator = Orchestrator()
orchestrator.add_task(Task(prompt="Run tests"))
orchestrator.add_task(Task(prompt="Build project"))
results = orchestrator.run_sequential()

# With logging
from claude_core import configure_logging
configure_logging(log_file="workflow.log.json")
results = orchestrator.run_parallel()
```
