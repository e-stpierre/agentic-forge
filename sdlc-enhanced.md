# SDLC Plugin Split: Interactive & Agentic

## Overview

Split the current SDLC plugin into two specialized plugins:

1. **interactive-sdlc**: New plugin for interactive use within Claude Code sessions with user questions/feedback
2. **agentic-sdlc**: Renamed from current SDLC, fully autonomous workflow orchestrated via Python

---

## Command Namespacing

Both plugins use Claude Code's standard namespace pattern with colon separators, matching the existing marketplace convention.

### Interactive-SDLC Commands

All commands are prefixed with `interactive-sdlc:`:

**Configuration:**

- `/interactive-sdlc:configure` - Set up plugin configuration interactively

**Planning:**

- `/interactive-sdlc:plan-chore` - Plan a maintenance task
- `/interactive-sdlc:plan-bug` - Plan a bug fix with root cause analysis
- `/interactive-sdlc:plan-feature` - Plan a feature with milestones

**Implementation:**

- `/interactive-sdlc:build` - Implement a plan file
- `/interactive-sdlc:validate` - Validate implementation quality

**Workflows:**

- `/interactive-sdlc:one-shot` - Quick task without saved plan
- `/interactive-sdlc:plan-build-validate` - Full workflow from planning to validation

**Documentation:**

- `/interactive-sdlc:document` - Generate or update project documentation with mermaid diagrams

**Analysis:**

- `/interactive-sdlc:analyse-bug` - Analyze codebase for bugs and logic errors
- `/interactive-sdlc:analyse-doc` - Analyze documentation quality and accuracy
- `/interactive-sdlc:analyse-debt` - Identify technical debt and refactoring opportunities
- `/interactive-sdlc:analyse-style` - Check code style, consistency, and best practices
- `/interactive-sdlc:analyse-security` - Scan for security vulnerabilities and unsafe patterns

### Agentic-SDLC Commands

All commands are prefixed with `agentic-sdlc:`:

- `/agentic-sdlc:configure` - Set up plugin configuration
- `/agentic-sdlc:design` - Design technical implementation
- `/agentic-sdlc:plan` - Meta-command for planning (auto-selects type)
- `/agentic-sdlc:plan-feature` - Generate feature plan (JSON I/O)
- `/agentic-sdlc:plan-bug` - Generate bug fix plan (JSON I/O)
- `/agentic-sdlc:plan-chore` - Generate chore plan (JSON I/O)
- `/agentic-sdlc:plan-build` - All-in-one workflow
- `/agentic-sdlc:implement` - Implement from plan (JSON I/O)
- `/agentic-sdlc:implement-from-plan` - Legacy implementation command
- `/agentic-sdlc:review` - Review code changes (JSON I/O)
- `/agentic-sdlc:test` - Run tests and analyze results (JSON I/O)

### Benefits of Namespace Pattern

1. **Clear separation**: No command name conflicts between plugins
2. **Discoverability**: Users type `/interactive-sdlc:` or `/agentic-sdlc:` to see available commands
3. **Self-documenting**: Command name clearly indicates which plugin it belongs to
4. **Consistency**: Matches existing plugins in marketplace (`/core:git-branch`, `/sdlc:plan-feature`)
5. **Python integration**: Scripts reference commands unambiguously (`/agentic-sdlc:plan-feature`)

### **CRITICAL REQUIREMENT: Always Use Full Namespace**

**All command references MUST use the full namespaced form, even when shorthand would work.**

This applies to:

- **Documentation and examples**: Always show `/interactive-sdlc:plan-chore`, never `/plan-chore`
- **Command prompts**: Commands that invoke other commands must use full namespace
- **Python scripts**: Always use `/agentic-sdlc:plan-feature`, never `/plan-feature`
- **Error messages**: Reference commands with full namespace
- **User-facing help text**: Show full namespace form

**Why this matters:**

- Commands work consistently regardless of which plugins are installed
- Users can copy examples from docs and they always work
- No confusion about which plugin a command belongs to
- Scripts are portable across different plugin configurations

**Examples:**

```bash
# ✅ CORRECT - Always use full namespace
/interactive-sdlc:plan-feature User authentication
/agentic-sdlc:plan-feature --json-input spec.json

# ❌ WRONG - Never use shorthand in documentation/scripts
/plan-feature User authentication
```

