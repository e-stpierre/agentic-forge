<p align="center">
  <img src="agentic-forge-banner.png" alt="Agentic Forge" width="600">
</p>

<h1 align="center">Agentic Forge</h1>

<p align="center">
  <a href="https://github.com/e-stpierre/agentic-forge/releases"><img src="https://img.shields.io/github/v/release/e-stpierre/agentic-forge?include_prereleases" alt="GitHub release"></a>
  <a href="https://claude.ai/code"><img src="https://img.shields.io/badge/Built%20for-Claude%20Code-orange" alt="Built for Claude Code"></a>
  <a href="https://github.com/e-stpierre/agentic-forge/blob/main/LICENSE"><img src="https://img.shields.io/github/license/e-stpierre/agentic-forge" alt="License"></a>
</p>

<p align="center">
  <strong>Claude Code plugins for autonomous development workflows</strong>
</p>

<p align="center">
  YAML-based agentic workflows | Multi-step task orchestration | Long-running
</p>

## Getting Started

### Prerequisites

- Claude Code CLI installed and configured
- Basic familiarity with Claude Code

### Installation

1. Add this repository as a plugin marketplace in Claude Code:

   ```bash
   /plugin marketplace add e-stpierre/agentic-forge
   ```

2. Install the plugin(s) you need and refer to their README for usage.

## Plugins

### Agentic SDLC

YAML-based workflow orchestration for autonomous task execution with parallel execution, conditional logic, and retry mechanisms.

**Best for**: Autonomous development where you prefer Claude works independently.

#### Installation

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

#### Examples

See [Agentic-SDLC README](plugins/agentic-sdlc/README.md) for all commands and workflow options.

```bash
# Complete a task end-to-end autonomously with PR creation
agentic-sdlc one-shot "Add user authentication"

# Run a workflow with variables for iterative task completion
agentic-sdlc run ralph-loop.yaml --var "max_iterations=20" \
  --var "task=Follow the improvement plan. Each iteration: read plan, implement next task, commit, STOP."

# Run plan-build-validate workflow for full SDLC automation
agentic-sdlc run plan-build-validate.yaml --var "task=Add dark mode support"
```

## Experimental Plugins

The `/experimental-plugins/` directory contains work-in-progress plugins that are not yet officially released. These may have breaking changes and are available for testing and feedback.

## Contributing

Found a bug or have a suggestion? Please [open an issue](https://github.com/e-stpierre/agentic-forge/issues) on GitHub.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
