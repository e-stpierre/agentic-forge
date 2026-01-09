# Agentic Workflows

## Goal

The agentic workflows goal is to enable Claude Code to execute any type of task with a high success rate. The framework allows Claude Code to work fully independently, with resiliency and accuracy, in a multi-session workflow.

## Guiding Principles

- Composed of highly flexible building blocks
- YAML workflows are the top level entity in the framework, they support arguments:
  - autofix: severity level for automatic fixes (none, minor, major, critical)
  - max-retry: maximum retries for a single step, after which the workflow is stopped
  - timeout-minutes: maximum timeout, the workflow stops if it reaches this time without completing (can also be configured at the step level)
  - track-progress: if enabled, the Claude sessions will be instructed to track progress in the workflow progress document
- Able to complete short and long-running tasks
- Mainly used for software development tasks, but must not be limited to this
- Support any task size: chore, bug, task, story, epic
- Support retry on error and for requested loops to improve result quality
- The workflow must be able to work in every scenario where agents can be used:
  - feature development
  - code analysis
  - code improvement
  - bug fixes
  - brainstorming
  - technical analysis
  - financial analysis
  - pentesting, security analysis
  - QA
  - Product management
- Workflows are YAML files that consist of one or more steps
- Steps can be executed in series, in parallel, and support conditional execution
- Steps are always dependent on previous steps, except for parallel blocks
- Workflows must support additional custom steps and commands that can be written by the user and not be part of the core package
- Support an integrated checkpoint system to support stopping and continuing the workflow (on-demand via skill invocation)
- Support full logging options, configurable by the user for specific levels (information, warning, error, critical). Every Claude session that runs must be able to add logs to this system (a .md file per workflow execution)
- Support a global JSON configuration schema and a Claude /configure command that will guide the user in the creation of this configuration. The configuration is used by many steps in the framework: log levels, git main branch name (main, master, etc.), always use git, always create PRs, maximum retry count for failing steps, framework documents outputs location
- Each workflow step starts a new Claude Code session (no session resume to keep implementation simple)
- Support fully automated git workflows and GitHub interactions (issues, PR, etc.)
- Support git worktree, that can be configured per step or globally for the workflow
- Support permissions management, per step or for the whole workflow. If bypass-permission is configured, Claude will run with the --dangerously-skip-permissions flag
- Use Jinja2 for template resolution (YAML and output templates)
- Have a base output folder configured (/agentic) in the current directory. Every document produced by the framework will be added there
- Have a basic self-learning and self-improving process. When a Claude instance faces an error, fails at a task, discovers something unexpected, or anything else similar, it should create a .md document in the /memory directory to note this. Eventually, these findings can be used to automatically update CLAUDE.md, create Skills, etc.
- Include a CLAUDE.example.md file that provides sections a user can include in their CLAUDE.md to enhance the utility provided by the framework, for example sections about how and when to create Memory, how and when to create checkpoints, etc.
- IMPORTANT: only add comments in the code of this plugin when necessary to identify something unusual. Do not use comments for normal code paths

## Workflow Execution Lifecycle

### Workflow States

```
pending ──start──> running ──complete──> completed
                      │
                      ├──fail──> failed
                      │
                      ├──pause──> paused ──resume──> running
                      │
                      └──cancel──> cancelled
```

### Step States

```
pending ──start──> running ──complete──> completed
                      │
                      ├──fail──> failed ──retry──> running (if retries left)
                      │              └──abort──> aborted (if max retries reached)
                      │
                      └──skip──> skipped
```

## Error Types

The framework categorizes errors to enable appropriate handling:

| Error Type | Description | Action |
|------------|-------------|--------|
| **Transient** | Network timeout, rate limit, temporary failures | Retry with same prompt, new session |
| **Recoverable** | Test failure, validation error, fixable issues | Fix and retry |
| **Fatal** | Invalid workflow definition, missing dependencies | Abort workflow |
| **Blocking** | Human input required, ambiguous decision | Pause workflow |

