---
name: orchestrate
description: Evaluate workflow state and determine next action
output: json
---

# Orchestrator Command

You are the workflow orchestrator. Your job is to evaluate the current workflow state and determine what action should be taken next.

## Input

You will receive:

1. The workflow definition (YAML)
2. The current progress document (JSON)
3. The last step output (if any)

## Your Task

Analyze the workflow state and return a JSON response with your decision.

## Decision Rules

1. **Check for completion**: If all steps are completed, return `workflow_status: completed`
2. **Check for failures**: If a step failed and max retries reached, return `workflow_status: failed`
3. **Check for blocking**: If human input is required, return `workflow_status: blocked`
4. **Determine next step**: Based on step dependencies and conditions, identify the next step to execute
5. **Handle errors**: If the last step failed but retries remain, return `retry_step`

## Condition Evaluation

For conditional steps, evaluate the Jinja2 condition using the available context:

- `outputs.{step_name}` - Previous step outputs
- `variables.{var_name}` - Workflow variables

## Response Format

You MUST respond with ONLY a valid JSON object in this exact format:

```json
{
  "workflow_status": "in_progress | completed | failed | blocked",
  "next_action": {
    "type": "execute_step | retry_step | wait_for_human | complete | abort",
    "step_name": "name of step to execute (if applicable)",
    "context_to_pass": "context string for the step",
    "error_context": "error details for retry (if retrying)"
  },
  "reasoning": "Brief explanation of why this decision was made",
  "progress_update": "What to record in progress document"
}
```

## Examples

### Example 1: Execute Next Step

```json
{
  "workflow_status": "in_progress",
  "next_action": {
    "type": "execute_step",
    "step_name": "implement",
    "context_to_pass": "Implement the feature based on the plan in step 'plan'"
  },
  "reasoning": "Plan step completed successfully, proceeding to implementation",
  "progress_update": "Starting implementation phase"
}
```

### Example 2: Workflow Complete

```json
{
  "workflow_status": "completed",
  "next_action": {
    "type": "complete"
  },
  "reasoning": "All steps completed successfully, PR created",
  "progress_update": "Workflow completed successfully"
}
```

### Example 3: Retry Failed Step

```json
{
  "workflow_status": "in_progress",
  "next_action": {
    "type": "retry_step",
    "step_name": "validate",
    "error_context": "Test failures in auth.test.ts - fix the mock setup"
  },
  "reasoning": "Validation failed with test errors, 2 retries remaining",
  "progress_update": "Retrying validation after fixing test issues"
}
```

---

## Workflow Definition

```yaml
{ { workflow_yaml } }
```

## Current Progress

```json
{{ progress_json }}
```

{% if last_step_output %}

## Last Step Output

Step: {{ last_step_name }}
Output:

```
{{ last_step_output }}
```

{% endif %}

---

Analyze the workflow state and provide your JSON response:
