---
name: plan-build
description: Execute simple task end-to-end with git management
argument-hint: <task-description | issue-number> [--interactive]
---

# Plan-Build Command

All-in-one workflow that creates a branch, explores the codebase, builds an in-memory plan, implements changes, commits, pushes, and opens a PR.

## Arguments

- **`<task-description | issue-number>`** (required): Either a text description of the task OR a GitHub issue number (e.g., `123`)
- **`--interactive`** (optional): Ask clarifying questions before building the plan

## Objective

Execute a simple task from start to finish with proper git hygiene and a pull request.

## Core Principles

- Suitable for small to medium tasks that can be completed in a single session
- For complex tasks, use `/sdlc:design` or `/sdlc:plan-feature` instead
- Commit frequently at logical checkpoints
- Keep the PR focused on the single task
- Include clear PR description with context

## Instructions

1. Parse the input to determine if it's a GitHub issue number or text description:
   - If numeric (e.g., `123`), fetch the issue using `/core:read-gh-issue 123`
   - If text, use the description directly

2. **If `--interactive` flag is present**, use the AskUserQuestion tool:
   - Is my understanding of the task correct? [summary]
   - Are there any constraints or preferences I should know?
   - What branch naming would you prefer?

   Wait for user responses before proceeding.

3. **If not `--interactive`**, proceed with defaults:
   - Use task description as-is
   - Generate branch name from task description

4. Create a feature branch using `/core:git-branch`:
   - Format: `feature/<slug-from-task>` or `fix/<slug>` for bugs
   - Example: `feature/add-dark-mode` or `fix/login-timeout`

5. Use the Task tool with `subagent_type=Explore` to understand the codebase:
   - Find relevant files and patterns
   - Identify what needs to change
   - Note testing requirements

6. Build an in-memory implementation plan:
   - List files to modify in order
   - Define specific changes for each file
   - Identify test updates needed
   - Do NOT write this plan to a file (keep it simple)

7. Implement the changes:
   - Make changes file by file
   - Follow existing code patterns
   - Add or update tests as needed
   - Run tests to verify (if test command available)

8. Commit the changes using `/core:git-commit`:
   - Use a descriptive commit message
   - Reference the issue number if from GitHub (e.g., "Fix login timeout #123")

9. Push the branch:
   - `git push -u origin HEAD`

10. Create a pull request using `/core:git-pr`:
    - Title: Clear description of the change
    - Body: Context, what was done, testing notes
    - Reference the issue if applicable

11. Report completion with PR URL

## Output Guidance

Progress updates throughout:

```
## Task: [Task Description]

### Step 1: Setup
- Created branch: `feature/add-dark-mode`

### Step 2: Analysis
- Found 3 files to modify
- Identified existing theme patterns

### Step 3: Implementation
- Modified: `src/theme/index.ts`
- Modified: `src/components/Header.tsx`
- Added: `src/hooks/useDarkMode.ts`

### Step 4: Testing
- Updated existing tests
- Added new test for dark mode toggle
- All tests passing

### Step 5: Commit & Push
- Committed: "Add dark mode toggle to header"
- Pushed to: `origin/feature/add-dark-mode`

### Step 6: Pull Request
- Created PR #45: "Add dark mode toggle"
- URL: https://github.com/org/repo/pull/45

## Summary

Task completed successfully. PR is ready for review.
```

## Best Practices

- If the task grows beyond expected scope, stop and recommend using `/sdlc:design` instead
- Always run tests before committing if a test runner is available
- Keep commits atomic - one logical change per commit for complex tasks
- If implementation reveals blockers, report them clearly and stop
