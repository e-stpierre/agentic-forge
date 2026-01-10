# Claude Context: agentic-forge Repository

## Project Overview

This repository is a collection of modular extensions for Claude Code. It serves as a centralized hub for reusable commands, sub-agents, skills, hooks, and configuration templates that enhance Claude Code's capabilities across various development scenarios.

## Purpose

The agentic-forge repository aims to:

1. **Share Best Practices**: Provide battle-tested automation patterns and workflows
2. **Accelerate Development**: Offer ready-to-use components that solve common problems
3. **Automate Development**: Offer re-usable and flexible workflows that enable the automation of development task during the whole SLDC life-cycle.

## Repository Structure

### `/docs/`

Comprehensive documentation for plugin development and usage.
This directory also contains template files for agent, command and skill. These template must be respected when creating a new prompt.

### `/experimental-plugins/`

Root directory containing all experimental plugins. These plugins are not yet officially released. These plugins should also not be explicitely documented in the repository root README.md, but the directory can be mention and the plugins can be used in examples, such as uv tool installation.

**Important**: Experimental plugins must NOT have a `CHANGELOG.md` file. The changelog is only added once the plugin becomes officially supported, moves to version 1.x.x+, and is relocated to the `/plugins/` directory.

### `/plugins/`

Root directory containing all plugins. Each plugin is self-contained within its own subdirectory.

### `/plugins/<plugin-name>/`

Individual plugin directory structure that is organized with one directory per prompt type. Sub-directories can be used within a prompt type to organize it's content.

#### `commands/`

Slash command definitions (`.md` files) that users can invoke directly in Claude Code sessions or can be invoked in python workflows.

#### `agents/`

Sub-agent configurations for specialized, autonomous task execution. Agents should be self-contained and focused on a specific domain or task.

#### `skills/`

Reusable skill modules that provide composable functionality.

#### `hooks/`

Runtime hooks that execute on specific events (session start, tool calls, etc.).

#### `src/`

Python source code for CLI tools and orchestration utilities (optional). Used by plugins like `core` and `sdlc` that provide command-line workflows.

#### `CHANGELOG.md`

Plugin-specific version history.

#### `README.md`

Plugin-specific documentation. Should only contain information specific to this plugin, not general marketplace or installation instructions.

The README must contain an initial section called `Overview` that allow a user to understand the plugin and how to use with a few examples it in 2 minute.

The README must also have a complete example section at the end, that covers all the supported commands and arguments, with examples.

## Plugin Development Guidelines

### Naming Conventions

- **Commands**: Use kebab-case (e.g., `review-pr.md`, `setup-tests.md`)
- **Agents**: Use descriptive names with domain prefix (e.g., `devops-agent.md`, `test-agent.md`)
- **Skills**: Use verb-noun format (e.g., `parse-logs`, `validate-config`)
- **Hooks**: Include event name (e.g., `session-start-hook.sh`, `tool-call-hook.sh`)
- **Templates**: Use project type (e.g., `nodejs-template`, `python-template`)

### Documentation Guidelines

- **Root README should not list experimental plugins**: The root README should not list or mention any plugin that are experimental (in the /experimental-plugins) directory.
- **Keep READMEs concise**: Plugin READMEs should only contain plugin-specific information
- **Avoid duplication**: Do not repeat information from the root README (installation, marketplace setup, contributing guidelines, license, support)
- **CHANGELOGs should be brief**: Focus on what changed, not detailed explanations
- **Link to root docs**: Reference the root README or `/docs/` for general information
- **ASCII only**: Use only valid ASCII characters in all files to avoid encoding issues across platforms
- **Workflow diagrams**: Use arrow notation (`->`) for workflow documentation instead of long multi-line ASCII boxes. Example: `Plan -> Implement -> Validate -> Output` is preferred over complex box diagrams

### File Formats

- **Commands**: Markdown (`.md`) files in `plugins/<plugin-name>/commands/`
- **Agents**: Markdown (`.md`) files in `plugins/<plugin-name>/agents/`
- **Skills**: Markdown (`.md`) files with structured prompts in `plugins/<plugin-name>/skills/`
- **Hooks**: Shell scripts (`.sh`) or executable programs in `plugins/<plugin-name>/hooks/`
- **Python Tools**: Python packages in `plugins/<plugin-name>/src/` with `pyproject.toml`

### Prompt Template Convention

All prompt files (commands, agents, skills) and plugin READMEs must follow the exact structure defined in the template files located in `docs/templates/`:

- `docs/templates/command-template.md` - Structure for command prompts
- `docs/templates/agent-template.md` - Structure for agent prompts
- `docs/templates/skill-template.md` - Structure for skill prompts
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
/normalize plugins/my-plugin/commands/

# Auto-fix non-compliant files
/normalize --autofix plugins/my-plugin/
```

### Code Style and Formatting

CI automatically formats code on pull requests. To run locally: `pnpm check`

## Technical Considerations

### Python Development

- **Always use `uv` for Python commands**: This repository requires `uv` for all Python-related operations (building packages, installing tools, running scripts)
- **Building packages**: Use `uv build` instead of `python -m build`
- **Installing tools**: Use `uv tool install` instead of `pip install`
- **Running scripts**: Use `uv run` for executing Python scripts
- This ensures consistent Python environments across different systems and avoids Python PATH issues

## Git Operations

Always use `/git-branch`, `/git-commit` and `/git-pr` commands for commits, pull requests, and branch management. These commands ensure consistent structure and formatting.

## Breaking Changes

This repository is in active development. Breaking changes are acceptable in any plugin at any time without backward compatibility considerations or migration documentation. When a breaking change is needed, simply make the change.
