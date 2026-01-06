---
name: git-branch
description: Create a branch with standardized naming convention
argument-hint: [category] <branch-name> [issue-id]
---

# Git Branch Command

Creates a new git branch following the naming convention: `<category>/<issue-id>_<branch-name>` or `<category>/<branch-name>` when no issue ID is provided.

## Parameters

- **`category`** (optional): Branch type. Common values: poc, feature, hotfix, chore, docs. Accepts any value. Defaults to `feature`
- **`branch-name`** (required): Short kebab-case description of the work
- **`issue-id`** (optional): GitHub issue number associated with this work

## Objective

Create and checkout a new branch with consistent naming that links to issue tracking when available.

## Core Principles

- Use kebab-case for branch names (lowercase, hyphens)
- Keep branch names concise but descriptive
- Include issue ID when context provides one
- Never prompt interactively - extract from context or use defaults
- Accept any category value provided

## Instructions

1. Parse the provided arguments to extract category, branch-name, and issue-id (if present)
2. If arguments are incomplete, infer from conversation context:
   - Look for GitHub issue references (#123, issue 123)
   - Derive branch name from the task description
   - Default category to `feature` if not provided
3. Use the provided category or default to `feature`. Common categories: poc, feature, hotfix, chore, docs
4. Construct the branch name:
   - With issue: `<category>/<issue-id>_<branch-name>`
   - Without issue: `<category>/<branch-name>`
5. Execute: `git checkout -b <constructed-branch-name>`
6. Report the created branch name

## Output Guidance

- Confirm the branch was created with the full branch name
- If inference was used, briefly state what was inferred
- On error, report the git error message
