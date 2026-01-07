# Agentic SDLC Plugin

Fully autonomous SDLC toolkit for zero-interaction workflows. Designed for CI/CD integration and Python-orchestrated development workflows with no developer interaction during execution. All commands accept JSON input and produce JSON output for agent-to-agent communication.

> **Note:** This is an experimental plugin. APIs and functionality may change.

## Overview

The Agentic SDLC plugin provides autonomous planning, implementation, review, and testing workflows that run without user interaction. Ideal for CI/CD pipelines and Python-orchestrated multi-agent workflows.

- `/agentic-sdlc:plan-feature --json-input spec.json` - Generate a feature implementation plan
- `/agentic-sdlc:implement --json-input plan.json` - Implement changes from a plan
- `/agentic-sdlc:review --json-input review.json` - Review code changes autonomously
- `agentic-workflow --type feature --spec spec.md --auto-pr` - Full workflow via Python CLI

## Commands

All commands use the `/agentic-sdlc:` namespace prefix and accept JSON input for autonomous operation.

### Planning Commands

| Command                      | Description                                |
| ---------------------------- | ------------------------------------------ |
| `/agentic-sdlc:design`       | Design technical implementation (JSON I/O) |
| `/agentic-sdlc:plan`         | Meta-command that auto-selects plan type   |
| `/agentic-sdlc:plan-feature` | Generate feature plan (JSON I/O)           |
| `/agentic-sdlc:plan-bug`     | Generate bug fix plan (JSON I/O)           |
| `/agentic-sdlc:plan-chore`   | Generate chore plan (JSON I/O)             |
| `/agentic-sdlc:plan-build`   | All-in-one workflow                        |

### Implementation Commands

| Command                             | Description                    |
| ----------------------------------- | ------------------------------ |
| `/agentic-sdlc:implement`           | Implement from plan (JSON I/O) |
| `/agentic-sdlc:implement-from-plan` | Legacy implementation command  |

### Review & Testing Commands

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `/agentic-sdlc:review` | Review code changes (JSON I/O)           |
| `/agentic-sdlc:test`   | Run tests and analyze results (JSON I/O) |

## Dependencies

This plugin requires the `core` plugin to be installed first.

## Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\experimental-plugins\core"
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\experimental-plugins\agentic-sdlc"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/experimental-plugins/core
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/experimental-plugins/agentic-sdlc
```

## Python CLI

Python scripts for orchestrating multi-session Claude Code workflows with parallel development support.

### CLI Commands

| Command            | Description                            |
| ------------------ | -------------------------------------- |
| `agentic-workflow` | Main workflow orchestrator             |
| `agentic-plan`     | Invoke planning agents with JSON input |
| `agentic-build`    | Invoke build agent with plan JSON      |
| `agentic-validate` | Invoke validation agents               |

### CLI Options

| Flag            | Description                                      |
| --------------- | ------------------------------------------------ |
| `--type`        | Task type: feature, bug, chore, epic             |
| `--spec`        | Path to specification file                       |
| `--level`       | Workflow level: 1 (product), 2 (epic), 3 (story) |
| `--auto-pr`     | Automatically create PR on completion            |
| `--worktree`    | Use git worktree for isolation                   |
| `--no-worktree` | Work in main repo                                |
| `--cleanup`     | Remove worktree after completion                 |
| `--timeout`     | Timeout per step in seconds                      |
| `--log-file`    | Path to JSON log file                            |

### Library Usage

```python
from claude_sdlc import run_claude

# All commands use full namespace
run_claude("/agentic-sdlc:plan-feature", json_input=spec)
run_claude("/agentic-sdlc:implement", json_input=plan_output)
run_claude("/agentic-sdlc:review", json_input=changes)
```

## Configuration

Configure in `.claude/settings.json`:

```json
{
  "agentic-sdlc": {
    "planDirectory": "/specs"
  }
}
```

### Workflow Files

Default location: `/specs/<feature-name>/`

| File               | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `orchestration.md` | Main orchestrator plan, monitors progress |
| `plan.md`          | Main plan built during planning phase     |
| `checkpoint.md`    | Task completion tracking and journal      |
| `communication.md` | Agent-to-agent messages                   |
| `logs.md`          | Progress and error logs                   |

### JSON Communication

All commands accept structured JSON input and produce JSON output for agent-to-agent communication:

```json
{
  "type": "feature",
  "title": "User authentication",
  "requirements": ["OAuth support", "JWT tokens"],
  "explore_agents": 3
}
```

## Architecture

- **Python orchestrator**: Main loop (30s intervals) that monitors agent progress
- **Orchestrator agent**: Claude agent triggered by main loop to validate progress

## Limitations

- Fully autonomous - no user prompts during execution
- Requires well-defined specifications for reliable results
- Large codebases may slow agent exploration

## Complete Examples

### /agentic-sdlc:plan-feature

**Arguments:**

- `--json-input <path>` - Path to JSON specification file
- `--json-stdin` - Read specification from stdin

**Examples:**

```bash
# Plan from JSON file
/agentic-sdlc:plan-feature --json-input /specs/input/auth-spec.json

# Plan from stdin (Python orchestrator)
echo '{"type":"feature","title":"Auth","description":"Add OAuth"}' | /agentic-sdlc:plan-feature --json-stdin
```

### /agentic-sdlc:implement

**Arguments:**

- `--json-input <path>` - Path to JSON plan file
- `--json-stdin` - Read plan from stdin

**Examples:**

```bash
# Implement from plan file
/agentic-sdlc:implement --json-input /specs/build-input.json

# With git commits enabled
/agentic-sdlc:implement --json-input '{"plan_file":"/specs/feature-auth.md","git_commit":true}'
```

### /agentic-sdlc:review

**Arguments:**

- `--json-input <path>` - Path to JSON review specification
- `--json-stdin` - Read specification from stdin

**Examples:**

```bash
# Review specific files
/agentic-sdlc:review --json-input /specs/review-input.json

# Review with plan compliance
/agentic-sdlc:review --json-input '{"files":["src/auth.ts"],"plan_file":"/specs/feature-auth.md"}'
```

### agentic-workflow (Python CLI)

**Options:**

- `--type` - Task type: feature, bug, chore, epic
- `--spec` - Path to specification file
- `--level` - Workflow level: 1 (product), 2 (epic), 3 (story)
- `--auto-pr` - Automatically create PR on completion
- `--worktree` - Use git worktree for isolation
- `--timeout` - Timeout per step in seconds

**Examples:**

```bash
# Autonomous bug fix with PR
agentic-workflow --type bug --spec bug-spec.md --auto-pr

# Epic-level feature in worktree
agentic-workflow --type feature --spec epic-auth.md --level 2 --worktree

# Single story with timeout
agentic-workflow --type feature --spec feature-2fa.md --timeout 300
```
