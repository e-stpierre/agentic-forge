# Changelog

## 0.11.0

- **Breaking:** Raised the minimum Node.js version from 20 to 22; Node 20 reached end of life and pnpm 11 no longer runs on it
- Updated the CI test matrix to Node 22 and 24, and pinned the package manager to pnpm 11 via the `packageManager` field
- Removed the pinned default Codex model; `--model` is now omitted so Codex CLI applies its own default instead of a SKU that goes stale
- Fixed the orchestrator falling back to the hardcoded `sonnet` alias for every runtime; it now uses the adapter's own default model
- Fixed `settings.model` leaking into steps that override `runtime`, so a Codex step in a Claude workflow no longer inherits a Claude alias
- Fixed `formatModelName` failing to match current model IDs by handling undated IDs and the fable and mythos families
- Updated docs and workflow-builder references for the Claude model aliases and the new Codex model behavior
- Fixed `pnpm install` failing with `ERR_PNPM_IGNORED_BUILDS` by declaring build approvals in `pnpm-workspace.yaml` and dropping the legacy `pnpm.onlyBuiltDependencies` field

## 0.10.2

- Fixed Codex writable output directories by granting both the working directory and workflow output directory as `--add-dir` roots, restoring writes when global outputs live outside the target repo
- Fixed orchestrator to propagate `workflowId` and `outputDir` to Codex runs so the output directory is correctly registered as a writable root

## 0.10.1

- Added `plan` variable to `plan-build-review` and `multi-plan-build-review` workflows; when set to a path, the existing plan is copied to the output directory instead of generating a new one
- Added `plan-loop` workflow that generates a checkbox-tracked plan from arbitrary input and drives a Ralph loop completing one task per iteration with Memory carryover and per-task commits
- Updated default Codex model from `gpt-5.4` to `gpt-5.5` across adapter, config, tests, and bundled workflows
- Updated Codex model lists in docs and workflow-builder references to reflect actually available models
- Updated `create-branch` step in `plan-build-review` and `multi-plan-build-review` to scope the agent to deriving a branch name only, preventing it from starting implementation work during the branch step
- Fixed Codex adapter to use `--sandbox workspace-write` instead of the deprecated `--full-auto` flag
- Fixed cumulative Codex agent output in BASE mode by finalizing each `agent_message` as its own turn, and switched non-TTY streams to plain incremental deltas instead of ANSI in-place rewrites

## 0.10.0

- **Breaking:** Removed `settings.git` from workflow settings (`enabled`, `worktree`, `auto-commit`, `auto-pr`, `branch-prefix` no longer recognized)
- **Breaking:** Removed `merge-mode: merge` from parallel steps; branches are always independent
- **Breaking:** Removed `step.git` from parallel step definitions; replaced with `step.worktree: true`
- **Breaking:** Removed `git.mainBranch`, `git.autoCommit`, `git.autoPr` config defaults
- Added `settings.worktree` schema with `enabled`, `location`, `directory`, and `cleanup` fields
- Added workflow-level worktree isolation (entire workflow runs in a single worktree when `worktree.enabled: true`)
- Added three worktree location modes: `sibling` (default, alongside repo), `nested` (inside repo), `absolute` (user-specified path)
- Added three cleanup policies: `on-success` (default, preserve on failure), `on-complete` (always remove), `manual` (always preserve)
- Added template-driven `worktree.enabled` supporting Nunjucks variables for per-run toggling
- Added `safetyCommit` to auto-save uncommitted changes before worktree removal, preventing data loss
- Added `getWorktreeOutputRoot` to force global output directory for worktree runs
- Added `findOutputDir` with worktree-aware output lookup for resume/status/cancel commands
- Added `worktree-settings.ts` shared helpers for resolving worktree template strings
- Added validation blocking parallel worktree inside workflow-level worktree (nested worktrees not supported)
- Added `on-failure` option to parallel steps: `fail` (default, fail workflow) or `warn` (log warning, continue workflow)
- Updated `plan-build-review` workflow with variable-driven worktree (`use_worktree` variable)
- Updated `analyze-codebase-merge` workflow to use `step.worktree: true` instead of `merge-mode: merge`
- Updated all bundled workflows to remove legacy git settings
- Fixed ralph-loop CWD to respect `cwdOverride` for worktree isolation
- Fixed `config.worktree` defaults (location, directory, cleanup) not being applied to workflow settings
- Fixed `af list` not finding worktree-backed runs when invoked from inside a worktree
- Fixed `pruneOrphaned` to scan both nested and sibling worktree directories by default
- Fixed `pruneOrphaned` missing workflow-level nested worktrees that lack the `agentic-` prefix
- Fixed worktree and output directory names diverging when using `--slug` with incremental suffixes
- Removed `update` CLI command; updates are now handled via `npm install -g agentic-forge@latest`

## 0.9.0

- Added multi-runtime support with `RuntimeAdapter` interface for pluggable coding agent backends
- Added `ClaudeAdapter` for Claude Code CLI with stream-JSON parsing
- Added `CodexAdapter` for Codex CLI with JSONL streaming
- Added `process-runner.ts` shared subprocess execution layer for all runtimes
- Added runtime resolution chain: step → CLI flag → workflow settings → config defaults → `"claude"`
- Added `codex-demo`, `multi-demo`, and `multi-plan-build-review` bundled workflows
- Renamed `demo` workflow to `claude-demo` for clarity
- Added `docs/coding-agents.md` guide covering supported runtimes and configuration
- Updated workflow YAML schema to support `runtime` field in settings and step level
- Updated authoring skill references to document multi-runtime options

## 0.8.0

- Added `paths.ts` central path resolver as single source of truth for all directory resolution
- Added `paths` CLI command to display resolved global, local, and bundled directory paths
- Added 3-layer config loading: built-in defaults → global config → local config
- Added `saveConfig()` with `--global`/`--local` scope support for targeted config writes
- Updated `init` command to default to global directory; added `--local` flag for project-local init
- Added `--config-only`, `--workflows-only`, and `--workflow <name>` flags to `init` command
- Added `--global`/`--local` scope flags to `config set` command
- Added `--slug` flag to `run` command for custom workflow run ID suffix
- Updated output directory to default to global (`%APPDATA%/agentic-forge/outputs/<project>/`) with local override via config
- Updated `status` command to show output directory source and resolved paths

## 0.7.1

- Added bare `key=value` argument support for passing workflow variables without the `--var` flag
- Added interactive prompts for missing required workflow variables when running in a TTY
- Added `--no-interactive` flag to disable interactive prompts in scripts and CI
- Updated `workflows --verbose` to show variable type, default value, and description per variable
- Added `authoring-dir` command to print path to interactive authoring skills (e.g., `workflow-builder`)
- Moved `workflow-builder` skill from workflow execution skills to dedicated authoring skills directory
- Updated usage examples in CLI help and `workflows` command output
- Fixed interactive prompt for variables with defaults and empty descriptions

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
