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
| `model`              | string | `"sonnet"` | sonnet, haiku, opus          | Default model for all steps                      |
| `required-tools`     | list   | `[]`       | Tool names                   | Tools Claude can use without prompting           |

### Git Settings

Nested under `settings.git`:

| Key             | Type   | Default     | Valid Values | Description                      |
| --------------- | ------ | ----------- | ------------ | -------------------------------- |
| `enabled`       | bool   | `false`     | true/false   | Enable git operations            |
| `worktree`      | bool   | `false`     | true/false   | Use worktrees for parallel steps |
| `auto-commit`   | bool   | `true`      | true/false   | Auto-commit after each step      |
| `auto-pr`       | bool   | `true`      | true/false   | Auto-create PR on completion     |
| `branch-prefix` | string | `"agentic"` | any string   | Prefix for branch names          |

```yaml
settings:
  git:
    enabled: true
    worktree: true
    auto-commit: true
    auto-pr: false
    branch-prefix: "feature"
```

## Variables

Define input parameters for the workflow. Passed via `--var "name=value"` on the CLI.

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

| Key               | Type   | Default      | Valid Values                                                      | Description                  |
| ----------------- | ------ | ------------ | ----------------------------------------------------------------- | ---------------------------- |
| `name`            | string | **required** | kebab-case                                                        | Unique step identifier       |
| `type`            | string | **required** | prompt, serial, parallel, conditional, ralph-loop, wait-for-human | Step type                    |
| `model`           | string | null         | sonnet, haiku, opus                                               | Override workflow model      |
| `timeout-minutes` | int    | null         | 1+                                                                | Override workflow timeout    |
| `max-retry`       | int    | null         | 0+                                                                | Override workflow max-retry  |
| `on-error`        | string | `"retry"`    | retry, skip, fail                                                 | Error handling strategy      |
| `checkpoint`      | bool   | `false`      | true/false                                                        | Create checkpoint after step |
| `depends-on`      | string | null         | step name                                                         | Step dependency              |

### prompt

Execute a prompt in a Claude session. The most common step type.

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

# Skill invocation (always use fully qualified names)
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

| Key              | Type   | Default         | Description                                          |
| ---------------- | ------ | --------------- | ---------------------------------------------------- |
| `steps`          | list   | **required**    | List of nested step definitions                      |
| `merge-strategy` | string | `"wait-all"`    | Only "wait-all" supported                            |
| `merge-mode`     | string | `"independent"` | "independent" (no merge) or "merge" (merge branches) |
| `git`            | object | null            | Step-level git config (see below)                    |

**Step-level git (parallel only):**

| Key             | Type   | Default     | Description                        |
| --------------- | ------ | ----------- | ---------------------------------- |
| `worktree`      | bool   | `false`     | Run each step in separate worktree |
| `branch-prefix` | string | `"agentic"` | Prefix for parallel branch names   |
| `auto-pr`       | bool   | `false`     | Auto-create PR per branch          |

**Constraints:**

- Nested parallel steps are NOT allowed (parallel inside parallel)
- When `merge-mode: merge`, branches are merged back to the parent branch after all complete
- When `merge-mode: independent`, each branch stays separate

