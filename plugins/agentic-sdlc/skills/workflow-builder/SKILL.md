---
name: workflow-builder
description: Create, update, explain, validate, and debug agentic-sdlc YAML workflows with comprehensive schema knowledge
argument-hint: <request>
---

# Workflow Builder

## Overview

Create, update, explain, validate, and debug agentic-sdlc YAML workflows. This skill has comprehensive knowledge of every workflow property, step type, setting, and pattern. Use it when you need to author new workflows, modify existing ones, understand workflow features, check YAML correctness, or troubleshoot execution issues.

## Arguments

### Definitions

- **`<request>`** (required): Free-form description of what you want. Examples: "create a workflow that plans and reviews a feature", "update my-workflow.yaml to add a parallel step", "explain how ralph-loop works", "validate my-workflow.yaml", "debug why my conditional always takes the else branch"

### Values

\$ARGUMENTS

## Additional Resources

- For the complete annotated workflow example, see [workflow-example.yaml](references/workflow-example.yaml)
- For the complete schema reference with all properties, types, and defaults, see [REFERENCE.md](references/REFERENCE.md)

## Core Principles

- Always produce valid YAML that conforms to the workflow schema
- Use kebab-case for all YAML keys (e.g., `timeout-minutes`, `max-retry`, `on-error`)
- Use kebab-case for step names and workflow names (e.g., `analyze-codebase`, `implement-feature`)
- Use snake_case for variable names (e.g., `max_iterations`, `fix_severity`)
- Always use fully qualified skill names in prompt steps (e.g., `/agentic-sdlc:sdlc-plan` not `/sdlc-plan`)
- Keep workflows focused: prefer composing simple workflows over one massive workflow
- Every workflow requires `name`, `version: "1.0"`, and at least one step
- Include descriptions on the workflow and variables for documentation
- When updating workflows, read the existing file first and preserve structure
- When validating, check: required fields, valid step types, valid setting values, variable type consistency, no nested parallel steps
- When debugging, look for: undefined template variables, incorrect condition expressions, missing completion-promise in ralph loops, timeout issues

## Skill-Specific Guidelines

### Operation Modes

**Create** - Generate a complete workflow YAML from a description:

1. Ask clarifying questions if the request is ambiguous
2. Choose appropriate step types for the task
3. Define variables for configurable values
4. Set reasonable defaults for settings and timeouts
5. Write the YAML file to the requested location (default: project root or `agentic/workflows/`)

**Update** - Modify an existing workflow YAML:

1. Read the existing workflow file
2. Understand the current structure
3. Apply the requested changes
4. Preserve comments and formatting where possible

**Explain** - Answer questions about workflow features:

1. Reference the schema to provide accurate information
2. Include examples from the reference workflow
3. Explain defaults and valid values

**Validate** - Check a workflow YAML for correctness:

1. Read the workflow file
2. Check against the schema (required fields, valid types, valid values)
3. Report issues with specific field references
4. Suggest fixes for each issue found

**Debug** - Help troubleshoot workflow execution issues:

1. Read the workflow YAML and any error output
2. Check for common issues (undefined variables, incorrect conditions, missing fields)
3. Check `agentic/outputs/<workflow-id>/progress.json` if available
4. Suggest specific fixes

### Step Type Selection Guide

| Step Type        | Use When                                           |
| ---------------- | -------------------------------------------------- |
| `prompt`         | Single task, skill invocation, or simple operation |
| `serial`         | Multiple tasks that must run in sequence           |
| `parallel`       | Independent tasks that can run concurrently        |
| `conditional`    | Branching logic based on variables or outputs      |
| `ralph-loop`     | Iterative work with unknown iteration count        |
| `wait-for-human` | Pause for human review, approval, or input         |

### Model Selection Strategy

| Model    | Best For                                            |
| -------- | --------------------------------------------------- |
| `haiku`  | Quick tasks: validation, formatting, small analysis |
| `sonnet` | Default: implementation, review, planning           |
| `opus`   | Complex reasoning: architecture, large refactors    |

Priority: step `model` > `settings.model` > config default > `sonnet`

### Common Patterns

**Plan-Build-Review**: plan (prompt) -> implement (ralph-loop) -> review (prompt) -> conditional fix -> conditional PR

**Parallel Analysis**: parallel step with multiple analyze prompts, each with `on-error: skip`

**Iterative Implementation**: ralph-loop with completion-promise, reading a plan file each iteration

**Gated Deployment**: implement -> review -> wait-for-human approval -> conditional deploy

### Common Debugging Issues

| Symptom                                | Likely Cause                                   | Fix                                                              |
| -------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| "Missing required variable"            | Variable not passed via `--var`                | Add `--var "name=value"` to CLI or set `default`                 |
| Conditional always takes else          | Condition expression evaluates to falsy        | Check Jinja2 expression syntax and variable names                |
| Ralph loop never completes             | Completion JSON not output or promise mismatch | Verify `completion-promise` matches the `promise` field in JSON  |
| Template variable shows as `{{ ... }}` | Undefined variable in lenient mode             | Define the variable or enable `strict-mode: true` to catch early |
| Step timeout                           | Task exceeds `timeout-minutes`                 | Increase step or workflow `timeout-minutes`                      |
| "Nested parallel steps not allowed"    | Parallel step inside another parallel          | Flatten structure or use serial inside parallel                  |

## Instructions

1. **Identify the operation** from the user's request (create, update, explain, validate, or debug)
2. **Load reference material**: Read [REFERENCE.md](references/REFERENCE.md) for schema details and [workflow-example.yaml](references/workflow-example.yaml) for patterns
3. **For create operations**:
   a. Determine which step types are needed
   b. Identify what variables should be configurable
   c. Choose appropriate settings (git, timeouts, model)
   d. Generate the complete YAML with comments explaining key sections
   e. Write the file to the appropriate location
4. **For update operations**:
   a. Read the existing workflow YAML file
   b. Understand the current structure and intent
   c. Apply the requested modifications
   d. Validate the result is still correct
5. **For explain operations**:
   a. Reference the schema to provide accurate, complete answers
   b. Include relevant examples
   c. Mention defaults, valid values, and edge cases
6. **For validate operations**:
   a. Read the workflow YAML file
   b. Check all required fields are present
   c. Verify step types have their required properties
   d. Check variable references in templates exist in the variables section
   e. Report all issues found with suggestions
7. **For debug operations**:
   a. Read the workflow YAML and any error output or progress files
   b. Identify the root cause of the issue
   c. Provide a specific fix with updated YAML

## Output Guidance

After completing the operation, output a JSON object:

```json
{
  "status": "completed",
  "operation": "create | update | explain | validate | debug",
  "workflow": {
    "name": "workflow-name",
    "path": "path/to/workflow.yaml"
  },
  "summary": "Brief description of what was done",
  "issues": [],
  "suggestions": []
}
```

For validate operations, populate `issues`:

```json
{
  "issues": [
    {
      "severity": "error | warning",
      "field": "steps[0].type",
      "message": "Invalid step type: 'loop'",
      "suggestion": "Use 'ralph-loop' instead"
    }
  ]
}
```
