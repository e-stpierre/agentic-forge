# Claude Context: claude-plugins Repository

## Project Overview

This repository is a community-driven collection of modular extensions for Claude Code. It serves as a centralized hub for reusable commands, sub-agents, skills, hooks, and configuration templates that enhance Claude Code's capabilities across various development scenarios.

## Purpose

The claude-plugins repository aims to:

1. **Democratize Customization**: Make it easy for developers to extend Claude Code without deep technical knowledge
2. **Share Best Practices**: Provide battle-tested automation patterns and workflows
3. **Build Community**: Foster collaboration among Claude Code users
4. **Accelerate Development**: Offer ready-to-use components that solve common problems

## Repository Structure

### `/commands/`

Slash command definitions (`.md` files) that users can invoke directly in Claude Code sessions. Commands should:

- Have clear, descriptive names
- Include usage examples
- Be well-documented
- Handle edge cases gracefully

### `/agents/`

Sub-agent configurations for specialized, autonomous task execution. Agents should:

- Focus on specific domains (DevOps, testing, documentation, etc.)
- Have well-defined capabilities and limitations
- Include clear invocation instructions
- Provide example use cases

### `/skills/`

Reusable skill modules that provide composable functionality. Skills should:

- Be modular and single-purpose
- Work across different contexts
- Have clear input/output contracts
- Be composable with other skills

### `/hooks/`

Runtime hooks that execute on specific events (session start, tool calls, etc.). Hooks should:

- Be lightweight and performant
- Handle errors gracefully
- Include clear documentation on events and triggers
- Provide configuration options

### `/templates/`

Project configuration templates for common scenarios. Templates should:

- Include a complete `.claude/` directory structure
- Provide sensible defaults
- Include documentation on customization
- Cover common use cases

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

### File Formats

- **Commands**: Markdown (`.md`) files in `.claude/commands/`
- **Agents**: Configuration in markdown or YAML
- **Skills**: Markdown (`.md`) files with structured prompts
- **Hooks**: Shell scripts (`.sh`) or executable programs
- **Templates**: Directory structures with configuration files

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
/plugin marketplace add e-stpierre/claude-plugins

# Browse available plugins via the menu
/plugin menu

# Or install specific plugins directly
/plugin install appsec@e-stpierre/claude-plugins
```

**For Private Repositories**: Claude Code supports private Git repositories as marketplaces. Users need proper Git authentication configured (SSH keys or GitHub personal access token) to access private marketplace repositories.

**Marketplace Configuration**: This repository includes a `.claude-plugin/marketplace.json` file that defines all available plugins, their metadata, and installation requirements.

### Plugin Components

#### Commands

Commands are stored in `.claude/commands/` and invoked with `/command-name`. When a user types a slash command, the markdown file content becomes the prompt.

#### Agents

Sub-agents are invoked via the Task tool with `subagent_type` parameter. They run autonomously to complete specific tasks.

#### Skills

Skills are activated using the Skill tool with the skill name. They provide specialized capabilities that can be called during a session.

#### Hooks

Hooks execute automatically on configured events. They can inject context, monitor state, or adapt behavior dynamically.

## Best Practices for Plugin Usage

### For End Users

1. **Add the Marketplace**: Use `/plugin marketplace add e-stpierre/claude-plugins` to access plugins
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

## Future Directions

This repository is designed to evolve with the Claude Code ecosystem:

- **Plugin Marketplace**: ✅ Implemented via `.claude-plugin/marketplace.json` - users can now browse and install plugins directly
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
