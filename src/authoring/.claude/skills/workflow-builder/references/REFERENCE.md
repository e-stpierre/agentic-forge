# Workflow Schema Reference

Complete reference for all agentic-forge workflow YAML properties.

## Top-Level Structure

```yaml
name: workflow-name # Required. Unique identifier (kebab-case)
version: "1.0" # Required. Schema version (always "1.0")
description: | # Optional. Human-readable description
  What this workflow does
requires: { agentic-forge: ">=0.12", contract: 1 } # Optional. Harness requirements
settings: {} # Optional. Workflow configuration
variables: [] # Optional. Input parameters
steps: [] # Required. Workflow steps (at least one)
outputs: [] # Optional. Output artifacts
```

## Requires

Optional. What the workflow needs from the harness. af refuses an unmet workflow at dispatch, before any step runs, naming the required and installed versions.

| Key             | Type   | Description                                                                                 |
| --------------- | ------ | ------------------------------------------------------------------------------------------- |
| `agentic-forge` | string | Version range: `>=0.12`, `^0.12.0`, `~0.12.1`, `0.12` (any 0.12.x), `>=0.12 <1`, `a \|\| b` |
| `contract`      | int    | Harness contract version (currently `1`)                                                    |

`agentic-forge run --ignore-requires` overrides only the `agentic-forge` range, with a warning; a contract mismatch is always refused. Skill pack workflows (`af-workflows/`) should always declare both.

## Settings

All settings are optional with sensible defaults.

### Global Settings

| Key                  | Type   | Default    | Valid Values                 | Description                                                         |
| -------------------- | ------ | ---------- | ---------------------------- | ------------------------------------------------------------------- |
| `max-retry`          | int    | `null`     | 0+                           | Max retry attempts for failed steps (unset: `defaults.maxRetry`, 3) |
| `timeout-minutes`    | int    | `60`       | 1+                           | Max time for entire workflow (minutes)                              |
| `track-progress`     | bool   | `true`     | true/false                   | Track progress in progress.json                                     |
| `autofix`            | string | `"none"`   | none, minor, major, critical | Auto-fix severity level                                             |
| `terminal-output`    | string | `"base"`   | base, all                    | Output mode: base (last message) or all (stream)                    |
| `bypass-permissions` | bool   | `false`    | true/false                   | Bypass tool permission prompts (warns per step)                     |
| `strict-mode`        | bool   | `false`    | true/false                   | Fail on undefined template variables                                |
| `model`              | string | `"sonnet"` | Runtime-dependent (below)    | Default model for all steps                                         |
| `runtime`            | string | `null`     | claude, codex                | Default coding agent runtime for all steps                          |
| `required-tools`     | list   | `[]`       | Tool names                   | Added to `runtimes.claude.allow` (no prompting)                     |
| `amend.step`         | string | none       | A top-level step name        | Step `af amend` runs before the next step                           |

**Runtime resolution order:** `step.runtime` > `--runtime` CLI flag > `settings.runtime` > `config.defaults.runtime` > `"claude"`

**Model names are runtime-specific:**

- Claude: `haiku`, `sonnet`, `opus`, `fable` — aliases that always resolve to the latest model in that family. Full IDs (e.g. `claude-opus-5`) work but freeze the version.
- Codex: no aliases exist. Omit `model` to let Codex CLI use its own default, or pin an ID such as `gpt-5.3-codex`.

**Per-runtime default models:** Each runtime resolves its own default model from config (`claude.model` or `codex.model`). Steps that use a non-default runtime do not need an explicit model: `settings.model` is deliberately **not** inherited across runtimes, so a codex step in a claude workflow falls back to `codex.model` or to no `--model` flag at all.

**Note:** `skill` steps and slash-command prompts only work with `runtime: claude`. agentic-forge bundles no execution skills: they come from the user's installed plugins and `.claude/skills/` directories.

### Worktree Settings

Nested under `settings.worktree`. Controls workflow-level git worktree isolation. When enabled, the entire workflow runs in a dedicated worktree and all steps see that worktree as their working directory.

