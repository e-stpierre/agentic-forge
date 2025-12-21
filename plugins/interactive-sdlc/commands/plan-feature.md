# Plan Feature

Plan a feature with milestones, architecture design, and comprehensive task breakdown.

## Arguments

- `--explore N`: Override default explore agent count (default: 3)
- `--git`: Commit plan file after creation
- `--output <path>`: Override plan file location
- `[context]`: Optional freeform context for parameter inference

## Behavior

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
   - Save to `--output` path if specified
   - Otherwise save to `{planDirectory}/feature-{slugified-title}.md`
   - Inform user of the saved file path

8. **Git Commit (if --git flag)**
   - Stage the plan file
   - Commit with message: `docs(plan): Add feature plan - {title}`

## Example Usage

```bash
# Basic usage - interactive prompts
/interactive-sdlc:plan-feature

# With context
/interactive-sdlc:plan-feature Add dark mode support with toggle in settings and persistent user preference

# With flags
/interactive-sdlc:plan-feature --explore 5 --git User authentication with OAuth support for Google and GitHub

# With custom output
/interactive-sdlc:plan-feature --output /docs/features/auth.md User authentication
```

## Important Notes

- Plans are static documentation - never modified during implementation
- No time estimates, deadlines, or scheduling information in plans
- Progress tracking happens via TodoWrite tool, not plan file updates
- Features should be broken into logical milestones for incremental delivery
- Each milestone should be independently testable and valuable
- Architecture decisions should align with existing codebase patterns
