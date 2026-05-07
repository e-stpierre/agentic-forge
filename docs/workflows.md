# Workflows

Agentic Forge ships with 12 bundled workflows. You can run any of them immediately without initialization. Use `af workflows --verbose` to see all available workflows and their variables.

Workflows support a `runtime` field on individual steps and in `settings`. See [Coding Agents](coding-agents.md) for the runtime resolution order and per-runtime capabilities.

> **Note**: Skill-based prompts (`/af-git-commit`, `/af-sdlc-plan`, etc.) only work with the `claude` runtime. Steps that invoke skills must use `runtime: claude` (explicitly or by default).

## Tool Permissions Disclaimer

Most bundled workflows declare a `required-tools` list in their `settings` block:

```yaml
settings:
  required-tools:
    - Read
    - Edit
    - Write
    - Glob
    - Grep
    - Bash
```

When present, these tools are passed as `--allowedTools` to the Claude Code runtime, **automatically granting the agent permission to use them without prompting**. In practice this means the agent can:

- **Read** any file in your repository
- **Edit** and **Write** files (create, modify, or overwrite)
- **Glob** and **Grep** to search the codebase
- **Bash** to execute arbitrary shell commands

This is required for autonomous workflow execution -- without these permissions, the agent would lack the access needed to complete its tasks autonomously.

Additionally, the agent always has access to any permissions already configured at the repository level (`.claude/settings.json`, `.claude/settings.local.json`, etc.), regardless of the workflow's `required-tools` setting. The `required-tools` list is additive on top of those existing permissions.

### Which workflows declare required-tools

| Workflow                  | Required Tools                      |
| ------------------------- | ----------------------------------- |
| `plan-build-review`       | Read, Edit, Write, Glob, Grep, Bash |
| `one-shot`                | Read, Edit, Write, Glob, Grep, Bash |
| `ralph-loop`              | Read, Edit, Write, Glob, Grep, Bash |
| `plan-loop`               | Read, Edit, Write, Glob, Grep, Bash |
| `analyze-codebase`        | Read, Edit, Write, Glob, Grep, Bash |
| `analyze-single`          | Read, Edit, Write, Glob, Grep, Bash |
| `multi-plan-build-review` | Read, Edit, Write, Glob, Grep, Bash |
| `claude-demo`             | Read, Edit, Write, Glob, Grep, Bash |
| `multi-demo`              | Read, Edit, Write, Glob, Grep, Bash |
| `permission-test-claude`  | Read, Edit, Write, Glob, Grep, Bash |
| `codex-demo`              | None (Codex runtime)                |
| `permission-test-codex`   | None (Codex runtime)                |

> **Note**: The `required-tools` setting only applies to the Claude Code runtime. Codex CLI manages its own permissions separately.

### Mitigations

- **Worktree isolation**: Workflows like `plan-build-review` run in a disposable git worktree by default (`use_worktree=true`), so changes are made on a copy of your repo rather than directly in your working directory.
- **Review before running**: Use `af workflows --verbose` or inspect the workflow YAML directly to see exactly what permissions and steps are configured.
- **Custom workflows**: When creating your own workflows, you can omit `required-tools` entirely or list only the specific tools you want to allow. Without `required-tools`, the agent will only have access to the permissions configured at the repository level (`.claude/settings.json`, `.claude/settings.local.json`, etc.), and the workflow will fail if the agent is unable to complete a step due to insufficient permissions.

## plan-build-review

Full SDLC workflow: plan, implement iteratively, review, fix, and optionally create a PR. Runs the entire workflow in an isolated git worktree by default.

**Use cases**: Feature development, bug fixes, and chores that benefit from upfront planning and automated review.

**Flow**: Plan (opus) -> Create Branch -> Implement (iterative loop) -> Review -> Fix Issues -> Create PR

### Variables

| Variable         | Type    | Required | Default | Description                                                                                                                                                                                              |
| ---------------- | ------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task`           | string  | Yes      |         | Feature or task description. When `plan` is also set, use `task` to pass additional instructions about the supplied plan (e.g., "the plan is only half done, finish the missing milestones").            |
| `type`           | string  | No       | `auto`  | Task type: `feature`, `bug`, `chore`, or `auto`                                                                                                                                                          |
| `fix_severity`   | string  | No       | `major` | Minimum severity for auto-fix                                                                                                                                                                            |
| `explore_agents` | integer | No       | `2`     | Number of explore agents (0=quick, 1+=parallel)                                                                                                                                                          |
| `max_iterations` | number  | No       | `25`    | Maximum iterations for implementation loop                                                                                                                                                               |
| `create_branch`  | boolean | No       | `true`  | Create a new branch before implementation                                                                                                                                                                |
| `create_pr`      | boolean | No       | `false` | Create a PR after completion                                                                                                                                                                             |
| `use_worktree`   | boolean | No       | `true`  | Run the workflow in an isolated git worktree                                                                                                                                                             |
| `plan`           | string  | No       | `""`    | Path to an existing plan file. When set, the plan step copies this file to the output directory instead of generating a new one, and applies any additional instructions from `task` to the copied plan. |

### Examples

```bash
# Basic feature implementation
af run plan-build-review --var "task=Add dark mode support"

# Bug fix with PR creation
af run plan-build-review --var "task=Fix login timeout" --var "type=bug" --var "create_pr=true"

# Large feature with more iterations and explore agents
af run plan-build-review --var "task=Implement payment system" --var "max_iterations=50" --var "explore_agents=4"

# Reuse a plan you already iterated on, optionally tweaking it via task
af run plan-build-review --var "plan=./my-plan.md" --var "task=Implement the attached plan"
af run plan-build-review --var "plan=./my-plan.md" --var "task=The plan is only half done; fill in the remaining milestones before implementing"
```

## one-shot

Single-task workflow: execute a task in one pass, review, and optionally create a PR.

**Use cases**: Small, well-defined tasks that don't need iterative planning.

**Flow**: Create Branch -> Execute Task -> Review -> Create PR

### Variables

| Variable    | Type    | Required | Default | Description                |
| ----------- | ------- | -------- | ------- | -------------------------- |
| `task`      | string  | Yes      |         | Task description or prompt |
| `create_pr` | boolean | No       | `false` | Whether to create a PR     |

### Examples

```bash
# Simple task
af run one-shot --var "task=Add user authentication middleware"

# Task with PR
af run one-shot --var "task=Update API error responses" --var "create_pr=true"

# Quick refactor
af run one-shot --var "task=Extract database helpers into a shared module"
```

## ralph-loop

Generic iterative loop where each iteration runs in a fresh Claude Code session. Based on the [Ralph Wiggum technique](https://ghuntley.com/ralph/).

**Use cases**: Open-ended tasks that require multiple iterations, following a plan step-by-step, or any work that benefits from fresh context on each attempt.

**Flow**: Iterative Task (loop until completion promise or max iterations)

### Variables

| Variable             | Type   | Required | Default         | Description                       |
| -------------------- | ------ | -------- | --------------- | --------------------------------- |
| `task`               | string | Yes      |                 | Task to complete iteratively      |
| `completion_promise` | string | No       | `TASK_COMPLETE` | Text signal indicating completion |
| `max_iterations`     | number | No       | `25`            | Maximum iterations                |

### Examples

```bash
# Follow an improvement plan
af run ralph-loop --var "task=Follow the improvement plan in PLAN.md"

# Iterative migration with custom limit
af run ralph-loop --var "task=Migrate all API endpoints to v2" --var "max_iterations=40"

# Custom completion signal
af run ralph-loop --var "task=Refactor the test suite" --var "completion_promise=ALL_TESTS_PASSING"
```

## plan-loop

Generate a checkbox-tracked plan from arbitrary input (free-form prompt, task list, or file paths), then run a Ralph loop that completes one task per iteration until every checkbox is checked.

**Use cases**: Working through a known scoped set of tasks (alignment reviews, migrations, tracked refactors) without needing to hand-author a plan file first.

**Flow**: Build Plan (opus) -> Execute Plan (iterative loop, one task per iteration)

### Variables

| Variable             | Type   | Required | Default              | Description                                                                                                                      |
| -------------------- | ------ | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `input`              | string | Yes      |                      | Source material the plan is built from. Can be a list of tasks, a free-form prompt, file paths to documents, or any combination. |
| `task_id_prefix`     | string | No       | `TASK`               | Prefix for task IDs (e.g. `TASK` -> `TASK-001`). Commit titles are prefixed with `[<ID>]`.                                       |
| `completion_promise` | string | No       | `ALL_TASKS_COMPLETE` | Text signal indicating completion                                                                                                |
| `max_iterations`     | number | No       | `25`                 | Maximum iterations                                                                                                               |

### Examples

```bash
# Free-form prompt -> generated plan -> looped execution
af run plan-loop --var "input=Migrate the auth middleware off the legacy session store. Cover handlers, tests, and docs."

# Reference an existing document; the planning step reads it and decomposes into tasks
af run plan-loop --var "input=Follow the alignment notes in C:\\path\\to\\alignment.md" --var "task_id_prefix=IMP" --var "max_iterations=40"