| Key         | Type        | Default        | Valid Values                              | Description                                               |
| ----------- | ----------- | -------------- | ----------------------------------------- | --------------------------------------------------------- |
| `enabled`   | bool/string | `false`        | true/false, Nunjucks template string      | Enable worktree isolation for this workflow               |
| `location`  | string      | `"sibling"`    | sibling, nested, absolute                 | Where to create the worktree relative to the repository   |
| `directory` | string/null | `null`         | any absolute path                         | Base directory for `absolute` location (required if used) |
| `cleanup`   | string      | `"on-success"` | on-success, on-complete, on-merge, manual | When to remove the worktree after the workflow finishes   |

**Location modes:**

| Value        | Worktree path                          | Notes                              |
| ------------ | -------------------------------------- | ---------------------------------- |
| `"sibling"`  | `../.worktrees/{repo}-{workflow}-{id}` | Default; safe on long-path systems |
| `"nested"`   | `.worktrees/agentic-{workflow}-{id}`   | Inside the repository              |
| `"absolute"` | `{directory}/{repo}-{workflow}-{id}`   | `directory` must be set            |

**Cleanup policies:**

| Value           | Behavior                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------ |
| `"on-success"`  | Remove worktree on success; preserve on failure                                            |
| `"on-complete"` | Always remove worktree after the workflow finishes                                         |
| `"on-merge"`    | Remove the worktree, then its local branch, once a step reported `merged` (a `merge` step) |
| `"manual"`      | Never remove automatically; log path for manual inspection                                 |

**The `enabled` field accepts a Nunjucks template string** so users can toggle worktree mode via a CLI variable:

```yaml
settings:
  worktree:
    enabled: "{{ variables.use_worktree }}"
    cleanup: "on-success"

variables:
  - name: use_worktree
    type: boolean
    required: false
    default: true
    description: Whether to run in an isolated worktree
```

## Variables

Define input parameters for the workflow. Passed as bare `key=value` args or via `--var "name=value"` on the CLI. Missing required variables are prompted interactively when running in a TTY (disable with `--no-interactive`).

| Key           | Required | Type   | Default    | Description                           |
| ------------- | -------- | ------ | ---------- | ------------------------------------- |
| `name`        | Yes      | string | -          | Variable identifier (snake_case)      |
| `type`        | No       | string | `"string"` | string, number, boolean               |
| `required`    | No       | bool   | `true`     | Whether the variable must be provided |
| `default`     | No       | any    | `null`     | Default value if not provided         |
| `description` | No       | string | `""`       | Human-readable description            |

```yaml
variables:
  - name: task
    type: string
    required: true
    description: Task description

  - name: max_iterations
    type: number
    required: false
    default: 10
    description: Maximum loop iterations

  - name: create_pr
    type: boolean
    required: false
    default: true
    description: Whether to create a PR
```

Reference in templates: `{{ variables.task }}`, `{{ variables.max_iterations }}`

## Step Types

### Common Step Properties

These properties apply to all step types:

| Key                  | Type   | Default      | Valid Values                                                                                                   | Description                                                   |
| -------------------- | ------ | ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `name`               | string | **required** | kebab-case                                                                                                     | Unique step identifier                                        |
| `type`               | string | **required** | prompt, skill, serial, parallel, conditional, ralph-loop, human-input, wait-for-review, wait-for-checks, merge | Step type                                                     |
| `model`              | string | null         | Runtime-dependent (see Model Names)                                                                            | Override model for this step                                  |
| `runtime`            | string | null         | claude, codex                                                                                                  | Override runtime for this step (never overridden by CLI flag) |
| `timeout-minutes`    | int    | null         | 1+                                                                                                             | Override workflow timeout                                     |
| `max-retry`          | int    | null         | 0+                                                                                                             | Override workflow max-retry                                   |
| `on-error`           | string | `"retry"`    | retry, skip, fail                                                                                              | Error handling strategy                                       |
| `checkpoint`         | bool   | `false`      | true/false                                                                                                     | Create checkpoint after step                                  |
| `depends-on`         | string | null         | step name                                                                                                      | Step dependency                                               |
| `bypass-permissions` | bool   | null         | true/false                                                                                                     | Override workflow-level permission bypass for this step       |

### prompt

Execute a prompt in a coding agent session. The most common step type.

**Specific properties:**

| Key      | Type   | Required | Description                                                                                                                        |
| -------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `prompt` | string | Yes      | The prompt text, skill invocation, or template                                                                                     |
| `agent`  | string | No       | Path to an agent file prepended to the prompt, relative to the workflow file, then the repo root (agentic-forge bundles no agents) |

