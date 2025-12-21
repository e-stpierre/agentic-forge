---
name: plan-bug
description: Generate a bug fix plan
argument-hint: <bug-description> [--interactive]
---

# Plan Bug Command

Diagnoses a bug and generates a plan for fixing it, including root cause analysis and testing strategy.

## Parameters

- **`bug-description`** (required): Description of the bug, including symptoms and reproduction steps if known
- **`--interactive`** (optional): Enable interactive mode to ask clarifying questions before planning

## Objective

Identify the root cause of the bug and create a targeted fix plan with validation steps.

## Core Principles

- Diagnose before prescribing - understand the root cause first
- Minimize the scope of changes to reduce regression risk
- Include reproduction steps in the plan
- Add regression tests to prevent recurrence
- Consider related code that may have similar issues
- Document the root cause for future reference

## Instructions

1. Parse the input to extract the bug description and check for `--interactive` flag

2. **If `--interactive` flag is present**, use the AskUserQuestion tool to gather information:
   - Can you provide steps to reproduce the bug?
   - When did this bug start occurring (if known)?
   - What is the expected vs actual behavior?
   - What is the severity/priority of this bug?

   Wait for user responses before proceeding.

3. **If not `--interactive`**, work with available information:
   - Extract reproduction hints from the description
   - Assume moderate priority
   - Infer expected behavior from context

4. Use the Task tool with `subagent_type=Explore` to investigate:
   - Search for error messages or symptoms in the codebase
   - Trace the code path related to the bug
   - Find related tests that may be failing or missing
   - Look for recent changes that might have introduced the bug

5. Perform root cause analysis:
   - Identify the exact location of the bug
   - Understand why the bug occurs
   - Determine the minimal fix required
   - Assess potential side effects of the fix

6. Design the fix approach:
   - List files to modify
   - Define the specific changes needed
   - Identify tests to add or update
   - Plan validation steps

7. Generate the plan document

8. Write the plan to `docs/plans/bugfix-<slug>-plan.md`

9. Report the plan location and provide a summary

## Output Guidance

Create a markdown plan file with this structure:

```markdown
# Bugfix: [Bug Title]

## Bug Summary

**Symptom**: [What the user experiences]

**Expected Behavior**: [What should happen]

**Actual Behavior**: [What actually happens]

## Root Cause Analysis

[Explanation of why this bug occurs, with code references]

**Location**: `path/to/file.ts:123`

**Cause**: [Technical explanation]

## Reproduction Steps

1. [Step 1]
2. [Step 2]
3. [Observe: bug symptom]

## Fix Plan

### Task 1: [Fix Description]

**Files**: `path/to/file.ts`

**Changes**:

- [Specific change 1]
- [Specific change 2]

**Validation**:

- [ ] Bug no longer reproduces
- [ ] Related functionality still works

## Testing

- [ ] Add regression test for this specific case
- [ ] Verify existing tests pass
- [ ] Test edge cases: [list]

## Verification

1. [Step to verify fix works]
2. [Step to verify no regressions]
```

Report to the user:

- Plan file location
- Root cause summary (1 sentence)
- Files affected
- Risk level (low/medium/high)
