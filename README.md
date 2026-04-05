<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <img src="agentic-forge-banner.png" alt="Agentic Forge" width="600">
</p>

<h1 align="center">Agentic Forge</h1>

<p align="center">
  <a href="https://github.com/e-stpierre/agentic-forge/releases"><img src="https://img.shields.io/github/v/release/e-stpierre/agentic-forge?include_prereleases" alt="GitHub release"></a>
  <a href="https://github.com/e-stpierre/agentic-forge/blob/main/LICENSE"><img src="https://img.shields.io/github/license/e-stpierre/agentic-forge" alt="License"></a>
</p>

<p align="center">
  <strong>YAML-based agentic workflow engine</strong>
</p>

<p align="center">
  Multi-step execution | Parallel orchestration | Error recovery | Short and long-running operations
</p>

## Overview

Agentic Forge is a TypeScript/Node.js package that provides YAML-based workflow orchestration for Claude Code. It bundles skills, agents, and prompts as package data, enabling autonomous multi-step task execution with parallel execution, conditional logic, and retry mechanisms.

**Best for**: Autonomous development where you prefer Claude works independently.

## Getting Started

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (recommended) or npm
- Claude Code CLI installed and configured

### Installation

```bash
npm install -g agentic-forge
```

### Run Your First Workflow

No setup required. Run the demo workflow to verify your installation:

```bash
af run demo
```

Run a real workflow:

```bash
af run plan-build-review --var "task=Add dark mode support"
```

### Project Setup

Initialize a local `agentic/` directory to customize workflows and config for your project:

```bash
af init --local
```

### Workflow Builder

Load authoring skills into Claude Code to create and manage workflows interactively:

```bash
claude --add-dir $(af authoring-dir)
```

Then use `/af-workflow-builder` to create, validate, explain, or debug workflows.

## Documentation

| Document                                                                                         | Description                                                                |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [Getting Started](https://github.com/e-stpierre/agentic-forge/blob/main/docs/getting-started.md) | Installation, quick tour, initialization, and creating your first workflow |
| [CLI Reference](https://github.com/e-stpierre/agentic-forge/blob/main/docs/cli.md)               | Complete list of commands with all arguments and options                   |
| [Workflows](https://github.com/e-stpierre/agentic-forge/blob/main/docs/workflows.md)             | Bundled workflows, their use cases, variables, and examples                |
| [Configuration](https://github.com/e-stpierre/agentic-forge/blob/main/docs/configuration.md)     | All configuration options, defaults, and layering behavior                 |

## Contributing

- **Bug reports and suggestions** - [Open an issue](https://github.com/e-stpierre/agentic-forge/issues) on GitHub
- **Code contributions** - See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and PR guidelines

## Credits

- Original ralph-loop technique: [Geoffrey Huntley - Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
