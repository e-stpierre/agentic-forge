---
name: plan-bug
description: Plan a bug fix with root cause analysis, reproduction steps, and structured fix strategy
argument-hint: "[--explore N] [--git] [context]"
---

# Plan Bug

Plan a bug fix with root cause analysis, reproduction steps, and structured fix strategy.

## Arguments

- **`--explore N`** (optional): Override default explore agent count (default: 2)
- **`--git`** (optional): Commit plan file after creation
- **`[context]`** (optional): Optional freeform context for argument inference

## Objective

Plan a bug fix with thorough root cause analysis, reproduction steps, and a structured fix strategy that prevents regression.

## Core Principles

- Root cause analysis should be thorough - understanding the cause is critical to the fix
- Include clear reproduction steps to verify the bug exists
- Design fix strategy to address root cause, not just symptoms
- Include test cases to prevent regression
- Plans are static documentation - never modified during implementation

## Instructions

1. **Read Configuration**
   - Read `.claude/settings.json` for `interactive-sdlc.planDirectory` (default: `/specs`)
   - Read `interactive-sdlc.defaultExploreAgents.bug` (default: 2)

2. **Explore Codebase**
   - Launch N explore agents (from config or --explore flag)
   - Focus exploration on understanding the bug context
   - Trace code paths related to the bug
   - Identify potential root causes

3. **Gather Requirements**
   - Parse the `[context]` argument if provided
   - If bug description can be inferred from context, use it
   - Otherwise, ask the user:
     - What is the bug title/summary?
     - What is the observed behavior?
     - What is the expected behavior?
     - What are the reproduction steps?
     - What is the impact of this bug?

4. **Investigate Root Cause**
   - Analyze the codebase based on the bug description
   - Trace the execution path
   - Identify the root cause
   - Document findings

5. **Generate Plan**
   - Create a plan following this structure:

   ```markdown
   # Bug Fix: <bug-title>

   ## Description
   Clear explanation of the bug and its impact

   ## Reproduction Steps
   Step-by-step instructions to reproduce the bug

   ## Root Cause Analysis
   Technical explanation of why the bug occurs

   ## Fix Strategy
   High-level approach to fixing the bug

   ## Tasks
   Specific tasks to implement the fix

   ## Validation
   How to verify the bug is fixed and won't regress

   ## Testing
   Test cases to add or update to prevent regression
   ```

6. **Save Plan**
   - Save to `{planDirectory}/bug-{slugified-title}.md`
   - Inform user of the saved file path

7. **Git Commit (if --git flag)**
   - Stage the plan file
   - Commit with message: `docs(plan): Add bug fix plan - {title}`

## Output Guidance

Present the plan file path and a brief summary of the bug analysis:

```
Plan saved to /specs/bug-{slugified-title}.md

## Summary
- Bug: [one-line description]
- Root cause: [brief technical explanation]
- Fix strategy: [high-level approach]
- Test cases to add: X

Next steps:
- Implement with: /interactive-sdlc:build /specs/bug-{slugified-title}.md
- Or run full workflow: /interactive-sdlc:plan-build-validate
```

## Templates

### Bug Fix Plan Structure

```markdown
# Bug Fix: <bug-title>

## Description
Clear explanation of the bug and its impact

## Reproduction Steps
Step-by-step instructions to reproduce the bug

## Root Cause Analysis
Technical explanation of why the bug occurs

## Fix Strategy
High-level approach to fixing the bug

## Tasks
Specific tasks to implement the fix

## Validation
How to verify the bug is fixed and won't regress

## Testing
Test cases to add or update to prevent regression
```

## Don't

- Don't skip root cause analysis - fixing symptoms without understanding the cause leads to recurring bugs
- Don't modify plan files during implementation - they are static documentation
- Don't include time estimates or deadlines in plans
- Don't proceed with a fix until root cause is clearly identified
- Don't forget to add regression test cases
