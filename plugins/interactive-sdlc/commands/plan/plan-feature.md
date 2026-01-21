---
name: plan-feature
description: Plan a feature with milestones, architecture design, and comprehensive task breakdown
argument-hint: "[--explore N] [--git] [context]"
arguments:
  - name: explore
    description: Override default explore agent count (default 3)
    required: false
  - name: git
    description: Commit plan file after creation
    required: false
  - name: context
    description: Optional freeform context for argument inference
    required: false
---

# Plan Feature

Plan a feature with milestones, architecture design, and comprehensive task breakdown.

## Arguments

- **`--explore N`** (optional): Override default explore agent count (default: 3)
- **`--git`** (optional): Commit plan file after creation
- **`[context]`** (optional): Optional freeform context for argument inference

## Objective

Plan a feature with comprehensive codebase exploration, architecture design, milestone breakdown, and task decomposition that enables incremental delivery.

## Core Principles

- Break features into logical milestones for incremental delivery
- Each milestone should be independently valuable and testable
- Architecture decisions should align with existing codebase patterns
- Explore thoroughly to understand integration points and existing components
- Plans are static documentation - never modified during implementation

## Instructions

1. **Read Configuration**
   - Read `.claude/settings.json` for `interactive-sdlc.planDirectory` (default: `specs`)
   - Read `interactive-sdlc.defaultExploreAgents.feature` (default: 3)

2. **Explore Codebase**
   - Launch N explore agents (from config or --explore flag)
   - Focus exploration on understanding the codebase architecture
   - Identify patterns, conventions, and integration points
   - Understand existing components that may be affected

3. **Gather Requirements**
   - Parse the `[context]` argument if provided
   - If requirements can be inferred from context, use them
   - Otherwise, ask the user interactive questions about:
     - Feature title and overview
     - Functional requirements
     - Non-functional requirements (performance, security, etc.)
     - User experience expectations
     - Technical constraints
     - Integration points with existing systems
     - Any other clarifying questions needed

4. **Design Architecture**
   - Based on codebase exploration and requirements
   - Identify components to create or modify
   - Define data models and API contracts
   - Consider patterns consistent with existing codebase

5. **Break Down into Milestones**
   - Group related tasks into logical milestones
   - Each milestone should be independently valuable
   - Order milestones by dependency
   - Define tasks within each milestone

6. **Generate Plan**
   - Create a plan using the structure defined in the Templates section
   - Fill in all required sections with gathered requirements and architecture decisions
   - Include 2-5 milestones with specific tasks for each

7. **Save Plan**
   - Save to `{planDirectory}/feature-{slugified-title}.md`
   - Inform user of the saved file path

8. **Git Commit (if --git flag)**
   - Stage the plan file
   - Commit with message: `docs(plan): Add feature plan - {title}`

## Output Guidance

Present the plan file path and a brief summary of the feature design:

```
Plan saved to specs/feature-{slugified-title}.md

## Summary
- Feature: [one-line description]
- Milestones: X
- Total tasks: Y
- Key components: [list of main components]

Architecture highlights:
- [key architectural decisions]

Next steps:
- Implement with: /interactive-sdlc:build specs/feature-{slugified-title}.md
- Or run full workflow: /interactive-sdlc:plan-build-validate
```

## Templates

### Feature Plan Structure

```markdown
# Feature: {{feature_title}}

<!--
Instructions:
- Replace {{feature_title}} with a concise title for the feature
- Use title case (e.g., "User Authentication with OAuth")
-->

## Overview

{{overview}}

<!--
Instructions:
- Replace {{overview}} with what this feature does and why it's valuable
- Explain the user benefit and business value
- Keep it to 2-4 sentences
-->

## Requirements

{{requirements}}

<!--
Instructions:
- Replace {{requirements}} with functional and non-functional requirements
- Use bullet points or subsections
- Include performance, security, and UX requirements as applicable
- Example:
  Functional:
  - Users can log in with Google OAuth
  - Users can log in with GitHub OAuth

  Non-functional:
  - OAuth flow must complete within 5 seconds
  - Must support 10,000 concurrent OAuth sessions
-->

## Architecture

{{architecture}}

<!--
Instructions:
- Replace {{architecture}} with high-level design decisions and patterns to use
- Explain component structure, data flow, and integration points
- Reference existing patterns in the codebase
-->

## Milestones

### Milestone {{milestone_number}}: {{milestone_title}}

<!--
Instructions:
- Replace {{milestone_number}} with milestone number (1, 2, 3, etc.)
- Replace {{milestone_title}} with what this milestone achieves
- Each milestone should be independently valuable
-->

{{milestone_description}}

<!--
Instructions:
- Replace {{milestone_description}} with a brief description of what this milestone accomplishes
-->

#### Task {{milestone_number}}.{{task_number}}: {{task_title}}

<!--
Instructions:
- Replace {{task_number}} with task number within the milestone
- Replace {{task_title}} with a clear, actionable task title
- Include multiple tasks per milestone as needed
-->

{{task_description}}

<!--
Instructions:
- Replace {{task_description}} with specific task description
- Make it actionable and clear
- Include acceptance criteria if needed
-->

<!--
Instructions:
- Add additional milestones following the same structure
- Each milestone should build on previous ones
- Typical features have 2-5 milestones
-->

## Testing Strategy

{{testing_strategy}}

<!--
Instructions:
- Replace {{testing_strategy}} with how this feature will be tested
- Include unit tests, integration tests, e2e tests as appropriate
- Specify test coverage expectations
-->

## Validation Criteria

{{validation_criteria}}

<!--
Instructions:
- Replace {{validation_criteria}} with specific criteria to verify the feature is complete and working
- Use checklist format
- Make criteria objective and measurable
-->
```

## Important Notes

- Plans are static documentation - never modify them during implementation
- Focus on actionable tasks, not time estimates or deadlines
- Break features into logical milestones for incremental delivery
- Explore existing patterns before making architectural decisions
- Gather requirements thoroughly - clear requirements prevent rework
