---
name: plan-chore
description: Plan a maintenance task with codebase exploration and structured plan generation
argument-hint: "[--explore N] [--git] [--output <path>] [context]"
---

# Plan Chore

Plan a maintenance task with codebase exploration and structured plan generation.

## Arguments

- `--explore N`: Override default explore agent count (default: 2)
- `--git`: Commit plan file after creation
- `--output <path>`: Override plan file location
- `[context]`: Optional freeform context for parameter inference

## Behavior

1. **Read Configuration**
   - Read `.claude/settings.json` for `interactive-sdlc.planDirectory` (default: `/specs`)
   - Read `interactive-sdlc.defaultExploreAgents.chore` (default: 2)

2. **Explore Codebase**
   - Launch N explore agents (from config or --explore flag)
   - Focus exploration on understanding the areas relevant to the chore
   - Gather context about existing patterns, conventions, and dependencies

3. **Gather Requirements**
   - Parse the `[context]` argument if provided
   - If title and requirements can be inferred from context, use them
   - Otherwise, ask the user:
     - What is the chore title?
     - What needs to be done?
     - What is in scope and out of scope?
     - Any specific files or areas to focus on?

4. **Generate Plan**
   - Create a plan following this structure:

   ```markdown
   # Chore: <chore-title>

   ## Description
   Brief description of what needs to be done and why

   ## Scope
   What is included and what is explicitly out of scope

   ## Tasks
   List of specific tasks required to complete this chore, in order

   ## Validation Criteria
   How to verify this chore is complete
   ```

5. **Save Plan**
   - Save to `--output` path if specified
   - Otherwise save to `{planDirectory}/chore-{slugified-title}.md`
   - Inform user of the saved file path

6. **Git Commit (if --git flag)**
   - Stage the plan file
   - Commit with message: `docs(plan): Add chore plan - {title}`

## Example Usage

```bash
# Basic usage - interactive prompts
/interactive-sdlc:plan-chore

# With context
/interactive-sdlc:plan-chore Update all dependencies and fix any breaking changes

# With flags
/interactive-sdlc:plan-chore --explore 3 --git Refactor the logging system to use structured logs

# With custom output
/interactive-sdlc:plan-chore --output /docs/plans/logging.md Refactor logging
```

## Important Notes

- Plans are static documentation - never modified during implementation
- No time estimates, deadlines, or scheduling information in plans
- Progress tracking happens via TodoWrite tool, not plan file updates
- Use the explore agents to understand existing code before planning tasks
