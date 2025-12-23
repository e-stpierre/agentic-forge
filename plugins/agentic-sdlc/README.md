# Agentic SDLC Plugin

Fully autonomous SDLC toolkit for zero-interaction workflows. Designed for CI/CD integration and Python-orchestrated development workflows with no developer interaction during execution.

## Philosophy

No developer interaction during execution. Suitable for CI/CD integration. Leverages Claude prompts (commands, agents, skills, hooks) and Python scripts for complete agentic workflows.

## Dependencies

This plugin requires the `core` plugin to be installed first.

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

## Configuration

Configure in `.claude/settings.json`:

```json
{
  "agentic-sdlc": {
    "planDirectory": "/specs"
  }
}
```

## Python CLI

Python scripts for orchestrating multi-session Claude Code workflows with parallel development support.

### Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\core"
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\agentic-sdlc"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/core
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/agentic-sdlc
```

### CLI Commands

| Command            | Description                            |
| ------------------ | -------------------------------------- |
| `agentic-workflow` | Main workflow orchestrator             |
| `agentic-plan`     | Invoke planning agents with JSON input |
| `agentic-build`    | Invoke build agent with plan JSON      |
| `agentic-validate` | Invoke validation agents               |

### Examples

```bash
# Autonomous bug fix in CI/CD
uv run agentic-workflow --type bug --spec bug-spec.md --auto-pr

# Epic-level feature development
uv run agentic-build --level epic --spec epic-user-management.md

# Single story with autonomous execution
uv run agentic-workflow --type feature --spec feature-2fa.md --worktree
```

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

## Orchestrator Architecture

- **Python orchestrator**: Main loop (30s intervals) that monitors agent progress
- **Orchestrator agent**: Claude agent triggered by main loop to validate progress

## Workflow Files

Default location: `/specs/<feature-name>/`

| File               | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `orchestration.md` | Main orchestrator plan, monitors progress |
| `plan.md`          | Main plan built during planning phase     |
| `checkpoint.md`    | Task completion tracking and journal      |
| `communication.md` | Agent-to-agent messages                   |
| `logs.md`          | Progress and error logs                   |

## JSON Communication

All commands accept structured JSON input and produce JSON output for agent-to-agent communication:

```json
{
  "type": "feature",
  "title": "User authentication",
  "requirements": ["OAuth support", "JWT tokens"],
  "explore_agents": 3
}
```

## Migration from SDLC

This plugin was renamed from `sdlc` to `agentic-sdlc` in v2.0.0. Key changes:

- All commands now use `/agentic-sdlc:` namespace
- Removed user interaction (AskUserQuestion)
- All I/O is JSON-based for autonomous operation
- For interactive workflows, use `interactive-sdlc` plugin instead

## Limitations

- Fully autonomous - no user prompts during execution
- Requires well-defined specifications for reliable results
- Large codebases may slow agent exploration
