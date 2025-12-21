# SDLC Plugin Split: Interactive & Agentic

## Overview

Split the current SDLC plugin into two specialized plugins:

1. **interactive-sdlc**: New plugin for interactive use within Claude Code sessions with user questions/feedback
2. **agentic-sdlc**: Renamed from current SDLC, fully autonomous workflow orchestrated via Python

## Configuration System

Both plugins use the standard Claude Code configuration via `.claude/settings.json` (project scope, committed to git):

```json
{
  "enabledPlugins": {
    "interactive-sdlc@agentic-forge": true,
    "agentic-sdlc@agentic-forge": true
  },
  "interactive-sdlc": {
    "planDirectory": "/specs",
    "defaultExploreAgents": {
      "chore": 2,
      "bug": 2,
      "feature": 3
    }
  },
  "agentic-sdlc": {
    "planDirectory": "/specs"
  }
}
```

Personal overrides can be configured in `.claude/settings.local.json` (gitignored):

```json
{
  "interactive-sdlc": {
    "planDirectory": "/my-custom-specs"
  }
}
```

**Default behavior if not configured:**

- Plan files saved to `/specs` directory at project root
- Explore agent defaults as specified above
- Settings hierarchy: local overrides project overrides user overrides defaults

---

## Milestone 1: Create Interactive-SDLC Plugin Structure

**Goal**: Set up the new interactive-sdlc plugin with proper directory structure and metadata.

### Tasks

1. **Create plugin directory structure**
   - Create `plugins/interactive-sdlc/` directory
   - Create `plugins/interactive-sdlc/commands/` directory
   - Create `plugins/interactive-sdlc/.claude-plugin/` directory

2. **Create plugin metadata**
   - Create `plugins/interactive-sdlc/.claude-plugin/plugin.json` with:
     - name: "interactive-sdlc"
     - version: "1.0.0"
     - description: "Interactive SDLC commands for guided development within Claude Code sessions"
     - author and license info
     - dependencies: none

3. **Create plugin README**
   - Document plugin purpose and scope
   - List all commands with brief descriptions
   - Document configuration options (.claude/settings.json format)
   - Document command arguments (--git, --pr, --checkpoint, --explore)
   - Include usage examples

---

## Milestone 2: Implement Plan Template System

**Goal**: Create reusable plan templates with placeholder replacement system.

### Tasks

1. **Create plan template for chore**
   - Create template file or embed in command
   - Template structure:

     ```md
     # Chore: <chore-title>

     ## Description
     <description>Brief description of what needs to be done and why</description>

     ## Scope
     <scope>What is included and what is explicitly out of scope</scope>

     ## Tasks
     <tasks>List of specific tasks required to complete this chore, in order</tasks>

     ## Validation Criteria
     <validation>How to verify this chore is complete</validation>
     ```

2. **Create plan template for bug**
   - Template structure:

     ```md
     # Bug Fix: <bug-title>

     ## Description
     <description>Clear explanation of the bug and its impact</description>

     ## Reproduction Steps
     <repro-steps>Step-by-step instructions to reproduce the bug</repro-steps>

     ## Root Cause Analysis
     <root-cause>Technical explanation of why the bug occurs</root-cause>

     ## Fix Strategy
     <fix-strategy>High-level approach to fixing the bug</fix-strategy>

     ## Tasks
     <tasks>Specific tasks to implement the fix</tasks>

     ## Validation
     <validation>How to verify the bug is fixed and won't regress</validation>

     ## Testing
     <testing>Test cases to add or update to prevent regression</testing>
     ```

3. **Create plan template for feature**
   - Template structure:

     ```md
     # Feature: <feature-title>

     ## Overview
     <overview>What this feature does and why it's valuable</overview>

     ## Requirements
     <requirements>Functional and non-functional requirements</requirements>

     ## Architecture
     <architecture>High-level design decisions and patterns to use</architecture>

     ## Milestones

     ### Milestone 1: <milestone-1-title>
     <milestone-1-description>What this milestone achieves</milestone-1-description>

     **Tasks:**
     <milestone-1-tasks>Specific tasks for this milestone</milestone-1-tasks>

     ### Milestone 2: <milestone-2-title>
     <milestone-2-description>What this milestone achieves</milestone-2-description>

     **Tasks:**
     <milestone-2-tasks>Specific tasks for this milestone</milestone-2-tasks>

     <additional-milestones>Add more milestones as needed</additional-milestones>

     ## Testing Strategy
     <testing>How this feature will be tested</testing>

     ## Validation Criteria
     <validation>How to verify the feature is complete and working</validation>
     ```

