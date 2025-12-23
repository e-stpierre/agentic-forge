# Agentic SDLC JSON Schemas

This directory contains JSON schemas for agent-to-agent communication in the agentic-sdlc plugin.

## Schema Files

### Plan Input/Output

**Input**: `plan-input.schema.json`

```json
{
  "type": "feature|bug|chore",
  "title": "Task title",
  "description": "Detailed description",
  "requirements": ["Requirement 1", "Requirement 2"],
  "constraints": ["Constraint 1"],
  "explore_agents": 3
}
```

**Output**: `plan-output.schema.json`

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
        "tasks": [
          {"id": "t1.1", "description": "Add OAuth dependencies"},
          {"id": "t1.2", "description": "Create OAuth config"}
        ]
      }
    ]
  }
}
```

### Build Input/Output

**Input**: `build-input.schema.json`

```json
{
  "plan_file": "/specs/feature-auth.md",
  "plan_data": { ... },
  "checkpoint": "Milestone 2",
  "git_commit": true
}
```

**Output**: `build-output.schema.json`

```json
{
  "success": true,
  "completed_tasks": ["t1.1", "t1.2", "t2.1"],
  "changes": [
    {"file": "src/auth.ts", "action": "created"},
    {"file": "src/config.ts", "action": "modified"}
  ],
  "commits": ["abc123", "def456"],
  "ambiguities": []
}
```

### Review Input/Output

**Input**: `review-input.schema.json`

```json
{
  "files": ["src/auth.ts", "src/config.ts"],
  "commit_range": "abc123..def456",
  "plan_file": "/specs/feature-auth.md"
}
```

**Output**: `review-output.schema.json`

```json
{
  "success": true,
  "findings": [
    {
      "severity": "critical|major|medium|low",
      "file": "src/auth.ts",
      "line": 45,
      "message": "SQL injection vulnerability",
      "suggestion": "Use parameterized queries"
    }
  ],
  "summary": {
    "critical": 1,
    "major": 2,
    "medium": 3,
    "low": 5
  }
}
```

### Test Input/Output

**Input**: `test-input.schema.json`

```json
{
  "test_command": "npm test",
  "coverage": true,
  "files": ["src/auth.ts"]
}
```

**Output**: `test-output.schema.json`

```json
{
  "success": true,
  "passed": 42,
  "failed": 0,
  "skipped": 2,
  "coverage": {
    "lines": 85.5,
    "branches": 78.2,
    "functions": 90.1
  },
  "failures": []
}
```

## Usage

Commands accept JSON via `--json-input` flag or stdin:

```bash
# File input
/agentic-sdlc:plan-feature --json-input /path/to/spec.json

# Stdin input
echo '{"type":"feature",...}' | /agentic-sdlc:plan-feature --json-stdin

# Python orchestration
run_claude("/agentic-sdlc:plan-feature", json_input=spec_dict)
```

Commands output JSON to stdout when invoked with JSON input, enabling chaining:

```bash
# Chain commands
/agentic-sdlc:plan-feature --json-input spec.json | /agentic-sdlc:implement --json-stdin
```