```yaml
# Simple prompt
- name: implement-feature
  type: prompt
  prompt: |
    Implement the following feature: {{ variables.task }}
  model: sonnet
  timeout-minutes: 30
  on-error: retry
  checkpoint: true
```

### skill

Invoke a skill by namespace (`<plugin>:<skill>`, or a plain skill name) on the `claude` runtime. A skill step on Codex fails with "not supported yet" (Codex skill inlining comes later). It runs like a prompt step (drivers, retries, result block, steering) with the prompt:

```text
/<skill> <args> --run-dir <run dir> --config-snapshot <run dir>/skill-config/<pack>.json
```

`<pack>` is the plugin of `<plugin>:<skill>` (or the skill name). The snapshot holds af config `skill_config.<pack>` (`{}` when unset). Pending operator messages follow the slash command instead of preceding it. The `outputs` object of the skill's result block becomes `{{ outputs.<step>.<key> }}` for later steps.

**Specific properties:**

| Key     | Type   | Required | Description                                        |
| ------- | ------ | -------- | -------------------------------------------------- |
| `skill` | string | Yes      | `<plugin>:<skill>` or `<skill>` (template, no `/`) |
| `args`  | string | No       | Arguments after the skill name (template)          |

```yaml
- name: plan
  type: skill
  skill: esp-skills:esp-plan
  args: "{{ variables.task }}"
  model: opus

- name: build
  type: prompt
  prompt: "Implement {{ outputs.plan.plan_path }}"
```

### serial

Execute nested steps sequentially. Stops on first failure.

**Specific properties:**

| Key     | Type | Required | Description                     |
| ------- | ---- | -------- | ------------------------------- |
| `steps` | list | Yes      | List of nested step definitions |

```yaml
- name: setup-and-build
  type: serial
  steps:
    - name: setup
      type: prompt
      prompt: "Set up the environment"
    - name: build
      type: prompt
      prompt: "Build the project"
```

### parallel

Execute nested steps concurrently. Supports git worktrees for isolation.

**Specific properties:**

| Key          | Type        | Default      | Description                                                                                       |
| ------------ | ----------- | ------------ | ------------------------------------------------------------------------------------------------- |
| `steps`      | list        | **required** | List of nested step definitions                                                                   |
| `worktree`   | bool/string | `false`      | Run each step in a separate git worktree (inherits location and cleanup from `settings.worktree`) |
| `on-failure` | string      | `"fail"`     | How to handle branch failures: `fail` (fail workflow) or `warn` (log warning, continue workflow)  |

**Constraints:**

- Nested parallel steps are NOT allowed (parallel inside parallel)
- `human-input` steps are NOT allowed anywhere under a parallel step (a parallel step cannot stop the run `awaiting-human`)
- `worktree: true` on a parallel step is not supported when workflow-level `settings.worktree.enabled` is true
- When `worktree: true`, each branch stays independent after completion

```yaml
- name: parallel-analysis
  type: parallel
  worktree: true
  steps:
    - name: security-scan
      type: prompt
      prompt: Review the code for security issues and write them to {{ output_dir }}/security.md.
      on-error: skip
    - name: style-check
      type: prompt
      prompt: Review the code for style issues and write them to {{ output_dir }}/style.md.
      on-error: skip
```

### conditional

Branch execution based on a Nunjucks condition expression.

**Specific properties:**

| Key         | Type   | Required | Description                                  |
| ----------- | ------ | -------- | -------------------------------------------- |
| `condition` | string | Yes      | Nunjucks expression evaluating to true/false |
| `then`      | list   | Yes      | Steps to execute if condition is true        |
| `else`      | list   | No       | Steps to execute if condition is false       |

**Condition evaluation supports:**

- Variable checks: `{{ variables.create_pr }}`
- Equality: `{{ variables.severity == 'major' }}`
- Inequality: `{{ variables.mode != 'skip' }}`
- Output checks: `{{ outputs.review.passed }}`
- List operations: `{{ outputs.review.issues | length > 0 }}`
- Filtering: `{{ outputs.review.issues | selectattr('severity', 'eq', 'critical') | list | length > 0 }}`

```yaml
- name: maybe-create-pr
  type: conditional
  condition: "{{ variables.create_pr }}"
  then:
    - name: open-pr
      type: prompt
      prompt: Push the branch and open a pull request with `gh pr create --fill`.
  else:
    - name: skip-pr
      type: prompt
      prompt: "Skipping PR creation as requested."
```

