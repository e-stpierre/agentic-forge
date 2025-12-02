---
name: plan-dev
description: Create a comprehensive feature implementation plan through codebase analysis
argument-hint: [feature-description]
---

# Plan Development Command

Analyzes the codebase and gathers requirements through interactive questions to produce a detailed implementation plan that coding agents can follow. Ideal for new features, refactors, or complex changes requiring upfront planning.

## Parameters

- **`feature-description`** (optional): Description of the feature to plan. If not provided, prompts the user to describe the feature.

## Objective

Create a concise but complete feature implementation plan in markdown format that contains all the necessary details for a coding agent to implement the feature successfully. The plan may be broken into milestones for large features.

## Core Principles

- Understand the codebase thoroughly before asking questions
- Launch exploration agents in parallel for efficiency
- Ask only questions that affect implementation decisions
- Provide recommended answers when possible
- Break large features into logical milestones
- Reference existing code patterns and conventions
- No time estimates, story points, or project management overhead
- Plans should be detailed enough for a coding agent to execute autonomously

## Instructions

1. **Capture Feature Request**
   - Use provided description or ask the user to describe the feature
   - Ensure you have enough context to begin exploration

2. **Launch Parallel Codebase Exploration** Launch THREE Explore agents simultaneously using the Task tool (in a single message with three Task calls):

   **Agent 1 - Architecture Analysis**:

   ```
   Analyze the overall architecture and project structure of this codebase.

   **Focus on**:
   - Primary language(s) and framework(s) in use
   - Project organization patterns (MVC, microservices, monorepo, etc.)
   - Key directories and their purposes
   - Build system and configuration files
   - Testing infrastructure
   - Existing design patterns and conventions

   **Deliverables**:
   - Overview of project architecture
   - Directory structure explanation
   - Technology stack summary
   - Relevant architectural patterns
   - Build and test setup details

   Be thorough but concise. Explore the codebase systematically using medium thoroughness.
   ```

   **Agent 2 - Feature-Related Code Discovery**:

   ```
   Find existing code that is related to or will be affected by implementing: [FEATURE DESCRIPTION]

   **Focus on**:
   - Similar or related existing features
   - Code that will need modification
   - Relevant models, services, or components
   - API endpoints or routes that relate to this feature
   - Database schemas or data models involved
   - UI components or views affected
   - Configuration or setup requirements

   **Deliverables**:
   - List of files that will likely need changes
   - Existing patterns to follow or avoid
   - Dependencies between components
   - Potential integration points
   - Code that should be used as reference

   Use medium thoroughness to explore multiple areas and naming conventions.
   ```

   **Agent 3 - Dependencies and Integration Points**:

   ```
   Identify dependencies, utilities, and integration points relevant to: [FEATURE DESCRIPTION]

   **Focus on**:
   - External libraries or packages used for similar functionality
   - Internal utility functions and helpers
   - Authentication and authorization mechanisms
   - Logging, error handling, and monitoring patterns
   - API integrations or external services
   - Database access patterns
   - State management approaches
   - Common middleware or interceptors

   **Deliverables**:
   - List of reusable utilities and libraries
   - Integration patterns in use
   - Dependencies that should be leveraged
   - Common code patterns to follow
   - Potential blockers or limitations

   Use medium thoroughness to identify patterns across the codebase.
   ```

   **IMPORTANT**: Launch all three agents in PARALLEL in a single message. Do not launch them sequentially.

3. **Synthesize Exploration Results** Once all three agents have completed:
   - Synthesize findings into a coherent understanding
   - Identify where new code should be added
   - Determine which existing code needs modification
   - Note patterns and conventions to follow
   - List dependencies and utilities available
   - Identify areas of uncertainty needing clarification

