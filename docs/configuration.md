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

### git

Controls git behavior during workflow execution.

| Key              | Type    | Default  | Description                        |
| ---------------- | ------- | -------- | ---------------------------------- |
| `git.mainBranch` | string  | `"main"` | Primary branch name                |
| `git.autoCommit` | boolean | `true`   | Automatically commit changes       |
| `git.autoPr`     | boolean | `true`   | Automatically create pull requests |

### defaults

Default values for workflow execution.

| Key                       | Type    | Default    | Description                                     |
| ------------------------- | ------- | ---------- | ----------------------------------------------- |
| `defaults.model`          | string  | `"sonnet"` | Default Claude model: `haiku`, `sonnet`, `opus` |
| `defaults.maxRetry`       | number  | `3`        | Maximum retries for failed steps                |
| `defaults.timeoutMinutes` | number  | `60`       | Workflow timeout in minutes                     |
| `defaults.trackProgress`  | boolean | `true`     | Track workflow progress                         |
| `defaults.terminalOutput` | string  | `"base"`   | Terminal output granularity: `base` or `all`    |

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
  "defaults": {
    "model": "opus",
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
af config set defaults.model opus --local
af config set defaults.maxRetry 5 --local
af config set defaults.timeoutMinutes 120 --local
af config set defaults.terminalOutput all --local
af config set execution.maxWorkers 6 --local
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
