---
name: configure
description: Set up agentic-sdlc plugin configuration
argument-hint: [--json-output]
---

# Configure Command

Set up agentic-sdlc plugin configuration in `.claude/settings.json`.

## Instructions

1. **Check Existing Configuration**
   - Read `.claude/settings.json` if exists
   - Parse `agentic-sdlc` section

2. **Validate Configuration**
   Check against expected schema:

   | Setting         | Type   | Default    |
   | --------------- | ------ | ---------- |
   | `planDirectory` | string | `"/specs"` |

3. **If Valid and Complete**
   - Display success message
   - Show current configuration
   - Exit

4. **If Missing or Invalid**
   - Create `.claude/` directory if needed
   - Set default values
   - Write `.claude/settings.json`

## Configuration Schema

```json
{
  "agentic-sdlc": {
    "planDirectory": "/specs"
  }
}
```

## Output

### Standard Output

```
Checking agentic-sdlc configuration...

Configuration valid:
  planDirectory: /specs

Settings location: .claude/settings.json
```

### JSON Output (--json-output)

```json
{
  "success": true,
  "config": {
    "planDirectory": "/specs"
  },
  "settings_file": ".claude/settings.json"
}
```

## Usage

```bash
# Interactive check
/agentic-sdlc:configure

# JSON output for orchestration
/agentic-sdlc:configure --json-output
```

## Error Handling

If configuration cannot be written:

```json
{
  "success": false,
  "error": "Cannot write to .claude/settings.json",
  "error_code": "WRITE_FAILED"
}
```

## Python Integration

```python
result = run_claude("/agentic-sdlc:configure", args=["--json-output"])
print(f"Plan directory: {result['config']['planDirectory']}")
```

## Notes

- Agentic-SDLC has minimal configuration (just planDirectory)
- For interactive configuration with more options, use `interactive-sdlc` plugin
- Configuration is stored in project scope (`.claude/settings.json`)
