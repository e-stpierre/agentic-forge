---
name: one-shot
description: Quick task execution without a saved plan file. Ideal for small, well-defined tasks
argument-hint: "[--git] [--validate] [--explore N] [context]"
---

# One-Shot

Quick task execution without a saved plan file. Ideal for small, well-defined tasks.

## Arguments

- **`--git`** (optional): Auto-commit changes when done
- **`--validate`** (optional): Run validation after implementation
- **`--explore N`** (optional): Override explore agent count (default: 0 for speed)
- **`[context]`** (optional): Task description

## Objective

Execute small, well-defined tasks quickly without creating a saved plan file, optimizing for speed over thoroughness.

## Core Principles

- Optimized for speed - minimal exploration by default
- No plan file is saved - use full planning workflow for documented work
- Task must be well-defined and small in scope
- Ask clarifying questions if task is unclear
- Use --validate for critical changes to catch issues

## Instructions

1. **Parse Task**
   - Analyze the `[context]` to understand the task
   - Determine task type (chore/bug/feature)
   - Extract key requirements

2. **Quick Exploration (if --explore N > 0)**
   - Launch N explore agents
   - Focus on immediately relevant code areas
   - Skip for simple tasks

3. **Create In-Memory Plan**
   - Generate a lightweight plan internally
   - Do NOT save plan to file
   - Structure depends on task type:
     - Chore: tasks and validation
     - Bug: root cause, fix strategy, testing
     - Feature: minimal milestones and tasks

4. **Implement**
   - Create todo list from in-memory plan
   - Implement each task sequentially
   - Mark todos as completed
   - Ask clarifying questions if needed

5. **Git Commit (if --git flag)**
   - Stage all changes
   - Commit with descriptive message based on task type:
     - `fix: <description>` for bugs
     - `feat: <description>` for features
     - `chore: <description>` for chores

6. **Validate (if --validate flag)**
   - Run `/interactive-sdlc:validate`
   - Report any issues found

## Output Guidance

Provide a concise summary of what was done:

```
## Task Complete

Changes made:
- [list of changes]

Files modified: X
Committed: Yes/No

[If --validate used:]
Validation results: PASS/FAIL
- Tests: PASS
- Build: PASS
- Review: No critical issues
```

## When to Use One-Shot

**Good for:**

- Typo fixes
- Simple bug fixes with clear root cause
- Small refactoring tasks
- Adding minor functionality
- Quick code cleanup

**Not recommended for:**

- Complex features requiring architecture decisions
- Bugs requiring deep investigation
- Tasks with unclear requirements
- Large refactoring efforts

For complex tasks, use the full planning workflow instead.

## Important Notes

- Use the full planning workflow for complex features requiring architecture decisions
- Use the full planning workflow for bugs requiring deep investigation
- Always use --validate for critical or security-related changes
- Clarify requirements before proceeding - use planning workflow if unclear
- Use the full planning workflow for large refactoring efforts
