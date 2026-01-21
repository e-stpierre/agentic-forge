# Changelog

## [0.1.0] - 2026-01-11

### Added

- Initial release of Agentic SDLC plugin
- YAML-based workflow orchestration with sequential, parallel, and Ralph loop step types
- Checkpoint manager for session state tracking
- Python CLI for workflow management (`agentic-sdlc run`, `agentic-sdlc init`)
- Core commands: plan, build, validate, analyse, orchestrate
- Git commands: git-branch, git-commit, git-pr
- Explorer and reviewer agents for specialized tasks
- Skills for checkpoint and logging management
- Jinja2 templates for plans, reports, and analysis outputs
- Git worktree support for parallel step execution
- Console output module for workflow progress display
