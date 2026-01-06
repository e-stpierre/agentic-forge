# Interactive SDLC Plugin

Human-in-the-loop plugin for guided development within Claude Code sessions. Provides interactive planning, implementation, validation, and analysis workflows with smart context inference.

## Philosophy

Interactive development with human guidance for accuracy through clarification and context-aware prompting. All commands support optional context arguments to reduce interactive prompts while maintaining the ability to ask clarifying questions when needed.

## Commands

All commands use the `/interactive-sdlc:` namespace prefix. Commands are organized into logical categories.

### Configuration

- `/interactive-sdlc:configure` - Set up plugin configuration interactively

### Planning (`commands/plan/`)

- `/interactive-sdlc:plan-chore` - Plan a maintenance task
- `/interactive-sdlc:plan-bug` - Plan a bug fix with root cause analysis
- `/interactive-sdlc:plan-feature` - Plan a feature with milestones

### Development (`commands/dev/`)

- `/interactive-sdlc:build` - Implement a plan file with checkpoint support
- `/interactive-sdlc:validate` - Comprehensive validation (tests, code review, build, plan compliance)
- `/interactive-sdlc:document` - Generate or update documentation with mermaid diagrams

### Workflows (`commands/workflows/`)

- `/interactive-sdlc:one-shot` - Quick task without saved plan file
- `/interactive-sdlc:plan-build-validate` - Full workflow from planning to validation

### Analysis (`commands/analyse/`)

- `/interactive-sdlc:analyse-bug` - Analyze codebase for bugs and logic errors
- `/interactive-sdlc:analyse-doc` - Analyze documentation quality and accuracy
- `/interactive-sdlc:analyse-debt` - Identify technical debt and refactoring opportunities
- `/interactive-sdlc:analyse-style` - Check code style, consistency, and best practices
- `/interactive-sdlc:analyse-security` - Scan for security vulnerabilities and unsafe patterns

## Configuration

Configure the plugin in `.claude/settings.json` (project scope, committed to git):

```json
{
  "interactive-sdlc": {
    "planDirectory": "/specs",
    "analysisDirectory": "/analysis",
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

| Setting                        | Type          | Default       | Description                          |
| ------------------------------ | ------------- | ------------- | ------------------------------------ |
| `planDirectory`                | string        | `"/specs"`    | Directory for plan files (.md)       |
| `analysisDirectory`            | string        | `"/analysis"` | Directory for analysis reports (.md) |
| `defaultExploreAgents.chore`   | number (0-5)  | `2`           | Explore agents for chore planning    |
| `defaultExploreAgents.bug`     | number (0-5)  | `2`           | Explore agents for bug planning      |
| `defaultExploreAgents.feature` | number (0-10) | `3`           | Explore agents for feature planning  |

## Command Arguments

### Common Arguments

- `--git` - Auto-commit changes at logical checkpoints
- `--explore N` - Override default explore agent count for codebase analysis
- `[context]` - Optional freeform context as the last parameter

### Build-Specific Arguments

- `<plan-file>` - Required path to plan file
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

## Usage Examples

### Quick bug fix with one-shot

```bash
/interactive-sdlc:one-shot --git Fix login timeout on Safari - users get blank page after OAuth redirect
```

### Feature development with full workflow

```bash
/interactive-sdlc:plan-build-validate --git --pr Add dark mode toggle in user settings with persistent preference storage
```

### Plan a feature with context

```bash
/interactive-sdlc:plan-feature --explore 4 Add user authentication with OAuth support for Google and GitHub providers
```

### Resume interrupted work

```bash
/interactive-sdlc:build /specs/feature-auth.md --checkpoint "Milestone 2" --git
```

### Validate implementation

```bash
/interactive-sdlc:validate --plan /specs/feature-auth.md --autofix critical,major
```

### Security analysis

```bash
/interactive-sdlc:analyse-security Focus on authentication and session management
```

### Generate documentation

```bash
/interactive-sdlc:document --output docs/api.md Document the REST API endpoints with request/response examples
```

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