```python
# ✅ CORRECT - Python scripts always use full namespace
run_claude("/agentic-sdlc:plan-feature", json_input=spec)

# ❌ WRONG - Don't rely on shorthand
run_claude("/plan-feature", json_input=spec)
```

---

## Configuration System

Both plugins use the standard Claude Code configuration via `.claude/settings.json` (project scope, committed to git).

### Configuration Schema

**Complete settings.json schema for both plugins:**

```json
{
  "enabledPlugins": {
    "interactive-sdlc@agentic-forge": true,
    "agentic-sdlc@agentic-forge": true
  },
  "interactive-sdlc": {
    // Plan file storage
    "planDirectory": "/specs",

    // Analysis report storage
    "analysisDirectory": "/analysis",

    // Default explore agent counts per plan type
    "defaultExploreAgents": {
      "chore": 2,
      "bug": 2,
      "feature": 3
    }
  },
  "agentic-sdlc": {
    // Plan file storage (for autonomous workflows)
    "planDirectory": "/specs"
  }
}
```

**Supported Configuration Values:**

| Plugin | Setting | Type | Default | Description |
|--------|---------|------|---------|-------------|
| `interactive-sdlc` | `planDirectory` | string | `"/specs"` | Directory for plan files (.md) |
| `interactive-sdlc` | `analysisDirectory` | string | `"/analysis"` | Directory for analysis reports (.md) |
| `interactive-sdlc` | `defaultExploreAgents.chore` | number (0-5) | `2` | Explore agents for chore planning |
| `interactive-sdlc` | `defaultExploreAgents.bug` | number (0-5) | `2` | Explore agents for bug planning |
| `interactive-sdlc` | `defaultExploreAgents.feature` | number (0-10) | `3` | Explore agents for feature planning |
| `agentic-sdlc` | `planDirectory` | string | `"/specs"` | Directory for plan files (autonomous) |

Personal overrides can be configured in `.claude/settings.local.json` (gitignored):

```json
{
  "interactive-sdlc": {
    "planDirectory": "/my-custom-specs",
    "analysisDirectory": "/my-analysis"
  }
}
```

**Default behavior if not configured:**

- Plan files saved to `/specs` directory at project root
- Analysis reports saved to `/analysis` directory at project root
- Explore agent defaults as specified in schema table
- Settings hierarchy: local overrides project overrides user overrides defaults

---

## General Requirements for Interactive-SDLC Commands

**All interactive-sdlc commands MUST support an optional `[context]` argument as their last parameter.**

### Context Argument Specification

- **Position**: Always the last argument, after all flags and named parameters
- **Format**: Freeform text that can span multiple lines
- **Purpose**: Provides explicit instructions and context to infer command parameters without interactive questions
- **Behavior**:
  - Command reads and analyzes the context
  - Attempts to infer required parameters from context
  - Only asks interactive questions for parameters that cannot be confidently inferred
  - Context takes precedence over interactive questions

### Usage Examples

```bash
# Plan a feature with inline context
/interactive-sdlc:plan-feature Add dark mode support with toggle in settings and persistent user preference

# Plan a bug fix with detailed context
/interactive-sdlc:plan-bug --explore 3 Login fails on Safari when using OAuth.
Users click login button, get redirected to OAuth provider,
but after successful auth they are redirected to a blank page
instead of the dashboard.

# Build with checkpoint and context
/interactive-sdlc:build /specs/feature-auth.md --checkpoint "Milestone 2" Continue from where we left off, focus on the OAuth integration

# One-shot with context
/interactive-sdlc:one-shot --git Fix the typo in the README file, change "authenitcation" to "authentication"

# Validate with autofix and context
/interactive-sdlc:validate --autofix critical,major --plan /specs/bug-login.md Focus on security issues and the login flow validation
```

### Command Implementation Requirements

Each command must:

1. **Parse context**: Extract the `[context]` argument from the end of the command invocation
2. **Analyze context**: Use the context to infer parameters like:
   - Task titles
   - Requirements
   - Descriptions
   - User preferences
   - Specific instructions
