# Workflow Schema Reference

Complete reference for all agentic-forge workflow YAML properties.

## Top-Level Structure

```yaml
name: workflow-name # Required. Unique identifier (kebab-case)
version: "1.0" # Required. Schema version (always "1.0")
description: | # Optional. Human-readable description
  What this workflow does
settings: {} # Optional. Workflow configuration
variables: [] # Optional. Input parameters
steps: [] # Required. Workflow steps (at least one)
outputs: [] # Optional. Output artifacts
```

## Settings

All settings are optional with sensible defaults.

### Global Settings

| Key                  | Type   | Default    | Valid Values                 | Description                                      |
| -------------------- | ------ | ---------- | ---------------------------- | ------------------------------------------------ |
| `max-retry`          | int    | `3`        | 0+                           | Max retry attempts for failed steps              |
| `timeout-minutes`    | int    | `60`       | 1+                           | Max time for entire workflow (minutes)           |
| `track-progress`     | bool   | `true`     | true/false                   | Track progress in progress.json                  |
| `autofix`            | string | `"none"`   | none, minor, major, critical | Auto-fix severity level                          |
| `terminal-output`    | string | `"base"`   | base, all                    | Output mode: base (last message) or all (stream) |
| `bypass-permissions` | bool   | `false`    | true/false                   | Bypass tool permission prompts                   |
| `strict-mode`        | bool   | `false`    | true/false                   | Fail on undefined template variables             |
| `model`              | string | `"sonnet"` | Runtime-dependent (below)    | Default model for all steps                      |
| `runtime`            | string | `null`     | claude, codex                | Default coding agent runtime for all steps       |
| `required-tools`     | list   | `[]`       | Tool names                   | Tools Claude can use without prompting           |

**Runtime resolution order:** `step.runtime` > `--runtime` CLI flag > `settings.runtime` > `config.defaults.runtime` > `"claude"`

**Model names are runtime-specific:**

- Claude: `haiku`, `sonnet`, `opus`, `fable` — aliases that always resolve to the latest model in that family. Full IDs (e.g. `claude-opus-5`) work but freeze the version.
- Codex: no aliases exist. Omit `model` to let Codex CLI use its own default, or pin an ID such as `gpt-5.3-codex`.

**Per-runtime default models:** Each runtime resolves its own default model from config (`claude.model` or `codex.model`). Steps that use a non-default runtime do not need an explicit model: `settings.model` is deliberately **not** inherited across runtimes, so a codex step in a claude workflow falls back to `codex.model` or to no `--model` flag at all.

**Note:** Skill invocations (`/sdlc-plan`, `/git-commit`, etc.) only work with `runtime: claude`. Codex does not support bundled skill injection.

### Worktree Settings

Nested under `settings.worktree`. Controls workflow-level git worktree isolation. When enabled, the entire workflow runs in a dedicated worktree and all steps see that worktree as their working directory.

| Key         | Type        | Default        | Valid Values                         | Description                                               |
| ----------- | ----------- | -------------- | ------------------------------------ | --------------------------------------------------------- |
| `enabled`   | bool/string | `false`        | true/false, Nunjucks template string | Enable worktree isolation for this workflow               |
| `location`  | string      | `"sibling"`    | sibling, nested, absolute            | Where to create the worktree relative to the repository   |
| `directory` | string/null | `null`         | any absolute path                    | Base directory for `absolute` location (required if used) |
| `cleanup`   | string      | `"on-success"` | on-success, on-complete, manual      | When to remove the worktree after the workflow finishes   |

**Location modes:**

| Value        | Worktree path                          | Notes                              |
| ------------ | -------------------------------------- | ---------------------------------- |
| `"sibling"`  | `../.worktrees/{repo}-{workflow}-{id}` | Default; safe on long-path systems |
| `"nested"`   | `.worktrees/agentic-{workflow}-{id}`   | Inside the repository              |
| `"absolute"` | `{directory}/{repo}-{workflow}-{id}`   | `directory` must be set            |

**Cleanup policies:**