### ralph-loop

Iterative prompt execution with completion detection. Each iteration runs in a fresh coding agent session.

**Specific properties:**

| Key                  | Type          | Default      | Description                                      |
| -------------------- | ------------- | ------------ | ------------------------------------------------ |
| `prompt`             | string        | **required** | Prompt template for each iteration               |
| `max-iterations`     | int or string | `5`          | Maximum iterations (supports variable templates) |
| `completion-promise` | string        | null         | Text to match in completion JSON `promise` field |

**How it works:**

1. Each iteration runs in a fresh coding agent session (no context accumulation)
2. State persists in `{output_dir}/ralph-{step-name}.md`
3. Loop exits when the agent outputs completion JSON or max iterations reached
4. Additional template variables: `{{ iteration }}` (current), `{{ max_iterations }}` (max)
5. Iteration boundaries are safe points: `af pause` stops between two iterations, and operator messages (`af send`) are injected at the start of the next iteration prompt
6. Each iteration emits `iteration.started` and `iteration.completed` (`data.outcome`: `continue`, `complete`, `failed`, `error`, `max_iterations`) in the run's `events.jsonl`

**Completion JSON format** (agent must output this when done):

```json
{ "ralph_complete": true, "promise": "YOUR_PROMISE_TEXT" }
```

**Failure signal** (agent outputs this if stuck):

```json
{ "ralph_complete": false }
```

The `completion-promise` setting must match the `promise` value in the agent's JSON output.

````yaml
- name: implement-milestones
  type: ralph-loop
  prompt: |
    Read the plan at {{ output_dir }}/plan.md.
    Implement the next incomplete milestone.

    When ALL milestones are complete, output:
    ```json
    {"ralph_complete": true, "promise": "ALL_DONE"}
    ```
  max-iterations: "{{ variables.max_iterations }}"
  completion-promise: "ALL_DONE"
  model: sonnet
  checkpoint: true
  timeout-minutes: 120
````

### human-input

Ask a question through the harness contract `needs_input` protocol and wait for the answer. No coding agent runs. The run stops `awaiting-human` with the request in `run.json` (`x-af-needs-input`) and a `needs_input` event; `af answer` (or `af input` when it is the only pending request) answers it, and the step reruns, finds the answer and completes. `wait-for-human` (before 0.12) is parsed as an alias: `on-timeout: continue` becomes a non-blocking request whose only option, `continue`, is recommended and applied after `timeout-minutes` (stop the run with `af cancel`), any other value waits for an answer; `polling-interval` is ignored.

**Specific properties:**

| Key               | Type   | Default      | Description                                                                                                                |
| ----------------- | ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `message`         | string | **required** | The question (template)                                                                                                    |
| `context`         | string | null         | Background the answerer needs (template)                                                                                   |
| `options`         | list   | `[]`         | Strings (the id is the label with spaces as dashes) or `{ id, label, description }`; empty = free text                     |
| `recommended`     | string | null         | Id of the recommended option                                                                                               |
| `blocking`        | bool   | `true`       | `false` lets the harness apply `recommended` after the timeout                                                             |
| `timeout-minutes` | number | null         | Minutes before `recommended` is applied (needs `blocking: false` and `recommended`); else `supervisor.needs_input_timeout` |

Request ids are `input-<step>-<n>` (`n` counts the questions the step asked). Outputs: `{{ outputs.<step>.answer }}` (option id, or the free text), `option` (null for free text), `from` (`user`, `overseer` or `policy`), `request_id`.

```yaml
- name: approve-plan
  type: human-input
  message: "Ship the plan at {{ plan_path }}?"
  options:
    [yes, { id: revise, label: Revise it, description: Send feedback first }]
  recommended: "yes"
  blocking: false
  timeout-minutes: 60

- name: apply
  type: conditional
  condition: "{{ outputs['approve-plan'].answer == 'yes' }}"
  then:
    - { name: build, type: prompt, prompt: "Build the plan." }
```

### wait-for-review