3. **Smart prompting**: Only ask for information that cannot be inferred from context
4. **Context integration**: Include context in plan generation and execution decisions
5. **Multi-line support**: Handle context that spans multiple lines properly

### Benefits

- **Faster workflow**: Users can provide all information upfront
- **Better for automation**: Scripts can invoke commands with full context
- **Reduced friction**: No need to wait for interactive prompts
- **Flexibility**: Users choose between interactive mode or context mode

---

## Milestone 1: Create Interactive-SDLC Plugin Structure

**Goal**: Set up the new interactive-sdlc plugin with proper directory structure and metadata.

### Tasks

1. **Create plugin directory structure**
   - Create `plugins/interactive-sdlc/` directory
   - Create `plugins/interactive-sdlc/commands/` directory

2. **Add plugin metadata to marketplace.json**
   - Update `.claude-plugin/marketplace.json` to add interactive-sdlc plugin entry
   - Plugin configuration:
     - name: "interactive-sdlc"
     - version: "1.0.0"
     - source: "./"
     - description: "Interactive SDLC commands for guided development within Claude Code sessions"
     - category: "sdlc"
     - author: name and email
     - license: "MIT"
     - keywords: ["sdlc", "interactive", "planning", "building", "validation", "workflows"]
     - strict: false
     - commands: (will be populated as commands are created)

3. **Create plugin CHANGELOG**
   - Create `plugins/interactive-sdlc/CHANGELOG.md`
   - Include initial release entry (v1.0.0)
   - Brief summary of initial features

4. **Create plugin README**
   - Document plugin purpose and scope
   - List all commands with brief descriptions
   - Document configuration options (.claude/settings.json format)
   - Document command arguments (--git, --pr, --checkpoint, --explore)
   - Include usage examples

---

## Milestone 2: Implement Plan Template System

**Goal**: Create reusable plan templates with placeholder replacement system.

### **CRITICAL: Plan File Principles**

**Plans are static documentation of work to be done:**

1. **Plans are immutable during implementation**
   - Once created, plan files should NOT be modified to track progress
   - Progress tracking happens via TodoWrite tool, not plan file updates
   - Plans can only be updated if user explicitly requests changes to the plan itself

2. **Plans are descriptive, not prescriptive timelines**
   - NO time estimates or deadlines
   - NO completion percentages or status tracking
   - NO "planned start/end dates" or scheduling information
   - Focus on WHAT needs to be done and WHY, not WHEN

3. **Plans contain:**
   - ✅ Technical descriptions and requirements
   - ✅ Architecture and design decisions
   - ✅ Task breakdowns and dependencies
   - ✅ Validation criteria and testing strategies
   - ✅ Implementation guidance and context
   - ❌ Time estimates, schedules, or deadlines
   - ❌ Progress tracking or completion status
   - ❌ Assignment or ownership information

4. **Implementation commands (build) should:**
   - Read plan as reference documentation
   - Create TodoWrite list for progress tracking
   - Mark todos as complete (not plan tasks)
   - Never modify the plan file to show progress

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

     #### Task 1.1: <task-1.1-title>
     <task-1.1-description>Specific tasks for this milestone</task-1.1-description>

     <additional-tasks>Add more tasks as needed</additional-tasks>

     ### Milestone 2: <milestone-2-title>
     <milestone-2-description>What this milestone achieves</milestone-2-description>

     #### Task 2.1: <task-1.1-title>
     <task-2.1-description>Specific tasks for this milestone</task-2.1-description>

     <additional-tasks>Add more tasks as needed</additional-tasks>

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

1. **Create /interactive-sdlc:plan-chore command**
   - File: `plugins/interactive-sdlc/commands/plan-chore.md`
   - Full command name: `/interactive-sdlc:plan-chore`
   - Command behavior:
     - Read `.claude/settings.json` for config (planDirectory, explore agent count)
     - Launch N explore agents (default 2) to understand codebase context
     - If not provided in context, Ask user for chore title and basic requirements, and clarifying questions
     - Generate plan using chore template
     - Save plan to configured directory (default: `/specs/chore-<name>.md`)
     - If `--git` flag: commit the plan file
   - Support arguments:
     - `--explore N`: Override default explore agent count
     - `--git`: Commit plan file after creation
     - `--output <path>`: Override plan file location
     - `[context]`: Optional freeform context for parameter inference

