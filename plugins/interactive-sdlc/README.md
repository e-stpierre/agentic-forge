# Interactive SDLC Plugin

Human-in-the-loop plugin for guided development within Claude Code sessions. Provides interactive planning, implementation, validation, and analysis workflows with smart context inference. All commands support optional context arguments to reduce prompts while maintaining the ability to ask clarifying questions.

## Overview

The Interactive SDLC plugin provides guided workflows for planning, implementing, and validating development tasks. Commands ask clarifying questions when needed and support context arguments for automation.

- `/interactive-sdlc:plan-feature Add OAuth login` - Plan a feature with milestones
- `/interactive-sdlc:build specs/feature-auth.md --git` - Implement a plan with auto-commits
- `/interactive-sdlc:validate --plan specs/feature-auth.md` - Validate implementation
- `/interactive-sdlc:one-shot --git Fix login timeout` - Quick task without saved plan

## Commands

All commands use the `/interactive-sdlc:` namespace prefix. Commands are organized into logical categories. All paths are relative to the project root.

### Setup

| Command | Description |
|---------|-------------|
| `/interactive-sdlc:configure` | Set up plugin configuration interactively |

### Planning (`commands/plan/`)

| Command | Description |
|---------|-------------|
| `/interactive-sdlc:plan-chore` | Plan a maintenance task |
| `/interactive-sdlc:plan-bug` | Plan a bug fix with root cause analysis |
| `/interactive-sdlc:plan-feature` | Plan a feature with milestones |

### Development (`commands/dev/`)

| Command | Description |
|---------|-------------|
| `/interactive-sdlc:build` | Implement a plan file with checkpoint support |
| `/interactive-sdlc:validate` | Comprehensive validation (tests, code review, build, plan compliance) |
| `/interactive-sdlc:document` | Generate or update documentation with mermaid diagrams |

### Workflows (`commands/workflows/`)

| Command | Description |
|---------|-------------|
| `/interactive-sdlc:one-shot` | Quick task without saved plan file |
| `/interactive-sdlc:plan-build-validate` | Full workflow from planning to validation |

### Analysis (`commands/analyse/`)

| Command | Description |
|---------|-------------|
| `/interactive-sdlc:analyse-bug` | Analyze codebase for bugs and logic errors |
| `/interactive-sdlc:analyse-doc` | Analyze documentation quality and accuracy |
| `/interactive-sdlc:analyse-debt` | Identify technical debt and refactoring opportunities |
| `/interactive-sdlc:analyse-style` | Check code style, consistency, and best practices |
| `/interactive-sdlc:analyse-security` | Scan for security vulnerabilities and unsafe patterns |

### Git (`commands/git/`)

| Command | Description |
|---------|-------------|
| `/interactive-sdlc:git-branch` | Create branches with standardized naming conventions |
| `/interactive-sdlc:git-commit` | Commit changes with structured messages |
| `/interactive-sdlc:git-pr` | Create pull requests with contextual descriptions |

### GitHub (`commands/github/`)

| Command | Description |
|---------|-------------|
| `/interactive-sdlc:create-gh-issue` | Create GitHub issues with title, body, and labels |
| `/interactive-sdlc:read-gh-issue` | Read GitHub issue content by number |

## Arguments Reference

### Common Arguments

- `--git` - Auto-commit changes at logical checkpoints
- `--explore N` - Override default explore agent count for codebase analysis
- `[context]` - Optional freeform context as the last parameter

### Build-Specific Arguments

- `<plan-file>` - Required path to plan file (relative to project root)
- `--checkpoint "<text>"` - Resume from specific task/milestone

### Validate-Specific Arguments

- `--plan <plan-file>` - Plan file to verify compliance against
- `--skip-tests` - Skip test execution
- `--skip-build` - Skip build verification
- `--skip-review` - Skip code review
- `--autofix critical,major` - Auto-fix issues of specified severity levels

### Workflow-Specific Arguments

- `--pr` - Create draft PR when validation passes (plan-build-validate only)
- `--validate` - Run validation after implementation (one-shot only)

## Context Argument

All commands support an optional `[context]` argument as the last parameter. This allows you to provide upfront information that would otherwise require interactive questions.

**Benefits:**

- Faster workflow by providing all information upfront
- Better for automation and scripting
- Reduced friction with fewer interactive prompts
- Flexibility to choose between interactive or context mode

**Example:**

```bash
# With context - minimal prompts
/interactive-sdlc:plan-bug --explore 3 Login fails on Safari when using OAuth.
Users click login button, get redirected to OAuth provider,
but after successful auth they are redirected to a blank page
instead of the dashboard.

# Without context - interactive prompts
/interactive-sdlc:plan-bug --explore 3
```

## Plan File Principles

Plans are static documentation of work to be done:

- Plans are immutable during implementation (progress tracked via TodoWrite)
- No time estimates, deadlines, or scheduling information
- Content includes requirements, architecture, tasks, and validation criteria
- Implementation commands read plans as reference, not as mutable state