When max-retry is reached for a step, the error is promoted to fatal and the workflow stops.

## Workflow YAML Schema

```yaml
# Workflow Schema v1.0
name: string                      # Workflow identifier
version: string                   # Schema version (e.g., "1.0")
description: string               # Human-readable description

settings:
  max-retry: number               # Default: 3, retries per step
  timeout-minutes: number         # Default: 60, workflow timeout
  track-progress: boolean         # Default: true
  autofix: string                 # "none" | "minor" | "major" | "critical"
  git:
    enabled: boolean              # Enable git operations
    worktree: boolean             # Use git worktrees for parallel
    auto-commit: boolean          # Commit after milestones
    auto-pr: boolean              # Create PR on completion
    branch-prefix: string         # e.g., "feature/"
  bypass-permissions: boolean     # Run with --dangerously-skip-permissions

variables:                        # Input variables
  - name: string
    type: string | number | boolean
    required: boolean
    default: any
    description: string

steps:
  - name: string                  # Step identifier (required)
    type: prompt | command | parallel | conditional | recurring

    # For type: prompt
    prompt: string                # Jinja2 template with {{ variables }}
    agent: string                 # Optional agent file path

    # For type: command
    command: string               # Command to execute (e.g., "plan", "build")
    args: object                  # Command arguments as key-value pairs

    # For type: parallel
    steps: []                     # Nested steps to run in parallel (use worktrees)
    merge-strategy: string        # How to combine results: "wait-all" | "first-success"

    # For type: conditional
    condition: string             # Jinja2 expression evaluated by orchestrator
    then: []                      # Steps if condition is true
    else: []                      # Steps if condition is false (optional)

    # For type: recurring (Ralph-Wiggum pattern)
    max-iterations: number        # Maximum loop iterations
    until: string                 # Jinja2 expression for completion
    steps: []                     # Steps to repeat

    # Common options (all step types)
    timeout-minutes: number       # Override workflow timeout
    max-retry: number             # Override workflow max-retry
    on-error: retry | skip | fail # Error handling strategy
    checkpoint: boolean           # Create checkpoint after this step

outputs:
  - name: string                  # Output identifier
    template: string              # Template file path (Jinja2)
    path: string                  # Output file path
```

### Step Dependency

Steps are executed sequentially and each step can access outputs from all previous steps via the `{{ outputs.step_name }}` variable. The Python orchestrator stores step outputs and provides them to subsequent steps.

For parallel blocks, all nested steps execute concurrently in separate git worktrees. The parallel block completes when all nested steps complete (or based on merge-strategy).

### Conditional Execution

The `condition` key at the step level is a Jinja2 expression evaluated by the Claude Orchestrator. Examples:

```yaml
- name: fix-issues
  type: command
  condition: "{{ outputs.validate.issues_count > 0 }}"
  command: fix
  args:
    severity: major
```

## Output Directory Structure

All framework outputs are stored under the `/agentic` base directory:

```
/agentic/
├── config.json                   # Global plugin configuration
├── workflows/                    # Workflow executions
│   └── {workflow-id}/            # One directory per execution
│       ├── progress.json         # Workflow progress (machine-readable)
│       ├── checkpoint.md         # Checkpoints (on-demand)
│       ├── logs.md               # Workflow logs
│       └── plan.md               # Generated plan (if applicable)
├── memory/                       # Persistent memories (shared across workflows)
│   ├── pattern-auth-middleware.md
│   ├── lesson-rate-limiting.md
│   └── error-timeout-handling.md
└── analysis/                     # Analysis outputs
    ├── bug.md
    ├── debt.md
    ├── doc.md
    ├── security.md
    └── style.md
```

## Python Package Structure

