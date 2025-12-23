# Claude Context: agentic-forge Repository

## Project Overview

This repository is a community-driven collection of modular extensions for Claude Code. It serves as a centralized hub for reusable commands, sub-agents, skills, hooks, and configuration templates that enhance Claude Code's capabilities
across various development scenarios.

## Purpose

The agentic-forge repository aims to:

1. **Democratize Customization**: Make it easy for developers to extend Claude Code without deep technical knowledge
2. **Share Best Practices**: Provide battle-tested automation patterns and workflows
3. **Build Community**: Foster collaboration among Claude Code users
4. **Accelerate Development**: Offer ready-to-use components that solve common problems

## Repository Structure

### `/plugins/`

Root directory containing all plugins. Each plugin is self-contained within its own subdirectory.

### `/plugins/<plugin-name>/`

Individual plugin directory structure:

#### `commands/`

Slash command definitions (`.md` files) that users can invoke directly in Claude Code sessions. Commands should:

- Have clear, descriptive names
- Include usage examples
- Be well-documented
- Handle edge cases gracefully

#### `agents/`

Sub-agent configurations for specialized, autonomous task execution. Agents should:

- Focus on specific domains (DevOps, testing, documentation, etc.)
- Have well-defined capabilities and limitations
- Include clear invocation instructions
- Provide example use cases

#### `skills/`

Reusable skill modules that provide composable functionality. Skills should:

- Be modular and single-purpose
- Work across different contexts
- Have clear input/output contracts
- Be composable with other skills

#### `hooks/`

Runtime hooks that execute on specific events (session start, tool calls, etc.). Hooks should:

- Be lightweight and performant
- Handle errors gracefully
- Include clear documentation on events and triggers
- Provide configuration options

#### `src/`

Python source code for CLI tools and orchestration utilities (optional). Used by plugins like `core` and `sdlc` that provide command-line workflows.

#### `README.md`

Plugin-specific documentation. Should only contain information specific to this plugin, not general marketplace or installation instructions.

### `/docs/`

Comprehensive documentation for plugin development and usage. Documentation should:

- Be clear and beginner-friendly
- Include examples and code snippets
- Cover common pitfalls and solutions
- Stay up-to-date with Claude Code changes

### `/examples/`

Real-world example implementations showing plugins in action. Examples should:

- Demonstrate practical use cases
- Include complete, working code
- Show integration between different plugin types
- Provide learning value

## Plugin Development Guidelines

### General Principles

1. **Modularity**: Each plugin should do one thing well
2. **Composability**: Plugins should work together seamlessly
3. **Documentation**: Every plugin needs clear usage instructions
4. **Testing**: Plugins should be tested in multiple contexts
5. **Error Handling**: Fail gracefully with helpful error messages
6. **Performance**: Keep plugins lightweight and efficient

### Naming Conventions

- **Commands**: Use kebab-case (e.g., `review-pr.md`, `setup-tests.md`)
- **Agents**: Use descriptive names with domain prefix (e.g., `devops-agent.md`, `test-agent.md`)
- **Skills**: Use verb-noun format (e.g., `parse-logs`, `validate-config`)
- **Hooks**: Include event name (e.g., `session-start-hook.sh`, `tool-call-hook.sh`)
- **Templates**: Use project type (e.g., `nodejs-template`, `python-template`)

### Documentation Guidelines

- **Keep READMEs concise**: Plugin READMEs should only contain plugin-specific information
- **Avoid duplication**: Do not repeat information from the root README (installation, marketplace setup, contributing guidelines, license, support)
- **CHANGELOGs should be brief**: Focus on what changed, not detailed explanations
- **Link to root docs**: Reference the root README or `/docs/` for general information
- **ASCII only**: Use only valid ASCII characters in all files to avoid encoding issues across platforms

### File Formats

- **Commands**: Markdown (`.md`) files in `plugins/<plugin-name>/commands/`
- **Agents**: Markdown or YAML files in `plugins/<plugin-name>/agents/`
- **Skills**: Markdown (`.md`) files with structured prompts in `plugins/<plugin-name>/skills/`
- **Hooks**: Shell scripts (`.sh`) or executable programs in `plugins/<plugin-name>/hooks/`
- **Python Tools**: Python packages in `plugins/<plugin-name>/src/` with `pyproject.toml`

### Prompt Template Convention

All prompt files (commands, agents, skills) must follow the exact structure defined in the template files located in `docs/templates/`:

- `docs/templates/command-template.md` - Structure for command prompts
- `docs/templates/agent-template.md` - Structure for agent prompts
- `docs/templates/skill-template.md` - Structure for skill prompts

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

Open the workspace file (`.vscode/agentic-forge.code-workspace`) and install recommended extensions for auto-format on save.

CI automatically formats code on pull requests. To run locally: `pnpm check`

## Working with This Repository

### When Adding New Plugins

1. **Check for Duplicates**: Search existing plugins to avoid redundancy
2. **Follow Structure**: Place files in appropriate directories
3. **Add Documentation**: Include a README or inline documentation
4. **Provide Examples**: Show how to use the plugin
5. **Test Thoroughly**: Ensure it works in different scenarios

### When Modifying Existing Plugins

1. **Preserve Compatibility**: Don't break existing usage patterns
2. **Document Changes**: Update documentation to reflect changes
3. **Version Appropriately**: Consider versioning for breaking changes
4. **Test Existing Use Cases**: Ensure existing functionality still works

### When Reviewing Contributions

1. **Check Quality**: Ensure code meets project standards
2. **Verify Documentation**: Confirm clear usage instructions exist
3. **Test Functionality**: Try the plugin in relevant contexts
4. **Assess Value**: Ensure it adds meaningful capability
5. **Provide Feedback**: Give constructive suggestions for improvement

