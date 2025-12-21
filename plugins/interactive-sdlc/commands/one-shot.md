---
name: one-shot
description: Quick task execution without a saved plan file. Ideal for small, well-defined tasks
argument-hint: "[--git] [--validate] [--explore N] <context>"
---

# One-Shot

Quick task execution without a saved plan file. Ideal for small, well-defined tasks.

## Arguments

- `--git`: Auto-commit changes when done
- `--validate`: Run validation after implementation
- `--explore N`: Override explore agent count (default: 0 for speed)
- `[context]`: Required task description

## Behavior

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

## Example Usage

```bash
# Simple chore
/interactive-sdlc:one-shot --git Fix the typo in README, change "authenitcation" to "authentication"

# Bug fix with validation
/interactive-sdlc:one-shot --git --validate Fix login timeout on Safari - users get blank page after OAuth redirect

# Feature with exploration
/interactive-sdlc:one-shot --explore 2 --git Add a logout button to the user menu

# Quick refactor
/interactive-sdlc:one-shot --git Rename getUserData to fetchUserProfile across the codebase
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

For complex tasks, use the full planning workflow:
```bash
/interactive-sdlc:plan-build-validate --git --pr <task description>
```

## Important Notes

- One-shot is optimized for speed over thoroughness
- No plan file is saved (use planning commands for documented work)
- Default explore agents is 0 (increase with --explore for complex tasks)
- Always specify the task in the context argument
- Use --validate for critical changes to catch issues
