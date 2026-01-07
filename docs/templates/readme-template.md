<!--
PLUGIN README TEMPLATE

This template defines the exact structure for Claude Code plugin README files.

REQUIRED SECTIONS:
- Title + Description (merged philosophy/purpose, 1-5 sentences)
- Overview (quick understanding + bullet-point examples)
- Complete Examples (full reference at end)

PROMPT SECTIONS (include only if plugin contains prompts of that type):
- Commands (only if plugin has at least one command)
- Agents (only if plugin has at least one agent)
- Skills (only if plugin has at least one skill)
- Hooks (only if plugin has at least one hook)

OPTIONAL SECTIONS (only include when applicable):
- Dependencies (only if plugin depends on other plugins)
- Installation (only if plugin has Python CLI tools)
- Python CLI (only if plugin has Python CLI tools)
- Configuration (only if plugin is configurable via command or CLAUDE.md)
- Architecture (only when important to understand the plugin)
- Limitations (only if there are noteworthy limitations)

SECTION ORDER:
1. Title + Description
2. Overview
3. Commands (if applicable)
4. Agents (if applicable)
5. Skills (if applicable)
6. Hooks (if applicable)
7. Dependencies (if applicable)
8. Installation (if applicable)
9. Python CLI (if applicable)
10. Configuration (if applicable)
11. Architecture (if applicable)
12. Limitations (if applicable)
13. Complete Examples (always last)

NEVER INCLUDE:
- Migration Notes (handle in CHANGELOG.md instead)
- Time estimates or scheduling information
- Information already in root README (marketplace setup, contributing, license)
-->

# {{plugin_name}}

{{description_and_philosophy}}

<!--
Instructions:
- Replace {{plugin_name}} with the plugin name (e.g., "Interactive SDLC Plugin")
- Replace {{description_and_philosophy}} with 1-5 sentences that merge:
  - What the plugin does (purpose)
  - The philosophy/approach it takes
  - Target use case (CI/CD, interactive, etc.)
- This paragraph should give immediate understanding of the plugin
-->

## Overview

{{overview_content}}

{{overview_examples}}

<!--
Instructions:
- Replace {{overview_content}} with 2-4 sentences explaining:
  - The main capabilities
  - When to use this plugin
  - Key differentiators from similar plugins
- Replace {{overview_examples}} with bullet-point examples of the most important commands
- Include up to one example per command (not multiple variations)
- Less important commands can be omitted here (covered in Complete Examples)
- Format examples as: `command` - brief description of what it does
- If plugin has Python CLI, include 1-2 CLI examples here too
-->

## Commands

{{commands_content}}

<!--
Instructions:
- OMIT THIS SECTION ENTIRELY if plugin has no commands
- Replace {{commands_content}} with command tables
- Always use tables with | Command | Description | format
- If commands are organized in subfolders, use ### sub-sections matching folder structure
- Example structure for subfolder-organized commands:

### Planning (`commands/plan/`)

| Command | Description |
|---------|-------------|
| `/plugin:plan-feature` | Generate a feature implementation plan |
| `/plugin:plan-bug` | Generate a bug fix plan |

### Development (`commands/dev/`)

| Command | Description |
|---------|-------------|
| `/plugin:build` | Implement a plan file |
| `/plugin:validate` | Run validation checks |

- For flat command structure, use a single table without sub-sections
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
  - Settings that can be added to .claude/settings.json
  - Instructions for CLAUDE.md customization
- Show example configuration with all options
- Example:
  Configure in `.claude/settings.json`:
  ```json
  {
    "plugin-name": {
      "option1": "value",
      "option2": true
    }
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
