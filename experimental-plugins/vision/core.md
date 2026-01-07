# Core Plugin

Python orchestration utilities for building Claude Code plugins and multi-session workflows. Zero external dependencies - uses only Python stdlib.

## Purpose

Core provides the foundational Python library `agentic-forge-core` for programmatically orchestrating Claude Code. It enables:

- Running Claude sessions with prompts or slash commands
- Parallel execution of multiple Claude instances
- Git worktree management for isolated parallel development
- Structured JSON logging for debugging and auditing

## Design Principles

| Principle            | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| Zero Dependencies    | Uses only Python stdlib (3.10+)                               |
| Simple API           | Functions for single tasks, classes for complex orchestration |
| Parallel-First       | Built for concurrent multi-session workflows                  |
| Worktree Integration | Native git worktree support for isolation                     |

## Package Structure

```
experimental-plugins/core/
  pyproject.toml          # Python 3.10+, no external deps
  src/claude_core/
    __init__.py           # Exports: run_claude, Orchestrator, Task, configure_logging
    runner.py             # Claude CLI execution
    orchestrator.py       # Parallel task coordination
    worktree.py           # Git worktree management
    logging.py            # Structured JSON logging
```

## CLI Entry Points

| Command              | Description                        |
| -------------------- | ---------------------------------- |
| `claude-run`         | Run single Claude prompt           |
| `claude-orchestrate` | Parallel/sequential task execution |
| `claude-worktree`    | Git worktree management            |

## Python API

### run_claude()

Execute a single Claude session with a prompt.

```python
from claude_core import run_claude

result = run_claude(
    prompt="Fix the login bug",
    cwd=Path("/path/to/repo"),
    timeout=300,
    print_output=True,
    skip_permissions=True,
)

if result.success:
    print(result.stdout)
```

**ClaudeResult fields**: returncode, stdout, stderr, prompt, cwd, success (property)

### run_claude_with_command()

Execute a slash command.

```python
from claude_core import run_claude_with_command

result = run_claude_with_command(
    "interactive-sdlc:git-commit",
    args="Fix typo in README",
)
```

### Orchestrator

Coordinate multiple Claude sessions for parallel or sequential execution.

```python
from claude_core import Orchestrator, Task

orchestrator = Orchestrator(max_workers=4, log_file=Path("workflow.log.json"))

orchestrator.add_task(Task(prompt="Task 1", cwd=path_a, timeout=300))
orchestrator.add_task(Task(prompt="Task 2", cwd=path_b, timeout=300))

# Parallel execution
results = orchestrator.run_parallel(print_progress=True)

# Or sequential
results = orchestrator.run_sequential(stop_on_failure=True)

# Get summary
summary = orchestrator.get_summary()  # {total, successful, failed, total_duration_ms}
```

**Task fields**: prompt, cwd, name (auto-generated), timeout, skip_permissions

**TaskResult fields**: task, result (ClaudeResult), duration_ms, error, success (property)

### Git Worktree Management

Create isolated worktrees for parallel development.

```python
from claude_core.worktree import (
    temporary_worktree,
    create_worktree,
    remove_worktree,
    list_worktrees,
    get_repo_root,
    get_current_branch,
)

# Context manager for temporary worktree
with temporary_worktree("feature/my-branch", cleanup=True) as wt:
    # Work in wt.path - isolated from main repo
    run_claude("Implement feature", cwd=wt.path)
# Worktree auto-cleaned up on exit

# Manual worktree management
wt = create_worktree("feature/auth", worktree_path, base_branch="main")
# ... do work ...
remove_worktree(wt, force=True, delete_branch=True)
```

**Worktree fields**: path, branch, base_branch

### Structured Logging

JSON-based logging for workflow debugging.

```python
from claude_core import configure_logging, get_logger

# Configure global logger
logger = configure_logging(Path("workflow.log.json"), level="DEBUG")

# Log entries
logger.log_command(
    command="/plan-feature",
    args="add auth",
    cwd="/repo",
    duration_ms=45000,
    exit_code=0,
    output_summary="Plan created",
)

# Convenience methods
logger.info("Starting workflow", task_id="123")
logger.error("Failed to build", error="timeout")

# Read back
entries = logger.read_entries()
summary = logger.get_summary()  # {total_entries, successful, failed, commands: {}}
```

**LogEntry fields**: command, args, cwd, duration_ms, exit_code, output_summary, timestamp, level

## CLI Usage

### claude-run

```bash
# Run prompt
claude-run "Fix the login bug"

# With options
claude-run "Implement feature" --cwd /path/to/repo --timeout 600

# From stdin
echo "Fix typo" | claude-run

# Check availability
claude-run --check
```

### claude-orchestrate

```bash
# Parallel execution
claude-orchestrate "Task 1" "Task 2" "Task 3" --max-workers 4

# Sequential with stop on failure
claude-orchestrate "Step 1" "Step 2" --sequential --stop-on-failure

# JSON output
claude-orchestrate "Task 1" "Task 2" --json

# With logging
claude-orchestrate "Task 1" "Task 2" --log-file workflow.log.json
```

### claude-worktree

```bash
# List worktrees
claude-worktree list

# Create worktree
claude-worktree create feature/auth --base main

# Remove worktree
claude-worktree remove /path/to/worktree --force --delete-branch

# Show repo info
claude-worktree info
```

## Installation

```bash
# Install as uv tool
uv tool install experimental-plugins/core
```

## Technical Decisions

| Decision           | Choice                     | Rationale                                            |
| ------------------ | -------------------------- | ---------------------------------------------------- |
| Dependencies       | None (stdlib only)         | Maximum portability, no conflicts                    |
| Python Version     | 3.10+                      | Dataclasses, type hints, pathlib                     |
| Shell Execution    | subprocess with shell=True | Windows PATH resolution                              |
| Prompt Passing     | stdin                      | Avoid shell escaping issues                          |
| Parallel Execution | ThreadPoolExecutor         | Simple, built-in, sufficient for I/O-bound CLI calls |
| Logging Format     | JSON lines                 | Machine-parseable, appendable                        |

## Integration with Other Plugins

Core is a dependency for other plugins:

- **agentic-sdlc**: Uses `run_claude()` and `Orchestrator` for autonomous workflows
- **agentic-core**: Borrows patterns but has its own provider abstraction

## Pros & Cons

### Pros

- Zero dependencies - installs anywhere
- Simple, focused API
- Native worktree support for parallel work
- Structured logging built-in
- Works on Windows/macOS/Linux

### Cons

- No provider abstraction (Claude-only)
- No persistent state (no database)
- No crash recovery
- No async support (sync subprocess only)
- No JSON output parsing from Claude
