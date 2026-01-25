# Contributing to Agentic Forge

Thank you for your interest in contributing! This guide will help you get started.

## Ways to Contribute

- **Report bugs** - Found something broken? [Open an issue](https://github.com/e-stpierre/agentic-forge/issues)
- **Suggest features** - Have an idea for a new plugin or enhancement? [Let us know](https://github.com/e-stpierre/agentic-forge/issues)
- **Improve docs** - Fix typos, clarify explanations, add examples
- **Write code** - Bug fixes, new plugins, improvements to existing ones

## Development Setup

### Prerequisites

- [Claude Code](https://claude.ai/code) installed
- Git
- [uv](https://docs.astral.sh/uv/) recommended for Python development
- Node.js with pnpm (for formatting checks)

### Local Development

```bash
# Clone the repo
git clone https://github.com/your-org/agentic-forge.git
cd agentic-forge

# Test a plugin locally
claude --plugin-dir ./plugins/<plugin-name>
```

## Making Changes

### Branch Naming

- `feature/description` - New features or plugins
- `fix/description` - Bug fixes
- `doc/description` - Documentation updates
- `refactor/description` - Refactoring

### Commit Messages

Write clear, concise commit messages that describe the change. For example: `Add retry logic to workflow executor` or `Fix validation error in analyze-bug command`.

### Code Formatting

Run format, lint, and test checks locally before submitting a PR:

```bash
pnpm check          # Format and lint
uv run pytest       # Python tests (for plugins with Python code)
```

## Internal Tools

- **`/normalize`** - Validate prompt files and READMEs against templates. Use `--autofix` to auto-fix issues.
- **`/update-plugin`** - Analyze branch changes and update plugin versions following semantic versioning.
- **`uv run .claude/re-install-plugins.py`** - Reinstall all plugins from the local marketplace (or specify plugin names to reinstall specific ones).

## Plugin Development

### Structure

Each plugin lives in its own directory:

- `/plugins/` - Official, stable plugins
- `/experimental-plugins/` - Work-in-progress plugins that may have breaking changes

```
plugins/<plugin-name>/
├── commands/       # Slash commands (.md)
├── agents/         # Sub-agent definitions (.md)
├── skills/         # Reusable skill modules (.md)
├── hooks/          # Runtime hooks (.sh)
├── src/            # Python source code (optional)
├── CHANGELOG.md    # Version history (official plugins only)
└── README.md       # Plugin documentation
```

### Naming Conventions

- **Commands**: kebab-case (`review-pr.md`, `setup-tests.md`)
- **Agents**: descriptive with domain prefix (`devops-agent.md`, `test-agent.md`)
- **Skills**: verb-noun format (`parse-logs`, `validate-config`)
- **Hooks**: include event name (`session-start-hook.sh`)

### Prompt Templates

All prompts must follow the templates in [`docs/templates/`](docs/templates/). Use the `/normalize` command inside Claude Code to validate.

```bash
# Validate all prompts
/normalize

# Validate specific files
/normalize plugins/my-plugin/commands/

# Auto-fix non-compliant files
/normalize --autofix plugins/my-plugin/
```

## Pull Request Process

### Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `pnpm check` to verify formatting
5. Run `uv run pytest` for Python plugins
6. Run `/normalize` (inside Claude Code) to validate prompt files
7. Commit your changes with clear messages
8. Push to your fork
9. Open a pull request

### PR Checklist

- [ ] CI pipeline passes (format, lint, tests)
- [ ] Prompt templates validated (`/normalize`)
- [ ] Plugin README updated if applicable
- [ ] CHANGELOG updated (for official plugins only)
- [ ] Changes tested with Claude Code

## Reporting Issues

### Bug Reports

Include:

- Steps to reproduce
- Expected vs actual behavior
- Plugin name and version
- Claude Code version

### Feature Requests

Include:

- Description of the feature
- Use case / motivation
- Which plugin it applies to (or if it's a new plugin)

## Code of Conduct

Be respectful and constructive. We're all here to build useful tools together.

## Questions?

[Open an issue](https://github.com/e-stpierre/agentic-forge/issues) with the `question` label.

---

Thank you for contributing to Agentic Forge!
