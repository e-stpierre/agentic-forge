---
name: plan-bug
description: Generate a bug fix plan (autonomous, JSON I/O)
argument-hint: --json-input <spec.json> | --json-stdin
---

# Plan Bug Command (Autonomous)

Diagnoses a bug and generates a fix plan. Operates autonomously without user interaction.

## Input Schema

```json
{
  "type": "bug",
  "title": "Bug title/summary",
  "description": "Observed behavior and impact",
  "expected_behavior": "What should happen",
  "reproduction_steps": ["Step 1", "Step 2"],
  "affected_files": ["src/auth.ts"],
  "explore_agents": 2
}
```

## Output Schema

```json
{
  "success": true,
  "plan_file": "/specs/bug-login-safari.md",
  "plan_data": {
    "type": "bug",
    "title": "Login fails on Safari",
    "root_cause": {
      "location": "src/auth/oauth-callback.ts:45",
      "explanation": "Safari ITP blocks window.opener.postMessage"
    },
    "fix_strategy": "Replace postMessage with cookie-based token transfer",
    "tasks": [
      {
        "id": "t1",
        "title": "Modify OAuth callback",
        "files": ["src/auth/oauth-callback.ts"]
      },
      {
        "id": "t2",
        "title": "Update dashboard auth",
        "files": ["src/pages/dashboard.ts"]
      }
    ],
    "test_cases": ["Safari OAuth flow", "Chrome OAuth flow"]
  }
}
```

## Behavior

1. **Parse Input**: Read JSON specification
2. **Explore Codebase**: Trace code paths, find symptoms
3. **Root Cause Analysis**: Identify why bug occurs
4. **Generate Fix Strategy**: Minimal fix with low regression risk
5. **Generate Plan**: Write markdown plan file to `/specs/bug-{slug}.md`
6. **Output JSON**: Return structured result

## Plan File Structure

```markdown
# Bug Fix: [Title]

## Bug Summary

**Symptom**: [What user experiences]
**Expected**: [Correct behavior]
**Actual**: [Current behavior]

## Root Cause Analysis

**Location**: `file:line`
**Cause**: [Technical explanation]

## Reproduction Steps

1. [Step 1]
2. [Step 2]

## Fix Plan

### Task 1: [Title]

**Files**: `path/to/file.ts`
**Changes**: [What to change]

## Testing

- [Test case 1]
- [Test case 2]

## Verification

- [How to verify fix works]
```

## Error Handling

```json
{
  "success": false,
  "error": "Could not identify root cause",
  "error_code": "ROOT_CAUSE_NOT_FOUND"
}
```

## Usage

```bash
/agentic-sdlc:plan-bug --json-input /specs/input/safari-bug.json
```

## Python Integration

```python
result = run_claude("/agentic-sdlc:plan-bug", json_input={
    "type": "bug",
    "title": "Login fails on Safari",
    "description": "Blank page after OAuth redirect"
})
```
