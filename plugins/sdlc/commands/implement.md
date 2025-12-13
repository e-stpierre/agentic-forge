---
name: implement
description: Implement changes from a plan file
argument-hint: <plan-file-path>
---

# Implement Command

Reads a plan file and executes all implementation steps, committing after each milestone completion.

## Parameters

- **`plan-file-path`** (required): Path to the markdown plan file (from `/sdlc:plan-feature`, `/sdlc:plan-bug`, etc.)

## Objective

Execute all implementation tasks defined in a plan file systematically, committing changes after each milestone is completed.

## Core Principles

- Follow the plan exactly - do not add unrequested features
- **Commit after completing each milestone** (not individual tasks)
- Use the commit message specified in the milestone
- Verify each task against its validation criteria before proceeding
- Verify milestone completion before committing
- Stop and report if a task cannot be completed as specified
- Keep the user informed of progress throughout

## Instructions

1. Read the plan file at the specified path using the Read tool

2. Parse the plan structure to identify:
   - Prerequisites (check if they are met)
   - **Milestones** with their tasks, commit messages, and validation criteria
   - Each milestone's tasks with files, descriptions, and validation
   - Final validation steps

3. Check prerequisites:
   - If prerequisites are not met, report what's missing and stop
   - If prerequisites are met, proceed

4. Execute milestones in order:

   **For each milestone:**

   a. Report: "Starting Milestone N: [Title]"

   b. Execute all tasks within the milestone:
   - For each task:
     - Report: "Task N.M: [Title]"
     - Read the target files to understand current state
     - Make the specified changes using Edit tool
     - Verify against the task's validation criteria
     - If verification fails, attempt to fix or stop

   c. After all tasks in the milestone are complete:
   - Verify milestone validation criteria
   - **Commit all changes with the milestone's commit message**
   - Report the commit hash

   d. If any task or milestone validation fails:
   - Report the issue
   - Attempt to fix if straightforward
   - Stop and report if not resolvable

5. After all milestones complete:
   - Execute final validation steps
   - Report completion status

6. Report completion status with:
   - Milestones completed
   - Tasks completed
   - Files modified
   - Commits made (one per milestone)
   - Any issues encountered

## Output Guidance

Progress updates throughout execution:

```
## Implementing: [Plan Title]

### Prerequisites
- [x] [Prerequisite 1]
- [x] [Prerequisite 2]

---

### Milestone 1: [Milestone Title]

#### Task 1.1: [Task Title]
**Status**: In Progress
- Reading `src/components/Button.tsx`
- Applying changes...
- Verifying...
**Status**: Complete

#### Task 1.2: [Task Title]
**Status**: In Progress
...
**Status**: Complete

#### Milestone Validation
- [x] [Validation step 1]
- [x] [Validation step 2]

#### Milestone Commit
- Message: "feat: implement button component"
- Hash: abc1234
- Files: 3 changed

---

### Milestone 2: [Milestone Title]

#### Task 2.1: [Task Title]
...

#### Milestone Commit
- Message: "feat: add button variants"
- Hash: def5678
- Files: 2 changed

---

### Milestone 3: Tests

#### Task 3.1: [Test Task Title]
...

#### Milestone Commit
- Message: "test: add button component tests"
- Hash: ghi9012
- Files: 1 changed

---

## Implementation Complete

### Summary
- **Milestones**: 3/3 completed
- **Tasks**: 8/8 completed
- **Files Modified**: 6
- **Commits**: 3

### Commits Made
1. abc1234 - "feat: implement button component"
2. def5678 - "feat: add button variants"
3. ghi9012 - "test: add button component tests"

### Files Changed
- `src/components/Button.tsx` (modified)
- `src/components/Button.test.tsx` (created)
- `src/styles/button.css` (created)
...

### Final Validation
- [x] All milestones completed
- [x] All tests pass
- [x] Feature works end-to-end

### Status
Implementation successful. Ready for review.
```

## Commit Strategy

1. **One commit per milestone**: Group related changes logically
2. **Use milestone commit message**: Each milestone specifies its commit message
3. **Conventional commits**: Messages follow conventional commit format (feat:, fix:, test:, docs:, etc.)
4. **Clean history**: Each commit represents a logical, working state

## Error Handling

If a task fails:

```
### Milestone 2: [Milestone Title]

#### Task 2.1: [Task Title]
**Status**: Failed

**Issue**: [Description of what went wrong]

**Attempted Fix**: [What was tried, if anything]

**Recommendation**: [How to resolve manually or skip]

---

## Implementation Paused

Completed 1/3 milestones (4/8 tasks) before encountering an issue.

### Commits Made So Far
1. abc1234 - "feat: implement button component"

Please review the error above and advise how to proceed.
```

## Handling Legacy Plans

If the plan uses the older task-based format (without milestones), treat every 2-3 related tasks as a milestone and commit after each group. Use a descriptive commit message based on the completed tasks.
