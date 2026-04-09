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

Agentic Forge is a TypeScript/Node.js package that provides YAML-based workflow orchestration for coding agents. It bundles skills, agents, and prompts as package data, enabling autonomous multi-step task execution with parallel execution, conditional logic, and retry mechanisms.

**Best for**: Autonomous development where you prefer the coding agent works independently.

## Supported Runtimes

**Claude Code is the primary and recommended coding agent for Agentic Forge.** It is the default runtime, has the deepest integration, and supports all features including bundled skills, agent configurations, and worktree isolation.

**Codex CLI is supported as an experimental runtime.** Its integration is limited compared to Claude Code — it does not support bundled skills or agent configurations, and may have permission issues, particularly on Windows. Use it for secondary tasks like independent code review in mixed-runtime workflows.

| Runtime     | CLI      | Default | Status       |
| ----------- | -------- | ------- | ------------ |
| Claude Code | `claude` | Yes     | Recommended  |
| Codex CLI   | `codex`  | No      | Experimental |

Use `--runtime codex` on the CLI or set `defaults.runtime: codex` in config to switch. Per-step `runtime:` fields always take precedence over the invocation default.

## Getting Started

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (recommended) or npm
- Claude Code CLI installed and configured (required for default runtime)
- Codex CLI installed and configured (optional, required for `runtime: codex` steps)

### Installation

```bash
npm install -g agentic-forge
```

### Run Your First Workflow

No setup required. Run the demo workflow to verify your installation:

```bash
af run claude-demo
```

Run a real workflow:

```bash
af run plan-build-review --var "task=Add dark mode support" --slug "dark-mode"
```

The `--slug` flag names the output directory (e.g., `dark-mode/` instead of a generated timestamp ID), making it easy to find results later.

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
| [Coding Agents](https://github.com/e-stpierre/agentic-forge/blob/main/docs/coding-agents.md)     | Supported runtimes, per-step configuration, and model names                |
| [Configuration](https://github.com/e-stpierre/agentic-forge/blob/main/docs/configuration.md)     | All configuration options, defaults, and layering behavior                 |

## Contributing

- **Bug reports and suggestions** - [Open an issue](https://github.com/e-stpierre/agentic-forge/issues) on GitHub
- **Code contributions** - See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and PR guidelines

## Credits

- Original ralph-loop technique: [Geoffrey Huntley - Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
