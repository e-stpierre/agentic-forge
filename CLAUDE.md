# Claude Context: agentic-forge Repository

## Project Overview

This repository is a collection of modular extensions for Claude Code. It serves as a centralized hub for reusable agents, skills, hooks, configuration templates and Python automation that enhance Claude Code's capabilities across various development scenarios.

## Purpose

The agentic-forge repository aims to:

1. **Share Best Practices**: Provide battle-tested automation patterns and workflows
2. **Accelerate Development**: Offer ready-to-use components that solve common problems
3. **Automate Development**: Offer re-usable and flexible workflows that enable the automation of development task during the whole SLDC life-cycle.

## Repository Structure

### `/docs/`

Comprehensive documentation for plugin development and usage.
This directory also contains template files for agent and skill. These templates must be respected when creating a new prompt.

### `/plugins/`

Root directory containing all plugins. Each plugin is self-contained within its own subdirectory.

### `/plugins/<plugin-name>/`

Individual plugin directory structure that is organized with one directory per prompt type. Sub-directories can be used within a prompt type to organize its content.

#### `agents/`

Sub-agent configurations for specialized, autonomous task execution. Agents should be self-contained and focused on a specific domain or task.

#### `skills/`

Reusable skill modules that provide composable functionality. Skills are the primary way to extend Claude Code with custom slash commands.

#### `hooks/`

Runtime hooks that execute on specific events (session start, tool calls, etc.).

#### `src/`

Python source code for CLI tools and orchestration utilities (optional). Used by plugins like `agentic-sdlc` that provide command-line workflows.

#### `CHANGELOG.md`

Plugin-specific version history.

#### `README.md`

Plugin-specific documentation. Should only contain information specific to this plugin, not general marketplace or installation instructions.

The README must contain an initial section called `Overview` that allow a user to understand the plugin and how to use with a few examples it in 2 minute.

The README must also have a complete example section at the end, that covers all the supported commands and arguments, with examples.

## Plugin Development Guidelines

### Language Style

Use US English spelling in all code, comments, documentation, and UI strings when a word has both UK and US variants (e.g., "analyze" not "analyse", "color" not "colour", "canceled" not "cancelled").

### Naming Conventions

- **Agents**: Use descriptive names with domain prefix (e.g., `devops-agent.md`, `test-agent.md`)
- **Skills**: Directory name in kebab-case with `SKILL.md` inside (e.g., `parse-logs/SKILL.md`, `validate-config/SKILL.md`)
- **Hooks**: Include event name (e.g., `session-start-hook.sh`, `tool-call-hook.sh`)
- **Templates**: Use project type (e.g., `nodejs-template`, `python-template`)

### Documentation Guidelines

- **Keep READMEs concise**: Plugin READMEs should only contain plugin-specific information
- **Avoid duplication**: Do not repeat information from the root README (installation, marketplace setup, contributing guidelines, license, support)
- **CHANGELOGs should be brief**: Focus on what changed, not detailed explanations
- **Link to root docs**: Reference the root README or `/docs/` for general information
- **Character encoding**: Code files must use ASCII only. Documentation and markdown files (skills, agents, READMEs) may use minimal emojis where they add clarity (e.g., checkmarks, robot emoji for Claude attribution). Avoid decorative emoji use.
- **Workflow diagrams**: Use arrow notation (`->`) for workflow documentation instead of long multi-line ASCII boxes. Example: `Plan -> Implement -> Validate -> Output` is preferred over complex box diagrams

### File Formats

- **Agents**: Markdown (`.md`) files in `plugins/<plugin-name>/agents/`
- **Skills**: `SKILL.md` files in skill directories: `plugins/<plugin-name>/skills/<skill-name>/SKILL.md`
- **Hooks**: Shell scripts (`.sh`) or executable programs in `plugins/<plugin-name>/hooks/`
- **Python Tools**: Python packages in `plugins/<plugin-name>/src/` with `pyproject.toml`

### Prompt Template Convention

All prompt files (agents, skills) and plugin READMEs must follow the exact structure defined in their respective template files:

- `docs/templates/agent-template.md` - Structure for agent prompts
- `plugins/agentic-sdlc/skills/create-skill/template.md` - Structure for skill prompts
- `docs/templates/readme-template.md` - Structure for plugin README files

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
/normalize plugins/my-plugin/skills/

# Auto-fix non-compliant files
/normalize --autofix plugins/my-plugin/
```

### Code Style and Formatting

CI validates format, lint, and tests on all pull requests. Run locally before opening a pull request:

```bash
pnpm check          # Format and lint
uv run pytest       # Python tests (for plugins with Python code)
```

## Technical Considerations

### Python Development

- **Always use `uv` for Python commands**: This repository requires `uv` for all Python-related operations (building packages, installing tools, running scripts)
- **Building packages**: Use `uv build` instead of `python -m build`
- **Installing tools**: Use `uv tool install` instead of `pip install`
- **Running scripts**: Use `uv run` for executing Python scripts
- This ensures consistent Python environments across different systems and avoids Python PATH issues
