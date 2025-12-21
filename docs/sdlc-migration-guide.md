# SDLC Plugin Migration Guide

This guide helps you migrate from the old `sdlc` plugin to the new split plugins: `interactive-sdlc` and `agentic-sdlc`.

## Overview

The original `sdlc` plugin has been split into two specialized plugins:

| Old Plugin | New Plugins | Description |
|------------|-------------|-------------|
| `sdlc` | `interactive-sdlc` | Interactive development with user feedback |
| `sdlc` | `agentic-sdlc` | Fully autonomous workflows for CI/CD |

## Why the Split?

The original plugin tried to serve both interactive and autonomous use cases, leading to:

- Complex commands with too many flags
- Unclear when user interaction was expected
- Difficult CI/CD integration

The new plugins are purpose-built for their specific use cases.

## Command Mapping

### Interactive Commands

| Old Command | New Command | Notes |
|-------------|-------------|-------|
| `/sdlc:plan-feature` | `/interactive-sdlc:plan-feature` | Interactive planning |
| `/sdlc:plan-bug` | `/interactive-sdlc:plan-bug` | Interactive bug planning |
| `/sdlc:plan-chore` | `/interactive-sdlc:plan-chore` | Interactive chore planning |
| `/sdlc:implement` | `/interactive-sdlc:build` | Renamed to `build` |
| N/A | `/interactive-sdlc:validate` | New validation command |
| N/A | `/interactive-sdlc:one-shot` | New quick workflow |
| N/A | `/interactive-sdlc:plan-build-validate` | New full workflow |
| N/A | `/interactive-sdlc:document` | New documentation command |
| N/A | `/interactive-sdlc:analyse-*` | New analysis commands |

### Autonomous Commands

| Old Command | New Command | Notes |
|-------------|-------------|-------|
| `/sdlc:plan-feature` | `/agentic-sdlc:plan-feature` | JSON I/O, no user interaction |
| `/sdlc:plan-bug` | `/agentic-sdlc:plan-bug` | JSON I/O, no user interaction |
| `/sdlc:plan-chore` | `/agentic-sdlc:plan-chore` | JSON I/O, no user interaction |
| `/sdlc:implement` | `/agentic-sdlc:implement` | JSON I/O, autonomous |
| N/A | `/agentic-sdlc:review` | New review command |
| N/A | `/agentic-sdlc:test` | New test command |

## Configuration Changes

### Old Configuration

```json
{
  "enabledPlugins": {
    "sdlc@agentic-forge": true
  },
  "sdlc": {
    "planDirectory": "/specs"
  }
}
```

### New Configuration

```json
{
  "enabledPlugins": {
    "interactive-sdlc@agentic-forge": true,
    "agentic-sdlc@agentic-forge": true
  },
  "interactive-sdlc": {
    "planDirectory": "/specs",
    "analysisDirectory": "/analysis",
    "defaultExploreAgents": {
      "chore": 2,
      "bug": 2,
      "feature": 3
    }
  },
  "agentic-sdlc": {
    "planDirectory": "/specs"
  }
}
```

## Python CLI Changes

### Old CLI

```bash
# Old commands (still available for compatibility)
claude-sdlc feature "Add user authentication"
claude-sdlc bugfix "Fix login timeout"
claude-feature "Add user authentication"
claude-bugfix "Fix login timeout"
```

### New CLI

```bash
# Interactive workflows (legacy commands still work)
claude-sdlc feature "Add user authentication"
claude-feature "Add user authentication"

# Autonomous workflows (new)
agentic-sdlc workflow --type feature --spec spec.json
agentic-workflow --type feature --spec spec.json
agentic-plan --type feature --json-file spec.json
agentic-build --plan-file /specs/feature-auth.md
agentic-validate --plan-file /specs/feature-auth.md
```

## Breaking Changes

### 1. Namespace Change

All commands now use full namespace prefixes:

```bash
# Old (no longer works)
/plan-feature

# New (use full namespace)
/interactive-sdlc:plan-feature
/agentic-sdlc:plan-feature
```

### 2. Removed User Interaction from Agentic Commands

Agentic commands no longer prompt for user input. All input must be provided via JSON:

```bash
# This no longer works
/agentic-sdlc:plan-feature Add user authentication

# Use JSON input instead
/agentic-sdlc:plan-feature --json-stdin
{"title": "Add user authentication", "requirements": [...]}
```

### 3. New Required Configuration

The new plugins require configuration in `.claude/settings.json`. Run the configure command to set up:

```bash
/interactive-sdlc:configure
/agentic-sdlc:configure
```

## Migration Steps

1. **Update plugin installation**:
   ```bash
   # Remove old plugin
   /plugin uninstall sdlc

   # Install new plugins
   /plugin install interactive-sdlc
   /plugin install agentic-sdlc
   ```

2. **Update configuration**:
   ```bash
   # Run configure for each plugin
   /interactive-sdlc:configure
   /agentic-sdlc:configure
   ```

3. **Update scripts**:
   - Replace `/sdlc:*` commands with `/interactive-sdlc:*` or `/agentic-sdlc:*`
   - Update Python scripts to use new CLI commands

4. **Update CI/CD**:
   - Switch to `agentic-*` CLI commands for autonomous workflows
   - Use JSON I/O for all automation

## Getting Help

- Interactive plugin README: `plugins/interactive-sdlc/README.md`
- Agentic plugin README: `plugins/agentic-sdlc/README.md`
- Full plan specification: `plugins/sdlc-enhanced.md`