4. **Create placeholder replacement utility**
   - Function to parse template with `<placeholder>content</placeholder>` format
   - Replace placeholders with generated content
   - Preserve static text in template

---

## Milestone 3: Implement Planning Commands

**Goal**: Create the three core planning commands (plan-chore, plan-bug, plan-feature).

### Tasks

1. **Create /plan-chore command**
   - File: `plugins/interactive-sdlc/commands/plan-chore.md`
   - Command behavior:
     - Read `.claude/settings.json` for config (planDirectory, explore agent count)
     - Launch N explore agents (default 2) to understand codebase context
     - Ask user for chore title and basic requirements
     - Generate plan using chore template
     - Save plan to configured directory (default: `/specs/chore-<name>.md`)
     - If `--git` flag: commit the plan file
   - Support arguments:
     - `--explore N`: Override default explore agent count
     - `--git`: Commit plan file after creation
     - `--output <path>`: Override plan file location

2. **Create /plan-bug command**
   - File: `plugins/interactive-sdlc/commands/plan-bug.md`
   - Command behavior:
     - Read `.claude/settings.json` for config
     - Launch N explore agents (default 2) to understand bug context
     - Ask user for bug description and observed behavior
     - Investigate root cause
     - Generate repro steps
     - Create fix strategy
     - Generate plan using bug template
     - Save plan to configured directory (default: `/specs/bug-<name>.md`)
     - If `--git` flag: commit the plan file
   - Support arguments:
     - `--explore N`: Override default explore agent count
     - `--git`: Commit plan file after creation
     - `--output <path>`: Override plan file location

3. **Create /plan-feature command**
   - File: `plugins/interactive-sdlc/commands/plan-feature.md`
   - Command behavior:
     - Read `.claude/settings.json` for config
     - Launch N explore agents (default 3) to understand codebase architecture
     - Ask user interactive questions about:
       - Feature requirements
       - User experience expectations
       - Technical constraints
       - Integration points
     - Design architecture and milestones
     - Break down into tasks per milestone
     - Generate plan using feature template
     - Save plan to configured directory (default: `/specs/feature-<name>.md`)
     - If `--git` flag: commit the plan file
   - Support arguments:
     - `--explore N`: Override default explore agent count
     - `--git`: Commit plan file after creation
     - `--output <path>`: Override plan file location

---

## Milestone 4: Implement Build Command

**Goal**: Create the /build command that implements a plan file.

### Tasks

1. **Create /build command**
   - File: `plugins/interactive-sdlc/commands/build.md`
   - Command behavior:
     - Require plan file path as argument: `/build <plan-file>`
     - Read and parse plan file
     - Extract tasks/milestones from plan
     - Create todo list from plan structure
     - Implement each task sequentially
     - Mark todos as completed
     - Ask user questions if implementation is ambiguous
     - If `--git` flag: commit changes at logical checkpoints (per milestone for features, per major task for bugs/chores)
     - If `--checkpoint` flag: resume from specified checkpoint
   - Support arguments:
     - `<plan-file>`: Required path to plan file
     - `--git`: Auto-commit changes at checkpoints
     - `--checkpoint "<text>"`: Resume from specific task/milestone

2. **Implement checkpoint system**
   - Parse `--checkpoint` argument to find resume point in plan
   - Skip completed tasks based on checkpoint
   - Mark already-completed todos
   - Resume implementation from checkpoint

3. **Implement git commit strategy**
   - Check if user has git command preferences in CLAUDE.md
   - If user specifies git command format, use that
   - Otherwise, use simple descriptive commit messages
   - Commit frequency:
     - Features: after each milestone completion
     - Bugs: after fix is implemented, after tests added
     - Chores: after major task groups

---

## Milestone 5: Implement Validate Command

**Goal**: Create the /validate command that verifies implementation quality.

### Tasks

1. **Create /validate command**
   - File: `plugins/interactive-sdlc/commands/validate.md`
   - Command behavior performs ALL validation types:

     a. **Run Tests**
     - Detect test framework (pytest, jest, etc.)
     - Execute test suite
     - Report failures with details

     b. **Code Review**
     - Launch code-reviewer agent
     - Check for bugs, security issues, code quality
     - Review against project conventions

     c. **Build Verification**
     - Detect build system (npm, cargo, go, etc.)
     - Run build process
     - Report build errors

     d. **Plan Compliance**
     - If plan file provided, verify all tasks completed
     - Check implementation matches plan requirements
     - Flag any deviations or missing features

   - Support arguments:
     - `--plan <plan-file>`: Plan file to verify compliance against
     - `--skip-tests`: Skip test execution
     - `--skip-build`: Skip build verification
     - `--skip-review`: Skip code review