Wait until every listed reviewer has reviewed the pull request's current head commit. The supervisor polls GitHub with `gh` (first interval `poll-seconds`, doubling up to `github.max_poll_seconds`); no coding agent runs while it waits. A push (new head) restarts the wait for that head. A reviewer has reviewed the head when it submitted a pull request review on that commit, when its Codex summary comment (`codex-review-state:v1` marker) completed on that commit, or when it commented after the head was committed (the Claude GitHub Action's "No issues found" comment). Each review emits `review.received`. On timeout the run stops `awaiting-human` with a `needs_input` request `review-timeout-<step>-<n>`: answer `wait` (wait again) or `continue` (go on without the missing reviews).

**Specific properties:**

| Key               | Type          | Default                           | Description                                                                                                        |
| ----------------- | ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `reviewers`       | list/string   | **required**                      | Names from `github.reviewers` (`claude`, `codex`) or GitHub logins; a string is comma-separated (template)         |
| `pr`              | number/string | run `pr`, else the current branch | Pull request number, `#<n>` or URL (template)                                                                      |
| `trigger`         | bool          | `github.auto_trigger` (`false`)   | Post each missing reviewer's trigger comment (`@codex review`) once per head, after `github.trigger_after_seconds` |
| `poll-seconds`    | number        | `github.poll_seconds` (30)        | First polling interval                                                                                             |
| `timeout-minutes` | number        | `github.review_timeout_minutes`   | Time before the run stops `awaiting-human`                                                                         |

Outputs: `{{ outputs.<step>.reviews }}` (`reviewer`, `login`, `state`, `source`, `url`), `changes_requested`, `head`, `pr`, `url`, `missing`, `skipped` (true after `continue`).

### wait-for-checks

Wait until no check of the pull request head is pending, then report pass or fail. No coding agent runs. `checks: required` waits for the checks branch protection requires, or for every check when the base requires none; `all` waits for every check. A failing (or canceled) check fails the step, unless `on-fail: continue`, which completes it with `outputs.<step>.result: fail`. Emits `checks.completed`. On timeout the run stops `awaiting-human` (`checks-timeout-<step>-<n>`, answer `wait` or `continue`).

| Key               | Type          | Default                           | Description                                |
| ----------------- | ------------- | --------------------------------- | ------------------------------------------ |
| `pr`              | number/string | run `pr`, else the current branch | Pull request (template)                    |
| `checks`          | string        | `required`                        | `required` or `all`                        |
| `on-fail`         | string        | `fail`                            | `fail` or `continue`                       |
| `poll-seconds`    | number        | `github.poll_seconds`             | First polling interval                     |
| `timeout-minutes` | number        | `github.checks_timeout_minutes`   | Time before the run stops `awaiting-human` |

Outputs: `result` (`pass`, `fail`, `pending`), `passed`, `scope`, `failed`, `pending`, `total`, `head`, `pr`, `url`.

### merge

Merge the pull request under the per-repository merge lock: every `merge` step of one repository (main checkout and all its worktrees, any run) takes the same lock file, so merges never race. A lock whose holder died (a supervisor crash) goes stale after 30 seconds and is taken over.

- **Native** (no `skill`): the harness takes the lock (`merge.locked`), re-reads the pull request, resolves the method from the repository settings and rulesets (merge queue: enqueue; one method: use it; several: the first in `github.merge.preference`; linear history excludes `merge`; an explicit `method` that is not allowed fails the step), logs it as a decision, and runs `gh pr merge --repo <o/r> --<method> --match-head-commit <sha>` from outside the checkout (never `--delete-branch`, so `gh` never checks out the base in a worktree). It then deletes the remote head branch through the API (not for forks) and emits `merge.completed`. A draft, branch protection or any other refusal stops the run `awaiting-human`; nothing is bypassed. An already merged pull request completes `merged`.
- **Skill** (`skill: esp-skills:esp-merge`): runs like a `skill` step with `AF_MERGE_LOCK` set to the lock file; the skill takes and releases the lock itself.

| Key             | Type          | Default                           | Description                                    |
| --------------- | ------------- | --------------------------------- | ---------------------------------------------- |
| `skill`, `args` | string        | null                              | Merge skill to run instead of the native merge |
| `pr`            | number/string | run `pr`, else the current branch | Pull request (template)                        |
| `method`        | string        | `github.merge.method` (`repo`)    | `repo`, `squash`, `rebase` or `merge`          |
| `delete-branch` | bool          | `github.merge.delete_branch`      | Delete the remote head branch after the merge  |

