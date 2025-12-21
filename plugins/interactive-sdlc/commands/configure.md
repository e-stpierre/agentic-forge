---
name: configure
description: Set up interactive-sdlc plugin configuration interactively
argument-hint: ""
---

# Configure

Set up interactive-sdlc plugin configuration interactively.

## Behavior

1. **Read Existing Configuration**
   - Check if `.claude/settings.json` exists
   - Parse current `interactive-sdlc` settings if present
   - Identify which settings are missing or invalid

2. **Validate Current Configuration**
   Check each setting against expected schema:

   | Setting | Type | Valid Range | Default |
   |---------|------|-------------|---------|
   | `planDirectory` | string | Valid path | `"/specs"` |
   | `analysisDirectory` | string | Valid path | `"/analysis"` |
   | `defaultExploreAgents.chore` | number | 0-5 | `2` |
   | `defaultExploreAgents.bug` | number | 0-5 | `2` |
   | `defaultExploreAgents.feature` | number | 0-10 | `3` |

3. **If Configuration is Valid and Complete**
   - Display success message
   - Show current configuration summary
   - Inform user they can edit `.claude/settings.json` directly for changes
   - Exit command

4. **If Configuration is Missing or Invalid**
   - Use AskUserQuestion to gather missing/invalid values
   - Show current values as defaults in questions
   - Validate user inputs before accepting

   **Questions to ask:**
   - Where should plan files be saved? (default: `/specs`)
   - Where should analysis reports be saved? (default: `/analysis`)
   - How many explore agents for chore planning? (0-5, default: 2)
   - How many explore agents for bug planning? (0-5, default: 2)
   - How many explore agents for feature planning? (0-10, default: 3)

5. **Update Configuration**
   - Create `.claude/` directory if it doesn't exist
   - Create or update `.claude/settings.json`
   - Preserve other settings in the file (only update `interactive-sdlc` section)
   - Confirm successful configuration with summary

## Configuration File Format

### Project Configuration (`.claude/settings.json`)

Committed to git, shared across team:

```json
{
  "interactive-sdlc": {
    "planDirectory": "/specs",
    "analysisDirectory": "/analysis",
    "defaultExploreAgents": {
      "chore": 2,
      "bug": 2,
      "feature": 3
    }
  }
}
```

### Personal Overrides (`.claude/settings.local.json`)

Gitignored, personal preferences:

```json
{
  "interactive-sdlc": {
    "planDirectory": "/my-specs",
    "defaultExploreAgents": {
      "feature": 5
    }
  }
}
```

## Example Usage

```bash
# Run interactive configuration
/interactive-sdlc:configure
```

## Example Session

```
$ /interactive-sdlc:configure

Checking configuration...

Current interactive-sdlc configuration:
  planDirectory: /specs
  analysisDirectory: (not set)
  defaultExploreAgents.chore: 2
  defaultExploreAgents.bug: (not set)
  defaultExploreAgents.feature: 3

Missing settings detected. Let me help you configure them.

? Where should analysis reports be saved?
  [/analysis] (default)

? How many explore agents for bug planning? (0-5)
  [2] (default)

Configuration updated successfully!

Current configuration:
  planDirectory: /specs
  analysisDirectory: /analysis
  defaultExploreAgents:
    chore: 2
    bug: 2
    feature: 3

Configuration saved to .claude/settings.json

To change settings later, edit .claude/settings.json directly
or run /interactive-sdlc:configure again.
```

## Error Handling

### `.claude/settings.json` doesn't exist

- Create `.claude/` directory
- Create new `settings.json` with interactive-sdlc section
- Populate with user-provided or default values

### File exists but is invalid JSON

- Warn user about invalid JSON
- Offer to backup existing file
- Create new valid configuration

### File exists but missing `interactive-sdlc` section

- Add `interactive-sdlc` section
- Preserve all other existing settings

### User provides invalid input

- Show error message explaining valid values
- Re-prompt with same question
- Suggest valid alternatives

### File permission issues

- Inform user of the issue
- Provide manual configuration instructions:
  ```
  Unable to write to .claude/settings.json
  Please manually create the file with:
  { "interactive-sdlc": { ... } }
  ```

## Important Notes

- Configuration is stored in project scope (`.claude/settings.json`)
- Personal overrides go in `.claude/settings.local.json` (gitignored)
- Settings hierarchy: local > project > defaults
- All paths are relative to project root
- Run `/interactive-sdlc:configure` after first installing the plugin
