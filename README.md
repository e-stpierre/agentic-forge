<p align="center">
  <img src="agentic-forge-banner.png" alt="Agentic Forge" width="600">
</p>

<h1 align="center">Agentic Forge</h1>

<p align="center">
  <a href="https://claude.ai/code"><img src="https://img.shields.io/badge/Built%20for-Claude%20Code-orange" alt="Built for Claude Code"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <strong>Claude Code plugins for interactive and autonomous development workflows</strong>
</p>

<p align="center">
  Interactive commands for guided development | YAML-based agentic workflows | Multi-step task orchestration
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

## Plugins

### Interactive-SDLC

Interactive SDLC commands for guided development within Claude Code sessions through user questions and feedback.

**Best for**: Interactive development where you want to be involved in decisions.

#### Installation

1. Install the plugin in Claude Code:

   ```bash
   /plugin install interactive-sdlc@agentic-forge
   ```

#### Examples

See [Interactive-SDLC README](plugins/interactive-sdlc/README.md) for all commands and options.

```bash
# Plan a feature with milestones and implementation steps
/interactive-sdlc:plan-feature

# Run analysis on your codebase (bugs, docs, debt, style, security)
/interactive-sdlc:analyse-security

# Full workflow from branch creation to PR with user interaction
/interactive-sdlc:one-shot
```

## Experimental Plugins

The `/experimental-plugins/` directory contains work-in-progress plugins that are not yet officially released. These may have breaking changes and are available for testing and feedback.

## Contributing

Found a bug or have a suggestion? Please [open an issue](https://github.com/e-stpierre/agentic-forge/issues) on GitHub.

## Credits

- [Geoffrey Huntley - Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
