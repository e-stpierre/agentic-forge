---
name: git-worktree
description: Manage git worktrees
output: json
arguments:
  - name: action
    description: Action (create, remove, list)
    required: true
  - name: name
    description: Worktree/branch name (for create)
    required: false
  - name: path
    description: Worktree path (for remove)
    required: false
  - name: base
    description: Base branch (for create)
    required: false
---

# Git Worktree Command

Manage git worktrees for parallel development.

## Actions

- **create**: Create a new worktree with dedicated branch
- **remove**: Remove an existing worktree
- **list**: List all worktrees

## Naming Convention

Worktrees follow this naming pattern:
- Path: `.worktrees/agentic-{workflow}-{step}-{random}`
- Branch: `agentic/{workflow}-{step}-{random}`

Names are truncated to 30 characters each to avoid Windows path length issues.

## Output Format

### Create

```json
{
  "success": true,
  "action": "create",
  "worktree": {
    "path": ".worktrees/agentic-feature-auth-abc123",
    "branch": "agentic/feature-auth-abc123",
    "base": "main"
  }
}
```

### List

```json
{
  "success": true,
  "action": "list",
  "worktrees": [
    {
      "path": ".worktrees/agentic-feature-auth-abc123",
      "branch": "agentic/feature-auth-abc123"
    }
  ]
}
```

### Remove

```json
{
  "success": true,
  "action": "remove",
  "removed_path": ".worktrees/agentic-feature-auth-abc123",
  "branch_deleted": true
}
```

## Process

1. Validate action and parameters
2. Execute worktree operation
3. Handle any cleanup (prune orphaned)
4. Return result

---

Action: {{ action }}
{% if name %}Name: {{ name }}{% endif %}
{% if path %}Path: {{ path }}{% endif %}
{% if base %}Base: {{ base }}{% endif %}

---

Execute the worktree operation and return JSON output.
