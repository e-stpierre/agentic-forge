---
name: plan-feature
description: Generate a feature implementation plan
argument-hint: <feature-description> [--interactive]
---

# Plan Feature Command

Analyzes the codebase and generates a comprehensive implementation plan for a new feature.

## Parameters

- **`feature-description`** (required): Description of the feature to implement
- **`--interactive`** (optional): Enable interactive mode to ask clarifying questions before planning

## Objective

Generate a detailed, actionable implementation plan that can be executed autonomously or by another developer.

## Core Principles

- Explore the codebase thoroughly before planning
- Identify existing patterns and conventions to follow
- Break down the feature into discrete, testable tasks
- Consider edge cases and error handling
- Include validation criteria for each task
- Keep plans focused and avoid scope creep

## Instructions

1. Parse the input to extract the feature description and check for `--interactive` flag

2. **If `--interactive` flag is present**, use the AskUserQuestion tool to gather clarifying information:
   - What is the primary use case for this feature?
   - Are there any specific technical constraints or preferences?
   - What is the priority level and acceptable scope?
   - Are there related existing features to consider?

   Wait for user responses before proceeding.

3. **If not `--interactive`**, use reasonable defaults:
   - Assume standard use case based on description
   - Follow existing codebase patterns
   - Moderate scope with essential functionality only

4. Use the Task tool with `subagent_type=Explore` to analyze the codebase:
   - Find related existing code and patterns
   - Identify files that will need modification
   - Understand the project structure and conventions
   - Locate relevant tests and documentation

5. Based on exploration, design the implementation approach:
   - List all files to create or modify
   - Define the order of changes (dependencies first)
   - Identify potential risks or blockers
   - Note testing requirements

6. Generate the plan document with the following structure:
   - Overview: Feature summary and goals
   - Prerequisites: Dependencies, setup required
   - Tasks: Numbered list with file paths, descriptions, validation criteria
   - Testing: Test cases to add or modify
   - Documentation: Docs to update
   - Validation: How to verify the feature works

7. Write the plan to `docs/plans/<feature-slug>-plan.md`

8. Report the plan location and provide a summary

## Output Guidance

Create a markdown plan file with this structure:

```markdown
# Feature: [Feature Name]

## Overview

[1-2 paragraph description of the feature and its goals]

## Prerequisites

- [ ] [Any setup or dependencies required]

## Tasks

### Task 1: [Task Title]

**Files**: `path/to/file.ts`

**Description**: [What to do]

**Validation**:

- [ ] [How to verify this task is complete]

### Task 2: [Task Title]

...

## Testing

- [ ] [Test cases to add]
- [ ] [Existing tests to update]

## Documentation

- [ ] [Docs to update]

## Final Validation

- [ ] [End-to-end verification steps]
```

Report to the user:

- Plan file location
- Number of tasks identified
- Estimated complexity (small/medium/large)
- Any blockers or concerns identified
