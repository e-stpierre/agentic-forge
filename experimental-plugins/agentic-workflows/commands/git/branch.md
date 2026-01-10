---
name: git-branch
description: Create or manage git branches
output: json
arguments:
  - name: action
    description: Action (create, checkout, delete, list)
    required: true
  - name: name
    description: Branch name (for create/checkout/delete)
    required: false
  - name: base
    description: Base branch (for create)
    required: false
---

# Git Branch Command

Manage git branches for the workflow.

## Actions

- **create**: Create a new branch from base (or current)
- **checkout**: Switch to an existing branch
- **delete**: Delete a branch (local only)
- **list**: List all branches

## Output Format

```json
{
  "success": true,
  "action": "create",
  "branch": "feature/auth-impl",
  "base": "main",
  "current_branch": "feature/auth-impl"
}
```

## Branch Naming

For workflow-related branches, use the convention:

- `agentic/{workflow-name}-{step-name}-{suffix}`

## Process

1. Validate action and required parameters
2. Execute git command
3. Return current state

---

Action: {{ action }}
{% if name %}Branch: {{ name }}{% endif %}
{% if base %}Base: {{ base }}{% endif %}

---

Execute the git branch operation and return JSON output.
