---
name: create-log
description: Add a log entry to the workflow log
output: json
---

# Create Log

Add a structured log entry to the workflow's NDJSON log file.

## When to Use

Create logs for:

- Important progress milestones
- Errors or warnings encountered
- Decisions made during execution
- Context that should be recorded

## Parameters

- **level** (required): Critical | Error | Warning | Information
- **message** (required): Log message
- **context** (optional): Additional context as key-value pairs

## Log Levels

| Level       | When to Use                              |
| ----------- | ---------------------------------------- |
| Critical    | Fatal error causing workflow to stop     |
| Error       | Any error that occurred                  |
| Warning     | Unexpected issue that may need attention |
| Information | Regular progress logging                 |

## Output Format

```json
{
  "success": true,
  "entry": {
    "timestamp": "2024-01-15T10:30:00Z",
    "level": "Information",
    "step": "implement",
    "message": "Completed milestone 1"
  }
}
```

## Example

```
/create-log
Level: Information
Message: Successfully implemented authentication middleware
Context:
  files_changed: 3
  tests_added: 5
```

## Log File Format

Logs are stored in `agentic/workflows/{workflow-id}/logs.ndjson` as NDJSON (one JSON object per line):

```json
{"timestamp":"2024-01-15T10:30:00Z","level":"Information","step":"implement","message":"Started implementation","context":null}
{"timestamp":"2024-01-15T10:35:00Z","level":"Warning","step":"implement","message":"Rate limit approached","context":{"remaining":10}}
```
