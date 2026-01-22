# Quick Start

Get started with agentic-sdlc in under 5 minutes.

## Installation

```bash
# Windows (PowerShell)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\agentic-sdlc"

# macOS/Linux
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/agentic-sdlc
```

## Run Your First Workflow

Bundled workflows work immediately without any setup:

```bash
# Run the complete plan-build-validate workflow
agentic-sdlc run plan-build-validate.yaml --var "task=Add a login button to the homepage"
```

This will:
1. Generate an implementation plan
2. Implement the changes
3. Validate with tests and code review
4. Create a pull request

## Common Commands Cheat Sheet

### CLI Commands

```bash
# Execute a one-shot task (quick task completion)
agentic-sdlc one-shot "Fix the null pointer exception in UserService" --git --pr

# Run security analysis
agentic-sdlc analyse --type security

# List available bundled workflows
agentic-sdlc init --list

# Check workflow status
agentic-sdlc list

# Resume a paused workflow
agentic-sdlc resume <workflow-id>
```

### Claude Commands

Inside a Claude Code session:

```bash
# Generate an implementation plan
/plan Add user profile page with avatar upload

# Implement changes following a plan
/build --plan agentic/outputs/abc123/plan.md

# Run validation checks
/validate

# Analyze for bugs
/analyse-bug

# Create a git commit
/git-commit

# Create a pull request
/git-pr
```

## Next Steps

- **Customize workflows**: Run `agentic-sdlc init` to copy bundled workflows locally, then edit them in `agentic/workflows/`
- **Learn workflow syntax**: See [WorkflowBuilder.md](./WorkflowBuilder.md) for complete workflow authoring guide
- **Configure settings**: Run `agentic-sdlc configure` for interactive setup
- **View full command reference**: See [README.md](../README.md) for detailed documentation

## Directory Structure

After running workflows, you'll see:

```
agentic/
├── config.json           # Configuration settings
├── workflows/            # Custom workflow YAML files (created with 'init')
├── outputs/              # Workflow execution state and progress
└── analysis/             # Analysis outputs from /analyse commands
```

## Common Workflows

### Plan -> Build -> Validate -> PR

```bash
agentic-sdlc run plan-build-validate.yaml --var "task=Your feature description"
```

### Quick Task Completion

```bash
agentic-sdlc one-shot "Your task description" --git --pr
```

### Codebase Analysis

```bash
# All analysis types in parallel
agentic-sdlc analyse

# Specific analysis type
agentic-sdlc analyse --type security --autofix major
```

## Troubleshooting

**Workflow not found?**
- Use `agentic-sdlc init --list` to see available bundled workflows
- Bundled workflows work without copying: `agentic-sdlc run plan-build-validate.yaml`

**Need more verbose output?**
```bash
agentic-sdlc run workflow.yaml --terminal-output all
```

**Configuration issues?**
```bash
# Interactive setup
agentic-sdlc configure

# View current config
agentic-sdlc config get defaults
```
