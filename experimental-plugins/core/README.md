# Core Plugin

Python orchestration utilities for building Claude Code plugins and multi-session workflows.

## Overview

The Core plugin provides `agentic-forge-core`, a Python package for orchestrating Claude Code workflows programmatically. It enables running multiple Claude Code sessions in parallel, executing slash commands, and building automation pipelines.

> **Note:** Git and GitHub commands have been moved to the `interactive-sdlc` plugin to make it standalone. This plugin now focuses solely on Python utilities.

## Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\experimental-plugins\core"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/experimental-plugins/core
```

## Library Usage

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

## API Reference

### run_claude(prompt, ...)

Execute a single Claude Code session with a prompt.

### run_claude_with_command(command, args=None, ...)

Execute a slash command in Claude Code.

### Orchestrator

Manage multiple Claude Code sessions for parallel or sequential execution.

### Task

Represents a single task to be executed by the orchestrator.

### configure_logging(log_file=None)

Set up structured JSON logging for workflow debugging.

## License

MIT License - Part of the agentic-forge repository.
