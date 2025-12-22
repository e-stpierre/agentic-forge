---
name: configure
description: Set up interactive-sdlc plugin configuration interactively
argument-hint: ""
---

# Configure

Set up interactive-sdlc plugin configuration interactively.

## Objective

Set up interactive-sdlc plugin configuration interactively by reading existing settings, validating them, and prompting for missing or invalid values.

## Core Principles

- Configuration is stored in project scope (.claude/settings.json)
- Personal overrides go in .claude/settings.local.json (gitignored)
- Settings hierarchy: local > project > defaults
- All paths are relative to project root
- Only update interactive-sdlc section - preserve other settings

## Instructions

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

## Configuration

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

## Output Guidance

Show current configuration status and changes made:

**If configuration is valid:**
```
✓ Configuration is valid

Current interactive-sdlc configuration:
  planDirectory: /specs
  analysisDirectory: /analysis
  defaultExploreAgents:
    chore: 2
    bug: 2
    feature: 3

To change settings, edit .claude/settings.json directly
or run /interactive-sdlc:configure again.
```

**If configuration needed updates:**
```
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

## Important Notes

- Only update the interactive-sdlc section in .claude/settings.json - preserve all other settings
- Validate all user input before accepting
- Preserve existing settings when adding new ones
- Ensure all settings are within valid ranges
- If `.claude/settings.json` doesn't exist, create the directory and file with the interactive-sdlc section
- If file exists but is invalid JSON, warn the user, offer to backup existing file, and create new valid configuration
- If file exists but missing `interactive-sdlc` section, add it while preserving all other existing settings
- If user provides invalid input, show error message explaining valid values and re-prompt with suggestions
- If file permission issues prevent automatic updates, provide manual configuration instructions

