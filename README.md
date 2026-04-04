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
# Install globally with npm
npm install -g agentic-forge

# Or install from source
git clone https://github.com/e-stpierre/agentic-forge.git
cd agentic-forge
pnpm install && pnpm build
npm install -g .
```

## Workflows

### plan-build-review (Full SDLC)

Plan -> Create Branch -> Implement (iterative) -> Review -> Fix Issues -> Create PR

```bash
agentic-forge run plan-build-review --var "task=Add dark mode support"
```

### one-shot (Single Task)

Create Branch -> Execute Task -> Review -> Create PR

```bash
agentic-forge run one-shot --var "task=Add user authentication"
```

### ralph-loop (Iterative Execution)

Generic iterative loop where each iteration runs in a fresh session.

```bash
agentic-forge run ralph-loop --var "task=Follow the improvement plan" --var "max_iterations=20"
```

### analyze-codebase (Parallel Analysis)

Run 5 parallel analysis types (bug, debt, doc, security, style) with optional autofix.

```bash
agentic-forge run analyze-codebase --var "autofix=true"
```

### All Commands

```bash
# Run a workflow with variables
agentic-forge run <workflow> --var "key=value"

# Resume a paused or failed workflow
agentic-forge resume <workflow_id>

# Check workflow status
agentic-forge status <workflow_id>

# Cancel a running workflow
agentic-forge cancel <workflow_id>

# List all workflow runs (optionally filter by status)
agentic-forge list --status running

# Provide input to a paused workflow waiting for human response
agentic-forge input <workflow_id> "response text"

# Copy bundled workflow templates to your project
agentic-forge init

# List available workflows with descriptions
agentic-forge workflows

# Get or set configuration
agentic-forge config get <key>
agentic-forge config set <key> <value>

# Interactive configuration setup
agentic-forge configure

# Print path to bundled workflow skills directory
agentic-forge skills-dir

# Print path to interactive authoring skills directory
agentic-forge authoring-dir

# Show release notes
agentic-forge release-notes --latest

# Check current version
agentic-forge version

# Update to latest version
agentic-forge update
```

## Repository Structure

```text
src/
  agents/              # Bundled agent definitions (explorer, reviewer)
  authoring/.claude/   # Interactive authoring skills (workflow-builder)
    skills/            # Skills for users to create and manage workflows
  claude/.claude/      # Workflow execution skills loaded via --add-dir
    skills/            # Bundled skills used by workflows
  commands/            # CLI command implementations
  prompts/             # System prompt templates
  steps/               # Workflow step handlers
  workflows/           # 7 bundled YAML workflow definitions
  *.ts                 # Core TypeScript modules
tests/                 # Vitest test suite
```

### Skills directories

Agentic Forge separates skills into two directories:

- **Workflow skills** (`skills-dir`) — Skills used by the workflow engine during execution. Loaded automatically when running workflows.
- **Authoring skills** (`authoring-dir`) — Interactive skills for users to create and manage workflows. Add them to your Claude Code session manually:

```bash
claude --add-dir $(agentic-forge authoring-dir)
```

#### Using the workflow-builder skill

Once the authoring skills are loaded, use the `/af-workflow-builder` slash command to create, update, explain, validate, or debug workflows:

```text
/af-workflow-builder create a workflow that plans and reviews a feature
/af-workflow-builder validate my-workflow.yaml
/af-workflow-builder explain how ralph-loop works
/af-workflow-builder update my-workflow.yaml to add a parallel step
/af-workflow-builder debug why my conditional always takes the else branch
```

The skill has full knowledge of the workflow schema, all step types, and bundled skills.

## Contributing

- **Bug reports and suggestions** - [Open an issue](https://github.com/e-stpierre/agentic-forge/issues) on GitHub
- **Code contributions** - See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and PR guidelines

## Credits

- Original ralph-loop technique: [Geoffrey Huntley - Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