| Value           | Behavior                                                   |
| --------------- | ---------------------------------------------------------- |
| `"on-success"`  | Remove worktree on success; preserve on failure            |
| `"on-complete"` | Always remove worktree after the workflow finishes         |
| `"manual"`      | Never remove automatically; log path for manual inspection |

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

| Key                  | Type   | Default      | Valid Values                                                      | Description                                                   |
| -------------------- | ------ | ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `name`               | string | **required** | kebab-case                                                        | Unique step identifier                                        |
| `type`               | string | **required** | prompt, serial, parallel, conditional, ralph-loop, wait-for-human | Step type                                                     |
| `model`              | string | null         | Runtime-dependent (see Model Names)                               | Override model for this step                                  |
| `runtime`            | string | null         | claude, codex                                                     | Override runtime for this step (never overridden by CLI flag) |
| `timeout-minutes`    | int    | null         | 1+                                                                | Override workflow timeout                                     |
| `max-retry`          | int    | null         | 0+                                                                | Override workflow max-retry                                   |
| `on-error`           | string | `"retry"`    | retry, skip, fail                                                 | Error handling strategy                                       |
| `checkpoint`         | bool   | `false`      | true/false                                                        | Create checkpoint after step                                  |
| `depends-on`         | string | null         | step name                                                         | Step dependency                                               |
| `bypass-permissions` | bool   | null         | true/false                                                        | Override workflow-level permission bypass for this step       |

### prompt

Execute a prompt in a coding agent session. The most common step type.

**Specific properties:**

| Key      | Type   | Required | Description                                     |
| -------- | ------ | -------- | ----------------------------------------------- |
| `prompt` | string | Yes      | The prompt text, skill invocation, or template  |
| `agent`  | string | No       | Path to an agent file to load before the prompt |

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

# Skill invocation (always use fully qualified names; claude runtime only)
- name: generate-plan
  type: prompt
  prompt: /sdlc-plan --type {{ variables.plan_type }} {{ variables.task }}
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
- `worktree: true` on a parallel step is not supported when workflow-level `settings.worktree.enabled` is true
- When `worktree: true`, each branch stays independent after completion

```yaml
- name: parallel-analysis
  type: parallel
  worktree: true
  steps:
    - name: security-scan
      type: prompt
      prompt: /analyze security
      on-error: skip
    - name: style-check
      type: prompt
      prompt: /analyze style
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
      prompt: /git-pr
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

### wait-for-human

Pause workflow execution and wait for human input via CLI.

**Specific properties:**

| Key                | Type   | Default      | Description                                     |
| ------------------ | ------ | ------------ | ----------------------------------------------- |
| `message`          | string | **required** | Message displayed to the human                  |
| `polling-interval` | int    | `15`         | Seconds between input checks                    |
| `on-timeout`       | string | `"abort"`    | "abort" (stop workflow) or "continue" (proceed) |
| `timeout-minutes`  | int    | `5`          | Minutes to wait before timeout action           |

Human provides input via: `agentic-forge input <workflow-id> "response"`

```yaml
- name: get-approval
  type: wait-for-human
  message: |
    Review the implementation at {{ output_dir }}/plan.md.
    Respond with "approved" to continue or provide feedback.
  polling-interval: 30
  on-timeout: abort
  timeout-minutes: 120
```

## Templating

Workflows use Nunjucks for dynamic content in prompts, conditions, and output paths.

### Built-in Variables

| Variable                       | Description                            |
| ------------------------------ | -------------------------------------- |
| `{{ workflow_id }}`            | Unique workflow execution ID           |
| `{{ workflow_name }}`          | Workflow name from YAML                |
| `{{ variables.<name> }}`       | User-defined variable                  |
| `{{ outputs.<step>.<field> }}` | Output from a previous step            |
| `{{ iteration }}`              | Current ralph-loop iteration (1-based) |
| `{{ max_iterations }}`         | Max iterations for ralph-loop          |

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

Step prompt template variables: `{{ workflow_id }}`, `{{ output_dir }}` (absolute path to the workflow output directory), `{{ variables.* }}`, `{{ outputs.* }}`

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

## CLI Commands

```bash
# Run a workflow (bare key=value args or --var flag)
agentic-forge run <workflow> key=value [key=value ...] [--var "key=value"] [--slug <slug>] [--from-step <name>] [--no-interactive] [--terminal-output base|all] [--runtime claude|codex]