# Explicit task list
af run plan-loop --var "input=1. Add rate limiting\n2. Wire metrics\n3. Document the new headers"
```

## analyze-codebase

Run 5 parallel analysis types (bug, debt, doc, security, style) with optional autofix. Each analysis runs in an independent worktree.

**Use cases**: Comprehensive codebase health check, pre-release audits, automated fixing of common issues.

**Flow**: 5 Parallel Analyses (bug, debt, doc, security, style) -> Optional Autofix per type -> Optional PR per type

### Variables

| Variable             | Type    | Required | Default | Description                                                    |
| -------------------- | ------- | -------- | ------- | -------------------------------------------------------------- |
| `autofix`            | string  | No       | `none`  | Severity level for fixes: `none`, `minor`, `major`, `critical` |
| `paths`              | string  | No       | `""`    | Space-separated paths to analyze                               |
| `create_pr`          | boolean | No       | `false` | Create PR for each analysis branch                             |
| `max_fix_iterations` | number  | No       | `25`    | Maximum iterations for fix loops                               |

### Examples

```bash
# Analysis only, no fixes
af run analyze-codebase

# Analyze and fix major issues, create PRs
af run analyze-codebase --var "autofix=major" --var "create_pr=true"

# Analyze specific paths only
af run analyze-codebase --var "paths=src/api src/models" --var "autofix=minor"
```

## analyze-single

Run a single type of codebase analysis with optional autofix.

**Use cases**: Targeted analysis of one concern (e.g., security audit only), or when you want to focus on a specific area.

**Flow**: Run Analysis -> Optional Autofix (iterative loop)

### Variables

| Variable             | Type   | Required | Default | Description                                                 |
| -------------------- | ------ | -------- | ------- | ----------------------------------------------------------- |
| `analysis_type`      | string | Yes      |         | Type: `bug`, `debt`, `doc`, `security`, or `style`          |
| `autofix`            | string | No       | `none`  | Severity level: `none`, `low`, `medium`, `high`, `critical` |
| `paths`              | string | No       | `""`    | Space-separated paths to analyze                            |
| `max_fix_iterations` | number | No       | `25`    | Maximum iterations for fixing                               |

### Examples

```bash
# Security audit only
af run analyze-single --var "analysis_type=security"

# Fix style issues in a specific directory
af run analyze-single --var "analysis_type=style" --var "autofix=low" --var "paths=src/api"

# Bug analysis with aggressive fixing
af run analyze-single --var "analysis_type=bug" --var "autofix=low" --var "max_fix_iterations=50"
```

## claude-demo

Validates that your agentic-forge installation and Claude Code configuration are working correctly.

**Use cases**: First-time setup verification, troubleshooting, learning how the engine works with Claude.

**Runtime**: Claude (default)

**Flow**: Welcome -> Create Demo Files (parallel) -> Random Facts Loop (5 iterations) -> Git Branch -> Git Commit -> Validation

### Variables

None. This workflow has no configurable variables.

### Examples

```bash
af run claude-demo
```

The demo creates `demo-1.md` and `demo-2.md`, adds 3 random facts iteratively, creates a branch (`demo/random-facts`), commits, and validates everything. Follow the cleanup instructions printed at the end to remove demo artifacts.

## codex-demo

Validates that your Codex CLI configuration is working correctly with agentic-forge.

**Use cases**: First-time Codex setup verification, testing Codex runtime integration.

**Runtime**: Codex (set at workflow level via `settings.runtime: codex`)

**Flow**: Welcome -> Create Demo Files (parallel) -> Random Facts Loop (5 iterations) -> Git Branch -> Git Commit -> Validation

### Variables

None. This workflow has no configurable variables.

### Examples

```bash
af run codex-demo
```

Requires Codex CLI installed and authenticated. Creates `codex-demo-1.md` and `codex-demo-2.md`, runs the same loop as `claude-demo` but using the Codex runtime. Note that Codex steps use inline instructions instead of skill invocations.

## multi-demo

Demonstrates mixed-runtime execution with Claude and Codex running in parallel at the step level.

**Use cases**: Validating multi-runtime support, learning how per-step `runtime` fields work.

**Runtime**: Mixed — `runtime: claude` and `runtime: codex` on individual steps (no workflow-level default)

**Flow**: Welcome (claude) -> Create Demo Files (parallel: claude + codex) -> Validate (claude)

### Variables

None. This workflow has no configurable variables.

### Examples

```bash
af run multi-demo
```

Requires both Claude Code and Codex CLI installed and authenticated. Creates `multi-demo-claude.md` (Claude runtime) and `multi-demo-codex.md` (Codex runtime) in parallel, then validates both files exist.

## multi-plan-build-review

Full SDLC workflow using mixed runtimes — Claude for planning and implementation, Codex for independent plan and code review.

**Use cases**: Feature development where you want a second opinion from a different AI agent at review stages.

**Runtime**: Mixed — Claude for planning/implementation/branch/PR, Codex for plan review and code review

**Flow**: Plan (claude/opus) -> Plan Review (codex) -> Create Branch (claude/haiku) -> Implement (claude, loop) -> Parallel Review (claude + codex) -> Fix Issues (claude) -> Create PR (claude, conditional)

### Variables

| Variable         | Type    | Required | Default | Description                                                                                                                                                                                                                                               |
| ---------------- | ------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task`           | string  | Yes      |         | Feature or task description. When `plan` is also set, use `task` to pass additional instructions about the supplied plan (e.g., "the plan is only half done, finish the missing milestones").                                                             |
| `type`           | string  | No       | `auto`  | Task type: `feature`, `bug`, `chore`, or `auto`                                                                                                                                                                                                           |
| `fix_severity`   | string  | No       | `major` | Minimum severity for auto-fix                                                                                                                                                                                                                             |
| `explore_agents` | integer | No       | `2`     | Number of explore agents (0=quick, 1+=parallel)                                                                                                                                                                                                           |
| `max_iterations` | number  | No       | `25`    | Maximum iterations for implementation loop                                                                                                                                                                                                                |
| `create_branch`  | boolean | No       | `true`  | Create a new branch before implementation                                                                                                                                                                                                                 |
| `create_pr`      | boolean | No       | `false` | Create a PR after completion                                                                                                                                                                                                                              |
| `plan`           | string  | No       | `""`    | Path to an existing plan file. When set, the plan step copies this file to the output directory instead of generating a new one, and applies any additional instructions from `task` to the copied plan. The Codex plan-review step still runs afterward. |