The lock wait is `github.merge.lock_timeout_minutes` (then `awaiting-human`). The step result is `merged` (or `done` when queued); with `settings.worktree.cleanup: on-merge` the worktree is removed at the end of the run, then its branch.

```yaml
- name: wait-review
  type: wait-for-review
  reviewers: [claude, codex]
  trigger: true
- { name: wait-checks, type: wait-for-checks }
- { name: merge, type: merge }
```

`wait-for-review`, `wait-for-checks` and `merge` are not allowed under a parallel step.

## Templating

Workflows use Nunjucks for dynamic content in prompts, conditions, and output paths.

### Built-in Variables

| Variable                       | Description                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `{{ workflow_id }}`            | Unique workflow execution ID                                                                |
| `{{ workflow_name }}`          | Workflow name from YAML                                                                     |
| `{{ variables.<name> }}`       | User-defined variable                                                                       |
| `{{ outputs.<step>.<field> }}` | Output from a previous step                                                                 |
| `{{ iteration }}`              | Current ralph-loop iteration (1-based)                                                      |
| `{{ max_iterations }}`         | Max iterations for ralph-loop                                                               |
| `{{ plan_path }}`              | Latest plan in the run directory (`plan.md` or the highest `plan.v<N>.md`), empty when none |
| `{{ plan_version }}`           | Version of that plan (`plan.md` is 1, none is 0)                                            |

### Nunjucks Filters

| Filter             | Example                                         | Description         |
| ------------------ | ----------------------------------------------- | ------------------- |
| `length`           | `{{ list \| length }}`                          | Count items         |
| `first`            | `{{ list \| first }}`                           | First item          |
| `last`             | `{{ list \| last }}`                            | Last item           |
| `upper`            | `{{ text \| upper }}`                           | Uppercase           |
| `lower`            | `{{ text \| lower }}`                           | Lowercase           |
| `replace`          | `{{ text \| replace('old', 'new') }}`           | String replace      |
| `tojson`           | `{{ data \| tojson }}`                          | Convert to JSON     |
| `tojson(indent=2)` | `{{ data \| tojson(indent=2) }}`                | Pretty JSON         |
| `selectattr`       | `{{ items \| selectattr('key', 'eq', 'val') }}` | Filter by attribute |
| `rejectattr`       | `{{ items \| rejectattr('done', 'true') }}`     | Reject by attribute |

### Conditionals and Loops in Templates

```yaml
prompt: |
  {% if variables.create_pr %}
  Create PR: {{ variables.pr_title }}
  {% else %}
  Skip PR creation
  {% endif %}

  {% for item in outputs.issues %}
  - {{ item.description }}
  {% endfor %}
```

### Strict vs Lenient Mode

- **Lenient** (`strict-mode: false`, default): Undefined variables log a warning, original `{{ ... }}` syntax is preserved in output
- **Strict** (`strict-mode: true`): Undefined variables cause immediate failure

## Output Artifacts

Generate files when the workflow completes or fails.

| Key        | Required | Type   | Default       | Description                           |
| ---------- | -------- | ------ | ------------- | ------------------------------------- |
| `name`     | Yes      | string | -             | Output identifier                     |
| `template` | Yes      | string | -             | Nunjucks template file path           |
| `path`     | Yes      | string | -             | Output file path (supports templates) |
| `when`     | No       | string | `"completed"` | "completed" or "failed"               |

Template resolution order:

1. Workflow directory (same directory as the YAML file)
2. `agentic/templates/`
3. Bundled plugin templates

Step prompt template variables: `{{ workflow_id }}`, `{{ output_dir }}` (absolute path to the run directory, `<runs.root>/YYYY-MM-DD-<slug>/`, which also holds `run.json`, `events.jsonl` and `progress.json`), `{{ variables.* }}`, `{{ outputs.* }}`

Template context variables: `workflow`, `variables`, `outputs`, `progress`, `steps`, `analysis_steps`, `fix_steps`, `files_changed`, `branches`, `pull_requests`, `inputs`

```yaml
outputs:
  - name: report
    template: report.md.j2
    path: report.md
    when: completed
  - name: error-log
    template: error.md.j2
    path: error.md
    when: failed
```

## Operator Messages

Under the supervisor, `af send` queues messages in the run's `inbox/`. Before each step prompt (prompt and ralph-loop steps, nested ones included) and each ralph-loop iteration, pending messages for the run, or for that step when sent with `--step`, are prepended as a section, then marked delivered so they never repeat:

