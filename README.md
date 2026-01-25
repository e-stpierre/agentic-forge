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
  <strong>Autonomous workflow orchestration for Claude Code</strong>
</p>

<p align="center">
  YAML-defined workflows | Multi-step execution | Progress tracking | Error recovery
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

See [Agentic-SDLC README](plugins/agentic-sdlc/README.md) for all skills and workflow options.

```bash
# Run plan-build-review workflow for full SDLC automation
agentic-sdlc run plan-build-review.yaml --var "task=Add dark mode support"

# Complete a task end-to-end autonomously
agentic-sdlc run one-shot.yaml --var "task=Add user authentication"

# List available workflows
agentic-sdlc workflows

# Run a workflow with variables for iterative task completion
agentic-sdlc run ralph-loop.yaml --var "max_iterations=20" \
  --var "task=Follow the improvement plan. Each iteration: read plan, implement next task, commit, STOP."
```

## Coding Standards

This project follows strict coding standards to ensure consistency and quality:

- **Language**: US English spelling for all code, comments, and documentation (e.g., "analyze", "color", "canceled")
- **Naming**: Kebab-case for skills/hooks, descriptive names with domain prefix for agents
- **Validation**: Use `/normalize` to validate prompt files against templates
- **Formatting**: Run `pnpm check` for format/lint and `uv run pytest` for Python tests before PRs

See [CLAUDE.md](CLAUDE.md) for complete guidelines and [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow.

## Architecture

This repository is organized as a **plugin marketplace** for Claude Code, where each plugin extends Claude's capabilities through modular components:

**Repository Structure:**

- `/plugins/` - Self-contained plugin directories with standardized structure
- `/docs/` - Templates and development documentation
- `/.claude/` - Claude Code configuration for marketplace integration

**Plugin Anatomy:**

Each plugin (`/plugins/<plugin-name>/`) contains:

- `agents/` - Specialized agents for autonomous task execution
- `skills/` - Slash commands that extend Claude Code's functionality
- `hooks/` - Event-driven scripts (session start, tool calls, etc.)
- `src/` - Optional Python CLI tools for workflow orchestration

**Integration Flow:**

Plugin Installation -> Component Loading -> Claude Code Integration -> Task Execution

The `agentic-sdlc` plugin demonstrates this architecture with YAML-based workflow orchestration, combining skills, agents, and CLI tools for autonomous development workflows.

## Contributing

Found a bug or have a suggestion? Please [open an issue](https://github.com/e-stpierre/agentic-forge/issues) on GitHub.

## Credits

- Original ralph-loop technique: [Geoffrey Huntley - Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