## Configuration

Configure the plugin in `.claude/settings.json` (project scope, committed to git):

```json
{
  "interactive-sdlc": {
    "planDirectory": "specs",
    "analysisDirectory": "analysis",
    "defaultExploreAgents": {
      "chore": 2,
      "bug": 2,
      "feature": 3
    }
  }
}
```

Personal overrides can be added to `.claude/settings.local.json` (gitignored).

### Configuration Options

| Setting                        | Type          | Default      | Description                          |
| ------------------------------ | ------------- | ------------ | ------------------------------------ |
| `planDirectory`                | string        | `"specs"`    | Directory for plan files (.md)       |
| `analysisDirectory`            | string        | `"analysis"` | Directory for analysis reports (.md) |
| `defaultExploreAgents.chore`   | number (0-5)  | `2`          | Explore agents for chore planning    |
| `defaultExploreAgents.bug`     | number (0-5)  | `2`          | Explore agents for bug planning      |
| `defaultExploreAgents.feature` | number (0-10) | `3`          | Explore agents for feature planning  |

## Complete Examples

### /interactive-sdlc:configure

**Arguments:** None

**Examples:**

```bash
# Run interactive configuration
/interactive-sdlc:configure
```

### /interactive-sdlc:plan-chore

**Arguments:**

- `--explore N` - Override default explore agent count (default: 2)
- `--git` - Commit plan file after creation
- `[context]` - Chore description

**Examples:**

```bash
# Plan with context
/interactive-sdlc:plan-chore Update all npm dependencies to latest versions

# Plan with exploration
/interactive-sdlc:plan-chore --explore 3 Refactor database connection pooling

# Plan and commit
/interactive-sdlc:plan-chore --git Clean up unused imports across codebase
```

### /interactive-sdlc:plan-bug

**Arguments:**

- `--explore N` - Override default explore agent count (default: 2)
- `--git` - Commit plan file after creation
- `[context]` - Bug description

**Examples:**

```bash
# Plan with context
/interactive-sdlc:plan-bug Login fails on Safari when using OAuth

# Plan with exploration
/interactive-sdlc:plan-bug --explore 3 Memory leak in WebSocket handler

# Plan and commit
/interactive-sdlc:plan-bug --git Race condition in checkout flow
```

### /interactive-sdlc:plan-feature

**Arguments:**

- `--explore N` - Override default explore agent count (default: 3)
- `--git` - Commit plan file after creation
- `[context]` - Feature description

**Examples:**

```bash
# Plan with context
/interactive-sdlc:plan-feature Add user authentication with OAuth for Google and GitHub

# Plan with more exploration
/interactive-sdlc:plan-feature --explore 5 Implement real-time notifications

# Plan and commit
/interactive-sdlc:plan-feature --git --explore 4 Add dark mode toggle
```

### /interactive-sdlc:build

**Arguments:**

- `<plan-file>` - Required path to plan file
- `--git` - Auto-commit at milestones
- `--checkpoint "<text>"` - Resume from specific task/milestone
- `[context]` - Implementation guidance

**Examples:**

```bash
# Basic build
/interactive-sdlc:build specs/feature-auth.md

# Build with auto-commit
/interactive-sdlc:build specs/feature-auth.md --git

# Resume from checkpoint
/interactive-sdlc:build specs/feature-auth.md --checkpoint "Milestone 2" --git
```

### /interactive-sdlc:validate

**Arguments:**

- `--plan <plan-file>` - Plan file to verify compliance
- `--skip-tests` - Skip test execution
- `--skip-build` - Skip build verification
- `--skip-review` - Skip code review
- `--autofix <levels>` - Auto-fix issues (e.g., "critical,major")

**Examples:**

```bash
# Full validation
/interactive-sdlc:validate --plan specs/feature-auth.md

# Skip tests, auto-fix critical
/interactive-sdlc:validate --skip-tests --autofix critical

# Quick validation
/interactive-sdlc:validate --skip-tests --skip-build
```

### /interactive-sdlc:document

**Arguments:**

- `--output <path>` - Specify output file path
- `[context]` - Description of what to document

**Examples:**

```bash
# Document API endpoints
/interactive-sdlc:document --output docs/api.md Document the REST API endpoints

# Document architecture
/interactive-sdlc:document --output docs/architecture.md Document the system architecture

# Auto-detect output location
/interactive-sdlc:document Document the authentication flow
```

### /interactive-sdlc:one-shot

**Arguments:**

- `--git` - Auto-commit when done
- `--validate` - Run validation after implementation
- `--explore N` - Override explore agent count (default: 0)
- `[context]` - Task description

**Examples:**

```bash
# Quick fix
/interactive-sdlc:one-shot Fix typo in README

# Fix with commit and validation
/interactive-sdlc:one-shot --git --validate Fix login timeout on Safari

# With exploration
/interactive-sdlc:one-shot --explore 2 --git Refactor auth middleware
```

