# Claude Context: agentic-forge Repository

## Project Overview

Agentic Forge is a standalone Python package that provides YAML-based workflow orchestration for Claude Code. It bundles skills, agents, and prompts as package data, enabling autonomous multi-step task execution.

## Purpose

The agentic-forge repository aims to:

1. **Share Best Practices**: Provide battle-tested automation patterns and workflows
2. **Accelerate Development**: Offer ready-to-use components that solve common problems
3. **Automate Development**: Offer reusable and flexible workflows that enable the automation of development tasks during the whole SDLC life-cycle

## Repository Structure

### `src/agentic_forge/`

Python source code for the CLI and workflow orchestration engine.

#### `agents/`

Bundled sub-agent configurations for specialized, autonomous task execution (`explorer.md`, `reviewer.md`). Agents should be self-contained and focused on a specific domain or task.

#### `claude/.claude/skills/`

Bundled skills loaded via `--add-dir`. Skills are reusable Claude Code slash commands. Each skill is a directory in kebab-case containing a `SKILL.md` file.

#### `commands/`

CLI command implementations (`run`, `init`, `update`, `skills-dir`, `workflows`, etc.).

#### `prompts/`

System prompt templates used by the workflow runner.

#### `steps/`

Workflow step handlers (prompt, parallel, serial, conditional, ralph-loop).

#### `workflows/`

Bundled YAML workflow definitions (7 workflows: `plan-build-review`, `one-shot`, `ralph-loop`, `analyze-codebase`, `analyze-codebase-merge`, `analyze-single`, `demo`).

### `tests/`

Test suite for all Python source code.

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

- **Agents**: Markdown (`.md`) files in `src/agentic_forge/agents/`
- **Skills**: `SKILL.md` files in skill directories: `src/agentic_forge/claude/.claude/skills/<skill-name>/SKILL.md`
- **Workflows**: YAML files in `src/agentic_forge/workflows/`
- **Python Source**: Python packages in `src/agentic_forge/` with root `pyproject.toml`

### Prompt Template Convention

All prompt files (agents, skills) must follow the exact structure defined in their respective template files:

- `src/agentic_forge/claude/.claude/skills/create-skill/template.md` - Structure for skill prompts

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

**Validation:**

Use the `/normalize` command to validate prompt files against templates:

```bash
# Validate all prompts in the repository
/normalize

# Validate specific files or directories
/normalize src/agentic_forge/claude/.claude/skills/

# Auto-fix non-compliant files
/normalize --autofix src/agentic_forge/claude/.claude/skills/
```

### Shell Commands

Run shell commands directly without prefixing with `cd` to the repository root. The working directory is already set correctly, and unnecessary `cd` prefixes create distinct command strings that trigger extra permission prompts.

```bash
# Good
git status
uv run pytest

# Bad - unnecessary cd causes extra permission approval
cd "c:/Repositories/agentic-forge" && git status
```

### Code Style and Formatting

CI validates format, lint, and tests on all pull requests. Run locally before opening a pull request:

```bash
pnpm check          # Format and lint
uv run pytest       # Python tests
```

## Technical Considerations

### Workflow Engine Changes

When modifying the workflow engine in `src/agentic_forge/`, you must update the workflow-builder skill reference files to keep them in sync:

- `src/agentic_forge/claude/.claude/skills/workflow-builder/references/REFERENCE.md` - Complete schema reference
- `src/agentic_forge/claude/.claude/skills/workflow-builder/references/workflow-example.yaml` - Annotated reference workflow

Changes to workflow settings, step types, or features require updates to both files.

### Python Development

- **Always use `uv` for Python commands**: This repository requires `uv` for all Python-related operations (building packages, installing tools, running scripts)
- **Building packages**: Use `uv build` instead of `python -m build`
- **Installing tools**: Use `uv tool install` instead of `pip install`
- **Running scripts**: Use `uv run` for executing Python scripts
- This ensures consistent Python environments across different systems and avoids Python PATH issues