```
experimental-plugins/agentic-workflows/
├── pyproject.toml                # Python 3.10+, uv tool installable
├── CLAUDE.example.md             # Example CLAUDE.md sections for users
├── workflows/                    # Built-in workflow definitions
│   ├── analyse-codebase.yaml
│   ├── one-shot.yaml
│   └── plan-build-validate.yaml
├── templates/                    # Output templates (Jinja2)
│   ├── progress.json.j2
│   ├── checkpoint.md.j2
│   ├── memory.md.j2
│   ├── plan-feature.md.j2
│   ├── plan-bug.md.j2
│   ├── plan-chore.md.j2
│   └── analysis/
│       ├── bug.md.j2
│       ├── debt.md.j2
│       ├── doc.md.j2
│       ├── security.md.j2
│       └── style.md.j2
├── commands/                     # Claude commands (markdown prompts)
│   ├── orchestrate.md            # Evaluate state, return next action
│   ├── plan.md
│   ├── build.md
│   ├── validate.md
│   ├── analyse.md
│   └── git/
│       ├── branch.md
│       ├── commit.md
│       ├── pr.md
│       └── worktree.md
├── agents/                       # Agent definitions (markdown with frontmatter)
│   ├── orchestrator.md
│   ├── explorer.md
│   ├── reviewer.md
│   ├── fixer.md
│   └── documenter.md
├── skills/                       # Skills for Claude sessions
│   ├── create-memory.md
│   ├── create-checkpoint.md
│   └── create-log.md
├── schemas/                      # JSON schemas for validation
│   ├── workflow.schema.json
│   ├── config.schema.json
│   └── progress.schema.json
└── src/agentic_workflows/        # Python source code
    ├── __init__.py
    ├── cli.py                    # Entry point: agentic-workflow
    ├── runner.py                 # Claude session execution
    ├── orchestrator.py           # Async workflow orchestration
    ├── parser.py                 # YAML workflow parsing
    ├── executor.py               # Step execution engine
    ├── memory/
    │   ├── __init__.py
    │   ├── manager.py            # Memory CRUD operations
    │   └── search.py             # Frontmatter keyword search
    ├── checkpoints/
    │   ├── __init__.py
    │   └── manager.py            # Checkpoint read/write
    ├── logging/
    │   ├── __init__.py
    │   └── logger.py             # NDJSON structured logging
    ├── git/
    │   ├── __init__.py
    │   └── worktree.py           # Git worktree management
    └── templates/
        ├── __init__.py
        └── renderer.py           # Jinja2 template rendering
```

### CLI Entry Point

Single CLI command installed via `uv tool install`:

```bash
# Workflow execution
agentic-workflow run <workflow.yaml> [--var key=value]... [--from-step step]
agentic-workflow resume <workflow-id>
agentic-workflow status <workflow-id>
agentic-workflow cancel <workflow-id>
agentic-workflow list [--status running|completed|failed]

# One-shot convenience
agentic-workflow one-shot "<prompt>" [--git] [--pr]
agentic-workflow analyse [--type bug|debt|doc|security|style] [--autofix level]

# Configuration
agentic-workflow configure
agentic-workflow config get <key>
agentic-workflow config set <key> <value>

# Memory management
agentic-workflow memory list [--category pattern|lesson|error]
agentic-workflow memory search "<query>"
agentic-workflow memory prune [--older-than 30d]

# Checkpoint management
agentic-workflow checkpoint list <workflow-id>
agentic-workflow checkpoint restore <checkpoint-id>
```

## Configuration Schema

