---
name: plan
description: Create an implementation plan for a task
argument-hint: <context> [type] [output_dir] [template]
---

# Plan Command

Create a structured implementation plan for the given task. This command analyzes the codebase and produces a detailed plan with milestones and tasks.

## Arguments

- **`<context>`** (required): Task description or issue reference.
- **`[type]`** (optional): Plan type. Values: `feature`, `bug`, `chore`, `auto`. Defaults to `auto`.
- **`[output_dir]`** (optional): Directory to write plan.md file (e.g., `agentic/outputs/workflow-id`).
- **`[template]`** (optional): Custom template path.

## Behavior

1. **Type Detection** (if type=auto):
   - Analyze the context to determine if it's a feature, bug fix, or chore
   - Features: New functionality, enhancements
   - Bugs: Error fixes, unexpected behavior corrections
   - Chores: Refactoring, dependency updates, maintenance

2. **Codebase Analysis**:
   - Identify files and components relevant to the task
   - Understand existing patterns and conventions
   - Map dependencies and impact areas

3. **Plan Generation**:
   - Create discrete, independent milestones
   - Each milestone should be completable without knowledge of other milestones
   - Include specific file paths and line numbers
   - Estimate complexity (low, medium, high)

## Output Format

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

## Process

1. Read the task context
2. Use the explorer agent to understand relevant code
3. Determine plan type if auto
4. Generate milestones with specific, actionable tasks
5. Write plan document to `{{ output_dir }}/plan.md` if output_dir is provided, otherwise skip file creation
6. Return JSON summary

## Guidelines

- Each milestone should take 1-3 implementation sessions
- Tasks should be specific enough to execute without ambiguity
- Include file paths with line numbers where changes are needed
- Consider testing requirements in each milestone
- Flag any unclear requirements or assumptions

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