```md
## Operator Messages

- [user, 2026-11-10T12:00:00Z, m-1a2b3c4d] Reuse the existing theme tokens.
```

Prompts need no placeholder for it. Write prompts so that an instruction in this section takes precedence over the step's defaults.

On the Claude session driver (default), `af send --mode now` delivers the message into the running session, and `--mode next` sends it as the session's next turn. On the `cli` driver, `--mode now` kills the running step, safety-commits the worktree, and resumes the step's session (`claude --resume`, `codex exec resume`) with the message; when that fails, the step starts over. `af answer` and `af retry-step --context` also reach the step through this section.

## Step Results

Every prompt step ends with a contract result block on its last output line (the bundled system prompt asks for it): `{"status": "done", "summary": "..."}`. Its `status` decides what happens next:

| Result status    | Step / run outcome                                                                   |
| ---------------- | ------------------------------------------------------------------------------------ |
| `done`, `merged` | Step completed; a run with a `merged` step ends `merged`                             |
| `failed`         | Step failed (retried up to `max-retry`, then the run fails)                          |
| `awaiting-human` | Run `awaiting-human`; with `needs_input`, `af answer` resumes it and the step reruns |
| `halted`         | Run `halted` (terminal); the worktree is kept                                        |
| `escalate`       | Run `blocked`; `af resume` or `af retry-step` reruns the step                        |

Without a valid block, the process exit code is used: `0` done, `10` awaiting-human, `20` halted, `30` escalate, anything else failed. The supervisor writes the block to `steps/<NN-step>/result.json` in the run directory. Statuses other than `done` and `failed` stop the run only for top-level steps; nested steps report them to their parent as a failure.

## Amendments

`af amend <run> "<text>"` records a requirement change. Name an amend step to apply it to the plan:

```yaml
settings:
  amend:
    step: plan # top-level step that rewrites the plan as plan.v<N>.md
```

At the next step boundary, the supervisor runs the amend step with the amendment in its `## Operator Messages` section (`Amendment A001 (affects M2): ...`), then continues with the step it was about to run. The amend step writes `plan.v<N>.md` in `{{ output_dir }}`; later steps read the latest plan through `{{ plan_path }}`. Without `settings.amend`, the amendment is delivered to the next step as an `Amendment:` operator message.

## CLI Commands

```bash
# Run a workflow (bare key=value args or --var flag)
agentic-forge run <workflow> key=value [key=value ...] [--var "key=value"] [--slug <slug>] [--from-step <name>] [--no-interactive] [--terminal-output base|all] [--runtime claude|codex] [--ignore-requires]

# Resume a paused/failed workflow
agentic-forge resume <workflow-id>

# Check workflow status
agentic-forge status <workflow-id>

# Cancel a run (stops the current step now, safety-commits, applies the worktree cleanup policy)
agentic-forge cancel <workflow-id>

# Queue an operator message for the next step or iteration (optionally one step)
agentic-forge send <workflow-id> "text" [--step <name>]

# Pause at the next step or iteration boundary (--now stops the current step)
agentic-forge pause <workflow-id> [--now]

# Interrupt the current step and resume it with a message
agentic-forge send <workflow-id> "text" --mode now

# Answer a needs_input request (option id, label or free text) and resume
agentic-forge answer <workflow-id> <request-id> "answer"

# Record a requirement change (runs settings.amend.step at the next boundary)
agentic-forge amend <workflow-id> "text" [--affects M2,M3]

# Rerun a step (and every later step) of a stopped run
agentic-forge retry-step <workflow-id> <step> [--context "text"]

# Change the queue priority of a run
agentic-forge reprioritize <workflow-id> <priority>

# List runs with filters
agentic-forge list [--status paused,awaiting-human] [--repo <path>] [--since 2h] [--parent <run>] [--json]

# Print or follow run events (resumable with a cursor)
agentic-forge events [--run <workflow-id>] [--types needs_input,run.*] [--follow] [--cursor-file <path>] [--json]

# Show a run's plan, summary, decisions and review files
agentic-forge artifacts <workflow-id> [--kind plan|summary|decisions|review] [--content]

# Run a stdio MCP server that dispatches and steers runs (claude mcp add agentic-forge -- af mcp)
agentic-forge mcp

# Answer the single pending request of an awaiting-human run (human-input steps)
agentic-forge input <workflow-id> "response text"

# List workflow executions
agentic-forge list [--status running|completed|failed|paused]

# List available workflows (project, user, skill packs, bundled) with their origin
agentic-forge workflows [-v]

# Check runtimes, auth, the runs root and skill pack compatibility
agentic-forge doctor [--json]

# Copy bundled workflows to local project
agentic-forge init [--force] [--list]

# Print path to interactive authoring skills directory
agentic-forge authoring-dir

# Configuration
agentic-forge config get <key>
agentic-forge config set <key> <value>
agentic-forge configure
```