Global configuration stored in `/agentic/config.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "outputDirectory": "/agentic",
  "logging": {
    "level": "info",
    "format": "text"
  },
  "git": {
    "mainBranch": "main",
    "autoCommit": false,
    "autoPr": false
  },
  "memory": {
    "directory": "/agentic/memory",
    "template": "default"
  },
  "checkpoint": {
    "directory": "/agentic/workflows"
  },
  "defaults": {
    "maxRetry": 3,
    "timeoutMinutes": 60,
    "trackProgress": true
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `outputDirectory` | string | `/agentic` | Base directory for all outputs |
| `logging.level` | enum | `info` | critical, error, warning, info, debug |
| `logging.format` | enum | `text` | text or json |
| `git.mainBranch` | string | `main` | Default branch name |
| `git.autoCommit` | boolean | `false` | Auto-commit after milestones |
| `git.autoPr` | boolean | `false` | Auto-create PR on completion |
| `memory.directory` | string | `/agentic/memory` | Memory storage location |
| `memory.template` | string | `default` | Default memory template |
| `defaults.maxRetry` | number | `3` | Default max retries per step |
| `defaults.timeoutMinutes` | number | `60` | Default workflow timeout |

## Memory Document Format

Memories are markdown files with YAML frontmatter for searchability:

```markdown
---
id: mem-2024-01-15-auth-pattern
created: 2024-01-15T10:30:00Z
category: pattern
tags: [authentication, middleware, typescript]
source:
  workflow: plan-build-validate
  step: implement
relevance: high
---

# Authentication Middleware Pattern

## Context

When implementing authentication in this codebase, discovered that the project uses a custom middleware chain pattern rather than the standard Express middleware.

## Learning

The project uses a custom middleware chain pattern located in `src/middleware/chain.ts`. All auth-related middleware should:
1. Extend the `BaseMiddleware` class
2. Implement the `handle()` method
3. Call `this.next()` to continue the chain

## Application

Use this pattern when:
- Adding new authentication providers
- Implementing authorization checks
- Creating rate limiting middleware

## Code Example

