# Claude Context: agentic-forge Repository

## Project Overview

Agentic Forge is a TypeScript/Node.js package that provides YAML-based workflow orchestration for Claude Code. It bundles skills, agents, and prompts as package data, enabling autonomous multi-step task execution.

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

Bundled workflow execution skills loaded via `--add-dir`. Skills are reusable Claude Code slash commands. Each skill is a directory in kebab-case containing a `SKILL.md` file. These are used by the workflow engine during execution.

#### `commands/`

CLI command implementations (`run`, `init`, `update`, `skills-dir`, `authoring-dir`, `workflows`, etc.).

#### `prompts/`

System prompt templates used by the workflow runner.

#### `steps/`

Workflow step handlers (prompt, parallel, serial, conditional, ralph-loop).

#### `workflows/`

Bundled YAML workflow definitions (7 workflows: `plan-build-review`, `one-shot`, `ralph-loop`, `analyze-codebase`, `analyze-codebase-merge`, `analyze-single`, `demo`).

### `tests/`

Vitest test suite for all TypeScript source code.

### `agentic/`

Runtime directory for workflow configuration, outputs, and logs.

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

### Workflow Engine Changes

When modifying the workflow engine in `src/`, you must update the workflow-builder skill reference files to keep them in sync:

- `src/claude/.claude/skills/workflow-builder/references/REFERENCE.md` - Complete schema reference
- `src/claude/.claude/skills/workflow-builder/references/workflow-example.yaml` - Annotated reference workflow

Changes to workflow settings, step types, or features require updates to both files.

### Node.js Development

- **Always use `pnpm` for package management**: This repository uses pnpm for all Node.js operations
- **Building**: Use `pnpm build` (runs `tsc` + asset copy script)
- **Testing**: Use `pnpm test` (runs Vitest)
- **Linting**: Use `pnpm check` (runs Biome)
- **Development**: Use `pnpm dev` for TypeScript watch mode
