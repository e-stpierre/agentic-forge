---
name: plan-feature
description: Generate a feature implementation plan (autonomous, JSON I/O)
argument-hint: --json-input <spec.json> | --json-stdin
---

# Plan Feature Command (Autonomous)

Analyzes the codebase and generates a comprehensive implementation plan for a new feature. Operates autonomously without user interaction.

## Input Modes

- **`--json-input <path>`**: Read specification from JSON file
- **`--json-stdin`**: Read specification from stdin

## Input Schema

```json
{
  "type": "feature",
  "title": "Feature title",
  "description": "Detailed description of the feature",
  "requirements": ["Requirement 1", "Requirement 2"],
  "constraints": ["Technical constraint 1"],
  "explore_agents": 3
}
```

## Output Schema

```json
{
  "success": true,
  "plan_file": "/specs/feature-auth.md",
  "plan_data": {
    "type": "feature",
    "title": "User Authentication",
    "milestones": [
      {
        "id": "m1",
        "title": "Setup OAuth",
        "commit_message": "feat: add OAuth configuration",
        "tasks": [
          {"id": "t1.1", "title": "Add dependencies", "files": ["package.json"]},
          {"id": "t1.2", "title": "Create config", "files": ["src/config.ts"]}
        ]
      }
    ],
    "validation_criteria": ["All tests pass", "Feature works end-to-end"]
  },
  "summary": {
    "milestones": 4,
    "tasks": 12,
    "complexity": "medium"
  }
}
```

## Behavior

1. **Parse Input**
   - Read JSON specification from file or stdin
   - Validate required fields (type, title, description)
   - Apply defaults for optional fields

2. **Explore Codebase**
   - Use Task tool with `subagent_type=Explore`
   - Number of agents from input or default (3)
   - Find related code, patterns, conventions
   - Identify files to modify

3. **Design Implementation**
   - List all files to create or modify
   - Group changes into logical milestones
   - Order by dependencies
   - Identify risks and blockers

4. **Generate Plan**
   - Write markdown plan file to `/specs/feature-{slug}.md`
   - Structure with milestones and tasks
   - Include validation criteria

5. **Output JSON**
   - Return structured JSON with plan data
   - Include file path and summary
   - No user interaction

## Plan File Structure

```markdown
# Feature: [Title]

## Overview
[Description from input]

## Requirements
- [Requirement 1]
- [Requirement 2]

## Architecture
[High-level design decisions]

## Milestones

### Milestone 1: [Title]
**Commit**: `feat: [message]`

#### Task 1.1: [Title]
**Files**: `path/to/file.ts`
**Description**: [What to do]

### Milestone 2: [Title]
...

## Testing Strategy
[How to test]

## Validation Criteria
- [Criterion 1]
- [Criterion 2]
```

## Error Handling

On error, output:

```json
{
  "success": false,
  "error": "Error message",
  "error_code": "INVALID_INPUT|EXPLORATION_FAILED|WRITE_FAILED"
}
```

## Usage

```bash
# File input
/agentic-sdlc:plan-feature --json-input /specs/input/auth-spec.json

# Stdin (from Python orchestrator)
echo '{"type":"feature","title":"Auth",...}' | /agentic-sdlc:plan-feature --json-stdin
```

## Python Integration

```python
from claude_sdlc import run_claude

spec = {
    "type": "feature",
    "title": "User Authentication",
    "description": "Add OAuth support",
    "requirements": ["Google OAuth", "GitHub OAuth"],
    "explore_agents": 3
}

result = run_claude("/agentic-sdlc:plan-feature", json_input=spec)
print(f"Plan: {result['plan_file']}")
```
