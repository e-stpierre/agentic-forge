---
name: git-pr
description: Create a pull request with contextual title and description
output: json
arguments:
  - name: title
    description: PR title (auto-generated if not provided)
    required: false
  - name: body
    description: PR body/description (auto-generated if not provided)
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

Creates a pull request using the GitHub CLI with a descriptive title and appropriately-sized description.

## Arguments

- **`[title]`** (optional): PR title. Auto-generated if not provided.
- **`[body]`** (optional): PR body/description. Auto-generated if not provided.
- **`[base]`** (optional): Target branch for the PR. Defaults to main/master.
- **`[draft]`** (optional): Create as draft PR. Defaults to false.

## Objective

Create a pull request with a title and description sized appropriately to the scope and impact of the changes.

## Core Principles

- PR size dictates description length - small changes get small descriptions
- Title should clearly convey the primary change
- Description focuses on WHY and context, not WHAT (diff shows the what)
- Use `gh pr create` for PR creation
- Always include AI attribution at the end of the body

## Instructions

1. Verify current branch is not the base branch
2. Push current branch to remote if needed
3. Run `git log <base>..HEAD --oneline` to get commits in this PR
4. Run `git diff <base>...HEAD --stat` to assess change scope
5. Determine PR size category:
   - **Trivial**: <10 lines, single file, style/typo fix
   - **Small**: <50 lines, focused change
   - **Medium**: 50-200 lines, feature or significant fix
   - **Large**: >200 lines, major feature or refactor
6. Construct PR content based on size:

   **Trivial/Small**: Brief description with attribution

   ```
   gh pr create --title "Fix typo in README" --body "Corrects spelling error

   Generated with [Claude Code](https://claude.com/claude-code)"
   ```

   **Medium/Large**: Structured description with attribution

   ```
   gh pr create --title "<title>" --body "## Summary
   <1-2 sentence overview>

   ## Details
   - <Key change 1 with context>
   - <Key change 2 with context>

   Generated with [Claude Code](https://claude.com/claude-code)"
   ```

7. Execute `gh pr create` with constructed content
8. Return JSON output with PR details

## Output Guidance

Return JSON with PR details:

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
