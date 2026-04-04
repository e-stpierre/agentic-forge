# Contributing to Agentic Forge

Thank you for your interest in contributing! This guide will help you get started.

## Ways to Contribute

- **Report bugs** - Found something broken? [Open an issue](https://github.com/e-stpierre/agentic-forge/issues)
- **Suggest features** - Have an idea for a new workflow or enhancement? [Let us know](https://github.com/e-stpierre/agentic-forge/issues)
- **Improve docs** - Fix typos, clarify explanations, add examples
- **Write code** - Bug fixes, new skills, improvements to existing ones

## Development Setup

### Prerequisites

- [Claude Code](https://claude.ai/code) installed
- Git
- Node.js 20+
- [pnpm](https://pnpm.io/) for package management

### Local Development

```bash
# Clone the repo
git clone https://github.com/e-stpierre/agentic-forge.git
cd agentic-forge

# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Run format and lint checks
pnpm check
```

## Making Changes

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `doc/description` - Documentation updates
- `refactor/description` - Refactoring

### Commit Messages

Write clear, concise commit messages that describe the change. For example: `Add retry logic to workflow executor` or `Fix validation error in analyze skill`.

### Code Formatting

Run format, lint, and test checks locally before submitting a PR:

```bash
pnpm check          # Format and lint (Biome)
pnpm test           # Vitest tests
```

## Project Structure

```text
src/
  agents/              # Sub-agent definitions (.md)
  claude/.claude/      # Skills loaded via --add-dir
    skills/            # Bundled skills (slash commands)
  commands/            # CLI command implementations
  prompts/             # System prompt templates
  steps/               # Workflow step handlers
  workflows/           # YAML workflow definitions
  *.ts                 # Core TypeScript modules
tests/                 # Vitest test suite
```

### Naming Conventions

- **Agents**: descriptive with domain prefix (`explorer.md`, `reviewer.md`)
- **Skills**: directory name in kebab-case with `SKILL.md` inside (`analyze/SKILL.md`, `git-commit/SKILL.md`)
- **Workflows**: descriptive kebab-case YAML files (`plan-build-review.yaml`)

## Pull Request Process

### Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `pnpm check` to verify formatting
5. Run `pnpm test` to run the test suite
6. Commit your changes with clear messages
7. Push to your fork
8. Open a pull request

### PR Checklist

- [ ] CI pipeline passes (format, lint, tests)
- [ ] Changes tested with Claude Code

## Reporting Issues

### Bug Reports

Include:

- Steps to reproduce
- Expected vs actual behavior
- Agentic Forge version
- Claude Code version

### Feature Requests

Include:

- Description of the feature
- Use case / motivation

## Code of Conduct

Be respectful and constructive. We're all here to build useful tools together.

## Questions?

[Open an issue](https://github.com/e-stpierre/agentic-forge/issues) with the `question` label.

---

Thank you for contributing to Agentic Forge!
