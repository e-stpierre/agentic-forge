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

Agentic Forge is a TypeScript/Node.js package that provides YAML-based workflow orchestration for coding agents. It is a naked engine: it ships generic demo workflows and no opinionated skills, and your workflows call your own skills (see [Bring Your Own Skills](#bring-your-own-skills)). It supports parallel execution, conditional logic, and retry mechanisms.

**Best for**: Autonomous development where you prefer the coding agent works independently.

## Supported Runtimes

**Claude Code is the primary and recommended coding agent for Agentic Forge.** It is the default runtime, has the deepest integration, and supports all features including `skill` steps, live sessions, agent configurations, and worktree isolation.

**Codex CLI is supported as an experimental runtime.** Its integration is limited compared to Claude Code — it runs `skill` steps by inlining the skill's `SKILL.md`, and may have permission issues, particularly on Windows. Use it for secondary tasks like independent code review in mixed-runtime workflows.

| Runtime     | CLI      | Default | Status       |
| ----------- | -------- | ------- | ------------ |
| Claude Code | `claude` | Yes     | Recommended  |
| Codex CLI   | `codex`  | No      | Experimental |

Use `--runtime codex` on the CLI or set `defaults.runtime: codex` in config to switch. Per-step `runtime:` fields always take precedence over the invocation default.

## Tool Permissions

Most bundled demo workflows declare `required-tools` in their settings, which automatically allows the coding agent to use **Read, Edit, Write, Glob, Grep, and Bash** without prompting for permission on each call. This means the agent can read, create, modify, and delete files, as well as execute arbitrary shell commands in your repository, without asking for confirmation.

This is by design -- autonomous workflows need these permissions to operate without manual intervention. Additionally, the agent always has access to any permissions configured at the repository level (`.claude/settings.json`, `.claude/settings.local.json`, etc.), regardless of the workflow's `required-tools` setting.

If you want more control, you can:

- **Review the workflow YAML** before running it (`af workflows --verbose` or inspect the file directly)
- **Use worktree isolation** (`settings.worktree.enabled: true` in the workflow) so changes happen on a disposable copy of your repo
- **Remove or modify `required-tools`** in a custom workflow to restrict which tools are auto-approved

See [Workflows documentation](https://github.com/e-stpierre/agentic-forge/blob/main/docs/workflows.md) for details on which workflows declare these permissions.

## Getting Started

### Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/) (recommended) or npm
- Claude Code CLI installed and configured (required for default runtime)
- Codex CLI installed and configured (optional, required for `runtime: codex` steps)

### Installation

```bash
npm install -g agentic-forge
```

### Updating

Update to the latest version using npm:

```bash
npm install -g agentic-forge@latest
```

To update the default workflow files to the latest bundled versions, re-run `af init --force`. This overwrites any changes you made to these files.

```bash
# Update global workflows
af init --force

# Update project-local workflows
af init --local --force
```

### Run Your First Workflow

No setup required. Run the demo workflow to verify your installation:

```bash
af run claude-demo
```

Run a real task with the generic Ralph loop:

```bash
af run ralph-loop --var "task=Add dark mode support" --slug "dark-mode"
```

The `--slug` flag names the output directory (e.g., `dark-mode/` instead of a generated timestamp ID), making it easy to find results later.

### Project Setup

Initialize a local `agentic/` directory to customize workflows and config for your project:

```bash
af init --local
```

### Bring Your Own Skills

agentic-forge bundles no execution skills. A workflow calls any Claude Code skill you installed, as a plugin or in a `.claude/skills/` directory, with a `skill` step:

```yaml
steps:
  - name: plan
    type: skill
    skill: esp-skills:esp-plan
    args: "{{ variables.task }}"
```

The step runs `/esp-skills:esp-plan <args> --run-dir <run dir> --config-snapshot <file>`, and the `outputs` of the skill's result block are available to later steps. [esp-skills](https://github.com/e-stpierre/skills) is one such skill pack (`/plugin marketplace add e-stpierre/skills`, then `/plugin install esp-skills@esp`); any skill that follows the [harness contract](https://github.com/e-stpierre/agentic-forge/blob/main/docs/harness-contract.md) works the same way. See [Bring your own skills](https://github.com/e-stpierre/agentic-forge/blob/main/docs/workflows.md#bring-your-own-skills).

### Workflow Builder

Load authoring skills into Claude Code to create and manage workflows interactively:

```bash
claude --add-dir $(af authoring-dir)
```

Then use `/af-workflow-builder` to create, validate, explain, or debug workflows.

### MCP Server

`af mcp` is a stdio MCP server that lets an agent dispatch, follow and steer runs (`af_dispatch`, `af_wait`, `af_send`, ...). Register it, with the `overseer` and `af-delegate` skills, in Claude Code or Codex:

```bash
af setup claude   # the af-overseer plugin, user scope
af setup codex    # config.toml and the skills
```

See the [CLI Reference](https://github.com/e-stpierre/agentic-forge/blob/main/docs/cli.md#mcp) for the tools and other clients.

### Overseer

`af overseer` starts an interactive Claude Code session that oversees your runs: it dispatches workflows, wakes on their events, relays your corrections and questions, and reports when they finish. It comes with its own skill and the af MCP server, so nothing needs to be installed first:

```bash
af overseer --epic docs/epics/search.md
```

The runs keep going when the session closes; `af overseer --resume <run>` reopens it and the overseer rebuilds its picture from the harness. See the [CLI Reference](https://github.com/e-stpierre/agentic-forge/blob/main/docs/cli.md#overseer).

To run the overseer from Claude Desktop (Code tab, and from your phone through Remote Control), install the plugin with `af setup claude` and run `/af-overseer:overseer` there. See [Overseer](https://github.com/e-stpierre/agentic-forge/blob/main/docs/overseer.md).

## Documentation

| Document                                                                                           | Description                                                                     |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Getting Started](https://github.com/e-stpierre/agentic-forge/blob/main/docs/getting-started.md)   | Installation, quick tour, initialization, and creating your first workflow      |
| [CLI Reference](https://github.com/e-stpierre/agentic-forge/blob/main/docs/cli.md)                 | Complete list of commands with all arguments and options                        |
| [Workflows](https://github.com/e-stpierre/agentic-forge/blob/main/docs/workflows.md)               | Bundled workflows, their use cases, variables, and examples                     |
| [Coding Agents](https://github.com/e-stpierre/agentic-forge/blob/main/docs/coding-agents.md)       | Supported runtimes, per-step configuration, and model names                     |
| [Configuration](https://github.com/e-stpierre/agentic-forge/blob/main/docs/configuration.md)       | All configuration options, defaults, and layering behavior                      |
| [Harness Contract](https://github.com/e-stpierre/agentic-forge/blob/main/docs/harness-contract.md) | Contract v1 for skill packs: run directories, result blocks, events, exit codes |
| [Overseer](https://github.com/e-stpierre/agentic-forge/blob/main/docs/overseer.md)                 | The overseer in Claude Desktop: setup, locality and limits                      |

## Contributing

- **Bug reports and suggestions** - [Open an issue](https://github.com/e-stpierre/agentic-forge/issues) on GitHub
- **Code contributions** - See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and PR guidelines

## Credits

- Original ralph-loop technique: [Geoffrey Huntley - Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
