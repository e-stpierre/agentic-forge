---
name: plan
description: Create an implementation plan for a task
argument-hint: [type] [output_dir] [template] <context>
---

# Plan Command

## Overview

Create a structured implementation plan for the given task. This command analyzes the codebase, identifies relevant files and patterns, and produces a detailed plan with milestones and actionable tasks.

## Arguments

- **`[type]`** (optional): Plan type. Values: `feature`, `bug`, `chore`, `auto`. Defaults to `auto`.
- **`[output_dir]`** (optional): Directory to write plan.md file (e.g., `agentic/outputs/workflow-id`).
- **`[template]`** (optional): Custom template path.
- **`<context>`** (required): Task description or issue reference.

## Core Principles

- Each milestone should take 1-3 implementation sessions
- Tasks should be specific enough to execute without ambiguity
- Include file paths with line numbers where changes are needed
- Consider testing requirements in each milestone
- Flag any unclear requirements or assumptions
- Milestones should be completable independently

## Instructions

1. **Read Task Context**
   - Parse the provided context
   - Identify key requirements and constraints

2. **Detect Plan Type** (if type=auto)
   - Analyze the context to determine type:
     - **Features**: New functionality, enhancements
     - **Bugs**: Error fixes, unexpected behavior corrections
     - **Chores**: Refactoring, dependency updates, maintenance

3. **Analyze Codebase**
   - Use the explorer agent to understand relevant code
   - Identify files and components relevant to the task
   - Understand existing patterns and conventions
   - Map dependencies and impact areas

4. **Generate Plan**
   - Create discrete, independent milestones
   - Include specific file paths and line numbers
   - Estimate complexity (low, medium, high)

5. **Write Output**
   - Write plan document to `{{ output_dir }}/plan.md` if output_dir is provided
   - Return JSON summary

## Output Guidance

Return JSON with plan details:

```json
{
  "success": true,
  "plan_type": "feature",
  "summary": "Brief one-line summary",
  "milestones": [
    {
      "id": 1,
      "title": "Milestone title",
      "description": "What this milestone accomplishes",
      "complexity": "medium",
      "tasks": [
        {
          "id": "1.1",
          "description": "Task description",
          "files": ["src/path/file.ts:42"],
          "completed": false
        }
      ]
    }
  ],
  "affected_files": ["src/path/file.ts"],
  "dependencies": ["package-name"],
  "risks": ["Potential risk or consideration"],
  "document_path": "agentic/outputs/{id}/plan.md"
}
```

---

## Task Context

{{ context }}

{% if type != "auto" %}
Plan Type: {{ type }}
{% endif %}

{% if output_dir %}

## Output Directory

Write the plan document to: `{{ output_dir }}/plan.md`

IMPORTANT: You MUST create this file. Create the directory if it doesn't exist.
{% endif %}

---

Generate the implementation plan and return JSON output.
