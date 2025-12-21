# Build

Implement a plan file with checkpoint support for resuming work.

## Arguments

- `<plan-file>`: Required path to plan file
- `--git`: Auto-commit changes at logical checkpoints
- `--checkpoint "<text>"`: Resume from specific task/milestone
- `[context]`: Optional freeform context for implementation guidance

## Behavior

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

## Example Usage

```bash
# Basic usage
/interactive-sdlc:build /specs/feature-auth.md

# With git commits
/interactive-sdlc:build /specs/bug-login.md --git

# Resume from checkpoint
/interactive-sdlc:build /specs/feature-auth.md --checkpoint "Milestone 2"

# Resume from specific task
/interactive-sdlc:build /specs/feature-auth.md --checkpoint "Task 1.3: Add OAuth handlers"

# With implementation context
/interactive-sdlc:build /specs/chore-refactor.md --git Focus on maintaining backward compatibility
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

- The plan file is READ-ONLY during implementation
- Progress is tracked via TodoWrite tool, not plan file updates
- Ask clarifying questions rather than making assumptions
- Maintain code quality and follow existing patterns
- Run tests frequently to catch issues early
- If a task cannot be completed, explain why and ask for guidance