# Resume a paused/failed workflow
agentic-forge resume <workflow-id>

# Check workflow status
agentic-forge status <workflow-id>

# Cancel a running workflow
agentic-forge cancel <workflow-id>

# Provide human input (for wait-for-human steps)
agentic-forge input <workflow-id> "response text"

# List workflow executions
agentic-forge list [--status running|completed|failed|paused]

# List available workflows with descriptions
agentic-forge workflows [-v]

# Copy bundled workflows to local project
agentic-forge init [--force] [--list]

# Print path to bundled workflow skills directory
agentic-forge skills-dir

# Print path to interactive authoring skills directory
agentic-forge authoring-dir

# Configuration
agentic-forge config get <key>
agentic-forge config set <key> <value>
agentic-forge configure
```

## Available Skills for Prompt Steps

Skills only work with `runtime: claude` (the default). The Codex runtime does not support bundled skill injection.

Always use fully qualified names in workflows:

| Skill               | Description                   |
| ------------------- | ----------------------------- |
| `/sdlc-plan`        | Generate implementation plan  |
| `/sdlc-review`      | Review implementation quality |
| `/analyze bug`      | Find bugs and logic errors    |
| `/analyze debt`     | Identify technical debt       |
| `/analyze doc`      | Check documentation           |
| `/analyze security` | Security scan                 |
| `/analyze style`    | Code style check              |
| `/git-branch`       | Create git branch             |
| `/git-commit`       | Create commit                 |
| `/git-pr`           | Create pull request           |
| `/orchestrate`      | Workflow state evaluation     |

## Bundled Workflows

Available via `agentic-forge init` or `agentic-forge run <name>`:

| Workflow                  | Description                                                             |
| ------------------------- | ----------------------------------------------------------------------- |
| `claude-demo`             | Validation workflow for installation testing (Claude runtime)           |
| `codex-demo`              | Validation workflow for installation testing (Codex runtime)            |
| `multi-demo`              | Demonstrates mixed-runtime execution at step level                      |
| `one-shot`                | Complete a single task with optional PR                                 |
| `plan-build-review`       | Full SDLC: plan -> implement -> review -> fix -> PR                     |
| `multi-plan-build-review` | Full SDLC with mixed Claude/Codex runtimes per phase                    |
| `ralph-loop`              | Generic iterative loop for any task                                     |
| `analyze-codebase`        | Parallel analysis (5 types) with optional autofix, independent branches |
| `analyze-single`          | Single analysis type with optional autofix                              |
| `permission-test-claude`  | Test Claude file permissions with and without worktree                  |
| `permission-test-codex`   | Test Codex file permissions with and without worktree                   |

## Validation Checklist

When validating a workflow, check for these issues:

**Errors (workflow will fail):**

- Missing `name` field
- Missing `steps` field or empty steps list
- Invalid step type (not one of: prompt, serial, parallel, conditional, ralph-loop, wait-for-human)
- Nested parallel steps (parallel inside parallel)
- Prompt step without `prompt` field
- Conditional step without `condition` field
- Ralph-loop step without `prompt` field
- Wait-for-human step without `message` field
- Required variable without default and not provided at runtime
- `settings.worktree.location: "absolute"` without `settings.worktree.directory` set
- `worktree: true` on a parallel step when `settings.worktree.enabled` is true

**Warnings (may cause issues):**

- Variable referenced in templates but not defined in `variables` section
- `completion-promise` missing on ralph-loop (loop will only stop at max-iterations)
- No `timeout-minutes` on long-running steps
- `on-error: fail` without `max-retry` (any failure stops the workflow)
- Non-qualified skill names in prompt steps (e.g., `/sdlc-plan` instead of `/sdlc-plan`)
- Step name not in kebab-case
- Variable name not in snake_case
- Skill invocation used with `runtime: codex` (skills not supported by Codex)