2. **Implement test detection and execution**
   - Detect package.json (npm test)
   - Detect pytest.ini, pyproject.toml (pytest)
   - Detect Cargo.toml (cargo test)
   - Detect go.mod (go test)
   - Execute and parse results

3. **Implement build detection and execution**
   - Detect package.json (npm run build)
   - Detect Cargo.toml (cargo build)
   - Detect go.mod (go build)
   - Detect Makefile (make)
   - Execute and report results

4. **Implement plan compliance checker**
   - Parse plan file structure
   - Extract requirements and tasks
   - Verify each requirement is implemented
   - Generate compliance report

---

## Milestone 6: Implement Workflow Commands

**Goal**: Create high-level workflow commands that orchestrate planning, building, and validation.

### Tasks

1. **Create /one-shot command**
   - File: `plugins/interactive-sdlc/commands/one-shot.md`
   - Command behavior:
     - Ask user for task type (chore/bug/feature) and basic description
     - Create plan IN-MEMORY (do not save to file)
     - Use 0 explore agents by default (speed priority)
     - Immediately implement the plan
     - Skip validation by default
     - If `--git` flag: commit all changes at end
     - If `--validate` flag: run validation after build
   - Support arguments:
     - `--git`: Auto-commit changes when done
     - `--validate`: Run validation after implementation
     - `--explore N`: Override explore agent count

2. **Create /plan-build-validate command**
   - File: `plugins/interactive-sdlc/commands/plan-build-validate.md`
   - Command behavior:
     - Ask user for task type (chore/bug/feature)
     - Execute appropriate plan command
     - Execute build command on generated plan
     - Execute validate command
     - If `--git` flag: commit plan, commit changes during build
     - If `--pr` flag: create draft PR when validation passes
   - Support arguments:
     - `--git`: Auto-commit throughout workflow
     - `--pr`: Create draft PR at end
     - `--explore N`: Override explore agent count for planning phase

3. **Implement PR creation logic**
   - Check if `--pr` flag is set
   - Verify validation passed
   - Generate PR title from plan title
   - Generate PR body from plan summary
   - Use `gh pr create --draft` to create draft PR
   - Include validation results in PR body

---

## Milestone 7: Configuration & Documentation

**Goal**: Complete the interactive-sdlc plugin with configuration support and comprehensive documentation.

### Tasks

1. **Implement configuration reading**
   - Read `.claude/settings.json` (project scope)
   - Read `.claude/settings.local.json` (personal overrides)
   - Merge with hierarchy: local > project > defaults
   - Extract `interactive-sdlc.*` settings
   - Apply defaults if config not present
   - Handle configuration errors gracefully

2. **Create comprehensive README**
   - Overview of plugin purpose
   - Installation instructions (via plugin marketplace)
   - Configuration guide with `.claude/settings.json` example
   - Explain settings hierarchy (local vs project)
   - Command reference for all commands
   - Examples for common workflows
   - Troubleshooting section

3. **Create example plans**
   - Example chore plan in `plugins/interactive-sdlc/examples/chore-example.md`
   - Example bug plan in `plugins/interactive-sdlc/examples/bug-example.md`
   - Example feature plan in `plugins/interactive-sdlc/examples/feature-example.md`

4. **Update marketplace metadata**
   - Update `.claude-plugin/marketplace.json` to include interactive-sdlc plugin
   - Add proper description, tags, and metadata

5. **Test interactive-sdlc plugin**
   - Test each planning command (chore/bug/feature)
   - Test build command with various plan types
   - Test validate command
   - Test workflow commands
   - Test all flags (--git, --pr, --checkpoint, --explore)
   - Test configuration system

---

## Milestone 8: Add Configuration Command

**Goal**: Create interactive /configure commands for both plugins to guide users through setup.

### Tasks

