# SDLC Plugin

Software Development Lifecycle toolkit for Claude Code with planning, implementation, review, and testing workflows. Supports parallel development through git worktrees.

## Dependencies

This plugin requires the `core` plugin to be installed first.

## Commands

### Planning Commands

| Command              | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `/sdlc:design`       | Design technical implementation and create GitHub issues |
| `/sdlc:plan`         | Meta-command that auto-selects plan-feature/bug/chore    |
| `/sdlc:plan-feature` | Generate feature implementation plans with milestones    |
| `/sdlc:plan-bug`     | Generate bug fix plans with root cause analysis          |
| `/sdlc:plan-chore`   | Generate maintenance task plans                          |
| `/sdlc:plan-build`   | All-in-one workflow: branch -> plan -> implement -> PR   |

### Implementation Commands

| Command                     | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| `/sdlc:implement`           | Implement changes from a plan file (commits per milestone) |
| `/sdlc:implement-from-plan` | Legacy: Implement from plan file                           |

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

Python scripts for orchestrating multi-session Claude Code workflows with parallel development support.

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

| Command          | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `claude-feature` | Full feature workflow: worktree -> plan -> implement -> review -> PR |
| `claude-bugfix`  | Full bugfix workflow: worktree -> diagnose -> fix -> test -> PR      |
| `claude-sdlc`    | Main CLI with all subcommands                                        |

### Parallel Development

By default, workflows run in isolated git worktrees, enabling multiple features/fixes to be developed in parallel without conflicts:

```bash
# Run multiple features in parallel (each in its own worktree)
claude-feature "Add user authentication" &
claude-feature "Add dark mode support" &
claude-bugfix --issue 123 "Fix login error" &
```

Use `--no-worktree` to work directly in the main repository for simple changes.

### Examples

```bash
# Feature workflow (creates worktree automatically)
claude-feature "Add user authentication"
claude-feature --interactive "Add dark mode support"
claude-feature --no-worktree "Simple change in main repo"
claude-feature --cleanup "Feature with auto-cleanup"

# Bugfix workflow
claude-bugfix "Login timeout on Safari"
claude-bugfix --issue 123 "Fix authentication error"
claude-bugfix --skip-test --no-worktree "Minor typo fix"

# Via main CLI
claude-sdlc feature "Add caching"
claude-sdlc bugfix --issue 456 "Fix memory leak"
```

### CLI Options

Both `claude-feature` and `claude-bugfix` support:

| Flag            | Description                                      |
| --------------- | ------------------------------------------------ |
| `--interactive` | Enable interactive planning mode                 |
| `--dry-run`     | Show steps without executing                     |
| `--skip-review` | Skip code review step (feature only)             |
| `--skip-test`   | Skip running tests (bugfix only)                 |
| `--skip-pr`     | Skip PR creation                                 |
| `--no-worktree` | Work in main repo instead of creating a worktree |
| `--cleanup`     | Remove worktree after completion                 |
| `--base-branch` | Base branch for the work (default: main/master)  |
| `--timeout`     | Timeout per step in seconds (default: 300)       |
| `--log-file`    | Path to JSON log file                            |

### Library Usage

```python
from claude_sdlc import (
    feature_workflow,
    FeatureWorkflowConfig,
    bugfix_workflow,
    BugfixWorkflowConfig,
)

# Feature workflow with worktree
config = FeatureWorkflowConfig(
    feature_description="Add user authentication",
    interactive=True,
    use_worktree=True,  # Default: creates isolated worktree
    cleanup_worktree=False,  # Keep worktree after completion
)
state = feature_workflow(config)
print(f"PR: {state.pr_url}")
print(f"Worktree: {state.worktree_path}")

# Bugfix workflow
config = BugfixWorkflowConfig(
    bug_description="Fix login timeout",
    issue_number=123,
    use_worktree=True,
)
state = bugfix_workflow(config)

# Access core utilities
from claude_sdlc import run_claude, temporary_worktree

# Parallel execution with worktrees
with temporary_worktree("feature/my-branch") as wt:
    run_claude("Edit README.md", cwd=wt.path)
```

## Milestone-Based Planning

Plans generated by `/sdlc:plan-feature` use a milestone structure:

- Each **milestone** represents a logical commit point
- Milestones contain 1-many related **tasks**
- The `/sdlc:implement` command commits after each milestone
- Clean git history with conventional commit messages

## Limitations

- Analyzes static codebase structure only (no runtime behavior)
- Plans require human review before implementation
- Large codebases may slow agent exploration