2. **Create /interactive-sdlc:plan-bug command**
   - File: `plugins/interactive-sdlc/commands/plan-bug.md`
   - Full command name: `/interactive-sdlc:plan-bug`
   - Command behavior:
     - Read `.claude/settings.json` for config
     - Launch N explore agents (default 2) to understand bug context
     - If cannot be inferred from context, Ask user for bug description and observed behavior
     - Investigate root cause
     - Generate repro steps
     - Create fix strategy
     - Ask user clarifying questions
     - Generate plan using bug template
     - Save plan to configured directory (default: `/specs/bug-<name>.md`)
     - If `--git` flag: commit the plan file
   - Support arguments:
     - `--explore N`: Override default explore agent count
     - `--git`: Commit plan file after creation
     - `--output <path>`: Override plan file location
     - `[context]`: Optional freeform context for parameter inference

3. **Create /interactive-sdlc:plan-feature command**
   - File: `plugins/interactive-sdlc/commands/plan-feature.md`
   - Full command name: `/interactive-sdlc:plan-feature`
   - Command behavior:
     - Read `.claude/settings.json` for config
     - Launch N explore agents (default 3) to understand codebase architecture
     - Ask user interactive questions about:
       - Feature requirements
       - User experience expectations
       - Technical constraints
       - Integration points
       - Anything else that should be clarified
     - Design architecture and milestones
     - Break down into tasks per milestone
     - Generate plan using feature template
     - Save plan to configured directory (default: `/specs/feature-<name>.md`)
     - If `--git` flag: commit the plan file
   - Support arguments:
     - `--explore N`: Override default explore agent count
     - `--git`: Commit plan file after creation
     - `--output <path>`: Override plan file location
     - `[context]`: Optional freeform context for parameter inference

---

## Milestone 4: Implement Build Command

**Goal**: Create the /interactive-sdlc:build command that implements a plan file.

### Tasks

1. **Create /interactive-sdlc:build command**
   - File: `plugins/interactive-sdlc/commands/build.md`
   - Full command name: `/interactive-sdlc:build`
   - Command behavior:
     - Require plan file path as argument: `/interactive-sdlc:build <plan-file>`
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
     - `[context]`: Optional freeform context for implementation guidance

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

**Goal**: Create the /interactive-sdlc:validate command that verifies implementation quality.

### Tasks

1. **Create /interactive-sdlc:validate command**
   - File: `plugins/interactive-sdlc/commands/validate.md`
   - Full command name: `/interactive-sdlc:validate`
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

     Rate finding in criticality (Critical, major, medium, low)

   - Support arguments:
     - `--plan <plan-file>`: Plan file to verify compliance against
     - `--skip-tests`: Skip test execution
     - `--skip-build`: Skip build verification
     - `--skip-review`: Skip code review
     - `--autofix critical,major`: list of severity level to autofix (optional)
     - `[context]`: Optional freeform context for validation focus

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

1. **Create /interactive-sdlc:one-shot command**
   - File: `plugins/interactive-sdlc/commands/one-shot.md`
   - Full command name: `/interactive-sdlc:one-shot`
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
     - `[context]`: Optional freeform context describing the task

2. **Create /interactive-sdlc:plan-build-validate command**
   - File: `plugins/interactive-sdlc/commands/plan-build-validate.md`
   - Full command name: `/interactive-sdlc:plan-build-validate`
   - Command behavior:
     - Ask user for task type (chore/bug/feature)
     - Execute appropriate plan command using full namespace (e.g., invoke `/interactive-sdlc:plan-feature`)
     - Execute build command on generated plan using full namespace (`/interactive-sdlc:build`)
     - Execute validate command using full namespace (`/interactive-sdlc:validate`)
     - If `--git` flag: commit plan, commit changes during build
     - If `--pr` flag: create draft PR when validation passes
   - Support arguments:
     - `--git`: Auto-commit throughout workflow
     - `--pr`: Create draft PR at end
     - `--explore N`: Override explore agent count for planning phase
     - `[context]`: Optional freeform context for the workflow

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
   - Command reference for all commands **using full namespace form**:
     - `/interactive-sdlc:configure`
     - `/interactive-sdlc:plan-chore`
     - `/interactive-sdlc:plan-bug`
     - `/interactive-sdlc:plan-feature`
     - `/interactive-sdlc:build`
     - `/interactive-sdlc:validate`
     - `/interactive-sdlc:one-shot`
     - `/interactive-sdlc:plan-build-validate`
     - `/interactive-sdlc:document`
     - `/interactive-sdlc:analyse-bug`
     - `/interactive-sdlc:analyse-doc`
     - `/interactive-sdlc:analyse-debt`
     - `/interactive-sdlc:analyse-style`
     - `/interactive-sdlc:analyse-security`
   - Examples for common workflows using full namespace
   - Troubleshooting section

