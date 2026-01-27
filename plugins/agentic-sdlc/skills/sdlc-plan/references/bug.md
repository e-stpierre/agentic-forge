# Bug Fix Plan Reference

## Planning Approach

Bug fix plans focus on thorough root cause analysis and prevention of regression. Understanding the cause is critical to implementing an effective fix.

## Key Sections

A bug fix plan should include:

1. **Description**: Clear explanation of the bug and its impact
2. **Reproduction Steps**: Step-by-step instructions to reproduce the bug
3. **Root Cause Analysis**: Technical explanation of why the bug occurs
4. **Fix Strategy**: High-level approach to fixing the bug
5. **Tasks**: Specific implementation tasks
6. **Validation**: Steps to verify the fix works
7. **Testing**: Test cases to prevent regression

## Investigation Focus

When analyzing a bug:

- Trace the execution path that leads to the bug
- Identify the specific conditions that trigger it
- Look for related code paths that may have similar issues
- Check if there are existing tests that should have caught this
- Understand the impact scope (which users/features are affected)

## Root Cause Categories

Common root causes to investigate:

- **Logic Errors**: Incorrect conditions, off-by-one errors, wrong operators
- **State Management**: Race conditions, stale data, incorrect state transitions
- **Error Handling**: Unhandled exceptions, silent failures, missing edge cases
- **Integration Issues**: API contract violations, data format mismatches
- **Configuration**: Environment-specific issues, missing settings
- **Resource Management**: Memory leaks, connection exhaustion, deadlocks

## Fix Strategy Guidelines

- Address the root cause, not just symptoms
- Consider defensive measures to prevent similar bugs
- Avoid fixes that introduce new complexity
- Prefer targeted changes over broad refactoring
- Include test coverage for the specific failure case

## Milestone Design

Break bug fixes into logical milestones:

- Each milestone should deliver visible progress toward the fix
- Milestones should be testable independently
- Order by dependency (investigation before implementation)
- Each milestone must be scoped to a single Claude session
- Typically 1-3 milestones per bug fix

**Common milestone patterns**:

1. **Investigation & Setup**: Reproduce bug, identify root cause, document findings
2. **Implementation**: Apply fix, handle edge cases
3. **Validation & Testing**: Verify fix, add regression tests

**Session independence**: Each milestone will be executed in a fresh session with only the plan document as context. Ensure all necessary information (root cause analysis, affected files, reproduction steps) is documented in the plan itself.

## Template

```markdown
# Bug Fix: {{bug_title}}

## Progress

### Implementation

{{implementation_checklist}}

### Validation

{{validation_checklist}}

## Description

{{description}}

## Reproduction Steps

{{reproduction_steps}}

## Root Cause Analysis

{{root_cause}}

## Fix Strategy

{{fix_strategy}}

## Milestones

### Milestone {{milestone_number}}: {{milestone_title}}

{{milestone_description}}

#### Task {{milestone_number}}.{{task_number}}: {{task_title}}

{{task_description}}

## Validation

{{validation}}

## Testing

{{testing}}
```

<!--
Placeholders:
- {{bug_title}}: Concise title for the bug (e.g., "Login Timeout on Safari OAuth Redirect")
- {{implementation_checklist}}: Checkbox list of milestones and tasks for fixing the bug.
  Format:
  - [ ] Milestone 1: Title
    - [ ] Task 1.1: Description
    - [ ] Task 1.2: Description
  - [ ] Milestone 2: Title
    - [ ] Task 2.1: Description
- {{validation_checklist}}: Checkbox list of validation and testing items.
  Format:
  - [ ] Verify fix resolves the issue
  - [ ] Test: Regression test for bug scenario
  - [ ] Test: Edge case coverage
- {{description}}: Clear explanation of the bug and its impact
- {{reproduction_steps}}: Numbered steps to reproduce the bug
- {{root_cause}}: Technical explanation with code references
- {{fix_strategy}}: High-level approach to fixing the bug
- {{milestone_number}}: Sequential number (1, 2, 3, ...)
- {{milestone_title}}: What this milestone accomplishes
- {{milestone_description}}: Brief description of the milestone
- {{task_number}}: Task number within milestone
- {{task_title}}: Clear, actionable task title
- {{task_description}}: Specific task details with acceptance criteria
- {{validation}}: Steps to verify the bug is fixed
- {{testing}}: Test cases to add to prevent regression
-->
