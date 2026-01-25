# Quick Start

Get started with agentic-sdlc in under 5 minutes.

## Installation

1. Install the plugin in Claude Code:

   ```bash
   /plugin install agentic-sdlc@agentic-forge
   ```

2. Install the python CLI tools:

   ```bash
   # Windows (PowerShell)
   uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\agentic-sdlc"

   # macOS/Linux
   uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/agentic-sdlc
   ```

## Running Your First Workflow

### Help

Help arguments can give you important information about the plugins and supported commands and arguments:

```bash
agentic-sdlc --help

agentic-sdlc run --help
```

### Initialize

Running the init command will copy the default workflows yaml file in your current directory, for easier edit:

```bash
agentic-sdlc init
```

### List Workflows

You can see available workflows with the list command:

```bash
# List available workflows
agentic-sdlc workflows
```

You can run bundled workflow or local workflow that you can create or edit:

```bash
# Run bundle workflow, located in the plugin directory
agentic-sdlc run demo.yaml

# Run local workflow, located in your current directory
agentic-sdlc run agentic/workflows/demo.yaml
```

### Run Demo Workflow

The demo workflow executes a rapid workflow with demo steps to help you understand how the tool operates:

```bash
agentic-sdlc run demo.yaml
```

### Plan Build Review

Bundled workflows work immediately without any setup:

```bash
# Run the complete plan-build-review workflow
agentic-sdlc run plan-build-review.yaml --var "task=Update the README documentation to add two new section, one about coding standard and one about this project architecture"
```

This will:

1. Generate an implementation plan
2. Implement the changes
3. Review changes with tests and code review
4. Create a pull request

## Directory Structure

After running workflows, you'll see:

```
agentic/
├── config.json           # Configuration settings
├── workflows/            # Custom workflow YAML files (created with 'init')
├── outputs/              # Workflow execution state and progress
└── analysis/             # Analysis outputs from /analyze skill
```

## Next Steps

- **Learn workflow syntax**: See [WorkflowBuilder.md](./WorkflowBuilder.md) for complete workflow authoring guide
- **Configure settings**: Run `agentic-sdlc configure` for interactive setup
- **View full command reference**: See [README.md](../README.md) for detailed documentation

## Troubleshooting

**Workflow not found?**

- Use `agentic-sdlc workflows` to see available workflows
- Bundled workflows work without copying: `agentic-sdlc run plan-build-review.yaml`

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
