# Workflow Builder Guide

Complete guide to authoring YAML workflows for agentic-sdlc.

## Table of Contents

- [Workflow Structure](#workflow-structure)
- [Settings](#settings)
- [Variables](#variables)
- [Step Types](#step-types)
- [Templating with Jinja2](#templating-with-jinja2)
- [Git Integration](#git-integration)
- [Error Handling](#error-handling)
- [Outputs](#outputs)
- [Best Practices](#best-practices)

## Workflow Structure

Every workflow YAML file has this basic structure:

```yaml
name: workflow-name          # Unique identifier
version: "1.0"               # Schema version
description: Description     # Human-readable description

settings:                    # Workflow configuration (optional)
  max-retry: 3
  timeout-minutes: 60
  track-progress: true

variables:                   # Input parameters (optional)
  - name: task
    type: string
    required: true
    description: Task to complete

steps:                       # Workflow steps (required)
  - name: step-1
    type: prompt
    prompt: |
      Execute this task: {{ variables.task }}

outputs:                     # Output artifacts (optional)
  - name: report
    template: report.md.j2
    path: report.md
    when: completed
```

## Settings

Configure workflow behavior with these settings:

### Global Settings

```yaml
settings:
  # Retry failed steps automatically
  max-retry: 3                    # Default: 3, Range: 0+

  # Maximum time for entire workflow
  timeout-minutes: 180            # Default: 60, Range: 1+

  # Track progress in progress.json
  track-progress: true            # Default: true

  # Auto-fix issues during validation
  autofix: "major"                # Options: none, minor, major, critical

  # Terminal output verbosity
  terminal-output: "base"         # Options: base (last message), all (stream)

  # Bypass permission prompts (use with caution)
  bypass-permissions: false       # Default: false

  # Tools Claude can use without prompting
  required-tools:                 # Default: []
    - "Bash"
    - "Edit"
    - "Write"
```

### Git Settings

```yaml
settings:
  git:
    # Enable git operations
    enabled: true                 # Default: false

    # Use worktrees for parallel steps
    worktree: true                # Default: false

    # Auto-commit changes after each step
    auto-commit: true             # Default: true

    # Auto-create PR when workflow completes
    auto-pr: true                 # Default: true

    # Prefix for branch names
    branch-prefix: "feature"      # Default: "agentic"
```

## Variables

Define input parameters for your workflow:

```yaml
variables:
  # Required string variable
  - name: task
    type: string
    required: true
    description: Task description

  # Optional variable with default
  - name: severity
    type: string
    required: false
    default: "major"
    description: Minimum severity level

  # Boolean variable
  - name: create_pr
    type: boolean
    required: false
    default: true
    description: Whether to create PR

  # Number variable
  - name: max_iterations
    type: number
    required: false
    default: 10
    description: Maximum loop iterations
```

**Variable Types:**
- `string` - Text values
- `number` - Numeric values
- `boolean` - true/false values

**Using Variables:**

Pass variables via CLI:
```bash
agentic-sdlc run workflow.yaml --var "task=Add login" --var "create_pr=true"
```

Reference in workflow:
```yaml
prompt: "{{ variables.task }}"
condition: "{{ variables.create_pr }}"
```

## Step Types

### Prompt Step

Execute a custom prompt in a Claude session.

```yaml
steps:
  - name: implement-feature
    type: prompt
    prompt: |
      Implement the following feature:
      {{ variables.task }}

      Follow the plan in {{ variables.plan_path }}
    model: sonnet                    # Optional: sonnet, haiku, opus
    timeout-minutes: 30              # Optional: override global timeout
    max-retry: 2                     # Optional: override global retry
    on-error: retry                  # Optional: retry, skip, fail
    checkpoint: true                 # Optional: create checkpoint after step
```

### Command Step

Execute a Claude command with arguments.

```yaml
steps:
  - name: run-validation
    type: command
    command: agentic-sdlc:validate   # Must use namespace prefix
    args:
      plan: "agentic/outputs/{{ workflow_id }}/plan.md"
      severity: minor
    checkpoint: true
```

**Available Commands:**
- `agentic-sdlc:plan` - Generate implementation plan
- `agentic-sdlc:build` - Implement changes from plan
- `agentic-sdlc:validate` - Run validation checks
- `agentic-sdlc:analyse-bug` - Analyze for bugs
- `agentic-sdlc:analyse-debt` - Find technical debt
- `agentic-sdlc:analyse-doc` - Check documentation
- `agentic-sdlc:analyse-security` - Security scan
- `agentic-sdlc:analyse-style` - Code style check
- `agentic-sdlc:git-branch` - Create git branch
- `agentic-sdlc:git-commit` - Create commit
- `agentic-sdlc:git-pr` - Create pull request

### Serial Step

Execute nested steps sequentially.

```yaml
steps:
  - name: sequential-tasks
    type: serial
    steps:
      - name: step-1
        type: prompt
        prompt: "First task"

      - name: step-2
        type: prompt
        prompt: "Second task (runs after step-1)"

      - name: step-3
        type: command
        command: agentic-sdlc:validate
```

### Parallel Step

Execute nested steps concurrently in git worktrees.

```yaml
steps:
  - name: run-all-analysis
    type: parallel
    merge-strategy: wait-all         # Wait for all to complete
    merge-mode: independent          # independent or merge
    git:
      worktree: true                 # Run in separate worktrees
      branch-prefix: "analysis"
    steps:
      - name: security
        type: command
        command: agentic-sdlc:analyse-security

      - name: style
        type: command
        command: agentic-sdlc:analyse-style

      - name: bugs
        type: command
        command: agentic-sdlc:analyse-bug
```

**Merge Strategies:**
- `wait-all` - Wait for all parallel steps to complete

**Merge Modes:**
- `independent` - Each step works in isolation (no branch merging)
- `merge` - Merge parallel branches back to parent branch

### Conditional Step

Execute steps based on conditions.

```yaml
steps:
  - name: fix-if-needed
    type: conditional
    # Jinja2 condition expression
    condition: "{{ outputs.validate.issues | length > 0 }}"
    then:
      - name: apply-fixes
        type: prompt
        prompt: "Fix the issues found"
    else:
      - name: log-success
        type: prompt
        prompt: "No issues found!"
```

**Common Conditions:**

```yaml
# Check if variable is true
condition: "{{ variables.create_pr }}"

# Check output property
condition: "{{ outputs.validate.passed }}"

# Check list length
condition: "{{ outputs.validate.issues | length > 0 }}"

# Filter and count
condition: "{{ outputs.validate.issues | selectattr('severity', 'eq', 'critical') | list | length > 0 }}"

# Compare values
condition: "{{ variables.severity == 'major' }}"
```

### Ralph Loop Step

Iterative prompt execution with completion detection.

```yaml
steps:
  - name: implement-incrementally
    type: ralph-loop
    prompt: |
      Read the plan at {{ variables.plan_path }}.
      Implement the next incomplete milestone.

      After implementing:
      1. Run tests to verify
      2. Commit your changes
      3. Mark milestone as complete in plan

      When ALL milestones are complete, output:
      ```json
      {"ralph_complete": true, "promise": "ALL_DONE"}
      ```

      IMPORTANT: Only output completion JSON when genuinely finished.
    max-iterations: 10               # Maximum iterations
    completion-promise: "ALL_DONE"   # Text to match in completion JSON
    model: sonnet
    checkpoint: true
```

**How Ralph Loops Work:**
1. Each iteration runs in a fresh Claude session (no context accumulation)
2. State persists in `agentic/outputs/{workflow-id}/ralph-{step-name}.md`
3. Loop exits when Claude outputs the completion JSON or max iterations reached
4. The `completion-promise` field must match the `promise` value in Claude's JSON output

**Completion JSON Format:**
```json
{
  "ralph_complete": true,
  "promise": "YOUR_PROMISE_TEXT"
}
```

### Wait for Human Step

Pause workflow for human input.

```yaml
steps:
  - name: get-approval
    type: wait-for-human
    message: |
      Review the plan at agentic/outputs/{{ workflow_id }}/plan.md

      Respond with:
      - "approved" to continue
      - Provide feedback for changes
    polling-interval: 15             # Check every 15 seconds
    on-timeout: abort                # abort or continue
    timeout-minutes: 1440            # 24 hours default
```

**Providing Input:**
```bash
# User provides input via CLI
agentic-sdlc input <workflow-id> "approved"
```

## Templating with Jinja2

Workflows use Jinja2 templating for dynamic content.

### Built-in Variables

```yaml
{{ workflow_id }}         # Unique workflow execution ID
{{ workflow_name }}       # Workflow name from YAML
{{ variables.name }}      # Access workflow variables
{{ outputs.step.field }}  # Access step outputs
```

### Accessing Outputs

```yaml
# Previous step output
{{ outputs.plan.summary }}

# Nested field access
{{ outputs.validate.issues[0].severity }}

# Check if field exists
{% if outputs.validate.passed %}
```

### Filters

```yaml
# List operations
{{ list | length }}                    # Count items
{{ list | first }}                     # First item
{{ list | last }}                      # Last item

# Filtering
{{ items | selectattr('status', 'eq', 'active') }}
{{ items | rejectattr('done', 'true') }}

# String operations
{{ text | upper }}                     # Uppercase
{{ text | lower }}                     # Lowercase
{{ text | replace('old', 'new') }}     # Replace

# JSON serialization
{{ data | tojson }}                    # Convert to JSON string
```

### Conditionals in Templates

```yaml
{% if variables.create_pr %}
Create PR: {{ variables.pr_title }}
{% else %}
Skip PR creation
{% endif %}

{% for item in outputs.issues %}
- {{ item.description }}
{% endfor %}
```

## Git Integration

### Workflow-Level Git

Enable git for the entire workflow:

```yaml
settings:
  git:
    enabled: true
    worktree: false        # Use main working directory
    auto-commit: true
    auto-pr: true
    branch-prefix: "feature"
```

### Step-Level Git (Parallel Steps)

Use worktrees for parallel step isolation:

```yaml
steps:
  - name: parallel-features
    type: parallel
    git:
      worktree: true       # Each step in separate worktree
      branch-prefix: "feat"
    steps:
      - name: feature-a
        type: prompt
        prompt: "Implement feature A"

      - name: feature-b
        type: prompt
        prompt: "Implement feature B"
```

**How Worktrees Work:**
1. Python creates a git worktree for each parallel step
2. Each step runs in its isolated worktree
3. Changes are committed to separate branches
4. Worktrees are cleaned up after execution

## Error Handling

### Retry Configuration

```yaml
steps:
  - name: flaky-operation
    type: command
    command: agentic-sdlc:validate
    max-retry: 5           # Retry up to 5 times
    on-error: retry        # retry, skip, or fail
    timeout-minutes: 10
```

**Error Actions:**
- `retry` - Retry the step (up to max-retry times)
- `skip` - Skip the step and continue workflow
- `fail` - Fail the entire workflow immediately

### Timeouts

```yaml
# Workflow-level timeout
settings:
  timeout-minutes: 180

# Step-level timeout (overrides workflow)
steps:
  - name: long-running
    type: prompt
    prompt: "Long task"
    timeout-minutes: 60
```

### Checkpoints

Create checkpoints to track progress:

```yaml
steps:
  - name: critical-step
    type: command
    command: agentic-sdlc:plan
    checkpoint: true       # Create checkpoint after success
```

Checkpoints are saved to `agentic/outputs/{workflow-id}/checkpoint.md`.

## Outputs

Generate artifacts when workflow completes or fails:

```yaml
outputs:
  - name: implementation-report
    template: report.md.j2     # Jinja2 template file
    path: report.md            # Output file path
    when: completed            # completed or failed

  - name: error-log
    template: error.md.j2
    path: error.md
    when: failed
```

**Template Location:**
Templates are resolved from:
1. Workflow directory (same directory as YAML file)
2. `agentic/templates/`
3. Bundled plugin templates

**Template Context:**
Templates have access to:
- `workflow` - Workflow metadata
- `variables` - All workflow variables
- `outputs` - All step outputs
- `progress` - Workflow progress data

## Best Practices

### 1. Use Meaningful Names

```yaml
# Good
- name: validate-implementation
  type: command
  command: agentic-sdlc:validate

# Avoid
- name: step-1
  type: command
  command: agentic-sdlc:validate
```

### 2. Add Checkpoints for Long Workflows

```yaml
steps:
  - name: plan
    type: command
    command: agentic-sdlc:plan
    checkpoint: true         # Can resume from here

  - name: implement
    type: ralph-loop
    checkpoint: true         # Checkpoint after each milestone
```

### 3. Set Appropriate Timeouts

```yaml
# Short tasks
- name: quick-validation
  timeout-minutes: 5

# Long implementations
- name: full-implementation
  timeout-minutes: 120
```

### 4. Use Variables for Flexibility

```yaml
# Don't hardcode values
prompt: "Fix issues with severity major or higher"

# Use variables instead
prompt: "Fix issues with severity {{ variables.severity }} or higher"
```

### 5. Handle Errors Gracefully

```yaml
- name: optional-task
  type: command
  command: agentic-sdlc:analyse-style
  on-error: skip           # Don't fail workflow if this fails
  max-retry: 1             # Try once, then skip
```

### 6. Use Parallel Steps for Independent Tasks

```yaml
# Run independent analysis in parallel
- name: analyze-codebase
  type: parallel
  git:
    worktree: true
  steps:
    - name: security
      type: command
      command: agentic-sdlc:analyse-security

    - name: bugs
      type: command
      command: agentic-sdlc:analyse-bug
```

### 7. Document with Descriptions

```yaml
name: plan-build-validate
description: |
  Complete SDLC workflow:
  1. Generate implementation plan
  2. Implement changes incrementally
  3. Validate with tests and code review
  4. Create pull request

variables:
  - name: task
    description: Feature or bug description for planning

  - name: fix_severity
    description: Minimum severity level for auto-fixing issues
```

### 8. Use Ralph Loops for Incremental Work

```yaml
# Good for: Implementing multiple milestones incrementally
- name: implement
  type: ralph-loop
  prompt: |
    Implement next incomplete milestone from plan.
    Output completion JSON when ALL milestones done.
  max-iterations: 10

# Not good for: Single-step tasks (use prompt instead)
```

## Complete Example

See [workflow-example.yaml](./workflow-example.yaml) for a fully annotated reference workflow with all available options.

## Schema Reference

The complete workflow schema is available at `schemas/workflow.schema.json` in the plugin directory.

## Next Steps

- **Quick start**: See [QuickStart.md](./QuickStart.md) to run your first workflow
- **Examples**: Check bundled workflows in `src/agentic_sdlc/workflows/`
- **Contributing**: See [Contributing.md](./Contributing.md) for development guidelines
