# Workflows

Agentic Forge ships 7 generic demo workflows. They use only generic steps (no skill calls), and you can run any of them immediately without initialization. The SDLC and analysis workflows of earlier versions were removed: bring your own skills and workflows instead (see [Bring Your Own Skills](#bring-your-own-skills)). Use `af workflows --verbose` to see all available workflows and their variables.

Workflows support a `runtime` field on individual steps and in `settings`. See [Coding Agents](coding-agents.md) for the runtime resolution order and per-runtime capabilities.

> **Note**: `skill` steps only work with the `claude` runtime. Steps that invoke skills must use `runtime: claude` (explicitly or by default).

## Tool Permissions Disclaimer

Most bundled demo workflows declare a `required-tools` list in their `settings` block:

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

When present, these tools are added to the runtime allowlist (`runtimes.claude.allow`, see [Configuration](configuration.md#runtimes)) for the workflow's steps, **automatically granting the agent permission to use them without prompting**, on both Claude drivers. In practice this means the agent can:

- **Read** any file in your repository
- **Edit** and **Write** files (create, modify, or overwrite)
- **Glob** and **Grep** to search the codebase
- **Bash** to execute arbitrary shell commands

This is required for autonomous workflow execution -- without these permissions, the agent would lack the access needed to complete its tasks autonomously.

Additionally, the agent always has access to any permissions already configured at the repository level (`.claude/settings.json`, `.claude/settings.local.json`, etc.), regardless of the workflow's `required-tools` setting. The `required-tools` list is additive on top of those existing permissions.

### Which workflows declare required-tools

| Workflow                 | Required Tools                      |
| ------------------------ | ----------------------------------- |
| `ralph-loop`             | Read, Edit, Write, Glob, Grep, Bash |
| `plan-loop`              | Read, Edit, Write, Glob, Grep, Bash |
| `claude-demo`            | Read, Edit, Write, Glob, Grep, Bash |
| `multi-demo`             | Read, Edit, Write, Glob, Grep, Bash |
| `permission-test-claude` | Read, Edit, Write, Glob, Grep, Bash |
| `codex-demo`             | None (Codex runtime)                |
| `permission-test-codex`  | None (Codex runtime)                |

> **Note**: The `required-tools` setting only applies to the Claude Code runtime. Codex CLI manages its own permissions separately.

No step bypasses permission checks unless you opt in with `runtimes.<id>.permissions: bypass` or `bypass-permissions: true`; each bypassed step logs a warning. Codex steps can opt into full-access execution with `bypass-permissions: true`. For Codex this maps to `--dangerously-bypass-approvals-and-sandbox`, so use it only for workflows where you explicitly accept `danger-full-access`. On native Windows, Agentic Forge first grants global output directories with `--add-dir` and `sandbox_workspace_write.writable_roots`; if Codex still cannot write `%APPDATA%\agentic-forge\outputs`, prefer `outputDirectory: "local"` before enabling bypass on the affected Codex step.

### Mitigations

- **Worktree isolation**: A workflow with `settings.worktree.enabled: true` (or `use_worktree=true` on the permission tests) runs in a disposable git worktree, so changes are made on a copy of your repo rather than directly in your working directory.
- **Review before running**: Use `af workflows --verbose` or inspect the workflow YAML directly to see exactly what permissions and steps are configured.
- **Custom workflows**: When creating your own workflows, you can omit `required-tools` entirely or list only the specific tools you want to allow. Without `required-tools`, the agent will only have the default allowlist (`runtimes.claude.allow`, which has no shell commands) and the permissions configured at the repository level (`.claude/settings.json`, `.claude/settings.local.json`, etc.), and the workflow will fail if the agent is unable to complete a step due to insufficient permissions.

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

## claude-demo

Validates that your agentic-forge installation and Claude Code configuration are working correctly.

**Use cases**: First-time setup verification, troubleshooting, learning how the engine works with Claude.

**Runtime**: Claude (default)

**Flow**: Welcome -> Create Demo Files (parallel) -> Random Facts Loop (5 iterations) -> Create Branch -> Commit Files -> Validation

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

**Flow**: Welcome -> Create Demo Files (parallel) -> Random Facts Loop (5 iterations) -> Create Branch -> Commit Files -> Validation

### Variables

None. This workflow has no configurable variables.

### Examples

```bash
af run codex-demo
```

Requires Codex CLI installed and authenticated. Creates `codex-demo-1.md` and `codex-demo-2.md`, runs the same loop as `claude-demo` but using the Codex runtime. Like every bundled workflow, it uses plain prompt instructions (git commands included) instead of skill invocations.

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

## Bring Your Own Skills

agentic-forge bundles no execution skills. Workflows call the skills you installed, through two step types:

- **`skill`**: `skill: <plugin>:<skill>` (or a plain skill name) with optional `args`. The step sends `/<plugin>:<skill> <args> --run-dir <run dir> --config-snapshot <file>` to Claude, and the `outputs` of the skill's result block are available to later steps as `{{ outputs.<step>.<key> }}`.
- **`prompt`**: any prompt, including a slash command such as `/my-skill do this`. Use `agent:` to prepend an instructions file, resolved relative to the workflow file, then the repo root.

A skill is found the way Claude Code finds it: an installed plugin, `~/.claude/skills/`, or the repo's `.claude/skills/`. Skills that follow the [harness contract](harness-contract.md) (result block, `--run-dir`, `## Operator Messages`) get the full feature set: outputs chaining, `needs_input` questions and steering.

### Example: esp-skills

[esp-skills](https://github.com/e-stpierre/skills) is one skill pack built for the harness contract. Install it in Claude Code:

```text
/plugin marketplace add e-stpierre/skills
/plugin install esp-skills@esp
```

Then call its skills from a workflow in your project (`agentic/workflows/plan-and-build.yaml`):

```yaml
name: plan-and-build
settings:
  required-tools: [Read, Edit, Write, Glob, Grep, Bash]
variables:
  - name: task
    type: string
    required: true
steps:
  - name: plan
    type: skill
    skill: esp-skills:esp-plan
    args: "{{ variables.task }}"
  - name: approve
    type: human-input
    message: "Review the plan in {{ output_dir }} and approve it."
    options: [approve, reject]
  - name: build
    type: prompt
    prompt: Implement the plan in {{ output_dir }}, one milestone at a time.
```

```bash
af run plan-and-build --var "task=Add dark mode support"
```

Any other pack works the same way: replace the `skill:` names with your own.

## Custom Workflows

You can create your own workflows using the workflow-builder authoring skill, or by writing YAML files directly. For the complete workflow schema and all supported properties (step types, settings, variables, outputs, git options, etc.), see:

- [Workflow Schema Reference](https://github.com/e-stpierre/agentic-forge/blob/main/src/authoring/.claude/skills/workflow-builder/references/REFERENCE.md) — Full specification of all workflow properties
- [Annotated Example Workflow](https://github.com/e-stpierre/agentic-forge/blob/main/src/authoring/.claude/skills/workflow-builder/references/workflow-example.yaml) — Complete example with inline documentation
