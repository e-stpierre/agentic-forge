# Claude Plugins Repository - Implementation Plan

## Vision

Create scoped, concise, and highly reusable Claude Code tooling that works both interactively within Claude Code sessions and programmatically via `claude -p` or Python scripts.

## Goals

1. **Dual-mode execution**: All prompts work standalone AND programmatically
2. **Composable commands**: Commands can invoke other commands within a session
3. **Python orchestration**: Cross-session workflows coordinated by Python scripts
4. **Mandatory core**: Core plugin provides foundational prompts and Python utilities
5. **Interactive flag**: Commands support `--interactive` argument to enable user Q&A during execution; without the flag, commands run autonomously for programmatic use

---

## Architecture Overview

```
claude-plugins/
├── PLAN.md                          # This file
├── CLAUDE.md                        # Repository instructions
├── README.md                        # User documentation
├── .claude-plugin/
│   └── marketplace.json             # Plugin registry
├── plugins/
│   ├── core/                        # MANDATORY - Base prompts + Python
│   │   ├── commands/                # Git commands, base utilities
│   │   ├── agents/                  # Foundational sub-agents
│   │   ├── hooks/                   # PowerShell hook scripts
│   │   └── src/                     # Python: runner, orchestrator
│   ├── sdlc/                        # Software Development Lifecycle
│   │   ├── commands/                # Planning, implementation commands
│   │   ├── agents/                  # Development-focused sub-agents
│   │   └── src/                     # Python: SDLC-specific workflows
│   └── appsec/                      # Security toolkit (existing)
└── docs/                            # Additional documentation
```

---

## Plugin Structure

### Core Plugin (Mandatory)

**Purpose**: Foundation for some other plugins. Must be installed first before using any plugin that depends on it.

**Contents**:

- Git commands: `git-branch`, `git-commit`, `git-pr`, `git-worktree`
- Base Python package: `claude-plugins-core`
  - `runner.py` - Claude CLI wrapper
  - `orchestrator.py` - Parallel execution engine

**Python Package**: `claude-plugins-core`

### SDLC Plugin

**Purpose**: Software Development Lifecycle workflows.

**Dependencies**: Requires `claude-plugins-core`

**Contents**:

- All-in-one: `plan-build`,
- Planning commands: `plan`, `plan-feature`, `plan-bug`, `plan-chore`, The plan command is a prompt that select which sub-plan command to use based on the complexity of the task.
- Implementation commands: `implement`
- Review commands: `review`
- Workflow scripts: Full SDLC orchestration => plan, implement, review with git management included (create a worktree first, create a branch, commit changes after each task/milestones, push the changes, finally open a PR)

**Python Package**: `claude-plugins-sdlc` (depends on `claude-plugins-core`)

### Other Plugins

- `appsec` - Security toolkit (no Python dependency)
- Future plugins follow the same pattern

---

## Component Types

### Commands (`.md`)

Slash commands invoked with `/command-name`. Stored in `commands/` directory.

**Frontmatter Schema**:

```yaml
---
name: command-name
description: Brief description for help text
argument-hint: [args] [--interactive]
---
```

**The `--interactive` Flag**:

Commands that support user interaction define two execution modes within the same prompt:

- **Without `--interactive`**: Command runs autonomously, makes reasonable defaults, no user prompts. Safe for `claude -p` and Python orchestration.
- **With `--interactive`**: Command uses `AskUserQuestion` tool to gather clarifying input from the user before proceeding.

**Command Prompt Structure**:

```markdown
# Command Name

## Parameters

- `args`: Required arguments
- `--interactive`: (Optional) Enable interactive mode with user Q&A

## Instructions

1. Parse arguments and check for `--interactive` flag

2. [If `--interactive`] Ask clarifying questions using AskUserQuestion tool:
   - Question 1...
   - Question 2... Wait for user responses before proceeding.

3. [If not `--interactive`] Use reasonable defaults:
   - Default for question 1: X
   - Default for question 2: Y

4. Execute the main task...
```

**Command Composition**:

- Commands can reference other commands inline: `/other-command args`
- Claude interprets and executes the referenced command
- Use for within-session composition only
- When composing, typically omit `--interactive` to avoid nested prompts

### Agents (`.md`)

Sub-agents invoked via the `Task` tool with `subagent_type` parameter.

**Location**: `agents/` directory

**Structure**:

```markdown
---
name: agent-name
description: What this agent specializes in
tools: [list, of, allowed, tools]
---

# Agent Name

[Agent instructions and behavior definition]
```

**Usage**: Claude invokes via `Task` tool, not directly by users.

### Skills (`.md`)

Reusable capabilities activated via the `Skill` tool.

**Location**: `skills/` directory (if needed)

**Note**: Skills are less common than commands. Use commands for most use cases.

### Hooks (`.ps1`)

PowerShell scripts triggered by Claude Code events.

**Location**: `hooks/` directory

**Naming Convention**: `{event}-{description}.ps1`

**Events**:

- `session-start` - When Claude Code session begins
- `tool-call` - Before/after tool execution
- `prompt-submit` - When user submits a prompt

---

