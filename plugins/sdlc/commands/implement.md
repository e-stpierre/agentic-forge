---
name: implement
description: Implement changes from a plan file
argument-hint: <plan-file-path>
---

# Implement Command

Reads a plan file and executes all implementation steps, committing at milestones.

## Parameters

- **`plan-file-path`** (required): Path to the markdown plan file (from `/sdlc:plan-feature`, `/sdlc:plan-bug`, etc.)

## Objective

Execute all implementation tasks defined in a plan file systematically and reliably.

## Core Principles

- Follow the plan exactly - do not add unrequested features
- Commit after each major task or milestone
- Verify each task against its validation criteria before proceeding
- Stop and report if a task cannot be completed as specified
- Keep the user informed of progress throughout

## Instructions

1. Read the plan file at the specified path using the Read tool

2. Parse the plan structure to identify:
   - Prerequisites (check if they are met)
   - Tasks with their files, descriptions, and validation criteria
   - Testing requirements
   - Final validation steps

3. Check prerequisites:
   - If prerequisites are not met, report what's missing and stop
   - If prerequisites are met, proceed

4. Execute tasks in order:

   For each task: a. Report: "Starting Task N: [Title]" b. Read the target files to understand current state c. Make the specified changes using Edit tool d. Verify against the task's validation criteria e. If verification passes:
   - Mark task complete
   - Commit if this is a milestone (every 2-3 tasks or major change) f. If verification fails:
   - Report the issue
   - Attempt to fix if straightforward
   - Stop and report if not resolvable

5. After all tasks complete:
   - Run tests if specified in the plan
   - Execute final validation steps
   - Create a summary commit if uncommitted changes remain

6. Report completion status with:
   - Tasks completed
   - Files modified
   - Commits made
   - Any issues encountered

## Output Guidance

Progress updates throughout execution:

```
## Implementing: [Plan Title]

### Prerequisites
- [x] [Prerequisite 1]
- [x] [Prerequisite 2]

### Task 1: [Task Title]
**Status**: In Progress
- Reading `src/components/Button.tsx`
- Applying changes...
- Verifying...
**Status**: Complete

### Task 2: [Task Title]
**Status**: In Progress
...

### Milestone Commit
- Committed: "Implement button component refactoring"
- Hash: abc1234

### Task 3: [Task Title]
...

---

## Implementation Complete

### Summary
- **Tasks**: 5/5 completed
- **Files Modified**: 8
- **Commits**: 3

### Files Changed
- `src/components/Button.tsx` (modified)
- `src/components/Button.test.tsx` (modified)
- `src/styles/button.css` (created)
...

### Commits Made
1. abc1234 - "Refactor button component structure"
2. def5678 - "Add button styling and variants"
3. ghi9012 - "Add button tests"

### Final Validation
- [x] All tasks completed
- [x] Tests pass
- [x] [Plan-specific validation 1]
- [x] [Plan-specific validation 2]

### Status
Implementation successful. Ready for review.
```

## Error Handling

If a task fails:

```
### Task 3: [Task Title]
**Status**: Failed

**Issue**: [Description of what went wrong]

**Attempted Fix**: [What was tried, if anything]

**Recommendation**: [How to resolve manually or skip]

---

## Implementation Paused

Completed 2/5 tasks before encountering an issue.
Please review the error above and advise how to proceed.
```