## Integration with Claude Code

### Plugin Marketplace Installation

This repository is designed to be used as a Claude Code plugin marketplace. Users should install plugins via the marketplace system rather than manually copying files:

```bash
# Add this repository as a marketplace
/plugin marketplace add e-stpierre/agentic-forge

# Browse available plugins via the menu
/plugin menu

# Or install specific plugins directly
/plugin install appsec@e-stpierre/agentic-forge
```

**For Private Repositories**: Claude Code supports private Git repositories as marketplaces. Users need proper Git authentication configured (SSH keys or GitHub personal access token) to access private marketplace repositories.

**Marketplace Configuration**: This repository includes a `.claude-plugin/marketplace.json` file that defines all available plugins, their metadata, and installation requirements.

### Plugin Components

#### Commands

Commands are stored in `plugins/<plugin-name>/commands/` and invoked with `/command-name`. When a user types a slash command, the markdown file content becomes the prompt. After installing a plugin, commands are automatically available in the Claude Code session.

#### Agents

Sub-agents are stored in `plugins/<plugin-name>/agents/` and invoked via the Task tool with `subagent_type` parameter. They run autonomously to complete specific tasks.

#### Skills

Skills are stored in `plugins/<plugin-name>/skills/` and activated using the Skill tool with the skill name. They provide specialized capabilities that can be called during a session.

#### Hooks

Hooks are stored in `plugins/<plugin-name>/hooks/` and execute automatically on configured events. They can inject context, monitor state, or adapt behavior dynamically.

#### Python Tools

Some plugins include Python CLI tools in `plugins/<plugin-name>/src/` for workflow orchestration. These can be installed using `uv tool install` to provide command-line utilities that work alongside Claude Code.

## Best Practices for Plugin Usage

### For End Users

1. **Add the Marketplace**: Use `/plugin marketplace add e-stpierre/agentic-forge` to access plugins
2. **Browse Before Installing**: Use `/plugin menu` to explore available plugins and their descriptions
3. **Review Before Use**: Always examine plugin code and documentation before installing
4. **Test in Safe Environment**: Try plugins in non-production contexts first
5. **Understand Behavior**: Read documentation to understand what plugins do
6. **Provide Feedback**: Report issues and suggest improvements
7. **Share Knowledge**: Contribute your own plugins back to the community

### For Plugin Developers

1. **Write Clear Documentation**: Users should understand your plugin immediately
2. **Handle Errors Gracefully**: Don't crash or leave things in a bad state
3. **Keep It Simple**: Complexity is the enemy of maintainability
4. **Test Extensively**: Try your plugin in various scenarios
5. **Accept Feedback**: Be open to suggestions and improvements

## Common Patterns

### Command Pattern: Automation Workflow

```markdown
# Command Description

Brief description of what this command does

## Usage

/command-name [optional-args]

## Example

/command-name --flag value

## Implementation

Detailed prompt that Claude executes when command is invoked
```

### Agent Pattern: Specialized Domain Expert

```markdown
# Agent Name

Description of agent's expertise and capabilities

## Domain

Specific area of focus (DevOps, Testing, etc.)

## Tools Available

List of tools this agent can use

## Behavior

Description of how agent approaches tasks
```

### Skill Pattern: Reusable Capability

```markdown
# Skill Name

Description of what this skill does

## Inputs

What the skill expects

## Outputs

What the skill produces

## Usage

How to activate and use this skill
```

### Hook Pattern: Event Handler

```bash
#!/bin/bash
# Hook Name: description
# Trigger: when this hook executes

# Implementation
# Script that runs on event
```

## Technical Considerations

### Performance

- Keep hooks lightweight (they run frequently)
- Cache expensive operations
- Avoid blocking operations in event handlers

### Security

- Never commit secrets or credentials
- Validate inputs to prevent injection attacks
- Use secure practices for shell scripts

### Compatibility

- Test across different operating systems
- Handle different shell environments
- Consider Claude Code version differences

### Maintainability

- Use clear, descriptive names
- Comment complex logic
- Keep files focused and modular
- Update documentation with code changes

### Python Development

- **Always use `uv` for Python commands**: This repository requires `uv` for all Python-related operations (building packages, installing tools, running scripts)
- **Building packages**: Use `uv build` instead of `python -m build`
- **Installing tools**: Use `uv tool install` instead of `pip install`
- **Running scripts**: Use `uv run` for executing Python scripts
- This ensures consistent Python environments across different systems and avoids Python PATH issues

## Breaking Changes

This repository is in active development. Breaking changes are acceptable in any plugin at any time without backward compatibility considerations or migration documentation. When a breaking change is needed, simply make the change.

## Future Directions

This repository is designed to evolve with the Claude Code ecosystem:

- **Plugin Marketplace**: [DONE] Implemented via `.claude-plugin/marketplace.json` - users can now browse and install plugins directly
- **Version Management**: Better handling of plugin versions and dependencies
- **Testing Framework**: Automated testing for plugin quality
- **Community Curation**: Ratings and reviews for popular plugins
- **Cross-Project Sharing**: Easy ways to share configurations across teams
- **Team Marketplaces**: Support for team-wide marketplace configuration in `.claude/settings.json`

## Getting Help

When working with this repository:

1. Check the `/docs/` directory for detailed guides
2. Look at `/examples/` for working implementations
3. Search existing issues for similar questions
4. Open a discussion for general questions
5. File an issue for bugs or feature requests

## Contributing

All contributions are welcome! Whether you're:

- Adding a new plugin
- Improving documentation
- Fixing bugs
- Suggesting enhancements
- Sharing use cases

Your input helps make Claude Code more powerful for everyone.

---

**Remember**: This repository is about empowering developers to customize their Claude Code experience. Keep that goal in mind when creating, reviewing, or using plugins.