4. **Ask Clarifying Questions** Formulate 0-20 clarifying questions based on complexity:
   - Have clear, specific focus
   - Include recommended answer choices when applicable
   - Cover requirements, behavior, edge cases, and design decisions
   - Prioritize most critical questions first

   **Question Format**:

   ```
   ## Question [N]: [Clear, specific question]

   **Context**: [Why this matters for implementation]

   **Recommended Options**:
   a) [Option 1 - with brief explanation]
   b) [Option 2 - with brief explanation]
   c) [Option 3 - with brief explanation]
   d) Other (please specify)

   **Your Answer**: [User will provide answer here]
   ```

   **Interaction Rules**:
   - 0-4 questions: Present all in a single interaction
   - 5+ questions: Break into pages of 4 questions each
   - Present pages sequentially, waiting for responses
   - Number questions sequentially across pages
   - At end of each page (except last): "Ready for the next set of questions?"
   - Allow users to skip or say "use your best judgment"

   **Example Questions** (adapt based on feature):
   - Where should this feature be accessible? (UI location, API endpoint, etc.)
   - What permissions/authorization is required?
   - How should this integrate with [existing feature]?
   - What should happen when [edge case]?
   - Should this be configurable? If yes, where?
   - What data validation rules apply?
   - What error messages should be shown?
   - Should this work offline or require connectivity?
   - What testing coverage is expected?

5. **Generate Implementation Plan** Create a comprehensive plan using the Implementation Plan Template (see Templates section).

6. **Save Plan** Ask user for save location:

   ```
   I've created a comprehensive implementation plan for this feature.

   **Where would you like to save this plan?**

   Default location: `/docs/plans/[feature-name]-plan.md`

   Please provide the full path, or press enter to use the default location.
   ```

   Save using the Write tool.

7. **Present Summary**

   ```
   ## Implementation Plan Created

   **Plan Location**: [path to saved file]

   **Summary**:
   - Feature: [brief description]
   - Milestones: [number of milestones, if applicable]
   - Files to create: [count]
   - Files to modify: [count]
   - Estimated complexity: [Simple/Medium/Complex]

   **Next Steps**:
   1. Review the plan for accuracy and completeness
   2. Use the plan to implement the feature (manually or with a coding agent)
   3. Follow the validation checklist before considering the feature complete

   Would you like me to:
   - Start implementing this plan?
   - Revise any part of the plan?
   - Create a GitHub issue from this plan?
   ```

## Output Guidance

- Plan format: Markdown (.md)
- Default location: `/docs/plans/`
- Naming convention: `[feature-name-kebab-case]-plan.md`
- Include file paths with line references where helpful
- Make every instruction actionable and specific
- Reference existing code as examples to follow

## Templates

### Implementation Plan Template

```markdown
# Feature Implementation Plan: [Feature Name]

## Overview

[Brief description of what will be implemented and why]

## Prerequisites

- [Any setup, dependencies, or preparation needed]
- [Tools or access requirements]

## Feature Requirements

[Clear, concise list of what the feature must do]

- Requirement 1
- Requirement 2
- ...

## Architecture & Design Decisions

[Key architectural decisions and rationale]

- Decision 1: [What and why]
- Decision 2: [What and why]

## Implementation Details

### Milestone 1: [Milestone Name] (if applicable for large features)

#### Files to Create

1. **`path/to/new/file.ext`**
   - Purpose: [What this file does]
   - Key components: [Main classes, functions, exports]
   - Dependencies: [What it imports/uses]

#### Files to Modify

1. **`path/to/existing/file.ext`**
   - Changes needed: [Specific modifications]
   - Lines/sections affected: [Approximate location]
   - Reason: [Why this change is needed]

#### Implementation Steps

1. [Step 1 - specific action]
   - Details: [What to do]
   - Considerations: [What to watch out for]

2. [Step 2 - specific action]
   - Details: [What to do]
   - Related code: [Reference existing patterns]

[Continue for all steps in this milestone]

### Milestone 2: [Milestone Name] (if applicable)

[Repeat structure for additional milestones]

## Testing Strategy

### Unit Tests

- Test file: `path/to/test/file.test.ext`
- Test cases:
  - [Test case 1]
  - [Test case 2]

### Integration Tests

- [What integration points to test]
- [Expected behaviors to verify]

### Manual Testing

- [ ] [Test scenario 1]
- [ ] [Test scenario 2]

## Edge Cases & Error Handling

- **Edge Case 1**: [Description] → [How to handle]
- **Edge Case 2**: [Description] → [How to handle]
- **Error Condition 1**: [Description] → [Error message and recovery]

## Security Considerations

- [Security concern 1 and mitigation]
- [Security concern 2 and mitigation]

## Performance Considerations

- [Performance concern 1 and approach]
- [Performance concern 2 and approach]

## Documentation Updates

- [ ] Update `path/to/doc.md` with [what to add]
- [ ] Add inline code documentation
- [ ] Update API documentation if applicable

## Validation Checklist

Before considering this feature complete, verify:

- [ ] All requirements are met
- [ ] Tests are passing
- [ ] Code follows project conventions
- [ ] Error handling is comprehensive
- [ ] Documentation is updated
- [ ] Security considerations addressed
- [ ] Performance is acceptable

## Notes for Implementation

[Any additional context, tips, or warnings for the implementing agent]

- Note 1
- Note 2

## References

- Existing code to reference: `path/to/reference.ext:line`
- Related patterns: [Where to find similar implementations]
- Documentation: [Links or file paths]
```

