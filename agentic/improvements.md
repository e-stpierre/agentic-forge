# Improvements

This file tracks improvement opportunities identified during code analysis. Each improvement has a checklist entry for progress tracking and a detailed section explaining the issue.

## How to Use This File

1. **Adding Improvements**: Add a checkbox to the Progress Tracking section (`- [ ] IMP-XXX: Short title`) and a corresponding details section with problem description, files to investigate, and acceptance criteria.
2. **Working on Improvements**: Mark the item as in-progress by keeping `[ ]` and update the Status in the details section to "In Progress".
3. **Completing Improvements**: Change `[ ]` to `[x]` and update the Status to "Completed".
4. **Implementation**: Use `/agentic-sdlc:build` to implement individual improvements.

## Progress Tracking

- [x] IMP-001: Workflow logging not capturing agent messages
- [x] IMP-002: Add version command to CLI
- [ ] IMP-003: Add release-notes command to CLI
- [ ] IMP-004: Add update command to CLI
- [ ] IMP-005: Auto-discover workflow files
- [ ] IMP-006: List command returns no results
- [ ] DOC-001: Restructure agentic-sdlc documentation

## Improvements List

List the details of every improvement request, 100 lines maximum per item.

---

### IMP-001: Workflow logging not capturing agent messages

**Status**: Completed

**Problem**: The workflow logging system has a `terminal-output` setting configured in the workflow schema with `base` and `all` options, but the implementation is not working as expected. When running workflows programmatically via the CLI, agent messages produced during Claude sessions are not being captured and displayed in the terminal. The `base` logging mode should display the last message from the agent and overwrite it as new messages arrive, providing a live status update experience.

**Files to Investigate**:

- `plugins/agentic-sdlc/schemas/workflow.schema.json:68-72` - Defines `terminal-output` setting with `base`/`all` enum
- `plugins/agentic-sdlc/src/agentic_sdlc/runner.py:150-266` - `run_claude()` function handles subprocess execution and streaming; `print_output` parameter controls streaming behavior
- `plugins/agentic-sdlc/src/agentic_sdlc/console.py:15-19` - `OutputLevel` enum defines BASE and ALL levels
- `plugins/agentic-sdlc/src/agentic_sdlc/console.py:181-184` - `stream_line()` method only prints if level is ALL, BASE mode gets no streaming
- `plugins/agentic-sdlc/src/agentic_sdlc/cli.py:49-53` - CLI accepts `--terminal-output` argument but it's unclear how it connects to the runner

**Expected Behavior / Goal**:

1. In `base` mode: Display the last message from the agent, overwriting previous messages as new ones arrive (using terminal control sequences like `\r` or ANSI cursor movement)
2. In `all` mode: Stream all messages from the agent in real-time (current partial implementation)
3. Agent output from Claude subprocess should be captured regardless of mode and made available for display
4. The `ConsoleOutput` class should handle the overwriting behavior for base mode

**Acceptance Criteria**:

- [x] Base mode displays live agent status by showing the last message and overwriting it
- [x] All mode streams complete agent output to terminal
- [x] Claude subprocess stdout is properly captured and forwarded to ConsoleOutput
- [x] Terminal output mode setting from workflow YAML flows through CLI to runner
- [x] Works correctly on both Windows and Unix terminals

---

### IMP-002: Add version command to CLI

**Status**: Completed

**Problem**: The `agentic-sdlc` CLI does not have a `version` command to display the current installed version of the plugin. Users need a way to quickly check which version they have installed for troubleshooting and ensuring compatibility.

**Files to Investigate**:

- `plugins/agentic-sdlc/pyproject.toml:3` - Version is defined as `version = "0.1.0"`
- `plugins/agentic-sdlc/src/agentic_sdlc/cli.py` - Main CLI entry point where new subcommand should be added
- `plugins/agentic-sdlc/src/agentic_sdlc/commands/__init__.py` - Command exports

**Expected Behavior / Goal**:

Running `agentic-sdlc version` or `agentic-sdlc --version` should print the current version from the package metadata.

**Acceptance Criteria**:

- [x] `agentic-sdlc version` command prints the current version (e.g., "agentic-sdlc 0.1.0")
- [x] `agentic-sdlc --version` flag also works as an alternative
- [x] Version is read from package metadata (not hardcoded) using `importlib.metadata`

---

### IMP-003: Add release-notes command to CLI

**Status**: Pending

**Problem**: Users have no easy way to view the changelog/release notes from the command line. They must manually find and read the CHANGELOG.md file.

**Files to Investigate**:

- `plugins/agentic-sdlc/CHANGELOG.md` - Existing changelog file with release notes
- `plugins/agentic-sdlc/src/agentic_sdlc/cli.py` - CLI entry point for adding new command
- `plugins/agentic-sdlc/src/agentic_sdlc/commands/__init__.py` - Command exports

**Expected Behavior / Goal**:

Running `agentic-sdlc release-notes` should print the contents of the CHANGELOG.md file, optionally filtered to a specific version.

**Acceptance Criteria**:

- [ ] `agentic-sdlc release-notes` prints the full changelog
- [ ] `agentic-sdlc release-notes --version 0.1.0` prints only that version's notes
- [ ] `agentic-sdlc release-notes --latest` prints only the most recent version's notes
- [ ] Handles missing CHANGELOG.md gracefully with informative message

