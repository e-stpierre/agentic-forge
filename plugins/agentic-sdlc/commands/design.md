---
name: design
description: Design technical implementation (autonomous, JSON I/O)
argument-hint: --json-input <spec.json> | --json-stdin
---

# Design Command (Autonomous)

Transforms a product requirement into a technical design document. Operates autonomously without user interaction.

## Input Schema

```json
{
  "requirement": "Feature description",
  "goals": ["Goal 1", "Goal 2"],
  "non_goals": ["Out of scope item"],
  "constraints": ["Technical constraint"],
  "create_issues": true,
  "explore_agents": 3
}
```

## Output Schema

```json
{
  "success": true,
  "design_file": "/docs/designs/feature-auth-design.md",
  "design_data": {
    "requirement": "User authentication",
    "selected_approach": {
      "name": "OAuth with JWT",
      "rationale": "Industry standard, existing infrastructure support"
    },
    "tasks": [
      {
        "id": "t1",
        "title": "Add OAuth providers",
        "complexity": "M",
        "dependencies": []
      }
    ],
    "risks": [
      {
        "description": "Token security",
        "impact": "high",
        "mitigation": "Use secure storage"
      }
    ]
  },
  "issues": [
    {"number": 123, "title": "Epic: User Authentication", "type": "epic"},
    {"number": 124, "title": "Add OAuth providers", "type": "task"}
  ]
}
```

## Behavior

1. **Parse Input**: Read JSON specification
2. **Explore Codebase**: Research existing patterns and integration points
3. **Design Solution**:
   - Evaluate 2-3 technical approaches
   - Select best approach with rationale
   - Define data model, API, UI changes
4. **Break Down Tasks**: Create implementation tasks with acceptance criteria
5. **Generate Design Document**: Write to `/docs/designs/{slug}-design.md`
6. **Create Issues (if create_issues: true)**: Create GitHub issues
7. **Output JSON**: Return structured result

## Design Document Structure

```markdown
# Design: [Feature Name]

## Problem Statement
[What problem, for whom]

## Goals
- [Goal 1]

## Non-Goals
- [Out of scope]

## Technical Approach

### Option 1: [Name]
[Description, pros, cons]

### Selected Approach
[Decision and rationale]

## Detailed Design

### Data Model
[Schema changes]

### API Changes
[Endpoints]

### UI Changes
[Components]

## Implementation Tasks

### Task 1: [Title]
**Complexity**: S/M/L
**Acceptance Criteria**:
- [ ] [Criterion]

## Risks and Mitigations
| Risk | Impact | Mitigation |

## Testing Strategy
[Test plan]
```

## Usage

```bash
/agentic-sdlc:design --json-input /specs/input/auth-requirement.json
```

## Python Integration

```python
result = run_claude("/agentic-sdlc:design", json_input={
    "requirement": "User authentication with OAuth",
    "goals": ["Google OAuth", "GitHub OAuth"],
    "create_issues": True
})

print(f"Design: {result['design_file']}")
if result.get("issues"):
    print(f"Epic: #{result['issues'][0]['number']}")
```
