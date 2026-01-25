<!--
PLUGIN README TEMPLATE

This template defines the exact structure for Claude Code plugin README files.

REQUIRED SECTIONS:
- Title (# Plugin Name)
- Overview (description, philosophy, purpose, quick examples, and optional ### Key Features)
- Complete Examples (full reference at end)

PROMPT SECTIONS (include only if plugin contains prompts of that type):
- Commands (only if plugin has at least one command)
- Agents (only if plugin has at least one agent)
- Skills (only if plugin has at least one skill)
- Hooks (only if plugin has at least one hook)

OPTIONAL SECTIONS (only include when applicable):
- Documentation (only if plugin has additional docs to link to)
- Dependencies (only if plugin depends on other plugins)
- Installation (only if plugin has Python CLI tools)
- Python CLI (only if plugin has Python CLI tools)
- Configuration (only if plugin is configurable via command or CLAUDE.md)
- Architecture (only when important to understand the plugin)
- Limitations (only if there are noteworthy limitations)

SECTION ORDER:
1. Title (# Plugin Name)
2. Overview (includes description, purpose, and optional ### Key Features)
3. Documentation (if applicable - links to additional docs)
4. Commands (if applicable)
5. Agents (if applicable)
6. Skills (if applicable)
7. Hooks (if applicable)
8. Dependencies (if applicable)
9. Installation (if applicable)
10. Python CLI (if applicable)
11. Configuration (if applicable)
12. Architecture (if applicable)
13. Limitations (if applicable)
14. Complete Examples (always last)

NEVER INCLUDE:
- Migration Notes (handle in CHANGELOG.md instead)
- Time estimates or scheduling information
- Information already in root README (marketplace setup, contributing, license)
-->

# {{plugin_name}}

<!--
Instructions:
- Replace {{plugin_name}} with the plugin name (e.g., "Agentic SDLC")
- Do NOT add a description paragraph directly after the title
- All description content goes in the Overview section below
-->

## Overview

{{description_and_purpose}}

{{overview_examples}}

### Key Features

{{key_features}}

<!--
Instructions:
- Replace {{description_and_purpose}} with 1-5 sentences that merge:
  - What the plugin does (purpose)
  - The philosophy/approach it takes
  - Target use case (CI/CD, interactive, etc.)
  - Main capabilities and when to use this plugin
- Replace {{overview_examples}} with bullet-point examples of the most important commands
  - Include up to one example per command (not multiple variations)
  - Less important commands can be omitted here (covered in Complete Examples)
  - Format examples as: `command` - brief description of what it does
  - If plugin has Python CLI, include 1-2 CLI examples here too
- Replace {{key_features}} with bullet-point list of key features (OPTIONAL)
  - OMIT the ### Key Features sub-section if there are no noteworthy features to highlight
  - Use format: **Feature Name** - Brief description
  - Include 4-8 key differentiating features
-->

## Documentation

{{documentation_links}}

<!--
Instructions:
- OMIT THIS SECTION ENTIRELY if plugin has no additional documentation
- Replace {{documentation_links}} with links to additional documentation files
- Use bullet-point format with markdown links
- Example:
  - **[Quick Start](docs/QuickStart.md)** - Get running in 5 minutes
  - **[Workflow Guide](docs/WorkflowBuilder.md)** - Complete authoring documentation
  - **[Contributing](docs/Contributing.md)** - Development guidelines
-->

## Skills

{{skills_content}}

<!--
Instructions:
- OMIT THIS SECTION ENTIRELY if plugin has no skills
- Replace {{skills_content}} with skill tables
- Always use tables with | Skill | Description | format
- If skills are organized in subfolders, use ### sub-sections matching folder structure
- Example:

| Skill | Description |
|-------|-------------|
| `plugin:parse-logs` | Parse and analyze log files |
| `plugin:validate-config` | Validate configuration files |
-->

## Agents

{{agents_content}}

<!--
Instructions:
- OMIT THIS SECTION ENTIRELY if plugin has no agents
- Replace {{agents_content}} with agent tables
- Always use tables with | Agent | Description | format
- If agents are organized in subfolders, use ### sub-sections matching folder structure
- Example:

| Agent | Description |
|-------|-------------|
| `plugin:code-reviewer` | Reviews code for bugs and security issues |
| `plugin:architect` | Designs system architecture |
-->

## Hooks

{{hooks_content}}

<!--
Instructions:
- OMIT THIS SECTION ENTIRELY if plugin has no hooks
- Replace {{hooks_content}} with hook tables
- Always use tables with | Hook | Trigger | Description | format
- Example:

| Hook | Trigger | Description |
|------|---------|-------------|
| `pre-commit` | Before git commit | Runs linting and tests |
| `session-start` | Session initialization | Loads project context |
-->

## Dependencies

{{dependencies}}

<!--
Instructions:
- Replace {{dependencies}} with plugin dependencies
- List each dependency with installation instructions
- OMIT THIS SECTION ENTIRELY if plugin has no dependencies
- Example:
  This plugin requires the `core` plugin to be installed first:
  ```bash
  uv tool install path/to/core
  ```
-->

## Installation

{{installation}}

<!--
Instructions:
- Replace {{installation}} with installation commands
- OMIT THIS SECTION ENTIRELY if plugin has no Python CLI tools
- Include both Windows and macOS/Linux examples
- Example:
  ```bash
  # Windows (PowerShell)
  uv tool install "$env:USERPROFILE\.claude\plugins\marketplaces\agentic-forge\plugins\plugin-name"

  # macOS/Linux
  uv tool install ~/.claude/plugins/marketplaces/agentic-forge/plugins/plugin-name
  ```
-->

## Python CLI

{{python_cli_content}}

<!--
Instructions:
- Replace {{python_cli_content}} with Python CLI documentation
- OMIT THIS SECTION ENTIRELY if plugin has no Python CLI tools
- Include the following sub-sections:

### CLI Commands

| Command | Description |
|---------|-------------|
| `cli-command` | What it does |

### CLI Options

| Flag | Description |
|------|-------------|
| `--flag` | What it controls |

### Library Usage

```python
from plugin_module import function

result = function(args)
```
-->

## Configuration

{{configuration}}

<!--
Instructions:
- Replace {{configuration}} with configuration documentation
- OMIT THIS SECTION ENTIRELY if plugin is not configurable
- Include if plugin has:
  - A /plugin:configure command
  - Settings that can be added to .claude/configs/plugin-name.json
  - Instructions for CLAUDE.md customization
- Show example configuration with all options
- Example:
  Configure in `.claude/configs/plugin-name.json`:
  ```json
  {
    "option1": "value",
    "option2": true
  }
  ```
-->

## Architecture

{{architecture}}

<!--
Instructions:
- Replace {{architecture}} with architecture documentation
- OMIT THIS SECTION ENTIRELY unless architecture is important to understand
- Use arrow notation for workflows: Step 1 -> Step 2 -> Step 3
- Keep brief - link to detailed docs if needed
- Include only when understanding the architecture is necessary for using the plugin
-->

## Limitations

{{limitations}}

<!--
Instructions:
- Replace {{limitations}} with noteworthy limitations
- OMIT THIS SECTION ENTIRELY if there are no significant limitations
- Use bullet points
- Only include limitations that users need to be aware of
- Example:
  - Requires well-defined specifications for reliable results
  - Large codebases may slow agent exploration
-->

## Complete Examples

{{complete_examples}}

<!--
Instructions:
- Replace {{complete_examples}} with comprehensive examples for ALL commands and tools
- This section is the full reference for the plugin
- Structure by command/tool category
- For each command/tool include:
  - All supported arguments with descriptions
  - Multiple examples showing different argument combinations
  - Expected behavior for each example
- Example structure:

### /plugin:command-name

**Arguments:**
- `--flag` - Description of what this flag does
- `--option <value>` - Description with expected value type
- `[context]` - Optional context description

**Examples:**

```bash
# Basic usage
/plugin:command-name

# With flag
/plugin:command-name --flag

# With option and context
/plugin:command-name --option value Additional context here
```

### cli-command (Python CLI)

**Options:**
- `--type` - Task type: feature, bug, chore
- `--spec` - Path to specification file
- `--output` - Output file path

**Examples:**

```bash
# Basic workflow
cli-command --type feature --spec spec.json

# With output file
cli-command --type bug --spec bug.json --output result.json
```
-->
