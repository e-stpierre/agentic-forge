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

Agentic Forge orchestrates workflows across multiple coding agent runtimes. Each runtime must be installed and authenticated independently before use.

| Runtime     | CLI      | Default |
| ----------- | -------- | ------- |
| Claude Code | `claude` | Yes     |
| Codex CLI   | `codex`  | No      |

The default runtime is Claude Code. Use `--runtime codex` on the CLI or set `defaults.runtime: codex` in config to switch. Per-step `runtime:` fields always take precedence over the invocation default.

## Architecture

### System Overview

Agentic Forge is a TypeScript/Node.js workflow engine that sits between a developer's CLI and one or more coding agent runtimes. The CLI discovers and parses YAML workflow definitions, then hands them to `WorkflowExecutor`, which iterates through steps and dispatches each to a type-specific executor. The executor delegates the actual code generation work to a runtime adapter. The adapter spawns the appropriate coding agent CLI (Claude Code or Codex), streams its output, and returns a normalized result used to update workflow progress.

### Workflow Engine

The core execution pipeline consists of three collaborating components:

- `WorkflowParser` loads YAML workflow files into typed `WorkflowDefinition` objects
- `WorkflowExecutor` is the main entry point — it iterates workflow steps and dispatches each to the correct type-specific executor
- `WorkflowOrchestrator` wraps `WorkflowExecutor` with a runtime-driven decision loop (`execute_step`, `retry_step`, `wait_for_human`, `abort`) for AI-driven step selection workflows

Six step types are supported:

| Type             | Description                                                                         |
| ---------------- | ----------------------------------------------------------------------------------- |
| `prompt`         | Single coding agent invocation with a rendered prompt                               |
| `serial`         | Executes a list of sub-steps sequentially                                           |
| `parallel`       | Runs branches concurrently, with optional worktree isolation (`git.worktree: true`) |
| `conditional`    | Evaluates a Nunjucks expression and routes to `then` or `else` branches             |
| `ralph-loop`     | Iterative loop that keeps invoking the agent until a completion promise is detected |
| `wait-for-human` | Pauses the workflow and waits for external input via `af input`                     |

### Runtime Adapters

The `RuntimeAdapter` interface abstracts all coding agent interactions behind three methods: `buildCommand()` constructs the CLI invocation, `parseStreamLine()` normalizes streaming output into `StreamEvent` objects, and `buildFinalResult()` assembles the final `RuntimeResult`.

Two adapters are provided out of the box:

- `ClaudeAdapter` — drives Claude Code (`claude` CLI), supports `--add-dir` skill injection
- `CodexAdapter` — drives Codex CLI (`codex`), streams JSONL output

The shared `runRuntime()` function in `process-runner.ts` handles process spawning, output streaming, and timeout enforcement for both adapters. Runtime resolution follows this order:

```
step.runtime -> CLI --runtime flag -> workflow settings.runtime -> config defaults.runtime -> "claude"
```

Skills (bundled `/af-*` slash commands) are injected via `--add-dir` and work only with the `claude` runtime. The `codex` runtime does not support skill injection.

### Configuration & Resolution

Agentic Forge uses a 3-tier resolution model for all user-facing resources:

- **Config**: built-in defaults -> global config (`getGlobalRoot()/config.json`) -> local config (`agentic/config.json`)
- **Workflows**: project-local (`agentic/workflows/`) -> user-global (`getGlobalRoot()/workflows/`) -> bundled
- **Outputs**: global by default (`getGlobalRoot()/outputs/<project-slug>/`), or local (`agentic/outputs/`) when `outputDirectory: "local"`

The global directory is lazy-initialized on first use; no `af init` is required to run workflows.

### Data Flow

```
CLI (af run) -> Workflow Discovery -> YAML Parser -> WorkflowExecutor -> Step Executors -> Runtime Adapters -> Coding Agent CLI -> Output & Progress Tracking
```

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
af run demo
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
| [Configuration](https://github.com/e-stpierre/agentic-forge/blob/main/docs/configuration.md)     | All configuration options, defaults, and layering behavior                 |

## Contributing

- **Bug reports and suggestions** - [Open an issue](https://github.com/e-stpierre/agentic-forge/issues) on GitHub
- **Code contributions** - See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and PR guidelines

## Credits

- Original ralph-loop technique: [Geoffrey Huntley - Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
