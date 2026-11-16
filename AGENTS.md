# Repository Guidelines

## Project Overview

Agentic Forge is a TypeScript/Node.js package that provides YAML-based workflow orchestration for coding agents (Claude Code, Codex CLI, and others). It bundles skills, agents, and prompts as package data, enabling autonomous multi-step task execution.

## Purpose

The agentic-forge repository aims to:

1. **Share Best Practices**: Provide battle-tested automation patterns and workflows
2. **Accelerate Development**: Offer ready-to-use components that solve common problems
3. **Automate Development**: Offer reusable and flexible workflows that enable the automation of development tasks during the whole SDLC life-cycle

## Repository Structure

### `src/`

TypeScript source code for the CLI and workflow orchestration engine.

#### `agents/`

Bundled sub-agent configurations for specialized, autonomous task execution (`explorer.md`, `reviewer.md`). Agents should be self-contained and focused on a specific domain or task.

#### `authoring/.claude/skills/`

Interactive authoring skills for users to create and manage workflows (e.g., `workflow-builder`). Exposed via the `authoring-dir` CLI command. These are not used by the workflow engine.

#### `claude/.claude/skills/`

Bundled workflow execution skills loaded via `--add-dir`. Skills are reusable Claude Code slash commands. Each skill is a directory in kebab-case containing a `SKILL.md` file. These are used by the workflow engine during execution with the `claude` runtime only.

#### `commands/`

CLI command implementations (`run`, `init`, `update`, `skills-dir`, `authoring-dir`, `workflows`, etc.).

#### `prompts/`

System prompt templates used by the workflow runner.

#### `runtimes/`

Runtime adapter layer for coding agent integrations:

- `types.ts` — `RuntimeId`, `RuntimeAdapter`, `RuntimeCommand`, `StreamEvent`, `RuntimeRunOptions`, `RuntimeResult`
- `claude.ts` — `ClaudeAdapter` (extracted from `runner.ts`)
- `codex.ts` — `CodexAdapter` (Codex CLI with JSONL streaming)
- `process-runner.ts` — `runRuntime()` shared process spawning
- `utils.ts` — `getExecutable()`, `FileNotFoundError`, `getAgenticSystemPrompt()`
- `index.ts` — `getAdapter()`, `resolveRuntime()`, re-exports

#### `steps/`

Workflow step handlers (prompt, parallel, serial, conditional, ralph-loop).

#### `workflows/`

Bundled YAML workflow definitions (12 workflows: `plan-build-review`, `one-shot`, `ralph-loop`, `plan-loop`, `analyze-codebase`, `analyze-single`, `claude-demo`, `codex-demo`, `multi-demo`, `multi-plan-build-review`, `permission-test-claude`, `permission-test-codex`).

### `tests/`

Vitest test suite for all TypeScript source code.

### `src/paths.ts`

Central path resolver module. Single source of truth for all directory resolution:

- `getGlobalRoot()` — platform-native global directory (`%APPDATA%`, `~/Library/Application Support`, `$XDG_CONFIG_HOME`)
- `getOutputRoot(config, cwd)` — resolves output base dir (global default, local override)
- `getOutputDir(workflowId, config, cwd)` — full output path for a workflow run
- `getWorkflowDirs(bundledDir)` — ordered workflow search path (project-local > user-global > bundled)
- `getConfigPaths()` — global and local config file paths
- `ensureGlobalDir()` — lazy-initializes global directory on first use
- `sanitizeSlug(input)` — cleans user-provided slugs for safe directory names

### `docs/`

User-facing documentation, linked from the README via GitHub `blob/main/` URLs. Not included in the npm package.

- `getting-started.md` — Installation, quick tour, init, and first workflow creation
- `cli.md` — Complete CLI reference with all commands, arguments, and options
- `workflows.md` — Bundled workflows with use cases, variables, and examples
- `coding-agents.md` — Supported runtimes, per-step configuration, and model names
- `configuration.md` — All configuration options, defaults, and layering behavior

### `agentic/`

Optional project-local directory for workflow configuration and outputs. Created by `agentic-forge init --local`. When `outputDirectory` is set to `"global"` (the default), outputs go to the global directory instead.

## Development Guidelines

### Language Style

Use US English spelling in all code, comments, documentation, and UI strings when a word has both UK and US variants (e.g., "analyze" not "analyse", "color" not "colour", "canceled" not "cancelled").

### Naming Conventions

- **Agents**: Use descriptive names with domain prefix (e.g., `explorer.md`, `reviewer.md`)
- **Skills**: Directory name in kebab-case with `SKILL.md` inside (e.g., `analyze/SKILL.md`, `git-commit/SKILL.md`)
- **Workflows**: Descriptive kebab-case YAML files (e.g., `plan-build-review.yaml`)

