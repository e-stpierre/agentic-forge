# Core Plugin

Essential tooling for Claude Code that provides foundational commands used across development workflows. This plugin is designed to be a dependency for other plugins.

## Overview

The Core plugin provides common git workflow commands that automate branch creation, commits, and pull requests with consistent naming conventions and structured messages. It also includes Python utilities for orchestrating multi-session
Claude Code workflows.

## Components

### Commands

| Command                 | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `/core:git-branch`      | Create branches with standardized naming          |
| `/core:git-commit`      | Commit and push with structured messages          |
| `/core:git-pr`          | Create pull requests with contextual descriptions |
| `/core:git-worktree`    | Manage git worktrees for parallel development     |
| `/core:create-gh-issue` | Create GitHub issues                              |
| `/core:read-gh-issue`   | Read GitHub issue content                         |

## Installation

### Marketplace Installation

```bash
/plugin marketplace add e-stpierre/agentic-forge
/plugin install core@e-stpierre/agentic-forge
```

### Manual Installation

```bash
mkdir -p .claude/commands
cp plugins/core/commands/*.md .claude/commands/
```

## Usage

### git-branch

Creates a branch following the naming convention:

- With issue: `<category>/<issue-id>_<branch-name>`
- Without issue: `<category>/<branch-name>`

```bash
/git-branch feature 123 add-dark-mode
# Creates: feature/123_add-dark-mode

/git-branch fix security-patch
# Creates: fix/security-patch
```

### git-commit

Commits staged changes with a structured message and pushes:

```bash
/git-commit
# Analyzes changes and creates appropriate commit message
```

### git-pr

Creates a pull request with contextual title and description:

```bash
/git-pr
# Analyzes branch commits and creates PR with appropriate detail level
```

## Branch Categories

Standard categories for branch naming:

- `feature` - New functionality
- `fix` - Bug fixes
- `hotfix` - Urgent production fixes
- `refactor` - Code improvements
- `docs` - Documentation changes
- `test` - Test additions/modifications
- `chore` - Maintenance tasks

## Python Package

The core plugin includes `agentic-forge-core`, a Python package for orchestrating Claude Code workflows programmatically.

### Python Package Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\core"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/core
```

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
result = run_claude_with_command("core:git-commit", args="Fix typo")

# Parallel execution
orchestrator = Orchestrator()
orchestrator.add_task(Task(prompt="Task 1", cwd=path_a))
orchestrator.add_task(Task(prompt="Task 2", cwd=path_b))
results = orchestrator.run_parallel()

# Structured logging
configure_logging(log_file="workflow.log.json")
```

## License

MIT License - Part of the agentic-forge repository.
