---
name: plan-chore
description: Generate a chore/maintenance plan (autonomous, JSON I/O)
argument-hint: --json-input <spec.json> | --json-stdin
---

# Plan Chore Command (Autonomous)

Generates a plan for maintenance tasks. Operates autonomously without user interaction.

## Input Schema

```json
{
  "type": "chore",
  "title": "Chore title",
  "description": "What needs to be done and why",
  "scope": {
    "include": ["src/", "package.json"],
    "exclude": ["tests/"]
  },
  "explore_agents": 2
}
```

## Output Schema

```json
{
  "success": true,
  "plan_file": "/specs/chore-update-deps.md",
  "plan_data": {
    "type": "chore",
    "title": "Update npm dependencies",
    "chore_type": "dependency_update",
    "risk_level": "medium",
    "tasks": [
      {
        "id": "t1",
        "title": "Audit current dependencies",
        "files": ["package.json"]
      },
      {
        "id": "t2",
        "title": "Update minor versions",
        "files": ["package.json", "package-lock.json"]
      },
      {
        "id": "t3",
        "title": "Update major versions",
        "files": ["package.json", "package-lock.json"]
      }
    ],
    "validation_criteria": ["npm audit clean", "All tests pass"]
  }
}
```

## Chore Types

- `refactoring`: Code restructuring
- `dependency_update`: Package updates
- `cleanup`: Dead code removal
- `tech_debt`: Debt reduction

## Behavior

1. **Parse Input**: Read JSON specification
2. **Explore Codebase**: Understand scope and patterns
3. **Assess Risk**: Determine risk level
4. **Generate Tasks**: Create ordered task list
5. **Generate Plan**: Write markdown plan file to `/specs/chore-{slug}.md`
6. **Output JSON**: Return structured result

## Plan File Structure

```markdown
# Chore: [Title]

## Overview

**Type**: [Chore type]
**Rationale**: [Why needed]
**Scope**: [What's affected]

## Impact Assessment

**Breaking Changes**: [None / List]
**Risk Level**: [Low/Medium/High]

## Tasks

1. [Task 1]
2. [Task 2]

## Rollback Plan

[How to revert]

## Validation Criteria

- [Criterion 1]
```

## Usage

```bash
/agentic-sdlc:plan-chore --json-input /specs/input/deps-update.json
```

## Python Integration

```python
result = run_claude("/agentic-sdlc:plan-chore", json_input={
    "type": "chore",
    "title": "Update npm dependencies",
    "description": "Update all dependencies to latest versions"
})
```
