# Development Plugin

Development toolkit for Claude Code that accelerates feature implementation through codebase analysis, interactive requirement gathering, and automated planning.

## Commands

### `/plan-dev [feature-description]`

Creates comprehensive feature implementation plans.

**Process:**

1. Launches 3 Explore agents in parallel to analyze your codebase
2. Asks 0-20 clarifying questions based on complexity
3. Generates a detailed implementation plan with milestones, file changes, and testing strategy
4. Saves to `/docs/plans/` (or custom location)

**Usage:**

```
/plan-dev Add user authentication with JWT tokens
```

### `/create-readme-plan <feature>`

Creates a simple plan for README modifications.

### `/implement-from-plan <path>`

Implements changes based on a plan file.

### `/demo-hello`, `/demo-bye`

Simple demo commands for testing CLI invocation.

## Python CLI (Experimental)

Python scripts for orchestrating Claude Code workflows from the command line.

### Installation

```powershell
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\claude-plugins\plugins\development"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/claude-plugins/plugins/development
```

### Commands

| Command                  | Description                                |
| ------------------------ | ------------------------------------------ |
| `claude-hello`           | Tests CLI invocation                       |
| `claude-parallel`        | Parallel editing in separate git worktrees |
| `claude-plan <feature>`  | Plan then implement workflow               |
| `claude-workflows <cmd>` | Main CLI with all subcommands              |

**Examples:**

```bash
claude-plan "Add user authentication"
claude-plan --skip-implement "API Documentation"
```

### Library Usage

```python
from claude_workflows import run_claude, temporary_worktree

result = run_claude("Explain this code", print_output=True)

with temporary_worktree("feature/my-branch") as wt:
    run_claude("Edit README.md", cwd=wt.path)
```

## Limitations

- Analyzes static codebase structure only (no runtime behavior)
- Plans require human review before implementation
- Large codebases may slow agent exploration
