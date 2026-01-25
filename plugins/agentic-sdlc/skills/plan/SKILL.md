---
name: plan
description: Create an implementation plan for a task
argument-hint: [type] [output_dir] <context>
---

# Plan

## Overview

Create a structured implementation plan for the given task. This skill analyzes the codebase, identifies relevant files and patterns, and produces a detailed plan with milestones and actionable tasks. Supports different plan types (feature, bug, chore) with type-specific guidance.

## Arguments

### Definitions

- **`[type]`** (optional): Plan type. Values: `feature`, `bug`, `chore`, `auto`. Defaults to `auto`.
- **`[output_dir]`** (optional): Directory to write plan.md file (default to `agentic/outputs/<workflow-id>`).
- **`<context>`** (required): Task description or issue reference.

### Values

\$ARGUMENTS

## Additional Resources

Load ONE of these based on the `[type]` argument (or detected type if auto):

- For feature plans, see [references/feature.md](references/feature.md)
- For bug fix plans, see [references/bug.md](references/bug.md)
- For chore plans, see [references/chore.md](references/chore.md)

## Core Principles

- Each milestone should take 1-3 implementation sessions
- Tasks should be specific enough to execute without ambiguity
- Include file paths with line numbers where changes are needed
- Consider testing requirements in each milestone
- Flag any unclear requirements or assumptions
- Milestones should be completable independently
- Plans are static documentation - never modified during implementation

## Instructions

1. **Parse Arguments**
   - Extract type, output_dir, template, and context from arguments
   - Default type to `auto` if not specified

2. **Detect Plan Type** (if type=auto)
   - Analyze the context to determine type:
     - **feature**: New functionality, enhancements, additions
     - **bug**: Error fixes, unexpected behavior corrections, defects
     - **chore**: Refactoring, dependency updates, maintenance, cleanup
   - Once detected, proceed with that type

3. **Load Type-Specific Guidelines**
   Based on the detected or specified type, load the corresponding reference file:
   - `feature` -> Read [references/feature.md](references/feature.md)
   - `bug` -> Read [references/bug.md](references/bug.md)
   - `chore` -> Read [references/chore.md](references/chore.md)

4. **Analyze Codebase**
   - Use the explorer agent to understand relevant code
   - Identify files and components relevant to the task
   - Understand existing patterns and conventions
   - Map dependencies and impact areas

5. **Generate Plan**
   - Apply type-specific planning approach from the loaded reference
   - Create discrete, independent milestones
   - Include specific file paths and line numbers
   - Estimate complexity (low, medium, high)

6. **Write Output**
   - Write plan document as .md format to the output_dir.
   - Return JSON summary

## Output Guidance

Return JSON with metadata only. The full plan content is saved to the markdown file.

```json
{
  "success": true,
  "plan_type": "{{type}}",
  "summary": "{{summary}}",
  "milestone_count": "{{milestone_count}}",
  "task_count": "{{task_count}}",
  "complexity": "{{complexity}}",
  "document_path": "{{document_path}}"
}
```

<!--
Placeholders:
- {{type}}: Plan type (feature, bug, chore)
- {{summary}}: Brief one-line summary of the plan
- {{milestone_count}}: Total number of milestones
- {{task_count}}: Total number of tasks across all milestones
- {{complexity}}: Overall complexity (low, medium, high)
- {{document_path}}: Path to generated plan.md file
-->
