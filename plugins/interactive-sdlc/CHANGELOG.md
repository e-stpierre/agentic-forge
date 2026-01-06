# Changelog

All notable changes to the interactive-sdlc plugin will be documented in this file.

## [1.2.0] - 2026-01-06

### Added

- Git commands (moved from core plugin to make interactive-sdlc standalone):
  - `commands/git/git-branch.md` - Create branches with standardized naming
  - `commands/git/git-commit.md` - Commit and push with structured messages
  - `commands/git/git-pr.md` - Create pull requests with contextual descriptions
  - `commands/git/git-worktree.md` - Manage git worktrees for parallel development
- GitHub commands (moved from core plugin):
  - `commands/github/create-gh-issue.md` - Create GitHub issues
  - `commands/github/read-gh-issue.md` - Read GitHub issue content

## [1.1.0] - 2026-01-06

### Changed

- Reorganized commands into logical subfolders:
  - `commands/plan/` - Planning commands (plan-chore, plan-bug, plan-feature)
  - `commands/dev/` - Development commands (build, validate, document)
  - `commands/workflows/` - Workflow commands (one-shot, plan-build-validate)
  - `commands/analyse/` - Analysis commands (analyse-bug, analyse-doc, analyse-debt, analyse-style, analyse-security)
  - `commands/configure.md` remains at root level

## [1.0.0] - 2025-12-21

### Added

- Initial release of interactive-sdlc plugin
- Planning commands: `/interactive-sdlc:plan-chore`, `/interactive-sdlc:plan-bug`, `/interactive-sdlc:plan-feature`
- Implementation command: `/interactive-sdlc:build` with checkpoint support
- Validation command: `/interactive-sdlc:validate` with tests, code review, build verification, and plan compliance
- Workflow commands: `/interactive-sdlc:one-shot`, `/interactive-sdlc:plan-build-validate`
- Documentation command: `/interactive-sdlc:document` with mermaid diagram support
- Analysis commands: `/interactive-sdlc:analyse-bug`, `/interactive-sdlc:analyse-doc`, `/interactive-sdlc:analyse-debt`, `/interactive-sdlc:analyse-style`, `/interactive-sdlc:analyse-security`
- Configuration command: `/interactive-sdlc:configure`
- Plan templates for chore, bug, and feature types
- Configuration system via `.claude/settings.json`
- Context argument support for all commands to reduce interactive prompts
