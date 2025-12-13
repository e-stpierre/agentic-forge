---
name: plan-feature
description: Generate a feature implementation plan
argument-hint: <feature-description> [--interactive]
---

# Plan Feature Command

Analyzes the codebase and generates a comprehensive implementation plan for a new feature, organized into milestones for incremental commits.

## Parameters

- **`feature-description`** (required): Description of the feature to implement
- **`--interactive`** (optional): Enable interactive mode to ask clarifying questions before planning

## Objective

Generate a detailed, actionable implementation plan organized into milestones. Each milestone represents a logical checkpoint where changes should be committed, enabling parallel development and clean git history.

## Core Principles

- Explore the codebase thoroughly before planning
- Identify existing patterns and conventions to follow
- Organize work into milestones (logical commit points)
- Each milestone contains 1-many related tasks
- Include validation criteria for each task and milestone
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
   - Group related changes into milestones (logical commit points)
   - Define the order of milestones (dependencies first)
   - Identify potential risks or blockers
   - Note testing requirements

6. Generate the plan document with milestone-based structure:
   - Overview: Feature summary and goals
   - Prerequisites: Dependencies, setup required
   - Milestones: Ordered list of milestones, each containing tasks
   - Final Validation: How to verify the feature works

7. Write the plan to `docs/plans/<feature-slug>-plan.md`

8. Report the plan location and provide a summary

## Output Guidance

Create a markdown plan file with this milestone-based structure:

```markdown
# Feature: [Feature Name]

## Overview

[1-2 paragraph description of the feature and its goals]

## Prerequisites

- [ ] [Any setup or dependencies required]

## Milestones

### Milestone 1: [Milestone Title]

**Commit message**: `feat: [descriptive commit message]`

**Description**: [What this milestone accomplishes as a logical unit]

#### Task 1.1: [Task Title]

**Files**: `path/to/file.ts`

**Description**: [What to do]

**Validation**:

- [ ] [How to verify this task is complete]

#### Task 1.2: [Task Title]

**Files**: `path/to/another-file.ts`

**Description**: [What to do]

**Validation**:

- [ ] [How to verify this task is complete]

**Milestone Validation**:

- [ ] [How to verify the milestone is complete and ready to commit]

---

### Milestone 2: [Milestone Title]

**Commit message**: `feat: [descriptive commit message]`

**Description**: [What this milestone accomplishes]

#### Task 2.1: [Task Title]

...

**Milestone Validation**:

- [ ] [Verification steps for this milestone]

---

### Milestone 3: [Milestone Title] (Tests)

**Commit message**: `test: add tests for [feature]`

**Description**: Add test coverage for the new feature

#### Task 3.1: [Test Task Title]

**Files**: `path/to/test-file.test.ts`

**Description**: [Test cases to add]

**Validation**:

- [ ] Tests pass
- [ ] Coverage meets requirements

**Milestone Validation**:

- [ ] All new tests pass
- [ ] No regressions in existing tests

---

### Milestone 4: [Milestone Title] (Documentation)

**Commit message**: `docs: document [feature]`

**Description**: Update documentation for the new feature

#### Task 4.1: [Docs Task Title]

**Files**: `docs/feature.md`, `README.md`

**Description**: [Documentation to add/update]

**Validation**:

- [ ] Documentation is accurate and complete

**Milestone Validation**:

- [ ] All documentation updated

## Final Validation

- [ ] All milestones completed
- [ ] All tests pass
- [ ] Feature works end-to-end
- [ ] [Feature-specific validation steps]
```

## Milestone Guidelines

1. **Logical grouping**: Each milestone should represent a coherent, atomic change
2. **Commit-ready**: After completing a milestone, the code should be in a working state
3. **Descriptive commits**: Each milestone includes a conventional commit message
4. **Typical milestone types**:
   - Core implementation (may span multiple milestones for complex features)
   - Tests
   - Documentation
   - Integration/wiring

Report to the user:

- Plan file location
- Number of milestones identified
- Total number of tasks
- Estimated complexity (small/medium/large)
- Any blockers or concerns identified
