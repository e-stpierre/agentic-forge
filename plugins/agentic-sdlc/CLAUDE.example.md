# Agentic SDLC Integration

Add these sections to your CLAUDE.md to enable agentic workflow features.

## Checkpoint Guidelines

Create checkpoints using `/create-checkpoint` when:

- Completing a milestone in implementation
- About to hand off to another session
- Encountering issues that need documentation

## Workflow Integration

This repository uses agentic-sdlc for automated development. Key directories:

- `agentic/outputs/` - Workflow execution state and logs
- `agentic/workflows/` - Workflow YAML templates
- `agentic/analysis/` - Code analysis reports

When working in a workflow context, always:

1. Check for existing checkpoints before starting
2. Update progress after completing tasks
3. Use structured JSON output for commands

## Available Commands

### Planning

- `/plan` - Create implementation plans for tasks
- `/build` - Implement changes following a plan
- `/validate` - Run validation checks

### Analysis

- `/analyze-bug` - Analyze for bugs and logic errors
- `/analyze-debt` - Identify technical debt
- `/analyze-doc` - Check documentation quality
- `/analyze-security` - Scan for security vulnerabilities
- `/analyze-style` - Check code style

### Git Operations

- `/git-branch` - Manage git branches
- `/git-commit` - Create commits
- `/git-pr` - Create pull requests

### State

- `/create-checkpoint` - Record progress
- `/create-log` - Add structured log entries

## Running Workflows

Execute workflows using the CLI:

```bash
# Run a one-shot task (bundled workflow)
agentic-sdlc run one-shot.yaml --var "task=Add health check endpoint"

# Run full SDLC workflow (bundled workflow)
agentic-sdlc run plan-build-validate.yaml --var "task=Implement user authentication"

# Run codebase analysis (bundled workflow)
agentic-sdlc run analyze-codebase.yaml --var "autofix=major"

# Run a local custom workflow
agentic-sdlc run agentic/workflows/my-custom-workflow.yaml
```

## Best Practices

1. **During Implementation**: Create checkpoints at milestones
2. **On Completion**: Record progress in checkpoints
3. **For Logging**: Use structured log entries for significant events
