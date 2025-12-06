---
name: git-worktree
description: Create or manage git worktrees for parallel work
argument-hint: <action> [branch-name] [--base <base-branch>]
---

# Git Worktree Command

Create and manage git worktrees for parallel development workflows.

## Parameters

- **`action`** (required): The worktree action to perform. One of: `create`, `list`, `remove`
- **`branch-name`** (required for create/remove): Name of the branch for the worktree
- **`--base <base-branch>`** (optional): Base branch when creating a new worktree (defaults to main/master)

## Objective

Manage git worktrees to enable parallel Claude workflows on different branches without switching the main repository.

## Core Principles

- Worktrees are created in a `.worktrees` directory adjacent to the repository root
- Branch names are sanitized for use as directory names (slashes replaced with dashes)
- Always verify worktree state before operations
- Clean up properly to avoid orphaned worktrees

## Instructions

1. Parse the action and arguments from the command input

2. **For `list` action**:
   - Run `git worktree list` to show all worktrees
   - Display the path, branch, and commit hash for each worktree
   - Indicate which is the main worktree

3. **For `create` action**:
   - Verify the branch name is provided
   - Determine the base branch (use `--base` value or detect default branch)
   - Calculate worktree path: `<repo-parent>/.worktrees/<sanitized-branch-name>`
   - Check if worktree already exists at that path
   - If branch exists, use it; otherwise create a new branch from base
   - Run `git worktree add [-b <branch>] <path> [<base-branch>]`
   - Report the created worktree path

4. **For `remove` action**:
   - Verify the branch name is provided
   - Find the worktree path for the branch
   - Run `git worktree remove <path>`
   - If removal fails (uncommitted changes), offer to force remove
   - Run `git worktree prune` to clean up

## Output Guidance

- **list**: Display a formatted table of worktrees with path, branch, and status
- **create**: Report the full path to the created worktree for use in subsequent commands
- **remove**: Confirm successful removal or report any errors

## Examples

```
/git-worktree list

/git-worktree create feature/auth-system

/git-worktree create bugfix/login-issue --base develop

/git-worktree remove feature/auth-system
```
