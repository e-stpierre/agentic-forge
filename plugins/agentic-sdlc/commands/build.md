---
name: build
description: Implement changes following a plan
argument-hint: [plan] [milestone] [context]
---

# Build Command

## Overview

Implement code changes following a plan or direct instructions. This command executes the implementation phase of the development workflow, tracking progress and creating commits at logical checkpoints.

## Arguments

- **`[plan]`** (optional): Path to plan document or plan JSON.
- **`[milestone]`** (optional): Specific milestone to implement.
- **`[context]`** (optional): Additional context or instructions.

## Core Principles

- Follow existing code patterns and conventions
- Write tests for new functionality
- Make atomic commits with clear messages
- Stop and checkpoint if hitting context limits
- Do not introduce security vulnerabilities

## Instructions

1. **Load Plan**
   - If plan path provided, read and parse the plan
   - Identify current milestone or specified milestone
   - Load any existing checkpoints

2. **Implement Tasks**
   - Execute tasks in order within the milestone
   - Make code changes following project conventions
   - Run tests after significant changes
   - Create commits at logical checkpoints

3. **Track Progress**
   - Update plan document with completed tasks
   - Create checkpoint if approaching context limit
   - Record files changed and tests run

4. **Complete**
   - Commit changes at milestone completion
   - Update plan with progress
   - Return JSON summary

## Output Guidance

Return JSON with implementation details:

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
