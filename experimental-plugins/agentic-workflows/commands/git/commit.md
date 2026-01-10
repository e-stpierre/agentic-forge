---
name: git-commit
description: Create a git commit
output: json
arguments:
  - name: message
    description: Commit message (auto-generated if not provided)
    required: false
  - name: files
    description: Specific files to commit (default: all staged)
    required: false
  - name: plan_step
    description: Reference to plan step being completed
    required: false
---

# Git Commit Command

Create a git commit with staged changes.

## Behavior

1. If no message provided, analyze changes and generate appropriate message
2. Stage specified files or use already staged files
3. Create commit
4. Return commit details

## Output Format

```json
{
  "success": true,
  "commit_hash": "abc1234",
  "message": "Implement OAuth callback handler",
  "files_committed": ["src/auth/callback.ts", "src/auth/callback.test.ts"],
  "stats": {
    "files_changed": 2,
    "insertions": 145,
    "deletions": 23
  }
}
```

## Commit Message Guidelines

When auto-generating commit messages:

- Use imperative mood ("Add feature" not "Added feature")
- Keep first line under 72 characters
- Reference plan step if applicable
- Include Co-Authored-By for agentic commits

## Process

1. Check for staged changes
2. Generate or validate commit message
3. Execute git commit
4. Return commit details

---

{% if message %}Message: {{ message }}{% endif %}
{% if files %}Files: {{ files }}{% endif %}
{% if plan_step %}Plan Step: {{ plan_step }}{% endif %}

---

Create the commit and return JSON output.
