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

- Git commands: `git-branch`, `git-commit`, `git-pr`, `git-worktree`,
- GitHub commands: `create-gh-issue`, `read-gh-issue`
- Base Python package: `claude-plugins-core`
  - `runner.py` - Claude CLI wrapper
  - `orchestrator.py` - Parallel execution engine

**Python Package**: `claude-plugins-core`

### SDLC Plugin

**Purpose**: Software Development Lifecycle workflows.

**Dependencies**: Requires `claude-plugins-core`

**Contents**:

- Design: `design` This command is used to start from a product requirement, design the technical implementation, then create a GitHub Epic (optional) and GitHub issues for every task that must be completed to implement this feature. It can
  be used in interactive mode to ask clarifying questions to the user.
- All-in-one: `plan-build` workflow that can be use to execute simple tasks. This will create a branch, explore the code, build and in-memory plan, implement it, commit and push the changes and open a pr. The input for this command is
  either a prompt or a GitHub issue. It can be used in interactive mode, to ask clarigyin questions to the user, before building the in-memory plan.
- Planning commands: `plan`, `plan-feature`, `plan-bug`, `plan-chore`, The plan command is a prompt that select which sub-plan command to use based on the complexity of the task. The plan command supports the --interactive flag. If plan is
  used in interactive mode, claryfing questions are asked to the user when the analysis is completed, before writing the .md plan.
- Implementation commands: `implement`
- Review commands: `review`
- Workflow scripts: Full SDLC orchestration => plan, implement, review with git management included (create a worktree first, create a branch, commit changes after each task/milestones, push the changes, finally open a PR). The input for
  this workflow can be a prompt or a GitHub issue number (the workflow uses the read-gh-issue command to obtain the instructions)

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

#### `create-gh-issue` (NEW)

Creates a GitHub issue with structured content.

```yaml
---
name: create-gh-issue
description: Create a GitHub issue with title, body, and labels
argument-hint: <title> [--body <body>] [--labels <labels>]
---
```

**Usage**:

- `/create-gh-issue "Fix login bug" --body "Users cannot login" --labels bug,priority`
- Integrates with `gh` CLI

#### `read-gh-issue` (NEW)

Reads a GitHub issue and returns its content for use in workflows.

```yaml
---
name: read-gh-issue
description: Read a GitHub issue by number
argument-hint: <issue-number>
---
```

**Usage**:

- `/read-gh-issue 123`
- Returns issue title, body, labels, and comments
- Used by SDLC workflows to get task instructions

### SDLC Commands

#### `design` (NEW)

Design technical implementation from product requirements and create GitHub issues.

```yaml
---
name: design
description: Design technical implementation and create GitHub issues
argument-hint: <requirement-description> [--interactive] [--epic]
---
```

**Modes**:

- `/design user authentication system` - Autonomous design with default decisions
- `/design user authentication system --interactive` - Asks clarifying questions before designing
- `/design user authentication system --epic` - Creates a GitHub Epic with linked issues

**Output**: Technical design document + GitHub issues for each implementation task.

#### `plan-build` (NEW)

All-in-one workflow for simple tasks: branch, plan, implement, commit, PR.

```yaml
---
name: plan-build
description: Execute simple task end-to-end with git management
argument-hint: <task-description | issue-number> [--interactive]
---
```

**Modes**:

- `/plan-build "Add loading spinner to dashboard"` - Autonomous execution
- `/plan-build 123` - Reads GitHub issue #123 for instructions
- `/plan-build "Add loading spinner" --interactive` - Asks clarifying questions first

**Flow**: Create branch → Explore code → Build in-memory plan → Implement → Commit → Push → Open PR

#### `plan` (NEW)

Meta-command that selects the appropriate planning command based on task complexity.

```yaml
---
name: plan
description: Auto-select and execute appropriate planning command
argument-hint: <task-description> [--interactive]
---
```

**Behavior**:

- Analyzes task description to determine type (feature, bug, chore)
- Delegates to `plan-feature`, `plan-bug`, or `plan-chore`
- Passes through `--interactive` flag if provided

#### `implement` (NEW)

Implements a plan from a markdown plan file.

```yaml
---
name: implement
description: Implement changes from a plan file
argument-hint: <plan-file-path>
---
```

**Usage**:

- `/implement docs/plans/feature-auth-plan.md`
- Reads plan, executes implementation steps, commits after milestones

#### `review` (NEW)

Reviews code changes and provides feedback.

```yaml
---
name: review
description: Review code changes for quality and correctness
argument-hint: [branch | commit-range]
---
```

**Usage**:

- `/review` - Reviews uncommitted changes
- `/review feature/auth` - Reviews changes on branch vs main
- `/review HEAD~3..HEAD` - Reviews specific commit range

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

### Prompt References

All prompts (commands, agents, skills) must follow the structure defined in the reference documents:

| Component | Reference Document                  |
| --------- | ----------------------------------- |
| Commands  | `docs/commands-prompt-reference.md` |
| Agents    | `docs/agents-prompt-reference.md`   |
| Skills    | `docs/skills-prompt-reference.md`   |

**Key Requirements**:

- All prompts must include valid YAML frontmatter
- Commands: Definition, Parameters, Objective, Core Principles, Instructions, Output Guidance
- Agents: Purpose, Methodology, Tools Available, Capabilities, Knowledge Base, Output Guidance
- Skills: Definition, Parameters, Objective, Core Principles, Instructions, Output Guidance

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

3. **Add GitHub commands**
   - Create `create-gh-issue.md` in core/commands
   - Create `read-gh-issue.md` in core/commands
   - Both integrate with `gh` CLI

4. **Update frontmatter**
   - Verify all commands have required frontmatter fields
   - Add `--interactive` to argument-hint for commands that support it
   - Ensure all prompts follow `docs/*-prompt-reference.md` structure

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

### Phase 3: Add SDLC Commands

1. **Create design.md**
   - Supports `--interactive` and `--epic` flags
   - Creates technical design + GitHub issues
   - Uses `/create-gh-issue` for issue creation

2. **Create plan-build.md**
   - Supports `--interactive` flag
   - Accepts prompt or GitHub issue number
   - Full workflow: branch → plan → implement → commit → PR

3. **Create plan.md**
   - Meta-command that delegates to plan-feature/bug/chore
   - Supports `--interactive` flag passthrough

4. **Create plan-feature.md**
   - Supports `--interactive` flag for user Q&A
   - Uses Explore agents for codebase analysis
   - Outputs structured plan

5. **Create plan-bug.md**
   - Supports `--interactive` flag
   - Focuses on diagnosis and fix strategy

6. **Create plan-chore.md**
   - Supports `--interactive` flag
   - For refactoring, updates, cleanup

7. **Create implement.md**
   - Reads plan file and executes steps
   - Commits after milestones

8. **Create review.md**
   - Reviews uncommitted changes, branch, or commit range
   - Outputs structured feedback

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
# Core Plugin - Python
plugins/core/src/claude_core/__init__.py
plugins/core/src/claude_core/runner.py
plugins/core/src/claude_core/orchestrator.py
plugins/core/src/pyproject.toml

# Core Plugin - Commands
plugins/core/commands/git-worktree.md
plugins/core/commands/create-gh-issue.md
plugins/core/commands/read-gh-issue.md

# SDLC Plugin - Commands
plugins/sdlc/commands/design.md
plugins/sdlc/commands/plan-build.md
plugins/sdlc/commands/plan.md
plugins/sdlc/commands/plan-feature.md
plugins/sdlc/commands/plan-bug.md
plugins/sdlc/commands/plan-chore.md
plugins/sdlc/commands/implement.md
plugins/sdlc/commands/review.md

# SDLC Plugin - Python
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
- [ ] `create-gh-issue` creates GitHub issues via `gh` CLI
- [ ] `read-gh-issue` reads GitHub issues via `gh` CLI
- [ ] Python package installs correctly
- [ ] All commands follow `docs/commands-prompt-reference.md` structure

### SDLC Plugin

- [ ] Depends on core (pip level)
- [ ] `design` creates technical design + GitHub issues
- [ ] `design --interactive` asks clarifying questions
- [ ] `plan-build` executes full workflow (branch → PR)
- [ ] `plan-build 123` reads instructions from GitHub issue
- [ ] `plan` delegates to correct sub-command
- [ ] `plan-feature` generates valid plans (autonomous mode)
- [ ] `plan-feature --interactive` asks clarifying questions
- [ ] `plan-bug` generates valid plans
- [ ] `plan-chore` generates valid plans
- [ ] `implement` executes plan from file
- [ ] `review` reviews code changes
- [ ] Python workflows execute end-to-end
- [ ] All commands follow `docs/commands-prompt-reference.md` structure

### Integration

- [ ] Commands work in Claude Code sessions
- [ ] Commands work via `claude -p`
- [ ] `--interactive` flag enables user Q&A
- [ ] Python scripts orchestrate multiple sessions
- [ ] Worktrees enable parallel execution

---

## References

- [Claude Code CLI Documentation](https://docs.anthropic.com/claude-code/cli)
- [Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
- [Python Packaging Guide](https://packaging.python.org/)