3. **Create example plans**
   - Example chore plan in `plugins/interactive-sdlc/examples/chore-example.md`
   - Example bug plan in `plugins/interactive-sdlc/examples/bug-example.md`
   - Example feature plan in `plugins/interactive-sdlc/examples/feature-example.md`

4. **Update marketplace commands list**
   - Update `.claude-plugin/marketplace.json` interactive-sdlc entry
   - Populate the `commands` array with all created command file paths (namespace is added automatically by Claude Code based on plugin name):
     - `./plugins/interactive-sdlc/commands/configure.md`
     - `./plugins/interactive-sdlc/commands/plan-chore.md`
     - `./plugins/interactive-sdlc/commands/plan-bug.md`
     - `./plugins/interactive-sdlc/commands/plan-feature.md`
     - `./plugins/interactive-sdlc/commands/build.md`
     - `./plugins/interactive-sdlc/commands/validate.md`
     - `./plugins/interactive-sdlc/commands/one-shot.md`
     - `./plugins/interactive-sdlc/commands/plan-build-validate.md`
     - `./plugins/interactive-sdlc/commands/document.md`
     - `./plugins/interactive-sdlc/commands/analyse-bug.md`
     - `./plugins/interactive-sdlc/commands/analyse-doc.md`
     - `./plugins/interactive-sdlc/commands/analyse-debt.md`
     - `./plugins/interactive-sdlc/commands/analyse-style.md`
     - `./plugins/interactive-sdlc/commands/analyse-security.md`
   - Note: File paths in marketplace.json do NOT include namespace prefix; Claude Code adds the namespace automatically

5. **Test interactive-sdlc plugin**
   - Test each planning command (chore/bug/feature)
   - Test build command with various plan types
   - Test validate command
   - Test workflow commands
   - Test all flags (--git, --pr, --checkpoint, --explore)
   - Test configuration system

---

## Milestone 7.5: Add Documentation Command

**Goal**: Create command to generate and update project documentation.

### Tasks

1. **Create /interactive-sdlc:document command**
   - File: `plugins/interactive-sdlc/commands/document.md`
   - Full command name: `/interactive-sdlc:document`
   - Command behavior:
     - Accept user request for documentation to create or update
     - Analyze existing documentation structure
     - Generate or update documentation in markdown format
     - Use mermaid diagrams for visual representations (architecture, flows, sequences)
     - Run `markdownlint-cli2` to format the output after creation/update
     - Save to appropriate location (suggest based on content type)
   - Support arguments:
     - `--output <path>`: Specify output file path
     - `[context]`: Description of what to document
   - Common use cases:
     - API documentation
     - Architecture documentation
     - Feature documentation
     - Setup/installation guides
     - Troubleshooting guides
   - Example usage:

     ```bash
     /interactive-sdlc:document --output docs/api.md Document the REST API endpoints with request/response examples
     /interactive-sdlc:document Create architecture diagram showing the plugin system
     ```

2. **Implement mermaid diagram generation**
   - Generate appropriate diagram types based on context:
     - Architecture diagrams (C4, component diagrams)
     - Sequence diagrams (for flows and interactions)
     - Flowcharts (for decision logic)
     - Class diagrams (for object models)
     - State diagrams (for state machines)
   - Ensure mermaid syntax is valid
   - Include descriptive titles and labels

