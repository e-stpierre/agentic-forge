---
name: git-branch
description: Create a branch with standardized naming convention
argument-hint: <category> [issue-id] <branch-name>
---

# Git Branch Command

Creates a new git branch following the naming convention: `<category>/<issue-id>_<branch-name>` or `<category>/<branch-name>` when no issue ID is provided.

## Parameters

- **`category`** (required): Branch type - feature, fix, hotfix, refactor, docs, test, chore
- **`issue-id`** (optional): GitHub issue number associated with this work
- **`branch-name`** (required): Short kebab-case description of the work

## Objective

Create and checkout a new branch with consistent naming that links to issue tracking when available.

## Core Principles

- Use kebab-case for branch names (lowercase, hyphens)
- Keep branch names concise but descriptive
- Include issue ID when context provides one
- Never prompt interactively - extract from context or use defaults
- Validate category against allowed values

## Instructions

1. Parse the provided arguments to extract category, issue-id (if present), and branch-name
2. If arguments are incomplete, infer from conversation context:
   - Look for GitHub issue references (#123, issue 123)
   - Derive branch name from the task description
   - Default category to "feature" if unclear
3. Validate category is one of: feature, fix, hotfix, refactor, docs, test, chore
4. Construct the branch name:
   - With issue: `<category>/<issue-id>_<branch-name>`
   - Without issue: `<category>/<branch-name>`
5. Execute: `git checkout -b <constructed-branch-name>`
6. Report the created branch name

## Output Guidance

- Confirm the branch was created with the full branch name
- If inference was used, briefly state what was inferred
- On error, report the git error message