## Python Orchestration

### Purpose

Python scripts orchestrate **cross-session workflows** where multiple Claude instances work in parallel or sequence.

### When to Use Python

| Scenario                           | Use Python? | Reason                                            |
| ---------------------------------- | ----------- | ------------------------------------------------- |
| Single command execution           | No          | Use `/command` directly                           |
| Sequential commands, same session  | No          | Command composition via inline `/command`         |
| Parallel Claude instances          | **Yes**     | Cannot spawn parallel sessions from within Claude |
| Cross-branch work (worktrees)      | **Yes**     | Each worktree needs its own Claude session        |
| Result aggregation across sessions | **Yes**     | No shared state between sessions                  |

### Core Python Package (`claude-plugins-core`)

```
plugins/core/src/claude_core/
├── __init__.py
├── runner.py          # Claude CLI invocation
└── orchestrator.py    # Parallel execution coordination
```

**runner.py** - Claude CLI Wrapper:

```python
from claude_core import run_claude, run_claude_with_command, ClaudeResult

# Run a prompt
result = run_claude("Analyze this code", cwd=Path("/project"))

# Run a slash command
result = run_claude_with_command("git-commit", args="Fix typo", cwd=Path("/project"))
```

**orchestrator.py** - Parallel Execution:

```python
from claude_core import Orchestrator, Task

orchestrator = Orchestrator()
orchestrator.add_task(Task(prompt="/plan-feature auth system", cwd=worktree_a))
orchestrator.add_task(Task(prompt="/plan-feature api docs", cwd=worktree_b))
results = orchestrator.run_parallel()
```

### SDLC Python Package (`claude-plugins-sdlc`)

```
plugins/sdlc/src/claude_sdlc/
├── __init__.py
├── workflows/
│   ├── feature.py     # Full feature workflow
│   ├── bugfix.py      # Bug fix workflow
│   └── release.py     # Release workflow
└── cli.py             # Entry point
```

**Depends on**: `claude-plugins-core`

---

## Command Specifications

### Core Commands

#### `git-worktree` (NEW)

Creates and manages git worktrees for parallel development.

```yaml
---
name: git-worktree
description: Create or manage git worktrees for parallel work
argument-hint: <action> [branch-name]
interactive: false
---
```

**Actions**:

- `create <branch>` - Create worktree with new branch
- `list` - List existing worktrees
- `remove <branch>` - Remove worktree

### SDLC Commands

#### `plan-feature`

Feature planning with optional interactive mode.

```yaml
---
name: plan-feature
description: Generate a feature implementation plan
argument-hint: <feature-description> [--interactive]
---
```

**Modes**:

- `/plan-feature add dark mode` - Autonomous execution with defaults
- `/plan-feature add dark mode --interactive` - Asks clarifying questions via AskUserQuestion

#### `plan-bug`

Bug fix planning. Focuses on root cause analysis and fix strategy.

```yaml
---
name: plan-bug
description: Generate a bug fix plan
argument-hint: <bug-description> [--interactive]
---
```

**Modes**:

- `/plan-bug login fails on Safari` - Autonomous diagnosis and plan
- `/plan-bug login fails on Safari --interactive` - Asks about reproduction steps, priority, etc.

#### `plan-chore`

Chore/maintenance planning. For refactoring, dependency updates, cleanup.

```yaml
---
name: plan-chore
description: Generate a maintenance task plan
argument-hint: <chore-description> [--interactive]
---
```

**Modes**:

- `/plan-chore update dependencies` - Autonomous plan with defaults
- `/plan-chore update dependencies --interactive` - Asks about scope, breaking changes tolerance, etc.

---

## Conventions & Standards

### Naming

| Type            | Convention             | Example                     |
| --------------- | ---------------------- | --------------------------- |
| Commands        | kebab-case             | `plan-feature.md`           |
| Agents          | kebab-case with domain | `code-reviewer.md`          |
| Hooks           | event-description      | `session-start-context.ps1` |
| Python modules  | snake_case             | `runner.py`                 |
| Python packages | kebab-case             | `claude-plugins-core`       |

### Frontmatter

All `.md` components must have YAML frontmatter:

```yaml
---
name: component-name # Required
description: Brief description # Required
argument-hint: [args] [--interactive] # Commands only, include --interactive if supported
tools: [Tool1, Tool2] # Agents only
---
```

### Documentation

- Plugin READMEs: Only plugin-specific information
- No duplication of root README content
- CHANGELOGs: Brief, focus on what changed
- Link to root docs for general information

### Python

- Type hints required
- Docstrings for public functions
- `pyproject.toml` for packaging
- Dependencies explicitly declared

---

## Implementation Roadmap

### Phase 1: Core Restructure

1. **Move Python to core**
   - Move `runner.py` from development to core
   - Create `orchestrator.py` in core
   - Set up `pyproject.toml` for `claude-plugins-core`

2. **Add git-worktree command**
   - Create `git-worktree.md` in core/commands
   - Remove `worktree.py` from Python (functionality now in command)

3. **Update frontmatter**
   - Verify all commands have required frontmatter fields
   - Add `--interactive` to argument-hint for commands that support it