1. **Create /configure command for interactive-sdlc**
   - File: `plugins/interactive-sdlc/commands/configure.md`
   - Command behavior:
     - Display instructions about required settings in `.claude/settings.json`
     - Read existing `.claude/settings.json` (create if missing)
     - Parse current `interactive-sdlc` settings
     - Validate configuration against expected schema:
       - `planDirectory`: string, valid directory path
       - `defaultExploreAgents.chore`: number, 0-5
       - `defaultExploreAgents.bug`: number, 0-5
       - `defaultExploreAgents.feature`: number, 0-10
     - If config is valid and complete:
       - Display success message
       - Show current configuration
       - Inform user they can edit `.claude/settings.json` directly for changes
       - Exit command
     - If config is missing or invalid:
       - Use AskUserQuestion to gather missing/invalid values
       - Show current values as defaults in questions
       - Validate user inputs
       - Update `.claude/settings.json` with new configuration
       - Preserve other settings in file (only update `interactive-sdlc` section)
       - Confirm successful configuration with summary
   - Example questions:
     - "Where should plan files be saved?" (current: `/specs`)
     - "How many explore agents for chore planning?" (current: `2`)
     - "How many explore agents for bug planning?" (current: `2`)
     - "How many explore agents for feature planning?" (current: `3`)

2. **Create /configure command for agentic-sdlc**
   - File: `plugins/agentic-sdlc/commands/configure.md`
   - Command behavior:
     - Display instructions about required settings in `.claude/settings.json`
     - Read existing `.claude/settings.json` (create if missing)
     - Parse current `agentic-sdlc` settings
     - Validate configuration against expected schema:
       - `planDirectory`: string, valid directory path
     - If config is valid and complete:
       - Display success message
       - Show current configuration
       - Inform user they can edit `.claude/settings.json` directly for changes
       - Exit command
     - If config is missing or invalid:
       - Use AskUserQuestion to gather missing/invalid values
       - Show current values as defaults in questions
       - Validate user inputs
       - Update `.claude/settings.json` with new configuration
       - Preserve other settings in file (only update `agentic-sdlc` section)
       - Confirm successful configuration with summary

3. **Implement configuration validation utilities**
   - Create shared validation logic for both commands
   - Path validation (directory exists or can be created)
   - Numeric range validation
   - JSON schema validation
   - Helper to merge new config with existing settings.json

4. **Handle edge cases**
   - `.claude/settings.json` doesn't exist (create with proper structure)
   - File exists but is invalid JSON (backup and recreate)
   - File exists but missing `interactive-sdlc` or `agentic-sdlc` section (add section)
   - User provides invalid input (re-prompt with error message)
   - File permissions issues (inform user of manual steps)

5. **Update documentation**
   - Add `/configure` to command list in both plugin READMEs
   - Document that `/configure` is the recommended way to set up plugins
   - Include examples of running `/configure` in getting started guides

---

## Milestone 9: Rename SDLC to Agentic-SDLC

**Goal**: Rename the existing SDLC plugin to agentic-sdlc and update metadata.

### Tasks

1. **Rename plugin directory**
   - Rename `plugins/sdlc/` to `plugins/agentic-sdlc/`
   - Update all internal references

2. **Update plugin metadata**
   - Update `plugins/agentic-sdlc/.claude-plugin/plugin.json`:
     - name: "agentic-sdlc"
     - description: "Fully autonomous SDLC workflow orchestrated via Python, with no user interaction"
     - version: "2.0.0" (major version bump for breaking changes)

3. **Update marketplace metadata**
   - Update `.claude-plugin/marketplace.json`:
     - Remove old "sdlc" entry
     - Add "agentic-sdlc" entry with proper metadata

4. **Update documentation**
   - Update `plugins/agentic-sdlc/README.md` to reflect new purpose
   - Document that this plugin is for autonomous workflows only
   - Add migration guide for users of old SDLC plugin

---

## Milestone 10: Refactor Commands for Agentic Workflow

**Goal**: Update all commands in agentic-sdlc to be fully autonomous with no user interaction.

### Tasks

1. **Define JSON schema for agent communication**
   - Create schemas for:
     - Plan input/output
     - Build input/output
     - Validation input/output
     - Agent-to-agent messages
   - Document schema in `plugins/agentic-sdlc/schemas/`

2. **Update plan commands (design, plan-feature, plan-bug, plan-chore)**
   - Remove all user interaction (AskUserQuestion calls)
   - Accept all inputs via JSON
   - Output plans in standardized JSON format
   - Include structured plan data AND markdown plan file
   - Example input JSON:

     ```json
     {
       "type": "feature",
       "title": "User authentication",
       "requirements": ["OAuth support", "JWT tokens"],
       "explore_agents": 3
     }
     ```

   - Example output JSON:

     ```json
     {
       "plan_file": "/path/to/plan.md",
       "plan_data": {
         "milestones": [...],
         "tasks": [...]
       }
     }
     ```

