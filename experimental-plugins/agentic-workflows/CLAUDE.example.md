# Agentic Workflows Integration

Add these sections to your CLAUDE.md to enable agentic workflow features.

## Memory Management

Create memories using `/create-memory` when you encounter:

- Architectural decisions and their rationale
- User preferences expressed during sessions
- Patterns/conventions discovered in the codebase
- Errors encountered and their solutions

Before starting complex tasks, use `/search-memory` or check `agentic/memory/index.md` for relevant context.

## Checkpoint Guidelines

Create checkpoints using `/create-checkpoint` when:

- Completing a milestone in implementation
- About to hand off to another session
- Encountering issues that need documentation

## Workflow Integration

This repository uses agentic-workflows for automated development. Key directories:

- `agentic/workflows/` - Workflow execution state and logs
- `agentic/memory/` - Persistent learnings and patterns
- `agentic/analysis/` - Code analysis reports

When working in a workflow context, always:

1. Check for existing checkpoints before starting
2. Update progress after completing tasks
3. Create memories for significant learnings
4. Use structured JSON output for commands

## Available Commands

### Planning
- `/plan` - Create implementation plans for tasks
- `/build` - Implement changes following a plan
- `/validate` - Run validation checks

### Analysis
- `/analyse` - Analyze codebase for issues (bug, debt, doc, security, style)

### Git Operations
- `/git-branch` - Manage git branches
- `/git-commit` - Create commits
- `/git-pr` - Create pull requests

### Memory & State
- `/create-memory` - Store learnings for future reference
- `/search-memory` - Find relevant context
- `/create-checkpoint` - Record progress
- `/create-log` - Add structured log entries

## Running Workflows

Execute workflows using the CLI:

```bash
# Run a one-shot task
agentic-workflow run workflows/one-shot.yaml --var "task=Add health check endpoint"

# Run full SDLC workflow
agentic-workflow run workflows/plan-build-validate.yaml --var "task=Implement user authentication"

# Run codebase analysis
agentic-workflow run workflows/analyse-codebase.yaml --var "autofix=major"
```

## Best Practices

1. **Before Complex Tasks**: Search memories for relevant context
2. **During Implementation**: Create checkpoints at milestones
3. **After Discoveries**: Create memories for future sessions
4. **On Errors**: Document solutions as error memories
5. **For Decisions**: Record architectural decisions with rationale
