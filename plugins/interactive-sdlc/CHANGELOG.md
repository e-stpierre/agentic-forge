# Changelog

All notable changes to the interactive-sdlc plugin will be documented in this file.

## [0.1.0] - 2025-12-21

### Added

- Initial release of interactive-sdlc plugin
- Planning commands: `/interactive-sdlc:plan-chore`, `/interactive-sdlc:plan-bug`, `/interactive-sdlc:plan-feature`
- Implementation command: `/interactive-sdlc:build` with checkpoint support
- Validation command: `/interactive-sdlc:validate` with tests, code review, build verification, and plan compliance
- Workflow commands: `/interactive-sdlc:one-shot`, `/interactive-sdlc:plan-build-validate`
- Documentation command: `/interactive-sdlc:document` with mermaid diagram support
- Analysis commands: `/interactive-sdlc:analyse-bug`, `/interactive-sdlc:analyse-doc`, `/interactive-sdlc:analyse-debt`, `/interactive-sdlc:analyse-style`, `/interactive-sdlc:analyse-security`
- Git commands: `/interactive-sdlc:git-branch`, `/interactive-sdlc:git-commit`, `/interactive-sdlc:git-pr`
- GitHub commands: `/interactive-sdlc:create-gh-issue`, `/interactive-sdlc:read-gh-issue`
- Configuration command: `/interactive-sdlc:configure`
- Plan templates for chore, bug, and feature types
- Configuration system via `.claude/settings.json`
- Context argument support for all commands to reduce interactive prompts