### /interactive-sdlc:plan-build-validate

**Arguments:**

- `--git` - Auto-commit throughout workflow
- `--pr` - Create draft PR when validation passes
- `--explore N` - Override explore agent count for planning phase
- `[context]` - Task description

**Examples:**

```bash
# Full workflow with PR
/interactive-sdlc:plan-build-validate --git --pr Add dark mode toggle

# Without PR creation
/interactive-sdlc:plan-build-validate --git Fix authentication timeout issue

# With extra exploration
/interactive-sdlc:plan-build-validate --explore 5 --git --pr Implement user notifications
```

### /interactive-sdlc:analyse-bug

**Arguments:**

- `[context]` - Focus areas or directories to analyze

**Examples:**

```bash
# Full bug analysis
/interactive-sdlc:analyse-bug

# Focused analysis
/interactive-sdlc:analyse-bug Focus on error handling in API routes

# Directory-specific
/interactive-sdlc:analyse-bug src/api/ src/services/
```

### /interactive-sdlc:analyse-doc

**Arguments:**

- `[context]` - Specific documentation files or areas to focus on

**Examples:**

```bash
# Full documentation analysis
/interactive-sdlc:analyse-doc

# Focused analysis
/interactive-sdlc:analyse-doc Check API documentation accuracy

# Specific files
/interactive-sdlc:analyse-doc docs/api.md README.md
```

### /interactive-sdlc:analyse-debt

**Arguments:**

- `[context]` - Specific areas or concerns to focus on

**Examples:**

```bash
# Full debt analysis
/interactive-sdlc:analyse-debt

# Focused analysis
/interactive-sdlc:analyse-debt Focus on database access patterns

# Module-specific
/interactive-sdlc:analyse-debt src/legacy/
```

### /interactive-sdlc:analyse-style

**Arguments:**

- `[context]` - Specific areas or files to focus on

**Examples:**

```bash
# Full style analysis
/interactive-sdlc:analyse-style

# Focused analysis
/interactive-sdlc:analyse-style Check naming conventions in React components

# Directory-specific
/interactive-sdlc:analyse-style src/components/
```

### /interactive-sdlc:analyse-security

**Arguments:**

- `[context]` - Focus areas or directories to analyze

**Examples:**

```bash
# Full security analysis
/interactive-sdlc:analyse-security

# Focused analysis
/interactive-sdlc:analyse-security Focus on authentication and session management

# Directory-specific
/interactive-sdlc:analyse-security src/api/ src/auth/
```

### /interactive-sdlc:git-branch

**Arguments:**

- `[category]` - Branch type: feature (default), hotfix, chore, docs, poc
- `<branch-name>` - Short kebab-case description (required)
- `[issue-id]` - GitHub issue number

When only one argument is provided, it is treated as the branch-name with category defaulting to `feature`.

**Examples:**

```bash
# Simple branch (defaults to feature/add-dark-mode)
/interactive-sdlc:git-branch add-dark-mode

# With category
/interactive-sdlc:git-branch hotfix login-timeout

# With issue reference
/interactive-sdlc:git-branch feature add-oauth 123
```

### /interactive-sdlc:git-commit

**Arguments:**

- `[message]` - Override commit title (auto-generated if not provided)

**Examples:**

```bash
# Auto-generate commit message from changes
/interactive-sdlc:git-commit

# With custom message
/interactive-sdlc:git-commit Fix login timeout on Safari
```

### /interactive-sdlc:git-pr

**Arguments:**

- `[base-branch]` - Target branch for the PR (defaults to main/master)

**Examples:**

```bash
# Create PR to default branch
/interactive-sdlc:git-pr

# Create PR to specific branch
/interactive-sdlc:git-pr develop
```

### /interactive-sdlc:create-gh-issue

**Arguments:**

- `"<title>"` - Issue title (required, use quotes if it contains spaces)
- `--body <body>` - Issue body/description
- `--labels <labels>` - Comma-separated list of labels
- `--milestone <milestone>` - Milestone to assign
- `--assignee <assignee>` - GitHub username (use `@me` for self)

**Examples:**

```bash
# Simple issue
/interactive-sdlc:create-gh-issue "Fix login bug"

# With body and labels
/interactive-sdlc:create-gh-issue "Fix login bug" --body "Users cannot login with Safari" --labels bug,priority-high

# With milestone and assignee
/interactive-sdlc:create-gh-issue "Add dark mode" --labels enhancement,ui --milestone "v2.0" --assignee @me
```

### /interactive-sdlc:read-gh-issue

**Arguments:**

- `<issue-number>` - The issue number to read (required)
- `--comments` - Include issue comments in the output

**Examples:**

```bash
# Read issue
/interactive-sdlc:read-gh-issue 123

# Read issue with comments
/interactive-sdlc:read-gh-issue 456 --comments
```
