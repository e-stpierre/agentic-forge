# SDLC Plugin

Software Development Lifecycle toolkit for Claude Code with planning, implementation, review, and testing workflows.

## Dependencies

This plugin requires the `core` plugin to be installed first.

## Commands

### `/implement-from-plan <path>`

Implements changes based on a plan file.

## Python CLI

Python scripts for orchestrating Claude Code workflows from the command line.

### Installation

First install the core package, then the sdlc package:

```powershell
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\claude-plugins\plugins\core"
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\claude-plugins\plugins\sdlc"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/claude-plugins/plugins/core
uv tool install ~/.claude/plugins/marketplaces/claude-plugins/plugins/sdlc
```

### Commands

| Command                 | Description                                |
| ----------------------- | ------------------------------------------ |
| `claude-parallel`       | Parallel editing in separate git worktrees |
| `claude-plan <feature>` | Plan then implement workflow               |
| `claude-sdlc <cmd>`     | Main CLI with all subcommands              |

**Examples:**

```bash
claude-plan "Add user authentication"
claude-plan --skip-implement "API Documentation"
claude-parallel
```

### Library Usage

```python
from claude_sdlc import run_claude, temporary_worktree, Orchestrator, Task

# Simple execution
result = run_claude("Explain this code", print_output=True)

# Parallel execution with worktrees
with temporary_worktree("feature/my-branch") as wt:
    run_claude("Edit README.md", cwd=wt.path)

# Orchestrated workflows
orchestrator = Orchestrator()
orchestrator.add_task(Task(prompt="/plan-feature auth", cwd=worktree_a))
orchestrator.add_task(Task(prompt="/plan-feature docs", cwd=worktree_b))
results = orchestrator.run_parallel()
```

## Roadmap

The following commands are planned for Phase 3:

- `/design` - Design technical implementation and create GitHub issues
- `/plan-build` - All-in-one workflow: branch, plan, implement, commit, PR
- `/plan` - Meta-command that delegates to plan-feature/bug/chore
- `/plan-feature` - Generate feature implementation plans
- `/plan-bug` - Generate bug fix plans
- `/plan-chore` - Generate maintenance task plans
- `/implement` - Implement changes from a plan file
- `/review` - Review code changes
- `/test` - Run tests and analyze results

## Limitations

- Analyzes static codebase structure only (no runtime behavior)
- Plans require human review before implementation
- Large codebases may slow agent exploration