```typescript
export class AuthMiddleware extends BaseMiddleware {
  async handle(ctx: Context): Promise<void> {
    const token = ctx.headers.authorization;
    if (!token) {
      throw new UnauthorizedError();
    }
    ctx.user = await this.validateToken(token);
    await this.next(ctx);
  }
}
```
```

### Memory Categories

| Category | When to Use |
|----------|-------------|
| `pattern` | Discovered code patterns, conventions, architectures |
| `lesson` | General learnings about the project or domain |
| `error` | Errors encountered and their solutions |
| `decision` | Decisions made during implementation with rationale |
| `context` | Project-specific context (dependencies, configurations) |

### Memory Search

Memory search uses simple keyword matching in frontmatter fields:
- Search by `category` (exact match)
- Search by `tags` (any tag matches)
- Search by content keywords (full-text search in title/content)

File glob patterns can also be used to find memories by naming convention.

## Self-Learning Process

### When to Create Memory

Claude sessions should create memory when they:
1. Discover an unexpected pattern in the codebase
2. Find a workaround for a framework limitation
3. Encounter an error and find the solution
4. Learn something about the project's conventions
5. Make an assumption that worked (or didn't)

### Memory Creation Flow

1. At the end of each step, the orchestrator evaluates if learnings should be captured
2. If yes, invoke the `/create-memory` skill with:
   - Category: pattern | lesson | error | decision | context
   - Tags: relevant keywords for searchability
   - Content: what was learned
   - Application: when this knowledge applies
3. The skill validates the memory is not duplicated and is pertinent
4. Memory is saved with proper frontmatter

### Memory Application

Before starting each step, the runner:
1. Searches memory for relevant entries (by step name, workflow type, tags)
2. Includes top 2-3 most relevant memories in the step's context
3. Memories are appended to the prompt context

### Memory Lifecycle

Memories are **permanent** and accumulate over time. The goal is to increase the success rate of Claude's work in the repository. Developers can periodically review the `/agentic/memory` directory to:
- Clean up outdated or incorrect memories
- Consolidate related memories
- Graduate high-value memories into CLAUDE.md updates or Skills

## Building Blocks

### Python Scripts

The following python scripts are what I envision as the base scripts to build, that are used in the core of the framework (use by steps scripts) or that are used directly by a step in a workflow.

#### Runner

Base scripts to run Claude Code in a programatic way

Can be build similar to:
experimental-plugins\agentic-core\src\agentic_core\runner.py
experimental-plugins\core\src\claude_core\runner.py

#### Orchestrator

Run Claude instances in parallel

Can be inspired from:
experimental-plugins\agentic-sdlc\src\claude_sdlc\orchestrator.py
experimental-plugins\core\src\claude_core\orchestrator.py

#### Memory

Use to create the memory about a specific topics that can be re-used later. Use clear fontmatter to help navigate and search in these .md files for a specific topic.
They are always stored as .md files

Can be inspired from
experimental-plugins\agentic-core\src\agentic_core\memory

#### Workflows

Scripts responsible of parsing and running the workflows

Can be strongly inspired from:
experimental-plugins\agentic-core\src\agentic_core\workflow

### Agents

Workflow steps can be assigned to an agent. The plugin offers base agents, but a user can install and refer his own agents when creating new yaml workflows. Here's the list

### Commands

The following commands are commands that can be explicitely calls in workflows. Additional commands, that don't come front this plugin, can also be used, if a user refer the command in a workflow step. So the commands listed here are really just the basics of the plugin, and the offering can be extended. Commands will always be executed in an agentic workflows, without interactions with the developer, it's important that they proceed to completion and that they have clear and fix arguments and output structure (json).

#### Plan

Base on the type of task or requested template, create a plan that will be used to accomplished the requested task

#### Build

plugins\interactive-sdlc\commands\dev\build.md

#### Validate

plugins\interactive-sdlc\commands\dev\validate.md

#### Analyse

Same commands and interactive sdlc analyse commands, oriented for agentic use case, with fixed json output. The commands support a template argument as input, that is the template file to use, otherwise they fallback to the default, if a template is provided in the workflow step, it's passed to the command argument.

plugins\interactive-sdlc\commands\analyse

#### Git

Same commands and interactive sdlc git commands, oriented for agentic use case, with fixed json output.

plugins\interactive-sdlc\commands\git

#### GitHub

Same commands and interactive sdlc github commands, oriented for agentic use case, with fixed json output.

plugins\interactive-sdlc\commands\github

### Skills

Skills are the same as commands in this framework, the skills offered in this plugin are a good basis, claude session invoked by the workflow should be able to use them, but they can be extended by any skill installed by the user.

#### Create Memory

Skill use to create memory, refers to the plugin json configuration for:

- directory to persist memory in
- memory template to use

Have configured default if these are not provided.
Ask Claude to double check if the memory he's about to create is not duplicated and is pertinent.
Put emphasis on creating a clear frontmatter for the memory, that respect the required properties defined in the templated used.

#### Create Checkpoint

Checkpoints are scoped per workflow, the checkpoint file name must contain the workflow execution name
Skill used to create a checkpoint, refers to the plugin json configuration for:

- directory to persist checkpoint in
- memory template to use

#### Create Log

If an event occured that matches the configured log level, add it to the workflow's log file.

Critical: Critical error, for example max retried fail causing the workflow to stop
Error: Any error
Warning: Unexpected issue that happened
Information: Regular logging during the progression

### Outputs

Other than expected framework outputs (modifying code, editing documents, etc.), workflow steps can be requested to create an output using a template. Same as other building blocks, the plugin will offer core output templates, but the user can use their own templates. Output templates must respect the following rules:

Templates use **Jinja2 syntax** with the following format:

```markdown
## {{ section_title }}

{{ content }}