### Examples

```bash
# Feature development with dual review
af run multi-plan-build-review --var "task=Add dark mode support"

# Bug fix with PR creation
af run multi-plan-build-review --var "task=Fix login timeout" --var "type=bug" --var "create_pr=true"

# Reuse an existing plan and let Codex still refine it
af run multi-plan-build-review --var "plan=./my-plan.md" --var "task=Implement the attached plan"
```

Requires both Claude Code and Codex CLI installed and authenticated. The Codex runtime reviews the plan after Claude creates it, and independently reviews the code after implementation.

## permission-test-claude

Tests Claude runtime file permissions in both the output directory and the repository, with optional worktree isolation. Each step is a separate session that performs a single file operation, making it easy to identify exactly where permissions break.

**Use cases**: Validating permission setup after installation, testing worktree file access, debugging permission issues.

**Runtime**: Claude

**Flow**: Output Create -> Output Append -> Output Edit -> Repo Create -> Repo Append -> Repo Edit -> Repo Delete

### Variables

| Variable       | Type    | Required | Default | Description                            |
| -------------- | ------- | -------- | ------- | -------------------------------------- |
| `use_worktree` | boolean | No       | `false` | Whether to run in an isolated worktree |

### Examples

```bash
# Test without worktree
af run permission-test-claude

# Test with worktree
af run permission-test-claude use_worktree=true
```

## permission-test-codex

Tests Codex runtime file permissions in both the output directory and the repository, with optional worktree isolation. Same structure as `permission-test-claude` but using the Codex runtime.

**Use cases**: Validating Codex permission setup, testing worktree file access with Codex, debugging permission issues.

**Runtime**: Codex

**Flow**: Output Create -> Output Append -> Output Edit -> Repo Create -> Repo Append -> Repo Edit -> Repo Delete

### Variables

| Variable       | Type    | Required | Default | Description                            |
| -------------- | ------- | -------- | ------- | -------------------------------------- |
| `use_worktree` | boolean | No       | `false` | Whether to run in an isolated worktree |

### Examples

```bash
# Test without worktree
af run permission-test-codex

# Test with worktree
af run permission-test-codex use_worktree=true
```

## Custom Workflows

You can create your own workflows using the workflow-builder authoring skill, or by writing YAML files directly. For the complete workflow schema and all supported properties (step types, settings, variables, outputs, git options, etc.), see:

- [Workflow Schema Reference](https://github.com/e-stpierre/agentic-forge/blob/main/src/authoring/.claude/skills/workflow-builder/references/REFERENCE.md) — Full specification of all workflow properties
- [Annotated Example Workflow](https://github.com/e-stpierre/agentic-forge/blob/main/src/authoring/.claude/skills/workflow-builder/references/workflow-example.yaml) — Complete example with inline documentation