3. **Update implement command**
   - Accept plan via JSON input
   - Output implementation status via JSON
   - Remove all user questions
   - Use autonomous decision-making
   - Report ambiguities in JSON output for orchestrator to handle

4. **Update review command**
   - Accept code changes via JSON
   - Output review results in structured JSON
   - Include severity levels, file locations, suggestions

5. **Update test command**
   - Accept test configuration via JSON
   - Output test results in structured JSON
   - Include pass/fail status, coverage data, error details

---

## Milestone 11: Create Python Workflow Orchestration

**Goal**: Create Python CLI tools for orchestrating agentic-sdlc workflows.

### Tasks

1. **Create Python package structure**
   - Create `plugins/agentic-sdlc/src/agentic_sdlc/` package
   - Create `plugins/agentic-sdlc/pyproject.toml` with uv configuration
   - Add CLI entry points

2. **Implement orchestration utilities**
   - Create `plugins/agentic-sdlc/src/agentic_sdlc/orchestrator.py`
   - Agent invocation wrapper
   - JSON schema validation
   - Agent-to-agent communication
   - Error handling and retry logic

3. **Create workflow commands**
   - `agentic-plan`: Invoke planning agents with JSON input
   - `agentic-build`: Invoke build agent with plan JSON
   - `agentic-validate`: Invoke validation agent with build output
   - `agentic-workflow`: Full end-to-end workflow orchestration

4. **Implement agent communication**
   - Parse agent output JSON
   - Validate against schemas
   - Route data between agents
   - Log communication for debugging

5. **Add workflow examples**
   - Example Python script showing full workflow
   - Example JSON input files
   - Example integration with CI/CD

---

## Milestone 12: Final Testing & Documentation

**Goal**: Complete the project with comprehensive testing and documentation.

### Tasks

1. **Test agentic-sdlc plugin**
   - Test all commands with JSON input/output
   - Test Python orchestration scripts
   - Test agent-to-agent communication
   - Test error handling
   - Test schema validation

2. **Update root README**
   - Document both plugins (interactive-sdlc and agentic-sdlc)
   - Explain differences and use cases
   - Add installation instructions for both
   - Add examples for both workflows

3. **Create migration guide**
   - Document how to migrate from old SDLC plugin
   - Explain breaking changes
   - Provide equivalent commands in new structure

4. **Update CHANGELOG**
   - Document plugin split
   - List new features in interactive-sdlc
   - List changes in agentic-sdlc
   - Note breaking changes

5. **Final validation**
   - Run both plugins end-to-end
   - Verify marketplace installation works
   - Verify configuration system works
   - Verify all documentation is accurate

---

## Key Design Decisions

### Interactive-SDLC

- **Slash commands**: Easier for users to discover and use
- **Standard configuration**: Uses `.claude/settings.json` (project) and `.claude/settings.local.json` (personal) following Claude Code conventions
- **Checkpoint system**: Allows resuming long-running builds
- **Comprehensive validation**: Covers all quality aspects (tests, review, build, compliance)

### Agentic-SDLC

- **JSON communication**: Structured, parseable agent interaction
- **Python orchestration**: Professional workflow automation with uv
- **No user interaction**: Fully autonomous for CI/CD integration
- **Schema validation**: Ensures reliable agent communication

### Shared Principles

- **Modularity**: Each command does one thing well
- **Composability**: Commands can be combined in workflows
- **Flexibility**: Configuration allows customization without code changes
- **Documentation**: Clear usage instructions and examples

---

## Success Criteria

- [ ] Interactive-sdlc plugin installed and functional
- [ ] All planning commands work with templates
- [ ] Build command implements plans correctly
- [ ] Validate command covers all quality checks
- [ ] Workflow commands orchestrate steps properly
- [ ] Configuration system works from `.claude/settings.json`
- [ ] `/configure` commands guide users through setup interactively
- [ ] Configuration validation prevents invalid settings
- [ ] Agentic-sdlc plugin renamed successfully
- [ ] All commands refactored for autonomous operation
- [ ] JSON schemas defined and validated
- [ ] Python orchestration tools implemented
- [ ] Both plugins have comprehensive documentation
- [ ] Migration guide helps users transition
- [ ] All tests pass
