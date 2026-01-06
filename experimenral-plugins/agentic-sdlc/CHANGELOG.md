# Changelog

All notable changes to the agentic-sdlc plugin will be documented in this file.

## [2.0.0] - 2024-12-21

### Breaking Changes

- Renamed plugin from `sdlc` to `agentic-sdlc`
- All commands now use `/agentic-sdlc:` namespace prefix
- Removed all user interaction (no AskUserQuestion calls)
- All I/O is now JSON-based for autonomous operation

### Changed

- Updated all command paths to use new plugin directory
- Refocused plugin for fully autonomous workflows
- Updated documentation to reflect autonomous operation
- Commands now designed for Python orchestration

### Migration

For interactive workflows, use the new `interactive-sdlc` plugin instead.

## [1.0.0] - Previous

Initial release as `sdlc` plugin with interactive planning, implementation, review, and testing workflows.