```yaml
- name: parallel-analysis
  type: parallel
  merge-strategy: wait-all
  merge-mode: independent
  git:
    worktree: true
    branch-prefix: "analysis"
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

Branch execution based on a Jinja2 condition expression.

**Specific properties:**

| Key         | Type   | Required | Description                                |
| ----------- | ------ | -------- | ------------------------------------------ |
| `condition` | string | Yes      | Jinja2 expression evaluating to true/false |
| `then`      | list   | Yes      | Steps to execute if condition is true      |
| `else`      | list   | No       | Steps to execute if condition is false     |

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

Iterative prompt execution with completion detection. Each iteration runs in a fresh Claude session.

**Specific properties:**

| Key                  | Type          | Default      | Description                                      |
| -------------------- | ------------- | ------------ | ------------------------------------------------ |
| `prompt`             | string        | **required** | Prompt template for each iteration               |
| `max-iterations`     | int or string | `5`          | Maximum iterations (supports variable templates) |
| `completion-promise` | string        | null         | Text to match in completion JSON `promise` field |

**How it works:**

1. Each iteration runs in a fresh Claude session (no context accumulation)
2. State persists in `agentic/outputs/{workflow-id}/ralph-{step-name}.md`
3. Loop exits when Claude outputs completion JSON or max iterations reached
4. Additional template variables: `{{ iteration }}` (current), `{{ max_iterations }}` (max)

**Completion JSON format** (Claude must output this when done):

```json
{ "ralph_complete": true, "promise": "YOUR_PROMISE_TEXT" }
```

**Failure signal** (Claude outputs this if stuck):

```json
{ "ralph_complete": false }
```

The `completion-promise` setting must match the `promise` value in Claude's JSON output.

````yaml
- name: implement-milestones
  type: ralph-loop
  prompt: |
    Read the plan at agentic/outputs/{{ workflow_id }}/plan.md.
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
    Review the implementation at agentic/outputs/{{ workflow_id }}/plan.md.
    Respond with "approved" to continue or provide feedback.
  polling-interval: 30
  on-timeout: abort
  timeout-minutes: 120
```

## Templating

Workflows use Jinja2 for dynamic content in prompts, conditions, and output paths.

### Built-in Variables

| Variable                       | Description                            |
| ------------------------------ | -------------------------------------- |
| `{{ workflow_id }}`            | Unique workflow execution ID           |
| `{{ workflow_name }}`          | Workflow name from YAML                |
| `{{ variables.<name> }}`       | User-defined variable                  |
| `{{ outputs.<step>.<field> }}` | Output from a previous step            |
| `{{ iteration }}`              | Current ralph-loop iteration (1-based) |
| `{{ max_iterations }}`         | Max iterations for ralph-loop          |

### Jinja2 Filters

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
| `template` | Yes      | string | -             | Jinja2 template file path             |
| `path`     | Yes      | string | -             | Output file path (supports templates) |
| `when`     | No       | string | `"completed"` | "completed" or "failed"               |

Template resolution order:

1. Workflow directory (same directory as the YAML file)
2. `agentic/templates/`
3. Bundled plugin templates

Template context variables: `workflow`, `variables`, `outputs`, `progress`, `steps`, `analysis_steps`, `fix_steps`, `files_changed`, `branches`, `pull_requests`, `inputs`

```yaml
outputs:
  - name: report
    template: report.md.j2
    path: agentic/outputs/{{ workflow_id }}/report.md
    when: completed
  - name: error-log
    template: error.md.j2
    path: agentic/outputs/{{ workflow_id }}/error.md
    when: failed
```

## CLI Commands

```bash
# Run a workflow
agentic-forge run <workflow-name-or-path> --var "key=value" [--from-step <name>] [--terminal-output base|all]

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

# Configuration
agentic-forge config get <key>
agentic-forge config set <key> <value>
agentic-forge configure
```

## Available Skills for Prompt Steps

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

| Workflow                 | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| `demo`                   | Validation workflow for installation testing                            |
| `one-shot`               | Complete a single task with optional PR                                 |
| `plan-build-review`      | Full SDLC: plan -> implement -> review -> fix -> PR                     |
| `ralph-loop`             | Generic iterative loop for any task                                     |
| `analyze-codebase`       | Parallel analysis (5 types) with optional autofix, independent branches |
| `analyze-codebase-merge` | Parallel analysis with autofix, branch merge, validation, and PR        |
| `analyze-single`         | Single analysis type with optional autofix                              |

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

**Warnings (may cause issues):**

- Variable referenced in templates but not defined in `variables` section
- `completion-promise` missing on ralph-loop (loop will only stop at max-iterations)
- No `timeout-minutes` on long-running steps
- `on-error: fail` without `max-retry` (any failure stops the workflow)
- Non-qualified skill names in prompt steps (e.g., `/sdlc-plan` instead of `/sdlc-plan`)
- Step name not in kebab-case
- Variable name not in snake_case
