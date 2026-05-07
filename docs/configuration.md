# Configuration

Agentic Forge uses a 3-layer configuration system. Values merge in order: **built-in defaults -> global config -> local config**. Local values always win.

## Config Files

| Scope  | Location                                    |
| ------ | ------------------------------------------- |
| Global | `<global-dir>/config.json` (see `af paths`) |
| Local  | `<project>/agentic/config.json`             |

Use `af configure` to view the current merged configuration.

## Managing Configuration

```bash
# View the full merged config
af configure

# Get a specific value (dot notation)
af config get defaults.model

# Set a value globally
af config set defaults.model opus --global

# Set a value locally (project-specific)
af config set outputDirectory local --local
```

## All Configuration Options

### outputDirectory

Where workflow outputs are stored.

| Value      | Description                                           |
| ---------- | ----------------------------------------------------- |
| `"global"` | Store in global directory under a project-slug folder |
| `"local"`  | Store in `<project>/agentic/outputs/`                 |

**Default**: `"global"`

### logging

Controls workflow execution logging.

| Key               | Type    | Default   | Description                                 |
| ----------------- | ------- | --------- | ------------------------------------------- |
| `logging.enabled` | boolean | `true`    | Enable or disable logging                   |
| `logging.level`   | string  | `"Error"` | Verbosity: `Error`, `Warn`, `Info`, `Debug` |

### worktree

Default worktree settings applied when a workflow enables worktree isolation. Individual workflows can override these via `settings.worktree`.

| Key                  | Type   | Default        | Description                                                                        |
| -------------------- | ------ | -------------- | ---------------------------------------------------------------------------------- |
| `worktree.location`  | string | `"sibling"`    | Where to create worktrees: `"sibling"`, `"nested"`, or `"absolute"`                |
| `worktree.directory` | string | `null`         | Base directory for `"absolute"` location mode (required when location is absolute) |
| `worktree.cleanup`   | string | `"on-success"` | When to remove worktrees: `"on-success"`, `"on-complete"`, or `"manual"`           |

**Location modes:**

| Value        | Worktree path                                 | Notes                      |
| ------------ | --------------------------------------------- | -------------------------- |
| `"sibling"`  | `../.worktrees/{repo}-{workflow}-{step}-{id}` | Default; avoids long paths |
| `"nested"`   | `.worktrees/agentic-{workflow}-{step}-{id}`   | Inside the repository      |
| `"absolute"` | `{directory}/{repo}-{workflow}-{step}-{id}`   | `directory` must be set    |

**Cleanup policies:**

| Value           | Behavior                                            |
| --------------- | --------------------------------------------------- |
| `"on-success"`  | Remove worktree on success; preserve on failure     |
| `"on-complete"` | Always remove worktree after workflow finishes      |
| `"manual"`      | Never remove automatically; log path for inspection |

### defaults

Default values for workflow execution.

| Key                       | Type    | Default    | Description                                  |
| ------------------------- | ------- | ---------- | -------------------------------------------- |
| `defaults.runtime`        | string  | `"claude"` | Default runtime: `"claude"` or `"codex"`     |
| `defaults.maxRetry`       | number  | `3`        | Maximum retries for failed steps             |
| `defaults.timeoutMinutes` | number  | `60`       | Workflow timeout in minutes                  |
| `defaults.trackProgress`  | boolean | `true`     | Track workflow progress                      |
| `defaults.terminalOutput` | string  | `"base"`   | Terminal output granularity: `base` or `all` |

### claude

Claude runtime configuration.

| Key            | Type   | Default    | Description          |
| -------------- | ------ | ---------- | -------------------- |
| `claude.model` | string | `"sonnet"` | Default Claude model |

### codex

Codex runtime configuration. Only applies when using the `codex` runtime.

| Key             | Type   | Default             | Description                                                              |
| --------------- | ------ | ------------------- | ------------------------------------------------------------------------ |
| `codex.model`   | string | `"gpt-5.5"`         | Default Codex model                                                      |
| `codex.sandbox` | string | `"workspace-write"` | Sandbox mode: `"read-only"`, `"workspace-write"`, `"danger-full-access"` |

> **Backward compatibility:** `defaults.model` is still honored as a global fallback if set. Per-runtime keys (`claude.model`, `codex.model`) take priority.

### execution

Controls parallel execution behavior.

| Key                                | Type   | Default | Description                                  |
| ---------------------------------- | ------ | ------- | -------------------------------------------- |
| `execution.maxWorkers`             | number | `4`     | Maximum parallel workers                     |
| `execution.pollingIntervalSeconds` | number | `5`     | Polling interval for status checks (seconds) |

## Example: Local Opus Configuration

A project-local configuration that uses Opus as the default model, increases parallelism, stores outputs locally, enables verbose logging, and extends timeouts for complex workflows:

```json
{
  "outputDirectory": "local",
  "logging": {
    "enabled": true,
    "level": "Info"
  },
  "claude": {
    "model": "opus"
  },
  "defaults": {
    "maxRetry": 5,
    "timeoutMinutes": 120,
    "terminalOutput": "all"
  },
  "execution": {
    "maxWorkers": 6
  }
}
```

Apply these settings one at a time with the CLI:

```bash
af config set outputDirectory local --local
af config set logging.level Info --local
af config set claude.model opus --local
af config set defaults.maxRetry 5 --local
af config set defaults.timeoutMinutes 120 --local
af config set defaults.terminalOutput all --local
af config set execution.maxWorkers 6 --local
```

## Example: Codex as Default Runtime

Use Codex CLI as the default runtime for all workflows in a project:

```json
{
  "defaults": {
    "runtime": "codex"
  },
  "codex": {
    "model": "gpt-5.5",
    "sandbox": "workspace-write"
  }
}
```

```bash
af config set defaults.runtime codex --local
af config set codex.sandbox workspace-write --local
```

To override for a single run without changing config:

```bash
af run my-workflow --runtime codex
```

## Config Layering

Configuration merges recursively. You only need to specify the keys you want to override. For example, a local config with just:

```json
{
  "defaults": {
    "model": "opus"
  }
}
```

inherits all other values from the global config and built-in defaults. Only `defaults.model` is overridden.