3. **Implement markdownlint-cli2 formatting**
   - Run `npx markdownlint-cli2 --fix <file>` after document creation/update
   - Handle formatting errors gracefully
   - Report formatting issues to user if auto-fix fails

---

## Milestone 7.6: Add Analysis Commands

**Goal**: Create comprehensive codebase analysis commands for identifying issues across different dimensions.

### Tasks

1. **Create /interactive-sdlc:analyse-bug command**
   - File: `plugins/interactive-sdlc/commands/analyse-bug.md`
   - Full command name: `/interactive-sdlc:analyse-bug`
   - **Focus**: Bugs, logic errors, runtime issues, error handling problems
   - Command behavior:
     - Analyze codebase for potential bugs and issues
     - Categorize findings by criticality (Critical, Major, Medium, Low)
     - Generate report in configured analysis directory (default: `/analysis`)
     - Save as `bug.md` or timestamped filename if specified
     - **CRITICAL**: Only report REAL issues - do not force-find problems
     - If no issues found, report "No issues identified" - this is perfectly acceptable
   - Report template:

     ```md
     # Bug Report

     ## Critical

     ### BUG-001: <Title>

     **Date**: YYYY-MM-DD

     **Location:** file:line or module description

     **Issue:** Clear description of the bug

     **Impact:** What happens because of this bug

     **Fix:** Suggested fix approach

     ---

     ## Major

     [Same format for major issues]

     ## Medium

     [Same format for medium issues]

     ## Low

     [Same format for low issues]
     ```

   - Support arguments:
     - `[context]`: Specific areas or concerns to focus on or directories or files to focus on

2. **Create /interactive-sdlc:analyse-doc command**
   - File: `plugins/interactive-sdlc/commands/analyse-doc.md`
   - Full command name: `/interactive-sdlc:analyse-doc`
   - **Focus**: Documentation quality, accuracy, completeness
   - Command behavior:
     - Analyze documentation for issues:
       - Outdated information
       - Incorrect/misleading content
       - Missing documentation
       - Broken references
       - Inconsistencies between docs and code
     - **CRITICAL**: Only report REAL issues
     - If documentation is good, say so
   - Report template:

     ```md
     # Documentation Issues

     ## Critical Issues (Completely Wrong/Misleading)

     ### DOC-001: <Title>

     **Date**: YYYY-MM-DD

     **Files:** List of affected documentation files

     **Issue:** What is wrong or missing

     **Fix:** How to correct it

     ---

     ## Major Issues (Outdated/Incomplete)

     [Same format]

     ## Minor Issues (Improvements)

     [Same format]
     ```

3. **Create /interactive-sdlc:analyse-debt command**
   - File: `plugins/interactive-sdlc/commands/analyse-debt.md`
   - Full command name: `/interactive-sdlc:analyse-debt`
   - **Focus**: Technical debt, optimization opportunities, refactoring needs
   - Command behavior:
     - Identify technical debt:
       - Code duplication
       - Complex/hard-to-maintain code
       - Outdated patterns
       - Architecture smells
       - Performance bottlenecks
       - Missing abstractions
     - **CRITICAL**: Focus on REAL debt that matters, not nitpicking
   - Report template:

     ```md
     # Tech Debt

     ## Architecture

     ### DEBT-001: <Title>

     **Date**: YYYY-MM-DD

     **Location:** Files or modules affected

     **Issue:** Current problematic pattern

     **Improvement:** Suggested improvement

     **Benefit:** Why this matters

     **Effort:** Low/Medium/High

     ---

     ## Code Quality

     [Same format]

     ## Performance

     [Same format]
     ```

4. **Create /interactive-sdlc:analyse-style command**
   - File: `plugins/interactive-sdlc/commands/analyse-style.md`
   - Full command name: `/interactive-sdlc:analyse-style`
   - **Focus**: Code style, consistency, best practices, pattern adherence
   - Command behavior:
     - Analyze code style and consistency:
       - Naming convention violations
       - Pattern mismatches
       - Inconsistent formatting (if not auto-fixable)
       - Best practice deviations
       - Project convention violations
     - **CRITICAL**: Put emphasis on normalization, there should ideally be a single way of doing anything in the codebase
   - Report template:

     ```md
     # Style & Consistency Issues

     ## Major Inconsistencies

     ### STYLE-001: <Title>

     **Date**: YYYY-MM-DD

     **Location:** Files affected

     **Issue:** Inconsistency or pattern mismatch

     **Standard:** Expected pattern/convention

     **Fix:** How to align with standard

     ---

     ## Minor Issues

     [Same format]
     ```