## Examples

### Simple Feature

```
User: /plan-dev
User: I want to add a "dark mode" toggle to the settings page

[Agent analyzes codebase with 3 Explore agents]
[Agent asks 3-5 clarifying questions]
[Agent creates single-milestone plan]
[Agent saves to /docs/plans/dark-mode-toggle-plan.md]
```

### Complex Feature

```
User: /plan-dev
User: I want to implement a real-time chat system with message history, typing indicators, and file attachments

[Agent analyzes codebase with 3 Explore agents]
[Agent asks 15 questions across 4 pages]
[Agent creates multi-milestone plan]
[Agent saves to /docs/plans/real-time-chat-system-plan.md]
```

## Configuration

**Explore Agent Settings**:

- Thoroughness: "medium" (balances speed and completeness)
- Model: "sonnet" (cost-effective for exploration)
- Run mode: Parallel (all 3 agents simultaneously)

**Question Interaction**:

- Max questions per page: 4
- Total question range: 0-20
- Allow skipping: Yes
- Provide recommended answers: Yes

**Plan Output**:

- Format: Markdown (.md)
- Default location: `/docs/plans/`
- Naming convention: `[feature-name-kebab-case]-plan.md`

## Best Practices

### Codebase Analysis

- **Be Thorough**: Use all three Explore agents to understand the full context
- **Run in Parallel**: Launch agents simultaneously for faster results
- **Synthesize Well**: Combine findings into coherent understanding
- **Identify Gaps**: Note what you couldn't find or need clarification on

### Asking Questions

- **Be Strategic**: Only ask questions that affect implementation
- **Provide Context**: Explain why each question matters
- **Offer Options**: Give recommended answers when possible
- **Respect Time**: Prioritize critical questions first
- **Use Pages**: Break into digestible chunks of 4 questions
- **Allow Flexibility**: Let users skip or defer questions

### Writing Plans

- **Be Specific**: Include file paths, function names, and code references
- **Be Complete**: Include all details needed for implementation
- **Be Concise**: Don't include unnecessary information
- **Be Actionable**: Make every instruction clear and executable
- **Reference Existing Code**: Point to similar implementations
- **Consider Edge Cases**: Think through error conditions and unusual scenarios

### Plan Organization

- **Use Milestones**: Break large features into logical phases
- **Sequence Properly**: Order steps in a logical implementation sequence
- **Show Dependencies**: Make clear what depends on what
- **Include Testing**: Testing is part of implementation, not separate
- **Think Security**: Always consider security implications
- **Think Performance**: Note performance-critical areas
