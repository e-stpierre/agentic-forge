---
name: git-pr
description: Create a pull request
output: json
arguments:
  - name: title
    description: PR title (auto-generated if not provided)
    required: false
  - name: body
    description: PR body/description
    required: false
  - name: base
    description: Base branch (default: main)
    required: false
  - name: draft
    description: Create as draft PR
    required: false
    default: false
---

# Git PR Command

Create a pull request on GitHub.

## Behavior

1. Push current branch to remote if needed
2. Generate title and body from commits if not provided
3. Create PR using gh CLI
4. Return PR details

## Output Format

```json
{
  "success": true,
  "pr_number": 42,
  "url": "https://github.com/owner/repo/pull/42",
  "title": "Implement OAuth authentication",
  "base": "main",
  "head": "feature/oauth-auth",
  "draft": false
}
```

## PR Body Template

When auto-generating PR body:

```markdown
## Summary

[Brief description from commits]

## Changes

- [List of changes from commits]

## Test Plan

[Testing instructions if applicable]

Generated with agentic-sdlc
```

## Process

1. Ensure branch is pushed to remote
2. Generate title and body if not provided
3. Create PR using `gh pr create`
4. Return PR details

---

{% if title %}Title: {{ title }}{% endif %}
{% if body %}Body: {{ body }}{% endif %}
Base: {{ base | default("main") }}
Draft: {{ draft }}

---

Create the pull request and return JSON output.