5. **Create /interactive-sdlc:analyse-security command**
   - File: `plugins/interactive-sdlc/commands/analyse-security.md`
   - Full command name: `/interactive-sdlc:analyse-security`
   - **Focus**: Security vulnerabilities, unsafe practices, dependency issues
   - Command behavior:
     - Analyze for security issues:
       - Common vulnerabilities (OWASP Top 10)
       - Unsafe dependencies
       - Insecure patterns
       - Missing security controls
       - Exposure of sensitive data
     - **CRITICAL**: Only report REAL security issues
     - Complements appsec plugin with lighter-weight analysis
   - Report template:

     ```md
     # Security Analysis

     ## Critical Vulnerabilities

     ### SEC-001: <Title>

     **Date**: YYYY-MM-DD

     **Location:** Code location or dependency

     **Vulnerability:** Type and description

     **Risk:** Potential impact

     **Remediation:** Fix approach

     ---

     ## High Risk

     [Same format]

     ## Medium Risk

     [Same format]

     ## Low Risk

     [Same format]
     ```

6. **Add analysis commands to marketplace**
   - Update marketplace.json with all 5 analysis commands
   - Update README with analysis command documentation

7. **Key principles for ALL analysis commands**
   - **No forced findings**: Only report actual, verifiable issues
   - **Quality over quantity**: Better to report 0 real issues than 10 false positives
   - **Clear criticality**: Use consistent criticality levels across all reports
   - **Actionable**: Every finding should have a clear fix/improvement
   - **Context-aware**: Understand project patterns before flagging as issues
   - **Positive outcomes**: "No issues found" is a SUCCESS, not a failure

---

## Milestone 8: Add Configuration Command

**Goal**: Create interactive /configure commands for both plugins to guide users through setup.

### Tasks

1. **Create /interactive-sdlc:configure command**
   - File: `plugins/interactive-sdlc/commands/configure.md`
   - Full command name: `/interactive-sdlc:configure`
   - Command behavior:
     - Display instructions about required settings in `.claude/settings.json`
     - Read existing `.claude/settings.json` (create if missing)
     - Parse current `interactive-sdlc` settings
     - Validate configuration against expected schema:
       - `planDirectory`: string, valid directory path
       - `analysisDirectory`: string, valid directory path
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
     - "Where should analysis reports be saved?" (current: `/analysis`)
     - "How many explore agents for chore planning?" (current: `2`)
     - "How many explore agents for bug planning?" (current: `2`)
     - "How many explore agents for feature planning?" (current: `3`)

2. **Create /agentic-sdlc:configure command**
   - File: `plugins/agentic-sdlc/commands/configure.md`
   - Full command name: `/agentic-sdlc:configure`
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
   - Add configure commands to both plugin READMEs using full namespace
   - Document that `/interactive-sdlc:configure` and `/agentic-sdlc:configure` are the recommended setup methods
   - Include examples using full namespace form in getting started guides

---

## Milestone 9: Rename SDLC to Agentic-SDLC

**Goal**: Rename the existing SDLC plugin to agentic-sdlc and update metadata.

### Tasks

1. **Rename plugin directory**
   - Rename `plugins/sdlc/` to `plugins/agentic-sdlc/`
   - Update all internal references

2. **Update marketplace metadata**
   - Update `.claude-plugin/marketplace.json`:
     - Remove old "sdlc" entry
     - Add "agentic-sdlc" entry with:
       - name: "agentic-sdlc"
       - version: "2.0.0" (major version bump for breaking changes)
       - source: "./"
       - description: "Fully autonomous SDLC workflow orchestrated via Python, with no user interaction"
       - category: "sdlc"
       - author: name and email
       - license: "MIT"
       - keywords: ["sdlc", "autonomous", "agentic", "python", "orchestration", "ci-cd", "workflows"]
       - strict: false
       - commands: (all existing command paths updated to agentic-sdlc)

