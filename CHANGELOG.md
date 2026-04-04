# Changelog

## 0.8.0

- Added bare `key=value` argument support for passing workflow variables without the `--var` flag
- Added interactive prompts for missing required workflow variables when running in a TTY
- Added `--no-interactive` flag to disable interactive prompts in scripts and CI
- Updated `workflows --verbose` to show variable type, default value, and description per variable
- Updated usage examples in CLI help and `workflows` command output

## 0.7.0

- **Breaking:** Full rewrite from Python to TypeScript/Node.js
- **Breaking:** Renamed package from `agentic-sdlc` to `agentic-forge` (CLI command also renamed)
- **Breaking:** Removed Claude Code marketplace dependency; skills now loaded via `--add-dir`
- **Breaking:** Replaced Jinja2 templates with Nunjucks for template rendering
- **Breaking:** Distribution changed from PyPI (`uv tool install`) to npm (`npm i -g agentic-forge`)
- Ported all 14 CLI command handlers to TypeScript with Commander.js
- Ported workflow executor, orchestrator, and checkpoint manager to TypeScript
- Ported all step executors (prompt, serial, parallel, conditional, ralph-loop) with shared base class
- Ported runner module with Claude CLI subprocess management and stream-JSON parsing
- Ported progress tracking, signal management, and workflow logger
- Ported parallel step executor with git worktree management
- Added `skills-dir` command to print bundled skills path for `--add-dir` integration
- Skills, agents, and prompts bundled as npm package data
- Repository restructured: flat layout at root instead of `plugins/agentic-sdlc/`
- Added Biome for TypeScript/JSON linting and formatting
- Added markdownlint-cli2 for Markdown linting
- Added Vitest test suite
- CI updated from Python (pytest, uv) to Node.js (pnpm, vitest, biome)
- Fixed wait-for-human progress state and parallel concurrency cap
- Fixed 5 major correctness issues from code review

## 0.6.0

- Added `workflow-builder` skill for creating, updating, explaining, validating, and debugging workflows
- Added parallel branch display in terminal with multi-branch status updates (BASE mode)
- Added queue-based message streaming for parallel steps (ALL mode)
- Added stream-JSON parsing for real-time Claude output processing
- Added model name detection and display in step headers (e.g., `sonnet-4.5`)
- Added `strict-mode` setting for failing on undefined template variables
- Added config file copy during `init` command
- Added comprehensive test coverage for console, runner, init, parser, and step modules
- Rewrote console output module with `ParallelOutputHandler` for parallel execution display
- Increased default `max_iterations` from 5-10 to 25 across all workflows
- Changed `create_pr` default to `false` across all workflows
- Changed `bypass-permissions` default to `false` in ralph-loop workflow
- Set `terminal-output: base` as explicit default in plan-build-review and ralph-loop workflows
- Consolidated workflow documentation from `docs/` into `workflow-builder` skill references
- Fixed workflow resume losing state on re-run
- Fixed fix-issues step in plan-build-review reading wrong file for review output
- Fixed JSON template placeholders in fix-issues step replaced with proper syntax

## 0.5.0

- Converted all CLI commands to skills for consistency and reusability
- Added `create-skill` skill for generating new skills from templates
- Renamed `validate` command to `sdlc-review` skill
- Prefixed plan and review skills with `sdlc-` to avoid naming conflicts with Claude Code built-ins
- Added workflow-id argument support across skills
- Fixed step output and reference handling between workflow steps
- Fixed full skill name usage in workflows to avoid command conflicts

## 0.4.0

- Added `fix-analysis` skill for iteratively fixing issues from analysis documents
- Added `workflows` CLI command to list available workflows with descriptions
- Removed `/build`, `one-shot`, and `analyze` CLI commands in favor of workflow-based execution
- Refactored analyze workflows to use the new `fix-analysis` skill
- Removed experimental-plugins directory
- Fixed `git-pr` command to fetch and compare against remote base branch to avoid stale local branch issues

## 0.3.0

- Standardized US English spelling across all code, commands, and documentation (e.g., `analyse` to `analyze`)
- Renamed workflow files from `analyse-*.yaml` to `analyze-*.yaml` and `demo-workflow.yaml` to `demo.yaml`
- Removed interactive-sdlc plugin

## 0.2.0

- Added `version` command to display installed version
- Added `release-notes` command to display release notes from CHANGELOG.md
- Added `update` command for self-updating from local marketplace
- Added `add-improvement` command for tracking improvement suggestions
- Added workflow auto-discovery with search order: project-local, user-global, bundled
- Added `--list` flag for `run` command to list all available workflows
- Added demo workflow for showcasing capabilities
- Fixed `list` command to correctly find workflow progress files in `agentic/outputs/`
- Fixed workflow logging to capture agent messages in both base and terminal-output modes
- Fixed ralph-loop first iteration template evaluation
- Fixed plan output when used in workflow context
- Fixed plan-build-validate build step failures and ralph failure handling

## 0.1.0

- Initial release of agentic-sdlc
- YAML-based workflow orchestration with sequential, parallel, and Ralph loop step types
- Checkpoint manager for session state tracking
- Python CLI for workflow management (`run`, `init`)
- Core commands: plan, build, validate, analyze, orchestrate
- Git commands: git-branch, git-commit, git-pr
- Explorer and reviewer agents for specialized tasks
- Jinja2 templates for plans, reports, and analysis outputs
- Git worktree support for parallel step execution
- Console output module for workflow progress display
- Plugin discovery and download system with marketplace structure
- Claude GitHub Actions for CI
- NuGet vulnerability detection and security analysis commands
