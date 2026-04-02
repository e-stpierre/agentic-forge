# Changelog

## [1.0.0] - 2026-04-02

### Breaking Changes

- Renamed package from `agentic-sdlc` to `agentic-forge`
- Removed Claude Code marketplace dependency
- Skills now loaded via `--add-dir` (no `agentic-sdlc:` prefix)
- CLI command renamed from `agentic-sdlc` to `agentic-forge`

### Added

- `skills-dir` command to print bundled skills path
- Skills, agents, and prompts bundled as package data
- `--add-dir` integration for Claude session skill discovery

### Changed

- Repository restructured: flat layout at root instead of `plugins/agentic-sdlc/`
- `update` command uses `uv tool upgrade` instead of marketplace