### Documentation Guidelines

- **Character encoding**: Code files must use ASCII only. Documentation and markdown files (skills, agents, READMEs) may use minimal emojis where they add clarity (e.g., checkmarks, robot emoji for Claude attribution). Avoid decorative emoji use.
- **Workflow diagrams**: Use arrow notation (`->`) for workflow documentation instead of long multi-line ASCII boxes. Example: `Plan -> Implement -> Review -> Output` is preferred over complex box diagrams

### File Formats

- **Agents**: Markdown (`.md`) files in `src/agents/`
- **Skills**: `SKILL.md` files in skill directories: `src/claude/.claude/skills/<skill-name>/SKILL.md`
- **Workflows**: YAML files in `src/workflows/`
- **TypeScript Source**: TypeScript modules in `src/` with root `package.json`

**Placeholder Convention:**

Prompt templates use **Mustache/Handlebars-style placeholders** with the following format:

```markdown
## {{section_title}}

{{content}}

<!--
Instructions:
- Replace {{content}} with the actual content
- Additional guidance for this section
- Suggested elements (include others as needed):
  - Element 1
  - Element 2
-->
```

**Key principles:**

- Use `{{variable_name}}` for all placeholders (not `<placeholder>` or other formats)
- Include HTML comments with instructions below each section
- Mark suggested elements as "include others as needed" to allow flexibility
- Required sections must be present; optional sections can be omitted
- Section names must match the template exactly (case-sensitive)

### Code Style and Formatting

CI validates format, lint, and tests on all pull requests. Run locally before opening a pull request:

```bash
pnpm check          # Format and lint (biome)
pnpm test           # Vitest tests
```

## Technical Considerations

### Path Resolution

All directory resolution flows through `src/paths.ts`. The system uses a 3-tier model:

- **Config**: built-in defaults -> global (`getGlobalRoot()/config.json`) -> local (`agentic/config.json`)
- **Workflows**: project-local (`agentic/workflows/`) -> user-global (`getGlobalRoot()/workflows/`) -> bundled
- **Outputs**: global by default (`getGlobalRoot()/outputs/<project-slug>/`), or local (`agentic/outputs/`) when `outputDirectory: "local"`

The global directory is lazy-initialized by `ensureGlobalDir()` on first use. No `init` is required to run workflows.

Worktrees always use local output (`outputDirectory: "local"`) since they are ephemeral.

### Runtime Adapter Pattern

The workflow engine delegates all coding agent interactions to runtime adapters in `src/runtimes/`. Each adapter implements the `RuntimeAdapter` interface:

- `buildCommand(options)` — constructs the CLI command and stdin input
- `parseStreamLine(line)` — parses streaming output into normalized `StreamEvent` objects
- `buildFinalResult()` — assembles the `RuntimeResult` from process output

Runtime resolution order: `step.runtime` > `--runtime` CLI flag > `workflow settings.runtime` > `config.defaults.runtime` > `"claude"`.

**Skills only work with the `claude` runtime.** The `codex` runtime does not support `--add-dir` skill injection. Workflows that use `/af-*` skill invocations must run with `runtime: claude` (or the default).

To add a new runtime: create an adapter in `src/runtimes/`, register it in `src/runtimes/index.ts`, and add the `RuntimeId` to the union type in `src/runtimes/types.ts`.

### Workflow Engine Changes

When modifying the workflow engine in `src/`, you must update the workflow-builder skill reference files to keep them in sync:

- `src/authoring/.claude/skills/workflow-builder/references/REFERENCE.md` - Complete schema reference
- `src/authoring/.claude/skills/workflow-builder/references/workflow-example.yaml` - Annotated reference workflow

Changes to workflow settings, step types, or features require updates to both files.

### Documentation Updates

When modifying CLI commands, configuration options, workflow variables, or user-facing behavior, update the corresponding documentation in `docs/`:

- CLI changes (new commands, arguments, options) -> `docs/cli.md`
- Workflow changes (new workflows, variable changes) -> `docs/workflows.md`
- Configuration changes (new keys, default changes) -> `docs/configuration.md`
- Setup or init flow changes -> `docs/getting-started.md`

### Node.js Development

- **Always use `pnpm` for package management**: This repository uses pnpm for all Node.js operations
- **Building**: Use `pnpm build` (runs `tsc` + asset copy script)
- **Testing**: Use `pnpm test` (runs Vitest)
- **Linting**: Use `pnpm check` (runs Biome)
- **Development**: Use `pnpm dev` for TypeScript watch mode