### Phase 2: Rename development → sdlc

1. **Rename plugin directory**
   - `plugins/development/` → `plugins/sdlc/`

2. **Update marketplace.json**
   - Change plugin name from `development` to `sdlc`
   - Update paths

3. **Set up Python package**
   - Create `pyproject.toml` for `claude-plugins-sdlc`
   - Add dependency on `claude-plugins-core`

4. **Move/reorganize commands**
   - Keep: `implement-from-plan.md`
   - Remove: `demo-hello.md`, `demo-bye.md`, `plan-dev.md` (POC only, replaced by plan-feature)
   - Remove: `create-readme-plan.md` (POC only)

### Phase 3: Add Planning Commands

1. **Create plan-feature.md**
   - Supports `--interactive` flag for user Q&A
   - Uses Explore agents for codebase analysis
   - Outputs structured plan

2. **Create plan-bug.md**
   - Supports `--interactive` flag
   - Focuses on diagnosis and fix strategy

3. **Create plan-chore.md**
   - Supports `--interactive` flag
   - For refactoring, updates, cleanup

### Phase 4: Python Orchestration

1. **Implement orchestrator.py**
   - Parallel task execution
   - Result aggregation
   - Error handling

2. **Create SDLC workflows**
   - `feature.py` - Plan → Implement → Review → PR
   - `bugfix.py` - Diagnose → Fix → Test → PR
   - CLI entry point

### Phase 5: Documentation & Cleanup

1. **Update root README.md**
   - Installation instructions
   - Core dependency requirement
   - Python setup instructions

2. **Update CLAUDE.md**
   - Breaking changes notice
   - New conventions

3. **Update plugin READMEs**
   - Core: Python package docs
   - SDLC: Workflow documentation

---

## Breaking Changes

**All breaking changes are acceptable at this stage.**

### Planned Breaking Changes

1. **Plugin rename**: `development` → `sdlc`
   - Users must reinstall: `/plugin uninstall development && /plugin install sdlc`

2. **Command removal**: `plan-dev` removed, replaced by `plan-feature`
   - Use `/plan-feature --interactive` for similar behavior to old `plan-dev`

3. **Python package restructure**
   - `claude_workflows` → `claude_core` + `claude_sdlc`
   - Import paths change

4. **Worktree management**
   - `worktree.py` removed
   - Use `/git-worktree` command instead
   - Python scripts call command via `run_claude_with_command("git-worktree", ...)`

### Migration Guide

```bash
# Uninstall old plugin
/plugin uninstall development

# Install new plugins
/plugin install core
/plugin install sdlc

# Update Python packages
pip uninstall claude-workflows  # if previously installed
pip install claude-plugins-core
pip install claude-plugins-sdlc
```

---

## File Changes Summary

### New Files

```
plugins/core/src/claude_core/__init__.py
plugins/core/src/claude_core/runner.py
plugins/core/src/claude_core/orchestrator.py
plugins/core/src/pyproject.toml
plugins/core/commands/git-worktree.md

plugins/sdlc/commands/plan-feature.md
plugins/sdlc/commands/plan-bug.md
plugins/sdlc/commands/plan-chore.md
plugins/sdlc/src/claude_sdlc/__init__.py
plugins/sdlc/src/claude_sdlc/cli.py
plugins/sdlc/src/claude_sdlc/workflows/feature.py
plugins/sdlc/src/pyproject.toml
```

### Moved/Renamed Files

```
plugins/development/ → plugins/sdlc/
plugins/development/src/claude_workflows/runner.py → plugins/core/src/claude_core/runner.py
```

### Deleted Files

```
plugins/development/src/claude_workflows/worktree.py  # replaced by git-worktree command
plugins/development/commands/demo-hello.md            # POC only
plugins/development/commands/demo-bye.md              # POC only
plugins/development/commands/plan-dev.md              # replaced by plan-feature
plugins/development/commands/create-readme-plan.md    # POC only
plugins/development/src/claude_workflows/commands/hello.py
plugins/development/src/claude_workflows/commands/bye.py
```

---

## Validation Checklist

### Core Plugin

- [ ] `runner.py` works standalone
- [ ] `orchestrator.py` can run parallel tasks
- [ ] `git-worktree` command creates/removes worktrees
- [ ] Python package installs correctly
- [ ] All commands have correct frontmatter

### SDLC Plugin

- [ ] Depends on core (pip level)
- [ ] `plan-feature` generates valid plans (autonomous mode)
- [ ] `plan-feature --interactive` asks clarifying questions
- [ ] `plan-bug` generates valid plans
- [ ] `plan-chore` generates valid plans
- [ ] `implement-from-plan` executes plans
- [ ] Python workflows execute end-to-end

### Integration

- [ ] Commands work in Claude Code sessions
- [ ] Commands work via `claude -p`
- [ ] Python scripts orchestrate multiple sessions
- [ ] Worktrees enable parallel execution

---

## References

- [Claude Code CLI Documentation](https://docs.anthropic.com/claude-code/cli)
- [Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
- [Python Packaging Guide](https://packaging.python.org/)