3. **Update CHANGELOG**
   - Update `plugins/agentic-sdlc/CHANGELOG.md`
   - Add v2.0.0 entry documenting breaking changes
   - Note plugin rename and new autonomous focus
   - List removed user interaction features

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
   - Ensure all commands use full namespace: `/agentic-sdlc:design`, `/agentic-sdlc:plan-feature`, etc.
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
   - Use full namespace: `/agentic-sdlc:implement`
   - Accept plan via JSON input
   - Output implementation status via JSON
   - Remove all user questions
   - Use autonomous decision-making
   - Report ambiguities in JSON output for orchestrator to handle

4. **Update review command**
   - Use full namespace: `/agentic-sdlc:review`
   - Accept code changes via JSON
   - Output review results in structured JSON
   - Include severity levels, file locations, suggestions

5. **Update test command**
   - Use full namespace: `/agentic-sdlc:test`
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
   - Agent invocation wrapper that ALWAYS uses full namespace for commands
   - JSON schema validation
   - Agent-to-agent communication
   - Error handling and retry logic
   - Example usage:

     ```python
     # ✅ CORRECT - Always use full namespace
     run_claude("/agentic-sdlc:plan-feature", json_input=spec)
     run_claude("/agentic-sdlc:implement", json_input=plan_output)

     # ❌ WRONG - Never use shorthand
     run_claude("/plan-feature", json_input=spec)
     ```

3. **Create workflow commands**
   - `agentic-plan`: Invoke planning agents with JSON input using `/agentic-sdlc:plan-*` commands
   - `agentic-build`: Invoke build agent with plan JSON using `/agentic-sdlc:implement`
   - `agentic-validate`: Invoke validation agent using `/agentic-sdlc:test` and `/agentic-sdlc:review`
   - `agentic-workflow`: Full end-to-end workflow orchestration using full namespace for all commands

4. **Implement agent communication**
   - Parse agent output JSON
   - Validate against schemas
   - Route data between agents
   - Log communication for debugging
   - All command invocations use full namespace form

5. **Add workflow examples**
   - Example Python script showing full workflow with proper namespace usage
   - Example JSON input files
   - Example integration with CI/CD
   - All examples demonstrate full namespace form: `/agentic-sdlc:command`

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
- **Context argument support**: All commands accept optional `[context]` parameter for inline instructions, reducing interactive prompts
- **Standard configuration**: Uses `.claude/settings.json` (project) and `.claude/settings.local.json` (personal) following Claude Code conventions
- **Checkpoint system**: Allows resuming long-running builds
- **Comprehensive validation**: Covers all quality aspects (tests, review, build, compliance)
- **Smart prompting**: Only asks questions when context doesn't provide enough information

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

### Interactive-SDLC Plugin

- [ ] Plugin installed and functional
- [ ] All commands support optional `[context]` argument for inline instructions
- [ ] Context argument properly infers parameters and reduces interactive prompts
- [ ] Plans are static and never modified during implementation
- [ ] Plans contain no time estimates or scheduling information
- [ ] All planning commands work with templates
- [ ] Build command implements plans correctly using TodoWrite for progress tracking
- [ ] Validate command covers all quality checks
- [ ] Workflow commands orchestrate steps properly
- [ ] Document command generates markdown with mermaid diagrams and runs markdownlint-cli2
- [ ] All 5 analysis commands generate proper reports with criticality levels
- [ ] Analysis commands only report real issues (no forced findings)
- [ ] Configuration system works from `.claude/settings.json` with complete schema
- [ ] Configure command validates all settings including analysisDirectory
- [ ] Configuration validation prevents invalid settings
- [ ] All 14 commands use full namespace form consistently

### Agentic-SDLC Plugin

- [ ] Plugin renamed successfully from SDLC
- [ ] All commands refactored for autonomous operation (no user interaction)
- [ ] JSON schemas defined and validated for agent communication
- [ ] Python orchestration tools implemented with uv
- [ ] All Python scripts use full namespace for command invocation

### General

- [ ] Both plugins have comprehensive documentation
- [ ] Migration guide helps users transition from old SDLC plugin
- [ ] Marketplace metadata updated for both plugins
- [ ] All tests pass
