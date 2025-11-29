---
name: git-pr
description: Create a pull request with contextual title and description
argument-hint: [base-branch]
---

# Git PR Command

Creates a pull request using the GitHub CLI with a descriptive title and appropriately-sized description.

## Parameters

- **`base-branch`** (optional): Target branch for the PR. Defaults to main/master.

## Objective

Create a pull request with a title and description sized appropriately to the scope and impact of the changes.

## Core Principles

- PR size dictates description length - small changes get small descriptions
- Title should clearly convey the primary change
- Description focuses on WHY and context, not WHAT (diff shows the what)
- Use `gh pr create` for PR creation
- Never include AI attribution in PR descriptions

## Instructions

1. Verify current branch is not the base branch
2. Run `git log <base>..HEAD --oneline` to get commits in this PR
3. Run `git diff <base>...HEAD --stat` to assess change scope
4. Determine PR size category:
   - **Trivial**: <10 lines, single file, style/typo fix
   - **Small**: <50 lines, focused change
   - **Medium**: 50-200 lines, feature or significant fix
   - **Large**: >200 lines, major feature or refactor
5. Construct PR content based on size:

   **Trivial**: One-line description

   ```
   gh pr create --title "Fix typo in README" --body "Corrects spelling error"
   ```

   **Small**: Brief summary (1-2 sentences)

   ```
   gh pr create --title "Add input validation" --body "Adds validation to prevent empty submissions"
   ```

   **Medium/Large**: Structured description

   ```
   gh pr create --title "<title>" --body "## Summary
   <1-2 sentence overview>

   ## Details
   - <Key change 1 with context>
   - <Key change 2 with context>"
   ```

6. Execute `gh pr create` with constructed content
7. Report the PR URL

## Output Guidance

- Show the PR title and description that will be used
- Confirm PR creation with the URL
- On error, report the gh CLI error
