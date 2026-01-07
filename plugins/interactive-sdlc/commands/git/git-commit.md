---
name: git-commit
description: Commit and push changes with a structured message
argument-hint: [message]
---

# Git Commit Command

Commits staged changes with a structured message and pushes to the remote repository.

## Arguments

- **`[message]`** (optional): Override commit title. If not provided, auto-generate from changes.

## Objective

Create a well-structured commit with a concise title and optional bullet-point description, then push to remote.

## Core Principles

- Title must be short (50 chars ideal, 72 max) and focus on the main task completed
- Description is optional for small commits
- Description uses 1-3 bullet points for larger commits highlighting important aspects
- Never include AI attribution in commit messages
- Push immediately after commit unless on a protected branch

## Instructions

1. Run `git status` to verify there are changes to commit
2. Run `git diff --staged` to analyze staged changes (if none, stage all with `git add .`)
3. Analyze the changes to determine:
   - Primary purpose of the changes (the "what")
   - Impact and scope (small fix vs. larger feature)
4. Construct commit message:
   - **Title**: Imperative mood, capitalize first letter, no period (e.g., "Add user authentication")
   - **Description**: Only if changes are substantial; 1-3 bullets on key aspects
5. Execute commit:

   ```
   git commit -m "<title>" [-m "- bullet 1" -m "- bullet 2"]
   ```

6. Push to remote: `git push` (use `git push -u origin HEAD` if no upstream)
7. Report success with commit hash

## Output Guidance

- Show the commit title used
- Show bullet points if description was included
- Confirm push success
- On error, report the specific failure