## Skills

agentic-forge bundles no execution skills. Workflows call the skills the user installed (Claude Code plugins, `~/.claude/skills/`, the repo's `.claude/skills/`), with a `skill` step (`skill: <plugin>:<skill>`, preferred: it passes `--run-dir` and `--config-snapshot` and chains the result block `outputs`) or a slash command in a prompt step. Skills only work with `runtime: claude` (the default).

Use fully qualified `<plugin>:<skill>` names for plugin skills. For example, with the esp-skills plugin installed (`/plugin install esp-skills@esp`):

```yaml
- name: plan
  type: skill
  skill: esp-skills:esp-plan
  args: "{{ variables.task }}"
```

A skill pack can also ship workflows in an `af-workflows/` directory at its plugin root. af discovers them (Claude Code installed plugins, or `skill_packs.paths` in the af config) after the project and user-global workflows and before the bundled ones, so `agentic-forge run <name>` finds them. Such workflows declare `requires` (see Requires).

When the user has no skill pack, write the instructions in a prompt step instead (the bundled demos do this for git branches and commits).

## Bundled Workflows

Generic demos only (no skill calls), available via `agentic-forge init` or `agentic-forge run <name>`:

| Workflow                 | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `claude-demo`            | Validation workflow for installation testing (Claude runtime) |
| `codex-demo`             | Validation workflow for installation testing (Codex runtime)  |
| `multi-demo`             | Demonstrates mixed-runtime execution at step level            |
| `ralph-loop`             | Generic iterative loop for any task                           |
| `plan-loop`              | Build a checkbox plan, then complete one task per iteration   |
| `permission-test-claude` | Test Claude file permissions with and without worktree        |
| `permission-test-codex`  | Test Codex file permissions with and without worktree         |

## Validation Checklist

When validating a workflow, check for these issues:

**Errors (workflow will fail):**

- Missing `name` field
- Missing `steps` field or empty steps list
- Invalid step type (not one of: prompt, skill, serial, parallel, conditional, ralph-loop, human-input, wait-for-review, wait-for-checks, merge; `wait-for-human` is an alias of human-input)
- `settings.amend.step` naming a step that is not a top-level step
- Nested parallel steps (parallel inside parallel)
- A `human-input`, `wait-for-review`, `wait-for-checks` or `merge` step under a parallel step
- `wait-for-review` without `reviewers`; `checks` other than required or all; `on-fail` other than fail or continue; `method` other than repo, squash, rebase or merge; `poll-seconds` or `timeout-minutes` not positive
- Prompt step without `prompt` field
- Conditional step without `condition` field
- Ralph-loop step without `prompt` field
- Skill step without `skill` field, or a skill name that is not `<plugin>:<skill>` or `<skill>`
- Human-input step without `message` field, a `recommended` that is not an option id, duplicate option ids, or `timeout-minutes` without `blocking: false` and `recommended`
- Required variable without default and not provided at runtime
- `settings.worktree.location: "absolute"` without `settings.worktree.directory` set
- `worktree: true` on a parallel step when `settings.worktree.enabled` is true

**Warnings (may cause issues):**

- Variable referenced in templates but not defined in `variables` section
- `completion-promise` missing on ralph-loop (loop will only stop at max-iterations)
- No `timeout-minutes` on long-running steps
- `on-error: fail` without `max-retry` (any failure stops the workflow)
- Non-qualified plugin skill names (e.g., `skill: esp-plan` instead of `skill: esp-skills:esp-plan`)
- `agent:` file that does not exist next to the workflow file or in the repo root (it is silently ignored)
- Step name not in kebab-case
- Variable name not in snake_case
- Skill invocation used with `runtime: codex` (skills not supported by Codex)
