# Workflows

Agentic Forge ships 8 generic workflows (7 demos and `instruction`). They use only generic steps (no skill calls), and you can run any of them immediately without initialization. The SDLC and analysis workflows of earlier versions were removed: bring your own skills and workflows instead (see [Bring Your Own Skills](#bring-your-own-skills)). Use `af workflows --verbose` to see all available workflows and their variables.

Workflows support a `runtime` field on individual steps and in `settings`. See [Coding Agents](coding-agents.md) for the runtime resolution order and per-runtime capabilities.

> **Note**: `skill` steps run natively on the `claude` runtime. On Codex, the step sends the skill's `SKILL.md` inline instead (see [Skills on Codex](coding-agents.md#skills-on-codex)).

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

## instruction

Carries out a short instruction in one prompt step. The overseer uses it for backlog items on the `instruction` track (a rename, a config value, a typo fix).

**Use cases**: Trivial one-step changes dispatched by the overseer or by hand.

**Runtime**: Claude (default)

**Flow**: Instruction

### Variables

| Variable       | Required | Default | Description                                                                     |
| -------------- | -------- | ------- | ------------------------------------------------------------------------------- |
| `instruction`  | Yes      | none    | What to do, in a few sentences, with the files it concerns                      |
| `use_worktree` | No       | `false` | Run in an isolated worktree (needed to run beside another run of the same repo) |

### Examples

```bash
af run instruction --var instruction="Rename the MAX_ITEMS constant in src/pager.ts to PAGE_SIZE"
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

- **`skill`**: `skill: <plugin>:<skill>` (or a plain skill name) with optional `args`. The step sends `/<plugin>:<skill> <args> --run-dir <run dir> --config-snapshot <file>` to Claude, and the `outputs` of the skill's result block are available to later steps as `{{ outputs.<step>.<key> }}`. On Codex, the step sends the skill's `SKILL.md` inline instead (see [Skills on Codex](coding-agents.md#skills-on-codex)).
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

### Skill pack workflows

A skill pack can ship ready-made workflows in an `af-workflows/` directory at its plugin root. af finds them automatically for Claude Code plugins (through Claude Code's installed plugin list), or through `skill_packs.paths` in the [configuration](configuration.md#skill_packs). `af workflows` lists them under `Skill pack: <name>`, and `af run <name>` runs them like any other workflow. Search order: project `agentic/workflows/` -> user-global -> skill packs -> bundled demos.

A pack workflow declares what it needs from the harness:

```yaml
name: esp-go
requires: { agentic-forge: ">=0.12", contract: 1 }
```

`agentic-forge` is a version range (`>=0.12`, `^0.12.0`, `>=0.12 <1`) and `contract` the [harness contract](harness-contract.md) version. af refuses a workflow it cannot satisfy before any step runs, naming the required and installed versions. `af run --ignore-requires` (or `ignore_requires` on `af_dispatch`) overrides only the version check, with a warning. `af doctor` checks every discovered pack.

## GitHub Steps

Three step types wait on GitHub and merge without an agent session: the supervisor polls `gh`, so waiting on bots and checks costs no tokens.

- **`wait-for-review`**: waits until every listed reviewer (`claude`, `codex`, or any login) has reviewed the pull request's current head, and can post the reviewer's trigger comment (`@codex review`). A push restarts the wait for the new head. On timeout the run stops `awaiting-human`: `af answer <run> <id> wait` or `continue`.
- **`wait-for-checks`**: waits for the required checks (every check when the base requires none) and reports pass or fail. A failing check fails the step unless `on-fail: continue`.
- **`merge`**: merges under a per-repository lock, so runs of one repository (from any worktree) never merge at once. Natively it resolves the method from the repository settings and runs `gh pr merge --repo` from outside the checkout; with `skill: esp-skills:esp-merge` it runs the skill with `AF_MERGE_LOCK` set. Branch protection is never bypassed: a refused merge stops the run `awaiting-human`.

```yaml
name: ship
settings:
  worktree: { enabled: true, cleanup: on-merge }
steps:
  - {
      name: wait-review,
      type: wait-for-review,
      reviewers: [claude, codex],
      trigger: true
    }
  - { name: wait-checks, type: wait-for-checks }
  - { name: merge, type: merge }
```

`cleanup: on-merge` removes the worktree, then its branch, once the merge succeeded. The steps find the pull request through `pr:` (a template), the run's pull request from an earlier step's result block, or the current branch. Reviewers, intervals, timeouts and the merge preference are in the [`github` configuration](configuration.md#github).

## Custom Workflows

You can create your own workflows using the workflow-builder authoring skill, or by writing YAML files directly. For the complete workflow schema and all supported properties (step types, settings, variables, outputs, git options, etc.), see:

- [Workflow Schema Reference](https://github.com/e-stpierre/agentic-forge/blob/main/src/authoring/.claude/skills/workflow-builder/references/REFERENCE.md) — Full specification of all workflow properties
- [Annotated Example Workflow](https://github.com/e-stpierre/agentic-forge/blob/main/src/authoring/.claude/skills/workflow-builder/references/workflow-example.yaml) — Complete example with inline documentation
