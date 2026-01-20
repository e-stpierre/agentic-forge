<p align="center">
  <img src="agentic-forge.png" alt="Agentic Forge" width="500">
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
- Basic familiarity with Claude Code concepts (commands, agents, hooks)

### Installation

Add this repository as a plugin marketplace in Claude Code:

```bash
/plugin marketplace add e-stpierre/agentic-forge
```

### Browse & Install Plugins

Once the marketplace is added, browse and install plugins using the plugin menu in Claude Code:

```bash
/plugin
```

This opens an interactive menu where you can:

- Browse all available plugins from the marketplace
- View plugin descriptions and capabilities
- Install plugins directly to your project
- Manage installed plugins
- Update marketplace and plugins

### Python CLI

Some plugins include Python CLI tools for workflow orchestration. Install them with uv:

**Windows (PowerShell):**

```powershell
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\agentic-sdlc"
```

**macOS/Linux:**

```bash
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/agentic-sdlc
```

## SDLC Plugins

### Interactive-SDLC

Interactive SDLC commands for guided development within Claude Code sessions with user questions and feedback.

**Best for**: Interactive development where you want to be involved in decisions.

**Key commands**:

- `/interactive-sdlc:plan-feature` - Plan a feature with milestones
- `/interactive-sdlc:plan-bug` - Plan a bug fix with root cause analysis
- `/interactive-sdlc:plan-chore` - Plan a maintenance task
- `/interactive-sdlc:build` - Implement a plan file
- `/interactive-sdlc:validate` - Validate implementation quality
- `/interactive-sdlc:one-shot` - Quick task without saved plan
- `/interactive-sdlc:document` - Generate documentation with mermaid diagrams
- `/interactive-sdlc:analyse-*` - Analysis commands for bugs, docs, debt, style, security

### Agentic SDLC

YAML-based workflow orchestration for fully autonomous task execution with parallel execution, conditional logic, retry mechanisms, and persistent memory.

**Best for**: Autonomous development where you want Claude to work independently.

**Key commands**:

- `/agentic-sdlc:plan` - Generate implementation plans
- `/agentic-sdlc:build` - Implement changes following a plan
- `/agentic-sdlc:validate` - Validate implementation quality
- `/agentic-sdlc:analyse` - Run codebase analysis
- `/agentic-sdlc:orchestrate` - Evaluate workflow state and determine next action

**Python CLI**:

- `agentic-sdlc run <workflow.yaml>` - Execute a YAML workflow
- `agentic-sdlc one-shot "task"` - Complete a task end-to-end with PR
- `agentic-sdlc analyse --type security` - Run security analysis

### Usage

After installation, plugins are immediately available in your Claude Code session:

- **Commands**: Available via `/command-name` (e.g., `/interactive-sdlc:plan-feature`)
- **Agents**: Invoked automatically via commands or Task tool
- **Skills**: Activated via `Skill` tool or skill name
- **Hooks**: Execute automatically on configured events

### Command Namespacing

Commands are namespaced by their plugin name using the format `plugin-name:command-name`. This prevents conflicts when multiple plugins provide similar commands:

```bash
# Interactive SDLC commands
/interactive-sdlc:plan-feature
/interactive-sdlc:validate
/interactive-sdlc:analyse-bug

# Agentic SDLC commands
/agentic-sdlc:plan
/agentic-sdlc:validate
/agentic-sdlc:analyse-bug
```

In workflow YAML files, always use the full namespace to ensure the correct plugin's command is executed:

```yaml
steps:
  - type: command
    command: agentic-sdlc:validate # Explicit - uses agentic-sdlc plugin
```

Refer to individual plugin documentation for specific usage instructions and examples.

## Credits

- [Geoffrey Huntley - Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
