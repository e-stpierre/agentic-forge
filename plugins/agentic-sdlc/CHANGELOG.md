# Changelog

## [0.4.0] - 2026-01-24

### Added

- `fix-analysis` skill for iteratively fixing issues from analysis documents
- `workflows` CLI command to list available workflows with descriptions

### Removed

- `/build` command (use workflows for implementation)
- `one-shot` CLI command (use `agentic-sdlc run one-shot.yaml` instead)
- `analyze` CLI command (use `agentic-sdlc run analyze-single.yaml` instead)

### Changed

- Refactored analyze workflows to use the new `fix-analysis` skill
- Updated documentation to reflect CLI changes

### Fixed

- `git-pr` command now fetches and compares against remote base branch to avoid stale local branch issues

## [0.3.0] - 2026-01-24

### Changed

- Renamed `analyse` commands to `analyze` for US English spelling consistency
- Renamed workflow files from `analyse-*.yaml` to `analyze-*.yaml`
- Renamed `demo-workflow.yaml` to `demo.yaml`
- Updated documentation and command prompts for clarity

## [0.2.0] - 2026-01-21

### Added

- `version` command to display installed agentic-sdlc version
- `release-notes` command to display release notes from CHANGELOG.md
- `update` command for self-updating from local marketplace
- `add-improvement` command for tracking improvement suggestions
- Workflow auto-discovery with search order: project-local, user-global, bundled
- `--list` flag for `run` command to list all available workflows
- Demo workflow for showcasing capabilities
- Documentation restructure with QuickStart, WorkflowBuilder, and Contributing guides

### Fixed

- `list` command now correctly finds workflow progress files in `agentic/outputs/`
- `update` command uses local marketplace instead of remote sources
- Workflow logging captures agent messages in both base and terminal-output modes
- Ralph-loop first iteration template evaluation
- Plan output when used in workflow context
- Plan-build-validate build step failures
- Ralph failure handling improvements

## [0.1.0] - 2026-01-11

### Added

- Initial release of Agentic SDLC plugin
- YAML-based workflow orchestration with sequential, parallel, and Ralph loop step types
- Checkpoint manager for session state tracking
- Python CLI for workflow management (`agentic-sdlc run`, `agentic-sdlc init`)
- Core commands: plan, build, validate, analyze, orchestrate
- Git commands: git-branch, git-commit, git-pr
- Explorer and reviewer agents for specialized tasks
- Skills for checkpoint and logging management
- Jinja2 templates for plans, reports, and analysis outputs
- Git worktree support for parallel step execution
- Console output module for workflow progress display
