---
name: design
description: Design technical implementation and create GitHub issues
argument-hint: <requirement-description> [--interactive] [--epic]
---

# Design Command

Takes a product requirement, designs the technical implementation, and optionally creates GitHub issues for each implementation task.

## Parameters

- **`requirement-description`** (required): The product requirement or feature to design
- **`--interactive`** (optional): Ask clarifying questions before designing
- **`--epic`** (optional): Create a GitHub Epic with linked issues

## Objective

Transform a product requirement into a technical design document with actionable GitHub issues.

## Core Principles

- Start with understanding the "why" before the "how"
- Consider multiple technical approaches before committing
- Break down into small, independently deliverable issues
- Include acceptance criteria for each issue
- Design for testability and maintainability
- Consider backward compatibility and migration paths

## Instructions

1. Parse the input to extract the requirement and check for `--interactive` and `--epic` flags

2. **If `--interactive` flag is present**, use the AskUserQuestion tool:
   - What problem does this solve for users?
   - Are there any technical constraints or preferences?
   - What is the timeline and priority?
   - Are there dependencies on other work?
   - Should this be behind a feature flag?

   Wait for user responses before proceeding.

3. **If not `--interactive`**, make reasonable assumptions:
   - Infer user problem from the requirement
   - Follow existing codebase patterns
   - Assume moderate priority
   - No feature flag unless complexity warrants it

4. Use the Task tool with `subagent_type=Explore` to research:
   - Existing related functionality in the codebase
   - Patterns and conventions used
   - Integration points and APIs
   - Test patterns and coverage

5. Design the technical solution:
   - Evaluate 2-3 technical approaches
   - Select the best approach with rationale
   - Define the data model changes (if any)
   - Define the API changes (if any)
   - Define the UI changes (if any)
   - Identify risks and mitigations

6. Break down into implementation tasks:
   - Each task should be completable in 1-2 focused sessions
   - Order tasks by dependencies
   - Include acceptance criteria for each
   - Estimate complexity (S/M/L)

7. Generate the design document:
   - Write to `docs/designs/<feature-slug>-design.md`

8. **If `--epic` flag is present**:
   - Create a GitHub Epic issue using `/core:create-gh-issue`
   - Create individual task issues linked to the epic
   - Report all issue numbers

9. Report the design location and summary

## Output Guidance

Create a markdown design document with this structure:

```markdown
# Design: [Feature Name]

## Problem Statement

[What problem are we solving and for whom?]

## Goals

- [Goal 1]
- [Goal 2]

## Non-Goals

- [Explicitly out of scope item 1]

## Technical Approach

### Option 1: [Approach Name]

[Description, pros, cons]

### Option 2: [Approach Name]

[Description, pros, cons]

### Selected Approach

[Which option and why]

## Detailed Design

### Data Model

[Schema changes, new models, etc.]

### API Changes

[New endpoints, modified endpoints]

### UI Changes

[Component changes, new screens]

### Dependencies

[External libraries, internal modules]

## Implementation Tasks

### Task 1: [Title]

**Complexity**: S/M/L

**Description**: [What to do]

**Acceptance Criteria**:

- [ ] [Criterion 1]
- [ ] [Criterion 2]

**Dependencies**: None | [Task X]

### Task 2: [Title]

...

## Risks and Mitigations

| Risk     | Impact         | Mitigation   |
| -------- | -------------- | ------------ |
| [Risk 1] | [High/Med/Low] | [Mitigation] |

## Testing Strategy

- [Unit tests for...]
- [Integration tests for...]
- [E2E tests for...]

## Rollout Plan

1. [Phase 1]
2. [Phase 2]
```

If `--epic` was used, also report:

- Epic issue number and URL
- Task issue numbers and URLs
