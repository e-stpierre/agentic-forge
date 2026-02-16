# Changelog

## [0.6.0] - 2026-02-15

### Added

- `workflow-builder` skill for creating, updating, explaining, validating, and debugging workflows
- Parallel branch display in terminal with multi-branch status updates (BASE mode)
- Queue-based message streaming for parallel steps (ALL mode)
- Stream-JSON parsing for real-time Claude output processing
- Model name detection and display in step headers (e.g., `sonnet-4.5`)
- `strict-mode` setting for failing on undefined template variables
- `max_iterations` variable to plan-build-review workflow
- Config file copy during `init` command
- Comprehensive test coverage for console, runner, init, parser, and step modules

### Changed

- Rewrote console output module with `ParallelOutputHandler` for parallel execution display
- Improved `sdlc-plan` skill with milestone structure, progress tracking, and validation sections
- Improved `sdlc-review` skill with workflow-id support and output directory handling
- Updated plan-build-review workflow: opus model for planning, variable-based max-iterations, improved review and fix steps
- Increased default `max_iterations` from 5-10 to 25 across all workflows
- Changed `create_pr` default to `false` across all workflows
- Changed `bypass-permissions` default to `false` in ralph-loop workflow
- Set `terminal-output: base` as explicit default in plan-build-review and ralph-loop workflows
- Improved `git-branch` prompt to pass task context
- Consolidated workflow documentation from `docs/` into `workflow-builder` skill references
- Updated all documentation references to point to new skill location

### Removed

- `docs/WorkflowBuilder.md` (consolidated into `skills/workflow-builder/references/REFERENCE.md`)
- `docs/workflow-example.yaml` (moved to `skills/workflow-builder/references/workflow-example.yaml`)

### Fixed

- Fix-issues step in plan-build-review now reads separate review.md instead of plan file review section
- JSON template placeholders in fix-issues step replaced with proper syntax
- `create-skill` template now documents `\$ARGUMENTS` escaping requirement

## [0.5.0] - 2026-01-25

### Added

- `create-skill` skill for generating new skills from templates
- `sdlc-plan` skill (converted from plan command)
- `sdlc-review` skill (renamed from validate command)
- Explore agent count configuration in plan skill
- Workflow-id argument support across skills

### Changed

- Converted all commands to skills for consistency
- Renamed `validate` command to `sdlc-review` skill
- Prefixed plan and review skills with `sdlc-` to avoid conflicts
- Updated skill template to Agent Skills standard
- Improved plan-build-review workflow
- Updated one-shot workflow

### Fixed

- Step output and reference handling
- Full skill name usage in workflows to avoid conflicts

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
