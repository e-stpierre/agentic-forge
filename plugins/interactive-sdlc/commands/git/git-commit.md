---
name: git-commit
description: Commit changes with a structured message
argument-hint: [message]
arguments:
  - name: message
    description: Override commit title. If not provided, auto-generate from changes
    required: false
---

# Git Commit Command

Commits staged changes with a structured message.

## Arguments

- **`[message]`** (optional): Override commit title. If not provided, auto-generate from changes.

## Objective

Create a well-structured commit with a concise title and optional bullet-point description.

## Core Principles

- Title must be short (50 chars ideal, 120 max) and focus on the main task completed
- Description is optional for small commits
- Description uses 1-5 bullet points for larger commits highlighting important aspects
- Always include AI attribution with your model name: `Co-Authored-By: Claude <model> <noreply@anthropic.com>`

## Plan Step Reference

When following a plan (implementation plan, milestone plan, etc.), include the current step reference at the start of the commit title in brackets:

- **Task-based plans**: `[Task N]` where N is the task number (e.g., `[Task 1]`, `[Task 8]`)
- **Milestone-based plans**: `[Milestone N]` when committing after completing a milestone
- **Nested plans**: `[Task M.N]` for tasks within milestones (e.g., `[Task 1.1]`, `[Task 2.3]`)

Only include this prefix if you are actively following a plan with numbered steps. If no plan context exists, omit the brackets entirely.

**Examples:**

- `[Task 8] Update CLI with orchestrator integration`
- `[Milestone 1] Complete authentication module`
- `[Task 2.3] Add unit tests for validation logic`
- `Add helper function for date parsing` (no plan context)

## Instructions

1. Run `git status` to verify there are changes to commit
2. Run `git diff --staged` to analyze staged changes (if none, stage all with `git add .`)
3. Analyze the changes to determine:
   - Primary purpose of the changes (the "what")
   - Impact and scope (small fix vs. larger feature)
4. Determine plan step reference (if following a plan):
   - Check if there is an active plan with numbered tasks or milestones
   - Identify which task/milestone these changes correspond to
   - Format the prefix accordingly (e.g., `[Task 3]`, `[Milestone 2]`, `[Task 1.2]`)
5. Construct commit message:
   - **Title**: `[Step Ref]` prefix (if applicable) + imperative mood, capitalize first letter, no period
   - **Description**: Only if changes are substantial; 1-5 bullets on key aspects
6. Execute commit using HEREDOC for proper formatting:

   ```bash
   git commit -m "$(cat <<'EOF'
   [Task N] <title>

   - bullet 1 (optional)
   - bullet 2 (optional)

   Co-Authored-By: Claude <model> <noreply@anthropic.com>
   EOF
   )"
   ```

7. Report success with commit hash

## Output Guidance

- Show the commit title used (including plan step prefix if applicable)
- Show bullet points if description was included
- On error, report the specific failure
