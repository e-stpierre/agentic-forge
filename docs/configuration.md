# Configuration

Agentic Forge uses a 3-layer configuration system. Values merge in order: **built-in defaults -> global config -> local config**. Local values always win.

## Config Files

| Scope  | Location                                    |
| ------ | ------------------------------------------- |
| Global | `<global-dir>/config.json` (see `af paths`) |
| Local  | `<project>/agentic/config.json`             |

Use `af configure` to view the current merged configuration.

Set the `AGENTIC_FORGE_HOME` environment variable to use another directory as `<global-dir>` on every platform (for isolated setups and tests).

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

### runs

Where run directories are created. Every run, worktree or not, writes to `<runs.root>/YYYY-MM-DD-<slug>/` (see [harness-contract.md](harness-contract.md)).

| Key         | Type           | Default | Description                                                                            |
| ----------- | -------------- | ------- | -------------------------------------------------------------------------------------- |
| `runs.root` | string or null | `null`  | Runs root: absolute, or relative to the repository. `null` means `<global dir>/runs/`. |

### outputDirectory (deprecated)

Replaced by `runs.root`. `"global"` (the default) maps to `<global dir>/runs/`. `"local"` maps to `<project>/agentic/runs/` and prints a deprecation warning at dispatch. Runs created before the supervisor stay under `outputs/` and are listed read-only by `af status` and `af list`.

### supervisor

Settings of the supervisor (`af serve`) and its scheduler.

| Key                              | Type           | Default | Description                                                                                                                                                                                                            |
| -------------------------------- | -------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supervisor.max_parallel_runs`   | integer        | `4`     | Runs executing at once, all repositories together. Read from the global config only.                                                                                                                                   |
| `supervisor.max_parallel_tasks`  | integer        | `2`     | Runs executing at once in one repository. Read from the dispatching repository's config.                                                                                                                               |
| `supervisor.env_passthrough`     | string[]       | `[]`    | Extra environment variable names a client forwards to its runs, on top of the built-in allowlist.                                                                                                                      |
| `supervisor.needs_input_timeout` | number or null | `null`  | Minutes before a non-blocking `needs_input` request (`blocking: false` with a `recommended` option) is answered with its recommended option. `null` never auto-answers. Read from the dispatching repository's config. |

Whatever the limits, two runs never share one checkout: a run without its own worktree waits while another run without a worktree is running on the same repository.

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

Prefer the version-agnostic aliases (`haiku`, `sonnet`, `opus`, `fable`) so the value tracks the latest model in that family. Pinned IDs such as `claude-opus-5` also work but must be updated by hand.

### codex

Codex runtime configuration. Only applies when using the `codex` runtime.

| Key             | Type   | Default             | Description                                                              |
| --------------- | ------ | ------------------- | ------------------------------------------------------------------------ |
| `codex.model`   | string | _unset_             | Default Codex model. Unset means no `--model` flag is passed             |
| `codex.sandbox` | string | `"workspace-write"` | Sandbox mode: `"read-only"`, `"workspace-write"`, `"danger-full-access"` |

Codex CLI has no version-agnostic aliases, so Agentic Forge pins no default model. When `codex.model` is unset, the `--model` flag is omitted and Codex CLI uses its own configured default. Set it only when you need a specific model ID (for example `gpt-5.3-codex`); see [Coding Agents](coding-agents.md#codex).

On native Windows, Codex also applies its Windows OS sandbox. When `codex.sandbox` is `"workspace-write"`, Agentic Forge passes workflow output directories through both `--add-dir` and `sandbox_workspace_write.writable_roots` so Codex can write global outputs without leaving `workspace-write`. If your Windows sandbox still denies those writes, set `outputDirectory` to `"local"` to keep outputs inside the workspace, or explicitly set `bypass-permissions: true` only for workflows where you accept Codex's `danger-full-access` mode.

> **Backward compatibility:** `defaults.model` is still honored as a fallback for the `claude` runtime only, since it predates per-runtime keys and always held a Claude alias. Other runtimes ignore it and fall back to their own key (`codex.model`). Per-runtime keys always take priority.
>
> **Upgrading:** if an earlier release wrote `codex.model` into your `config.json`, that value still applies and overrides the new CLI-selected default. Delete the `codex.model` key from your global or local `config.json` to let Codex CLI choose its own model.

### runtimes

Per-runtime driver settings. See [Coding Agents](coding-agents.md#drivers).

| Key                       | Type     | Default     | Description                                                               |
| ------------------------- | -------- | ----------- | ------------------------------------------------------------------------- |
| `runtimes.claude.driver`  | string   | `"session"` | `"session"` (Claude Agent SDK session) or `"cli"` (one-shot `claude -p`)  |
| `runtimes.claude.plugins` | string[] | `[]`        | Local plugin directories the session driver loads (skills, agents, hooks) |
| `runtimes.codex.driver`   | string   | `"cli"`     | Only `"cli"` (`codex exec`) for now; `"session"` falls back to `"cli"`    |

Installed Claude plugins and skills load on both Claude drivers through your Claude settings, as with `claude -p`; `plugins` adds directories that are not installed.

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
