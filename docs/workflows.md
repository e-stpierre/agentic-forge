# Workflows

Agentic Forge ships with 10 bundled workflows. You can run any of them immediately without initialization. Use `af workflows --verbose` to see all available workflows and their variables.

Workflows support a `runtime` field on individual steps and in `settings`. See [Coding Agents](coding-agents.md) for the runtime resolution order and per-runtime capabilities.

> **Note**: Skill-based prompts (`/af-git-commit`, `/af-sdlc-plan`, etc.) only work with the `claude` runtime. Steps that invoke skills must use `runtime: claude` (explicitly or by default).

## plan-build-review

Full SDLC workflow: plan, implement iteratively, review, fix, and optionally create a PR.

**Use cases**: Feature development, bug fixes, and chores that benefit from upfront planning and automated review.

**Flow**: Plan (opus) -> Create Branch -> Implement (iterative loop) -> Review -> Fix Issues -> Create PR

### Variables

| Variable         | Type    | Required | Default | Description                                     |
| ---------------- | ------- | -------- | ------- | ----------------------------------------------- |
| `task`           | string  | Yes      |         | Feature or task description                     |
| `type`           | string  | No       | `auto`  | Task type: `feature`, `bug`, `chore`, or `auto` |
| `fix_severity`   | string  | No       | `major` | Minimum severity for auto-fix                   |
| `explore_agents` | integer | No       | `2`     | Number of explore agents (0=quick, 1+=parallel) |
| `max_iterations` | number  | No       | `25`    | Maximum iterations for implementation loop      |
| `create_pr`      | boolean | No       | `false` | Create a PR after completion                    |

### Examples

```bash
# Basic feature implementation
af run plan-build-review --var "task=Add dark mode support"

# Bug fix with PR creation
af run plan-build-review --var "task=Fix login timeout" --var "type=bug" --var "create_pr=true"

# Large feature with more iterations and explore agents
af run plan-build-review --var "task=Implement payment system" --var "max_iterations=50" --var "explore_agents=4"
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

## analyze-codebase-merge

Same as `analyze-codebase` but merges all analysis branches back, runs a combined review, and optionally creates a single PR.

**Use cases**: When you want all analysis fixes consolidated into one branch instead of separate PRs.

**Flow**: 5 Parallel Analyses -> Merge Branches -> Review -> Fix Validation Issues -> Create PR

### Variables

| Variable             | Type    | Required | Default | Description                                                    |
| -------------------- | ------- | -------- | ------- | -------------------------------------------------------------- |
| `autofix`            | string  | No       | `major` | Severity level for fixes: `none`, `minor`, `major`, `critical` |
| `fix_severity`       | string  | No       | `major` | Minimum severity for validation auto-fix                       |
| `paths`              | string  | No       | `""`    | Space-separated paths to analyze                               |
| `create_pr`          | boolean | No       | `false` | Create PR after all changes merged                             |
| `max_fix_iterations` | number  | No       | `25`    | Maximum iterations for fix loops                               |

### Examples

```bash
# Full analysis with merged fixes
af run analyze-codebase-merge --var "autofix=major"

# Consolidated PR from all analyses
af run analyze-codebase-merge --var "autofix=minor" --var "create_pr=true"

# Strict: only fix critical issues
af run analyze-codebase-merge --var "autofix=critical" --var "fix_severity=critical"
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

| Variable         | Type    | Required | Default | Description                                     |
| ---------------- | ------- | -------- | ------- | ----------------------------------------------- |
| `task`           | string  | Yes      |         | Feature or task description                     |
| `type`           | string  | No       | `auto`  | Task type: `feature`, `bug`, `chore`, or `auto` |
| `fix_severity`   | string  | No       | `major` | Minimum severity for auto-fix                   |
| `explore_agents` | integer | No       | `2`     | Number of explore agents (0=quick, 1+=parallel) |
| `max_iterations` | number  | No       | `25`    | Maximum iterations for implementation loop      |
| `create_pr`      | boolean | No       | `false` | Create a PR after completion                    |

### Examples

```bash
# Feature development with dual review
af run multi-plan-build-review --var "task=Add dark mode support"

# Bug fix with PR creation
af run multi-plan-build-review --var "task=Fix login timeout" --var "type=bug" --var "create_pr=true"
```

Requires both Claude Code and Codex CLI installed and authenticated. The Codex runtime reviews the plan after Claude creates it, and independently reviews the code after implementation.

## Custom Workflows

You can create your own workflows using the workflow-builder authoring skill, or by writing YAML files directly. For the complete workflow schema and all supported properties (step types, settings, variables, outputs, git options, etc.), see:

- [Workflow Schema Reference](https://github.com/e-stpierre/agentic-forge/blob/main/src/authoring/.claude/skills/workflow-builder/references/REFERENCE.md) — Full specification of all workflow properties
- [Annotated Example Workflow](https://github.com/e-stpierre/agentic-forge/blob/main/src/authoring/.claude/skills/workflow-builder/references/workflow-example.yaml) — Complete example with inline documentation
