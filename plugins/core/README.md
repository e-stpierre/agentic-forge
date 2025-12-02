# Core Plugin

Essential tooling for Claude Code that provides foundational commands used across development workflows. This plugin is designed to be a dependency for other plugins.

## Overview

The Core plugin provides common git workflow commands that automate branch creation, commits, and pull requests with consistent naming conventions and structured messages.

## Components

### Commands

| Command       | Description                                                              |
| ------------- | ------------------------------------------------------------------------ |
| `/git-branch` | Create branches with standardized naming: `<category>/<issue-id>_<name>` |
| `/git-commit` | Commit and push with structured messages                                 |
| `/git-pr`     | Create pull requests with contextual descriptions                        |

## Installation

### Marketplace Installation

```bash
/plugin marketplace add e-stpierre/claude-plugins
/plugin install core@e-stpierre/claude-plugins
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

## License

MIT License - Part of the claude-plugins repository.
