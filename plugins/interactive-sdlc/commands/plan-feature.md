---
name: plan-feature
description: Plan a feature with milestones, architecture design, and comprehensive task breakdown
argument-hint: "[--explore N] [--git] [context]"
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
   - Read `.claude/settings.json` for `interactive-sdlc.planDirectory` (default: `/specs`)
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
   - Create a plan following this structure:

   ```markdown
   # Feature: <feature-title>

   ## Overview
   What this feature does and why it's valuable

   ## Requirements
   Functional and non-functional requirements

   ## Architecture
   High-level design decisions and patterns to use

   ## Milestones

   ### Milestone 1: <milestone-title>
   What this milestone achieves

   #### Task 1.1: <task-title>
   Specific task description

   #### Task 1.2: <task-title>
   Specific task description

   ### Milestone 2: <milestone-title>
   What this milestone achieves

   #### Task 2.1: <task-title>
   Specific task description

   (Additional milestones as needed)

   ## Testing Strategy
   How this feature will be tested

   ## Validation Criteria
   How to verify the feature is complete and working
   ```

7. **Save Plan**
   - Save to `{planDirectory}/feature-{slugified-title}.md`
   - Inform user of the saved file path

8. **Git Commit (if --git flag)**
   - Stage the plan file
   - Commit with message: `docs(plan): Add feature plan - {title}`

## Output Guidance

Present the plan file path and a brief summary of the feature design:

```
Plan saved to /specs/feature-{slugified-title}.md

## Summary
- Feature: [one-line description]
- Milestones: X
- Total tasks: Y
- Key components: [list of main components]

Architecture highlights:
- [key architectural decisions]

Next steps:
- Implement with: /interactive-sdlc:build /specs/feature-{slugified-title}.md
- Or run full workflow: /interactive-sdlc:plan-build-validate
```

## Templates

### Feature Plan Structure

```markdown
# Feature: <feature-title>

## Overview
What this feature does and why it's valuable

## Requirements
Functional and non-functional requirements

## Architecture
High-level design decisions and patterns to use

## Milestones

### Milestone 1: <milestone-title>
What this milestone achieves

#### Task 1.1: <task-title>
Specific task description

#### Task 1.2: <task-title>
Specific task description

### Milestone 2: <milestone-title>
What this milestone achieves

#### Task 2.1: <task-title>
Specific task description

(Additional milestones as needed)

## Testing Strategy
How this feature will be tested

## Validation Criteria
How to verify the feature is complete and working
```

## Don't

- Don't modify plan files during implementation - they are static documentation
- Don't include time estimates, deadlines, or scheduling information
- Don't create monolithic plans - break into milestones for incremental delivery
- Don't make architectural decisions without exploring existing patterns first
- Don't skip requirements gathering - unclear requirements lead to rework
