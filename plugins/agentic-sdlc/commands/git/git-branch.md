---
name: git-branch
description: Create a git branch following naming convention
argument-hint: [category] [name] [base]
---

# Git Branch Command

Creates a new git branch following the naming convention: `<category>/<issue-id>_<branch-name>` or `<category>/<branch-name>` when no issue ID is provided.

## Arguments

- **`[category]`** (optional): Branch type. Common values: poc, feature, fix, chore, doc, refactor. Accepts any value. Defaults to `feature`
- **`<name>`** (optional): Short kebab-case description of the work. Infer from context if not provided, default to `agentic/<random-id>`
- **`[base]`** (optional): Base branch to create from. If not provided, branch from current location

## Objective

Create and checkout a new branch with consistent naming that links to issue tracking when available.

## Core Principles

- Use kebab-case for branch names (lowercase, hyphens)
- Keep branch names concise but descriptive
- Include issue ID when context provides one
- Never prompt interactively - extract from context or use defaults
- Accept any category value provided

## Instructions

1. Parse the provided arguments to extract category, name, and base (if present)
2. If arguments are incomplete, infer from conversation context:
   - Look for GitHub issue references (#123, issue 123)
   - Derive branch name from the task description
   - Default category to `feature` if not provided
   - Default name to `agentic/<random-id>` if not provided
3. Use the provided category or default to `feature`. Common categories: poc, feature, fix, chore, doc, refactor
4. Determine base branch:
   - If base is provided, checkout that branch first
   - Otherwise branch from current location
5. Construct the branch name:
   - With issue: `<category>/<issue-id>_<name>`
   - Without issue: `<category>/<name>`
6. Execute: `git checkout -b <constructed-branch-name>` (from base if provided)
7. Return JSON output with branch details

## Output Guidance

Return JSON with branch creation details:

```json
{
  "success": true,
  "branch": "feature/123_add-user-auth",
  "base": "main",
  "category": "feature",
  "issue_id": "123"
}
```
