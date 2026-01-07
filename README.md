# Agentic Forge

[![Auto-Format Code](https://github.com/e-stpierre/agentic-forge/actions/workflows/auto-format.yml/badge.svg)](https://github.com/e-stpierre/agentic-forge/actions/workflows/auto-format.yml)

A modular collection of commands, sub-agents, skills, and hooks designed to extend and customize Claude Code for both generic and specialized development scenarios.

This repository provides a plug-and-play framework to define reusable automation units — from lightweight code utilities to fully autonomous agent behaviors — that enhance Claude's coding workflow, environment integration, and project
orchestration capabilities.

## Features

### Command

Ready-to-use slash commands for automation, scripting, and file manipulation. Commands provide quick access to common development workflows and can be composed to build complex automation pipelines.

- **Quick Actions**: Instant access to frequently-used development tasks
- **Composable**: Chain commands together for powerful workflows
- **Context-Aware**: Commands can adapt based on project context

### Sub-Agents

Specialized agent personalities and workflows for focused domains. Sub-agents bring domain expertise and autonomous task execution to specific problem areas.

- **Domain Experts**: DevOps, testing, code review, documentation, and more
- **Autonomous Workflows**: Let specialized agents handle complex multi-step tasks
- **Customizable Behavior**: Configure agent personalities and capabilities

### Skill

Composable building blocks for logic, data processing, and system interaction. Skills are reusable components that agents and commands can leverage.

- **Reusable Logic**: Share common functionality across commands and agents
- **Extensible**: Build new skills on top of existing ones
- **Interoperable**: Skills work seamlessly with all plugin types

### Hooks

Extend Claude Code's runtime behavior to inject context, monitor state, or adapt responses dynamically. Hooks enable event-driven customization of the development environment.

- **Event-Driven**: React to session start, tool calls, and other events
- **State Monitoring**: Track and respond to changes in your development environment
- **Dynamic Context**: Inject relevant information based on current state

## Repository Structure

```
agentic-forge/
├── docs/                   # Documentation, guides and templates
├── experimental-plugins/   # Experimental early-access plugins
└── plugins/                # Root folder for all official plugins
    └── <plugin-name>/
        ├── agents/         # Sub-agent configurations
        ├── commands/       # Slash command definitions
        ├── skills/         # Reusable skill modules
        ├── hooks/          # Runtime hooks and event handlers
        └── README.md       # Plugin-specific documentation
```

Each plugin is self-contained within its own directory under `plugins/`, allowing for modular installation and management.

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
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\experimental-plugins\agentic-core"
```

**macOS/Linux:**

```bash
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/experimental-plugins/agentic-core
```

## SDLC Plugins

This repository provides two SDLC plugins for different use cases:

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

### [Experimental] Agentic-SDLC

Fully autonomous SDLC workflow orchestrated via Python, with no user interaction.

**Best for**: CI/CD integration, automated workflows, batch processing.

**Key commands** (JSON I/O):

- `/agentic-sdlc:plan-feature` - Generate feature plan (JSON I/O)
- `/agentic-sdlc:plan-bug` - Generate bug fix plan (JSON I/O)
- `/agentic-sdlc:plan-chore` - Generate chore plan (JSON I/O)
- `/agentic-sdlc:implement` - Implement from plan (JSON I/O)
- `/agentic-sdlc:review` - Review code changes (JSON I/O)
- `/agentic-sdlc:test` - Run tests and analyze results (JSON I/O)

**Python CLI**:

```bash
# Full autonomous workflow
agentic-workflow --type feature --spec spec.json

# Individual steps
agentic-plan --type feature --json-file spec.json
agentic-build --plan-file /specs/feature-auth.md
agentic-validate --plan-file /specs/feature-auth.md
```

### Usage

After installation, plugins are immediately available in your Claude Code session:

- **Commands**: Available via `/command-name` (e.g., `/security-review`)
- **Agents**: Invoked automatically via commands or Task tool
- **Skills**: Activated via `Skill` tool or skill name
- **Hooks**: Execute automatically on configured events

Refer to individual plugin documentation for specific usage instructions and examples.

## Local Setup

### Automatic plugin installation

The following script can be run to automatically re-install every plugin and CLI tools contained in this repository.

```
uv run .claude/update-plugins.py
```

### Code Style

Open the workspace file (`.vscode/agentic-forge.code-workspace`) and install recommended extensions for auto-format on save.

CI automatically formats code on pull requests. To run locally: `pnpm check`

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Note**: These are ready-to-use plugins. Plugin quality and compatibility may vary. Always review plugins before using them in production environments.