{# Instructions:
- Replace {{ content }} with the actual content
- Additional guidance for this section
- Suggested elements (include others as needed):
  - Element 1
  - Element 2
#}
```

**Key principles:**

- Use `{{ variable_name }}` for all placeholders (Jinja2 syntax)
- Use `{# comment #}` for template instructions
- Use `{% if condition %}...{% endif %}` for conditional content
- Use `{% for item in items %}...{% endfor %}` for loops
- Mark suggested elements as "include others as needed" to allow flexibility

Here are the base outputs that will be included in the plugin.

#### Workflow Progress

Generated at the start of the workflow if the track-progress argument is enabled. This is a **JSON document** (progress.json) that serves as the main document used to orchestrate long-running workflows. The format is machine-optimized but human-readable:

```json
{
  "workflow_id": "uuid",
  "workflow_name": "plan-build-validate",
  "status": "running",
  "started_at": "2024-01-15T10:30:00Z",
  "current_step": "build",
  "completed_steps": [
    {
      "name": "plan",
      "status": "completed",
      "started_at": "...",
      "completed_at": "...",
      "output_summary": "Created plan with 3 milestones"
    }
  ],
  "parallel_branches": [
    {
      "branch_id": "analyse-bug",
      "status": "running",
      "worktree_path": "/.worktrees/analyse-bug"
    }
  ],
  "errors": [],
  "variables": {}
}
```

Sessions note their progress in this document. The orchestrator selects which step to trigger next based on the workflow progress. This document is also how the orchestrator knows if an error must cause the workflow to stop (e.g., a session reached max retry) or if the workflow is completed.

#### Checkpoint

A single **markdown document** per workflow (checkpoint.md) used to store checkpoints on-demand. Contains information about current progress, issues discovered, and data that should be communicated to another Claude session. The checkpoint acts as a notebook for sessions and enables basic communication between them.

Checkpoints are created on-demand via skill invocation or when explicitly specified in a prompt. Each checkpoint entry must clearly identify:
- The step from which the checkpoint was created
- The datetime of creation
- Any context or data to pass to future sessions

```markdown
## Checkpoint: build @ 2024-01-15T14:30:00Z

### Context
Completed Milestone 1 and 2 of the implementation plan.

### Progress
- [x] Task 1.1: Setup OAuth configuration
- [x] Task 1.2: Add dependencies
- [x] Task 2.1: Create auth middleware
- [ ] Task 2.2: Add route protection (in progress)

### Notes for Next Session
The auth middleware uses the existing ErrorBoundary pattern.
See src/middleware/auth.ts for the implementation.

### Issues Discovered
Rate limiting may need to be added - not in original plan.

---
```

#### Plans

Exact same plan as the interactive-sdlc plugin (only the plan section of the command)

plugins\interactive-sdlc\commands\plan

#### Analysis

Exact same template as the interactive-sdlc analyse commands templates

plugins\interactive-sdlc\commands\analyse

### Workflow Steps

The workflow steps are the blocks that can be defined in a .yaml workflow file.

#### Run Claude with a prompt

The most basic step, it simply is configured with a prompt, and this prompt is passed to a Claude Session.

#### Execute a command with Claude

Request Claude to execute a specific command, with provided arguments

#### Parallel step

Execute the nested steps in parallel

#### Conditional step

Execute the step nested in it only if the condition is met

#### Recurring step

Execute this step(s) embedded a specific amount of time, to increase success rate

### Workflows

Workflows are yaml files that re-use building blocks to create full set of automation, that will be executed by one or multiple sessions of Claude Code. The plugin will offers base workflows, but the main goal of this framework is to allow a user to create and customize it's own workflows. Here's a list of examples workflows that should be included in the plugin.

#### Analyse Codebase

Supported arguments:

- autofix "level" => --autofix "Major" => This will make the workflow trigger another claude session after each analyse command complete, to create a git branch, fix every issues at or above the selected level (major and critical in this case), commit and push the changes and open a PR.

Run in parallel all 5 analyse commands (bug, debt, doc, security, style), with one claude session per analyse command. One list of improvement is generated for each commands.

When autofix is enabled, the workflow is composed of 5 branches, that each have two steps (analyse + fix). The branches run in parallel, each in a dedicated git worktree to avoid conflict.

#### One Shot

A single step and session, use to complete a specific task, is a git worktree, from start to finish. Analyse the prompt request and code, create a git branch, make the changes, commit and push the code, create a PR

#### Plan Build Validate

Multiple steps, one Claude session per step:

- The python orchestrator uses the Claude orchestrator command to create the progress document initially. Then, the python orchestrator loops, using the Claude orchestrator command to know which step to execute next.
- Plan using the plan command and appropriate plan type.
- Build: create a branch, implement the changes following the plan, commit the changes after every milestones. If the session implementing the changes reaches 80% of it's context limit, it updates the workflow progress document, optionaly create a checkpoint for anything additional that must be saved, and end.
- Validate the changes based on the plan and diff in the current branch
- Fix issues identified by the validation (default major+, configurable with argument)
- Create a PR

## Open Questions

The following questions need to be validated or clarified during implementation:

### Context Window Management

The document mentions "80% context limit" for build steps in Plan Build Validate workflow. This requires clarification:

1. **How does a session know its context usage?**
   - Possible approaches:
     - Claude Code may provide token count in output
     - Estimate based on conversation length
     - Use a fixed turn limit as proxy
     - Rely on Claude to self-report when approaching limits

2. **What triggers the handoff?**
   - Session self-reports "approaching context limit"
   - Python orchestrator tracks approximate tokens
   - Fixed number of operations before forced handoff

3. **How is context summarized for the next session?**
   - Create a checkpoint with summary
   - Use `/summarize-session` command before ending
   - Pass last N messages plus summary to next session

**Suggested approach**: Have the orchestrator command include a flag indicating if the session should prepare for handoff. The session then creates a checkpoint with:
- Current progress summary
- Remaining tasks
- Important context to preserve
- Any issues or blockers discovered

### Parallel Progress Document Sharing

For parallel steps using git worktrees, can they share a single progress.json file, or do they need separate files that merge at sync point?

**Current decision**: Use separate progress files per worktree branch, merged by the Python orchestrator when the parallel block completes.

## Future Development

The following elements are ideas for future development that must not be included in the implementation plan of the agentic workflows.

- Support other CLI tools such as Codex CLI, Cursor CLI and Copilot CLI
- Fine-grained permission framework that is permissive enough to allow agents to run without issue but does not provide every permission
- Memory embeddings for semantic search (optional pgvector integration)
- Web dashboard for workflow monitoring
- Distributed workflow execution across multiple machines

## References

### Existing Agentic Plugins

#### agentic-core

experimental-plugins\vision\agentic-core.md
experimental-plugins\agentic-core

This is the latest version of the agentic plugin and this contains the best examples of code that can be re-used to build this plugin. It's important to note that it has downside and everything should not be used as-is, it must respect the current plugin requirements.

Full agentic plugin that is fully implemented but has not been fully validated. It's a bit too complex for the needs of this project, for example the use of kafka and postgresql, the meetings orchestration, etc.

- Uses the concept of yaml workflows, which can be re-used partially
- Use template for expected output of steps, which can be re-used

#### agentic-sdlc

experimental-plugins\vision\agentic-sdlc.md
experimental-plugins\agentic-sdlc

#### core

experimental-plugins\vision\core.md
experimental-plugins\core

Legacy plugin, only kept because it's script can be use as example to implement the bse python scriptsÈ

- logging.py
- orchestrator.py
- runner.py
- worktree.py

## Existing Framework

Here's a list of existing framework that have similarities to the system that I want to build:

- [BMAD](https://github.com/bmad-code-org/BMAD-METHOD): seems great for planning, but contains too much project managements processing, like scrum meetings, too many documents created. It's also a big downside that for a given meeting, one single session is role playing every meeting participant, instead of every participant being a dedicated agent. Mostly manual steps, the developer must start a plan, start a meeting, start the build phase, etc.
- [GetShitDone](https://github.com/glittercowboy/get-shit-done): Excellent simplicity, great approach for a single developer workflow. Only prompts, not scripts, lacking agentic features
- [Ralph-Wiggum](https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md): Simple loop using a hook, that forces Claude to process the same prompt in a loop, until the completion criteria are all met. Very interesting approach, known to give great results online. Would be interesting to have a similar workflow step in the framework

## Design Decisions

This section documents key architectural decisions made during requirements definition.

### Orchestration Architecture: Hybrid Python + Claude

The main orchestrator uses a hybrid approach where Python handles deterministic operations and Claude makes intelligent decisions:

```
Python Orchestrator (outer loop)
├── Parse YAML workflow
├── Initialize workflow progress document
├── Loop until workflow complete:
│   ├── Call Claude "Orchestrator Command" with:
│   │   - Current workflow progress document
│   │   - Workflow definition
│   │   - Last step outputs
│   ├── Parse Claude's JSON response
│   ├── Execute the indicated step (new Claude session)
│   ├── Update workflow progress document
│   └── Handle errors/retries
└── Generate final output/report
```

**Rationale:**
1. Python handles deterministic workflow parsing, file I/O, parallelism, timeouts
2. Claude makes intelligent decisions about workflow state, error recovery, next steps
3. The JSON contract between Python and Claude is fixed and predictable
4. Claude Orchestrator doesn't execute - it only decides (avoids context bloat)
5. Each step runs in isolated sessions, preventing context accumulation

**Orchestrator JSON Response Schema:**

```json
{
  "workflow_status": "in_progress | completed | failed | blocked",
  "next_action": {
    "type": "execute_step | retry_step | wait_for_human | complete | abort",
    "step_name": "implement",
    "context_to_pass": "string context for the step"
  },
  "reasoning": "Why this decision was made",
  "progress_update": "What to add to progress document"
}
```

### Session Management: New Session Per Step

Each workflow step starts a **new Claude Code session**. No session resume functionality is implemented to keep the architecture simple.

**Rationale:**
- Simplifies implementation (no session ID tracking)
- Avoids issues with session garbage collection
- Forces explicit context passing via checkpoints and progress documents
- Each step is self-contained and restartable

### Progress Document Format: JSON

The workflow progress document uses **JSON format** (not markdown) for machine-optimized parsing while remaining human-readable.

### Checkpoints: On-Demand Only

Checkpoints are created **on-demand via skill invocation** rather than automatically after every step. A single checkpoint.md file per workflow stores all checkpoints.

### Memory System: File-Based with Frontmatter

Memory uses **simple keyword matching** in YAML frontmatter or file glob patterns. No database or vector embeddings required. Memories are **permanent** and accumulate over time.

### Error Handling: Same Prompt, New Session

When a step fails and max-retry allows, the retry uses the **same prompt in a new session**. No exponential backoff between retries.

### Parallel Execution: Git Worktrees

Parallel steps use **git worktrees** for isolation. Each parallel branch has its own progress file, merged by the Python orchestrator when the parallel block completes.

### Configuration: Global Only

A single **global configuration** stored in `/agentic/config.json`. Per-workflow configuration overrides via workflow YAML settings.

### Template Engine: Jinja2

All templates (YAML, outputs, prompts) use **Jinja2 syntax** for consistency.

## Related Frameworks

Frameworks with similarities to agentic-workflows:

| Framework       | Similarity                           | Key Difference                         |
| --------------- | ------------------------------------ | -------------------------------------- |
| Composio        | Workflow orchestration for AI agents | API-focused, external service          |
| LangGraph       | Graph-based agent workflows          | Python library, not CLI-focused        |
| AutoGen         | Multi-agent conversation             | More chat-oriented, less task-oriented |
| CrewAI          | Agent crews with roles               | Role-playing focus, not SDLC-oriented  |
| Prefect/Airflow | Workflow orchestration               | Traditional DAG, not AI-native         |
| Semantic Kernel | Microsoft's agentic framework        | Heavy SDK, not file-based              |

**Agentic-workflows differentiator:** File-based state, CLI subscription focus (Claude Max), YAML workflows, checkpoint/resume, memory system without databases
