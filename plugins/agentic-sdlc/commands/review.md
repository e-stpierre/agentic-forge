---
name: review
description: Review code changes (autonomous, JSON I/O)
argument-hint: --json-input <review.json> | --json-stdin
---

# Review Command (Autonomous)

Reviews code changes for quality, security, and correctness. Operates autonomously without user interaction.

## Input Schema

```json
{
  "files": ["src/auth.ts", "src/config.ts"],
  "commit_range": "abc123..def456",
  "plan_file": "/specs/feature-auth.md",
  "focus_areas": ["security", "error_handling"]
}
```

## Output Schema

```json
{
  "success": true,
  "findings": [
    {
      "id": "R001",
      "severity": "critical",
      "category": "security",
      "file": "src/auth.ts",
      "line": 45,
      "message": "SQL injection vulnerability",
      "suggestion": "Use parameterized queries",
      "code_snippet": "const query = `SELECT * FROM users WHERE id = ${userId}`"
    }
  ],
  "summary": {
    "critical": 1,
    "major": 2,
    "medium": 5,
    "low": 3,
    "total": 11
  },
  "plan_compliance": {
    "compliant": true,
    "deviations": []
  },
  "verdict": "request_changes"
}
```

## Categories

- `security`: Vulnerabilities, unsafe patterns
- `bugs`: Logic errors, edge cases
- `error_handling`: Missing error handling
- `performance`: Inefficient code
- `maintainability`: Code quality
- `style`: Consistency issues

## Severity Levels

- `critical`: Must fix - security, data loss
- `major`: Should fix - bugs, significant issues
- `medium`: Consider fixing - quality concerns
- `low`: Minor improvements

## Verdicts

- `approve`: No blocking issues
- `request_changes`: Critical or major issues
- `needs_discussion`: Ambiguous or complex issues

## Behavior

1. **Parse Input**: Get files/commits to review
2. **Read Changes**: Load file contents or diff
3. **Analyze Code**: Check each category
4. **Check Plan Compliance**: Verify against plan if provided
5. **Output JSON**: Return structured findings

## Usage

```bash
/agentic-sdlc:review --json-input /specs/review-input.json
```

## Python Integration

```python
result = run_claude("/agentic-sdlc:review", json_input={
    "files": ["src/auth.ts"],
    "plan_file": "/specs/feature-auth.md"
})

if result["summary"]["critical"] > 0:
    print("Critical issues - blocking!")
```
