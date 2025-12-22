---
name: build
description: Implement a plan file with checkpoint support for resuming work
argument-hint: "<plan-file> [--git] [--checkpoint \"<text>\"] [context]"
---

# Build

Implement a plan file with checkpoint support for resuming work.

## Arguments

- **`<plan-file>`** (required): Path to plan file
- **`--git`** (optional): Auto-commit changes at logical checkpoints
- **`--checkpoint "<text>"`** (optional): Resume from specific task/milestone
- **`[context]`** (optional): Optional freeform context for implementation guidance

## Objective

Implement all tasks from a plan file with checkpoint support for resuming work, progress tracking via TodoWrite, and optional git commits at logical milestones.

## Core Principles

- Plans are read-only - never modify the plan file during implementation
- Track progress via TodoWrite tool, not plan file updates
- Ask clarifying questions rather than making assumptions
- Maintain code quality and follow existing patterns in the codebase
- Run tests frequently to catch issues early
- Git commits should be atomic and meaningful, aligned with milestones or task groups

## Instructions

1. **Read Plan File**
   - Read the plan file from the provided path
   - Parse the plan structure (milestones, tasks, validation criteria)
   - Validate the plan has required sections

2. **Handle Checkpoint (if --checkpoint flag)**
   - Parse the checkpoint text to find the resume point
   - Match against milestone titles or task descriptions
   - Mark all previous tasks as already completed
   - Resume from the matched checkpoint

3. **Create Todo List**
   - Extract all tasks from the plan
   - For feature plans: create todos per milestone with nested tasks
   - For bug/chore plans: create todos per task
   - Use TodoWrite tool to track progress
   - Mark checkpoint-completed tasks if resuming

4. **Implement Tasks**
   - Work through each task sequentially
   - Mark current task as in_progress before starting
   - Analyze what changes are needed for the task
   - Make the required code changes
   - If implementation is ambiguous:
     - Ask user clarifying questions using AskUserQuestion
     - Wait for response before proceeding
   - Mark task as completed when done

5. **Git Commits (if --git flag)**
   - Check CLAUDE.md for user's git command preferences
   - Commit at logical checkpoints:
     - Features: after each milestone completion
     - Bugs: after fix implemented, after tests added
     - Chores: after major task groups
   - Use descriptive commit messages

6. **Validation**
   - After completing all tasks, remind user to run `/interactive-sdlc:validate`
   - Provide summary of changes made

## Output Guidance

Provide clear progress updates and a final summary:

**During implementation:**
```
[in_progress] Milestone 1: OAuth Integration
  [completed] Task 1.1: Add OAuth provider configuration
  [in_progress] Task 1.2: Implement OAuth handlers
  [pending] Task 1.3: Add session management
```

**On completion:**
```
## Implementation Complete

Tasks completed: X
Files modified: Y
Commits created: Z (if --git used)

Changes summary:
- [list key changes made]

Next steps:
- Run validation: /interactive-sdlc:validate --plan /specs/feature-auth.md
- Review changes and test functionality
```

## Checkpoint System

The checkpoint system allows resuming long-running builds:

1. **Milestone Checkpoint**: Resume from start of a milestone
   ```bash
   --checkpoint "Milestone 2"
   --checkpoint "Milestone 2: OAuth Integration"
   ```

2. **Task Checkpoint**: Resume from a specific task
   ```bash
   --checkpoint "Task 2.1"
   --checkpoint "Add OAuth handlers"
   ```

3. **Text Matching**: Checkpoint matches against:
   - Milestone numbers (e.g., "Milestone 2")
   - Milestone titles (e.g., "OAuth Integration")
   - Task numbers (e.g., "Task 2.1")
   - Task descriptions (partial match supported)

## Git Commit Strategy

When `--git` flag is used:

- **Feature plans**: Commit after each milestone
  - Message: `feat(<scope>): <milestone-title>`

- **Bug fix plans**: Commit after fix, again after tests
  - Message: `fix(<scope>): <description>`

- **Chore plans**: Commit after major task groups
  - Message: `chore(<scope>): <description>`

Scope is derived from the plan file name or affected directories.

## Important Notes

- The plan file is read-only documentation - never modify it during implementation
- Ask questions when implementation details are unclear
- Run tests frequently to catch issues early
- Ensure changes work before committing
- If blocked on a task, explain the blocker and ask for guidance
