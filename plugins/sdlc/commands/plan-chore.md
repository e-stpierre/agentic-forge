---
name: plan-chore
description: Generate a maintenance task plan
argument-hint: <chore-description> [--interactive]
---

# Plan Chore Command

Generates a plan for maintenance tasks such as refactoring, dependency updates, cleanup, and technical debt reduction.

## Parameters

- **`chore-description`** (required): Description of the maintenance task
- **`--interactive`** (optional): Enable interactive mode to ask clarifying questions before planning

## Objective

Create a safe, incremental plan for maintenance work that minimizes risk and maintains functionality.

## Core Principles

- Preserve existing functionality - no behavioral changes unless intended
- Plan for incremental changes that can be tested independently
- Identify potential breaking changes and migration needs
- Include rollback considerations for risky changes
- Document the rationale for the maintenance work
- Keep each task small and verifiable

## Instructions

1. Parse the input to extract the chore description and check for `--interactive` flag

2. **If `--interactive` flag is present**, use the AskUserQuestion tool to gather information:
   - What is the scope of this maintenance work?
   - Are breaking changes acceptable?
   - Should this be done incrementally or all at once?
   - Are there any areas to avoid or prioritize?

   Wait for user responses before proceeding.

3. **If not `--interactive`**, use conservative defaults:
   - Minimal scope - only what's described
   - No breaking changes
   - Incremental approach preferred
   - Touch only necessary files

4. Use the Task tool with `subagent_type=Explore` to analyze:
   - Current state of the code/dependencies to be updated
   - Usage patterns and dependencies
   - Test coverage of affected areas
   - Related configurations or documentation

5. Assess the maintenance task type and plan accordingly:
   - **Refactoring**: Identify all usages, plan transformation, ensure tests exist
   - **Dependency Update**: Check changelogs, breaking changes, peer dependencies
   - **Cleanup**: Identify dead code, unused imports, stale files
   - **Tech Debt**: Prioritize by impact, plan incremental improvements

6. Design the maintenance approach:
   - Break into small, independently testable changes
   - Order tasks to minimize risk
   - Identify verification steps for each task
   - Note any manual testing required

7. Generate the plan document

8. Write the plan to `docs/plans/chore-<slug>-plan.md`

9. Report the plan location and provide a summary

## Output Guidance

Create a markdown plan file with this structure:

```markdown
# Chore: [Chore Title]

## Overview

**Type**: [Refactoring | Dependency Update | Cleanup | Tech Debt]

**Rationale**: [Why this maintenance is needed]

**Scope**: [What will be affected]

## Impact Assessment

**Breaking Changes**: [None | List of breaking changes]

**Risk Level**: [Low | Medium | High]

**Affected Areas**:

- [Area 1]
- [Area 2]

## Prerequisites

- [ ] [Any required setup or preparation]

## Tasks

### Task 1: [Task Title]

**Files**: `path/to/file.ts`

**Description**: [What to do]

**Verification**:

- [ ] [How to verify this task is complete]
- [ ] [Tests still pass]

### Task 2: [Task Title]

...

## Testing

- [ ] Run existing test suite
- [ ] [Additional testing if needed]

## Rollback Plan

[How to revert if something goes wrong]

## Final Verification

- [ ] All tests pass
- [ ] [Manual verification steps]
- [ ] No regressions in affected areas
```

Report to the user:

- Plan file location
- Chore type identified
- Number of tasks
- Risk assessment
