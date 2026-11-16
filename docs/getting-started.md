# Getting Started

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/) (recommended) or npm
- Claude Code CLI installed and configured (required — the default runtime)
- Codex CLI installed and configured (optional — only needed for `codex` runtime workflows)

## Installation

```bash
# Install globally with npm
npm install -g agentic-forge

# Or install from source
git clone https://github.com/e-stpierre/agentic-forge.git
cd agentic-forge
pnpm install && pnpm build
npm install -g .
```

After installation, two CLI aliases are available: `agentic-forge` and `af`.

## Quick Tour

Agentic Forge is a YAML-based workflow engine for coding agents. You define multi-step workflows in YAML, and the engine orchestrates Claude Code (or Codex CLI) sessions to execute them autonomously. The default runtime is Claude; Codex is opt-in via config or the `--runtime` flag.

Key concepts:

- **Workflows** define a sequence of steps (prompts, parallel tasks, loops, conditionals)
- **Skills** are reusable Claude Code slash commands used by workflow steps
- **Agents** are specialized sub-agent configurations (explorer, reviewer)
- **Variables** let you parameterize workflows at runtime
- **Outputs** are structured reports generated after workflow completion

## Run the Demo Workflow

No setup or initialization is required. Agentic Forge ships with bundled workflows you can run immediately:

```bash
af run claude-demo
```

This runs the `claude-demo` workflow, which:

1. Displays a welcome message
2. Creates two demo files (`demo-1.md`, `demo-2.md`) in parallel
3. Iteratively adds 3 random facts to `demo-1.md` using a ralph-loop
4. Creates a git branch and commits the changes
5. Validates that everything worked correctly

Watch the terminal output to see each step execute. When complete, the workflow reports success or lists any issues.

If you have Codex CLI installed and authenticated, you can also run the Codex demo:

```bash
af run codex-demo
```

## Understanding Global vs Local

Agentic Forge uses a 3-tier directory model:

- **Bundled** (read-only): Built-in workflows and defaults shipped with the package
- **Global** (user-level): Your personal workflow overrides and default output location
- **Local** (project-level): Project-specific workflows and configuration

### Global directory

The global directory is created automatically on first use. Its location is platform-specific:

| Platform | Path                                                              |
| -------- | ----------------------------------------------------------------- |
| Windows  | `%APPDATA%\agentic-forge\`                                        |
| macOS    | `~/Library/Application Support/agentic-forge/`                    |
| Linux    | `$XDG_CONFIG_HOME/agentic-forge/` (or `~/.config/agentic-forge/`) |

To explicitly initialize it:

```bash
af init
```

This creates `workflows/`, `outputs/`, and `config.json` inside the global directory.

### Local directory

The local directory lives at `<project>/agentic/` and is optional. When present, local workflows and config take priority over global ones.

### Priority order

- **Config**: built-in defaults -> global config -> local config (local wins)
- **Workflows**: project-local -> user-global -> bundled (first match wins)
- **Outputs**: global by default, or local when `outputDirectory: "local"` is set

Use `af paths` to see all resolved paths and their existence status.

## Initialize a Local Project

Create a project-local `agentic/` directory with bundled workflows and config:

```bash
af init --local
```

This creates:

```text
agentic/
  workflows/   # Project-specific workflow overrides
  outputs/     # Workflow outputs stored locally
  config.json  # Local config (merged on top of global)
```

The local config defaults to `outputDirectory: "local"`, so workflow outputs are stored inside the project rather than the global directory.

## Customize and Run a Local Workflow

After initializing locally, you can edit any workflow in `agentic/workflows/`. Let's customize the demo workflow:

1. Open `agentic/workflows/claude-demo.yaml` in your editor
2. Modify a step, change the number of random facts, or adjust the welcome message
3. Run it:

   ```bash
   af run demo
   ```

Because local workflows take priority, your modified version runs instead of the bundled one.

## Create a New Workflow with the Authoring Skill

Agentic Forge includes an interactive workflow-builder skill. Load the authoring skills into Claude Code:

```bash
claude --add-dir $(af authoring-dir)
```

Then use the `/af-workflow-builder` slash command to create a new workflow:

```text
/af-workflow-builder create a workflow that analyzes test coverage and reports gaps
```

The skill understands the full workflow schema, all step types, and bundled skills. It can also validate, explain, update, and debug existing workflows:

```text
/af-workflow-builder validate agentic/workflows/my-workflow.yaml
/af-workflow-builder explain how ralph-loop works
```

Once your workflow is saved to `agentic/workflows/`, run it:

```bash
af run my-workflow --var "key=value"
```

## Next Steps

- [CLI Reference](cli.md) for the complete list of commands and options
- [Workflows](workflows.md) for details on all bundled workflows
- [Configuration](configuration.md) for all available settings
- [Coding Agents](coding-agents.md) for multi-runtime support (Claude + Codex)
