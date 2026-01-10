---
name: build
description: Implement changes following a plan
output: json
arguments:
  - name: plan
    description: Path to plan document or plan JSON
    required: false
  - name: milestone
    description: Specific milestone to implement
    required: false
  - name: context
    description: Additional context or instructions
    required: false
---

# Build Command

Implement code changes following a plan or direct instructions. This command executes the implementation and tracks progress.

## Behavior

1. **Plan Loading**:
   - If plan path provided, read and parse the plan
   - Identify current milestone or specified milestone
   - Load any existing checkpoints

2. **Implementation**:
   - Execute tasks in order within the milestone
   - Make code changes following project conventions
   - Run tests after significant changes
   - Create commits at logical checkpoints

3. **Progress Tracking**:
   - Update plan document with completed tasks
   - Create checkpoint if approaching context limit
   - Record files changed and tests run

## Output Format

```json
{
  "success": true,
  "milestone_completed": 1,
  "tasks_completed": ["1.1", "1.2", "1.3"],
  "files_changed": [
    {
      "path": "src/auth/handler.ts",
      "action": "modified",
      "lines_added": 45,
      "lines_removed": 12
    }
  ],
  "tests_run": {
    "passed": 12,
    "failed": 0,
    "skipped": 2
  },
  "commits": [
    {
      "hash": "abc123",
      "message": "Implement OAuth callback handler"
    }
  ],
  "next_milestone": 2,
  "checkpoint_created": false
}
```

## Process

1. Load plan and identify work to do
2. For each task:
   - Read relevant files
   - Make required changes
   - Run related tests
3. Commit changes at milestone completion
4. Update plan with progress
5. Return JSON summary

## Guidelines

- Follow existing code patterns and conventions
- Write tests for new functionality
- Make atomic commits with clear messages
- Stop and checkpoint if hitting context limits
- Do not introduce security vulnerabilities

---

{% if plan %}
## Plan

{{ plan }}
{% endif %}

{% if milestone %}
## Target Milestone

{{ milestone }}
{% endif %}

{% if context %}
## Additional Context

{{ context }}
{% endif %}

---

Implement the changes and return JSON output.
