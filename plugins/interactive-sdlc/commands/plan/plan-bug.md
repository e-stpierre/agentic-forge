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
   - Read `.claude/settings.json` for `interactive-sdlc.planDirectory` (default: `specs`)
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
   - Create a plan using the structure defined in the Templates section
   - Fill in all required sections with investigation findings
   - Include specific tasks to implement the fix and prevent regression

6. **Save Plan**
   - Save to `{planDirectory}/bug-{slugified-title}.md`
   - Inform user of the saved file path

7. **Git Commit (if --git flag)**
   - Stage the plan file
   - Commit with message: `docs(plan): Add bug fix plan - {title}`

## Output Guidance

Present the plan file path and a brief summary of the bug analysis:

```
Plan saved to specs/bug-{slugified-title}.md

## Summary
- Bug: [one-line description]
- Root cause: [brief technical explanation]
- Fix strategy: [high-level approach]
- Test cases to add: X

Next steps:
- Implement with: /interactive-sdlc:build specs/bug-{slugified-title}.md
- Or run full workflow: /interactive-sdlc:plan-build-validate
```

## Templates

### Bug Fix Plan Structure

```markdown
# Bug Fix: {{bug_title}}

<!--
Instructions:
- Replace {{bug_title}} with a concise title for the bug
- Use title case (e.g., "Login Timeout on Safari OAuth Redirect")
-->

## Description

{{description}}

<!--
Instructions:
- Replace {{description}} with a clear explanation of the bug and its impact
- Include what is broken, who is affected, and the severity
-->

## Reproduction Steps

{{reproduction_steps}}

<!--
Instructions:
- Replace {{reproduction_steps}} with numbered step-by-step instructions to reproduce the bug
- Be specific enough that anyone can follow the steps
- Example:
  1. Navigate to /login
  2. Click "Login with OAuth"
  3. Complete OAuth flow on provider site
  4. Observe redirect to blank page instead of dashboard
-->

## Root Cause Analysis

{{root_cause}}

<!--
Instructions:
- Replace {{root_cause}} with technical explanation of why the bug occurs
- Include code references, execution flow, and specific conditions that trigger the bug
- Be thorough - understanding the cause is critical to the fix
-->

## Fix Strategy

{{fix_strategy}}

<!--
Instructions:
- Replace {{fix_strategy}} with high-level approach to fixing the bug
- Explain what changes need to be made and why
- Address the root cause, not just symptoms
-->

## Tasks

{{tasks}}

<!--
Instructions:
- Replace {{tasks}} with numbered list of specific tasks to implement the fix
- Include code changes, configuration updates, etc.
- Order tasks logically
-->

## Validation

{{validation}}

<!--
Instructions:
- Replace {{validation}} with steps to verify the bug is fixed and won't regress
- Include manual testing steps and automated checks
-->

## Testing

{{testing}}

<!--
Instructions:
- Replace {{testing}} with test cases to add or update to prevent regression
- Specify unit tests, integration tests, or e2e tests as appropriate
-->
```

## Important Notes

- Perform thorough root cause analysis - understanding the cause is critical to preventing recurring bugs
- Plans are static documentation - never modify them during implementation
- Focus on actionable tasks, not time estimates or deadlines
- Identify the root cause clearly before proceeding with a fix
- Include regression test cases to prevent future occurrences