---

### IMP-004: Add update command to CLI

**Status**: Pending

**Problem**: Users must manually run `uv tool upgrade agentic-sdlc` to update the plugin. A built-in update command would improve UX.

**Files to Investigate**:

- `plugins/agentic-sdlc/src/agentic_sdlc/cli.py` - CLI entry point
- `plugins/agentic-sdlc/pyproject.toml` - Package configuration

**Expected Behavior / Goal**:

Running `agentic-sdlc update` should update the plugin to the latest version using the appropriate package manager (uv preferred, pip as fallback).

**Acceptance Criteria**:

- [ ] `agentic-sdlc update` checks for and installs the latest version
- [ ] Displays current version vs available version before updating
- [ ] `--check` flag to only check for updates without installing
- [ ] Uses `uv tool upgrade` when uv is available, falls back to pip
- [ ] Shows success/failure message with new version number

---

### IMP-005: Auto-discover workflow files

**Status**: Pending

**Problem**: The `agentic-sdlc run` command requires users to specify the full path to a workflow YAML file. There is no auto-discovery of workflow files from standard locations.

**Files to Investigate**:

- `plugins/agentic-sdlc/src/agentic_sdlc/cli.py:38-53` - `run` command accepts workflow path as required argument
- `plugins/agentic-sdlc/src/agentic_sdlc/commands/run.py` - Run command implementation
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/` - Bundled workflow files location

**Expected Behavior / Goal**:

1. Allow running workflows by name: `agentic-sdlc run plan-build-validate`
2. Search for workflows in standard locations:
   - `./agentic/workflows/` (project-local)
   - `~/.config/agentic-sdlc/workflows/` (user-global)
   - Bundled workflows in package (`src/agentic_sdlc/workflows/`)
3. `agentic-sdlc run --list` to show available workflows

**Acceptance Criteria**:

- [ ] `agentic-sdlc run <name>` finds workflow by name without full path
- [ ] Searches project-local, user-global, and bundled workflow directories
- [ ] `agentic-sdlc run --list` shows all discoverable workflows with their locations
- [ ] Full path still works for custom workflow locations
- [ ] Clear error message when workflow name is ambiguous (found in multiple locations)

---

### IMP-006: List command returns no results

**Status**: Pending

**Problem**: The `agentic-sdlc list` command always returns "No workflows found" even when workflows have been run. This appears to be a bug in the implementation.

**Files to Investigate**:

- `plugins/agentic-sdlc/src/agentic_sdlc/commands/status.py:76-101` - `cmd_list()` implementation
- Line 78: Looks for `agentic/workflows/` directory in current working directory
- Lines 84-91: Iterates subdirectories looking for `progress.json` files

**Root Cause Analysis**:

The `cmd_list()` function looks for workflow progress in `agentic/workflows/` but:
1. This directory may not exist if no workflows have been run
2. The progress files may be stored elsewhere (need to verify with `progress.py`)
3. The directory structure assumption may not match actual workflow execution behavior

**Expected Behavior / Goal**:

`agentic-sdlc list` should display all workflows that have been run, with their status, start time, and workflow name.

**Acceptance Criteria**:

- [ ] List command shows workflows that have been previously run
- [ ] Correctly identifies the workflow progress storage location
- [ ] `--status` filter works correctly for running/completed/failed/paused
- [ ] Empty list message is accurate (distinguishes "no workflows dir" from "no matching workflows")

---

### DOC-001: Restructure agentic-sdlc documentation

**Status**: Pending

**Problem**: The agentic-sdlc README.md is a single monolithic file that tries to serve all audiences (beginners, advanced users, contributors). This makes it difficult to navigate and find relevant information quickly. The documentation lacks a clear separation of concerns and progression path.

**Files to Investigate**:

- `plugins/agentic-sdlc/README.md` - Current monolithic documentation file
- `plugins/agentic-sdlc/schemas/workflow.schema.json` - Workflow schema to reference in WorkflowBuilder.md
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/` - Example workflows to reference

**Expected Behavior / Goal**:

Split the documentation into focused files targeting different audiences and use cases:

1. **README.md** - High-level overview and entry point
   - Brief description of what agentic-sdlc does
   - Installation instructions
   - Quick example
   - Links to detailed documentation sections

2. **docs/QuickStart.md** - Get started in 5 minutes
   - Minimal setup steps
   - Run your first workflow
   - Common commands cheat sheet

3. **docs/WorkflowBuilder.md** - Complete workflow authoring guide
   - Workflow YAML structure explained
   - All step types with examples
   - Settings and configuration options
   - Reference to schema and example workflow

4. **docs/Contributing.md** - Developer documentation
   - Building and testing the plugin
   - Code structure overview
   - Pull request guidelines

5. **docs/workflow-example.yaml** - Annotated reference workflow
   - Contains every configurable option
   - Extensive comments explaining each field
   - Serves as both documentation and template

**Acceptance Criteria**:

- [ ] README.md is concise (under 200 lines) with clear links to detailed docs
- [ ] QuickStart.md enables new users to run a workflow in under 5 minutes
- [ ] WorkflowBuilder.md covers all step types, settings, and configuration options
- [ ] Contributing.md documents build, test, and contribution process
- [ ] workflow-example.yaml contains all schema options with explanatory comments
- [ ] Cross-references between documents are consistent and working
