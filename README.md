# 🧠 agentic-forge

[![Auto-Format Code](https://github.com/e-stpierre/agentic-forge/actions/workflows/auto-format.yml/badge.svg)](https://github.com/e-stpierre/agentic-forge/actions/workflows/auto-format.yml)

A modular collection of commands, sub-agents, skills, and hooks designed to extend and customize Claude Code for both generic and specialized development scenarios.

This repository provides a plug-and-play framework to define reusable automation units — from lightweight code utilities to fully autonomous agent behaviors — that enhance Claude's coding workflow, environment integration, and project
orchestration capabilities.

## 🚀 Features

### 📦 Command Packs

Ready-to-use slash commands for automation, scripting, and file manipulation. Commands provide quick access to common development workflows and can be composed to build complex automation pipelines.

- **Quick Actions**: Instant access to frequently-used development tasks
- **Composable**: Chain commands together for powerful workflows
- **Context-Aware**: Commands can adapt based on project context

### 🤖 Sub-Agents

Specialized agent personalities and workflows for focused domains. Sub-agents bring domain expertise and autonomous task execution to specific problem areas.

- **Domain Experts**: DevOps, testing, code review, documentation, and more
- **Autonomous Workflows**: Let specialized agents handle complex multi-step tasks
- **Customizable Behavior**: Configure agent personalities and capabilities

### 🧩 Skill Modules

Composable building blocks for logic, data processing, and system interaction. Skills are reusable components that agents and commands can leverage.

- **Reusable Logic**: Share common functionality across commands and agents
- **Extensible**: Build new skills on top of existing ones
- **Interoperable**: Skills work seamlessly with all plugin types

### 🔌 Hooks

Extend Claude Code's runtime behavior to inject context, monitor state, or adapt responses dynamically. Hooks enable event-driven customization of the development environment.

- **Event-Driven**: React to session start, tool calls, and other events
- **State Monitoring**: Track and respond to changes in your development environment
- **Dynamic Context**: Inject relevant information based on current state

### ⚙️ Configuration Templates

Easily register or override behaviors for project-specific use cases. Templates provide starting points for common development scenarios.

- **Quick Setup**: Bootstrap new projects with pre-configured plugins
- **Shareable**: Distribute configurations across teams
- **Adaptable**: Override defaults for project-specific needs

## 🎯 Goal

Create a flexible ecosystem where developers can configure, share, and evolve Claude Code capabilities to suit diverse project needs — from local coding assistants to distributed AI agents.

By providing a standardized way to package and distribute Claude Code extensions, this repository aims to:

- **Lower the barrier** to customizing Claude Code for specific workflows
- **Enable knowledge sharing** of best practices and automation patterns
- **Foster a community** of Claude Code power users and plugin developers
- **Accelerate development** by providing reusable, battle-tested components

## 📁 Repository Structure

```
agentic-forge/
├── plugins/          # Root folder for all plugins
│   └── <plugin-name>/
│       ├── agents/   # Sub-agent configurations
│       ├── commands/ # Slash command definitions
│       ├── skills/   # Reusable skill modules
│       ├── hooks/    # Runtime hooks and event handlers
│       └── README.md # Plugin-specific documentation
├── docs/             # Documentation and guides
└── examples/         # Example implementations and use cases
```

Each plugin is self-contained within its own directory under `plugins/`, allowing for modular installation and management.

## 🚦 Getting Started

### Prerequisites

- Claude Code CLI installed and configured
- Basic familiarity with Claude Code concepts (commands, agents, hooks)
- Git authentication configured for private repositories (if applicable)

### Installation

Add this repository as a plugin marketplace in Claude Code:

```bash
/plugin marketplace add e-stpierre/agentic-forge
```

**For private repositories**: Ensure you have proper Git authentication configured (SSH keys or GitHub personal access token).

### Browse & Install Plugins

Once the marketplace is added, browse and install plugins using the plugin menu:

```bash
/plugin menu
```

This opens an interactive menu where you can:

- Browse all available plugins from the marketplace
- View plugin descriptions and capabilities
- Install plugins directly to your project
- Manage installed plugins

### Marketplace Versioning

#### Latest Version

Install the latest version of the marketplace:

```bash
/plugin marketplace add e-stpierre/agentic-forge
```

#### Specific Version

Install a specific version using git tags:

```bash
/plugin marketplace add e-stpierre/agentic-forge#v1.1.0
```

#### Update Marketplace

Update the marketplace to the latest version:

```bash
/plugin marketplace update agentic-forge
```

#### Update Python Tools

Some plugins include Python CLI tools for workflow orchestration. Install them with uv:

**Windows (PowerShell):**

```powershell
# Core package (required for orchestration)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\core"

# Agentic-SDLC autonomous workflows (depends on core)
uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\agentic-sdlc"
```

**macOS/Linux:**

```bash
# Core package (required for orchestration)
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/core

# Agentic-SDLC autonomous workflows (depends on core)
uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/agentic-sdlc
```

**Available CLI commands after installation:**

| Command            | Description                                              |
| ------------------ | -------------------------------------------------------- |
| `claude-sdlc`      | Legacy CLI with feature and bugfix subcommands           |
| `claude-feature`   | Full feature workflow: plan -> implement -> review -> PR |
| `claude-bugfix`    | Full bugfix workflow: diagnose -> fix -> test -> PR      |
| `agentic-sdlc`     | Autonomous workflow CLI with JSON I/O                    |
| `agentic-workflow` | Full end-to-end autonomous workflow                      |
| `agentic-plan`     | Invoke planning agent with JSON input                    |
| `agentic-build`    | Invoke build agent with plan JSON                        |
| `agentic-validate` | Invoke validation agents (review + test)                 |

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

### Agentic-SDLC

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

#### Remove Marketplace

Remove the marketplace from your configuration:

```bash
/plugin marketplace remove agentic-forge
```

**⚠️ Warning**: Removing a marketplace will uninstall all plugins from that marketplace. This is useful when you need to install a previous version of the marketplace or its plugins.

### Install Specific Plugins

You can also install specific plugins directly by name:

```bash
/plugin install appsec
```

### Usage

After installation, plugins are immediately available in your Claude Code session:

- **Commands**: Available via `/command-name` (e.g., `/security-review`)
- **Agents**: Invoked automatically via commands or Task tool
- **Skills**: Activated via `Skill` tool or skill name
- **Hooks**: Execute automatically on configured events

Refer to individual plugin documentation for specific usage instructions and examples.

## 🤝 Contributing

Contributions are welcome! Whether you're adding new plugins, improving existing ones, or enhancing documentation, your input helps the community.

### Local Setup

```
uv run .claude/update-plugins.py
```

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-plugin`)
3. Commit your changes (`git commit -m 'Add amazing plugin'`)
4. Push to the branch (`git push origin feature/amazing-plugin`)
5. Open a Pull Request

### Plugin Guidelines

- Follow the directory structure conventions
- Include clear documentation for each plugin
- Provide example usage scenarios
- Test plugins in multiple contexts before submitting
- Use descriptive names and comments

### Code Style

All code in this repository is automatically formatted when pull requests are created or updated. The CI pipeline will format any changed files and commit the changes back to your PR branch.

#### Markdown

Markdown files are formatted using [markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2). Configuration: `.markdownlint-cli2.jsonc`

**Manual formatting** (optional):

```bash
# Format all markdown files
npx markdownlint-cli2 "**/*.md"

# Format specific files
npx markdownlint-cli2 README.md CLAUDE.md
```

#### Python

Python files are formatted and linted using [Ruff](https://docs.astral.sh/ruff/). Configuration: `ruff.toml`

Install ruff: `uv tool install ruff`

**Manual formatting** (optional):

```bash
# Format all Python files
ruff format .

# Format and fix linting issues
ruff check --fix .

# Format specific files
ruff format path/to/file.py
```

**VS Code auto-format on save**: Install the [Ruff extension](https://marketplace.visualstudio.com/items?itemName=charliermarsh.ruff) and add to your `.vscode/settings.json`:

```json
{
  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.fixAll": "explicit",
      "source.organizeImports": "explicit"
    }
  }
}
```

## 📚 Documentation

Detailed documentation for each plugin type can be found in the `docs/` directory:

- [Command Development Guide](docs/commands.md)
- [Agent Creation Guide](docs/agents.md)
- [Skill Module Spec](docs/skills.md)
- [Hook System Reference](docs/hooks.md)
- [Template Authoring](docs/templates.md)

## 🔗 Resources

- [Claude Code Documentation](https://docs.claude.com/en/docs/claude-code)
- [Claude Code GitHub](https://github.com/anthropics/claude-code)
- [Community Discussions](https://github.com/e-stpierre/agentic-forge/discussions)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🌟 Acknowledgments

Built with and for the Claude Code community. Special thanks to all contributors who help make Claude Code more powerful and accessible.

---

**Note**: These are ready-to-use plugins. Plugin quality and compatibility may vary. Always review plugins before using them in production environments.
