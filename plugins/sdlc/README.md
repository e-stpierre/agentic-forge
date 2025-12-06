# SDLC Plugin

Software Development Lifecycle toolkit for Claude Code with planning, implementation, review, and testing workflows.

## Dependencies

This plugin requires the `core` plugin to be installed first.

## Commands

### Planning Commands

| Command              | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `/sdlc:design`       | Design technical implementation and create GitHub issues |
| `/sdlc:plan`         | Meta-command that auto-selects plan-feature/bug/chore    |
| `/sdlc:plan-feature` | Generate feature implementation plans                    |
| `/sdlc:plan-bug`     | Generate bug fix plans with root cause analysis          |
| `/sdlc:plan-chore`   | Generate maintenance task plans                          |
| `/sdlc:plan-build`   | All-in-one workflow: branch -> plan -> implement -> PR   |

### Implementation Commands

| Command                     | Description                        |
| --------------------------- | ---------------------------------- |
| `/sdlc:implement`           | Implement changes from a plan file |
| `/sdlc:implement-from-plan` | Legacy: Implement from plan file   |

### Review & Testing Commands

| Command        | Description                                     |
| -------------- | ----------------------------------------------- |
| `/sdlc:review` | Review code changes for quality and correctness |
| `/sdlc:test`   | Run tests and analyze results                   |

### Command Flags

Most commands support these common flags:

- `--interactive`: Enable user Q&A before execution
- `--dry-run`: Show what would be done without executing

## Python CLI

Python scripts for orchestrating multi-session Claude Code workflows.

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

### CLI Commands

| Command          | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `claude-feature` | Full feature workflow: plan -> implement -> review -> PR |
| `claude-bugfix`  | Full bugfix workflow: diagnose -> fix -> test -> PR      |
| `claude-sdlc`    | Main CLI with all subcommands                            |

**Examples:**

```bash
# Feature workflow
claude-feature "Add user authentication"
claude-feature --interactive "Add dark mode support"
claude-feature --skip-review --dry-run "Quick feature"

# Bugfix workflow
claude-bugfix "Login timeout on Safari"
claude-bugfix --issue 123 "Fix authentication error"
claude-bugfix --skip-test "Minor typo fix"

# Via main CLI
claude-sdlc feature "Add caching"
claude-sdlc bugfix --issue 456 "Fix memory leak"
```

### Library Usage

```python
from claude_sdlc import (
    feature_workflow,
    FeatureWorkflowConfig,
    bugfix_workflow,
    BugfixWorkflowConfig,
)

# Feature workflow
config = FeatureWorkflowConfig(
    feature_description="Add user authentication",
    interactive=True,
    skip_review=False,
)
state = feature_workflow(config)
print(f"PR: {state.pr_url}")

# Bugfix workflow
config = BugfixWorkflowConfig(
    bug_description="Fix login timeout",
    issue_number=123,
)
state = bugfix_workflow(config)

# Access core utilities
from claude_sdlc import run_claude, Orchestrator, Task, temporary_worktree

# Simple execution
result = run_claude("Explain this code", print_output=True)

# Parallel execution with worktrees
with temporary_worktree("feature/my-branch") as wt:
    run_claude("Edit README.md", cwd=wt.path)
```

## Limitations

- Analyzes static codebase structure only (no runtime behavior)
- Plans require human review before implementation
- Large codebases may slow agent exploration
