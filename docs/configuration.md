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

| Key                  | Type   | Default        | Description                                                                            |
| -------------------- | ------ | -------------- | -------------------------------------------------------------------------------------- |
| `worktree.location`  | string | `"sibling"`    | Where to create worktrees: `"sibling"`, `"nested"`, or `"absolute"`                    |
| `worktree.directory` | string | `null`         | Base directory for `"absolute"` location mode (required when location is absolute)     |
| `worktree.cleanup`   | string | `"on-success"` | When to remove worktrees: `"on-success"`, `"on-complete"`, `"on-merge"`, or `"manual"` |

**Location modes:**

| Value        | Worktree path                                 | Notes                      |
| ------------ | --------------------------------------------- | -------------------------- |
| `"sibling"`  | `../.worktrees/{repo}-{workflow}-{step}-{id}` | Default; avoids long paths |
| `"nested"`   | `.worktrees/agentic-{workflow}-{step}-{id}`   | Inside the repository      |
| `"absolute"` | `{directory}/{repo}-{workflow}-{step}-{id}`   | `directory` must be set    |

**Cleanup policies:**

| Value           | Behavior                                                                          |
| --------------- | --------------------------------------------------------------------------------- |
| `"on-success"`  | Remove worktree on success; preserve on failure                                   |
| `"on-complete"` | Always remove worktree after workflow finishes                                    |
| `"on-merge"`    | Once a `merge` step reported `merged`: remove the worktree, then its local branch |
| `"manual"`      | Never remove automatically; log path for inspection                               |

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

| Key                                | Type     | Default       | Description                                                                                                                |
| ---------------------------------- | -------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `runtimes.claude.driver`           | string   | `"session"`   | `"session"` (Claude Agent SDK session) or `"cli"` (one-shot `claude -p`)                                                   |
| `runtimes.claude.plugins`          | string[] | `[]`          | Local plugin directories the session driver loads (skills, agents, hooks)                                                  |
| `runtimes.claude.permissions`      | string   | `"allowlist"` | `"allowlist"`: tools on `allow` run without asking. `"bypass"`: skip every check                                           |
| `runtimes.claude.allow`            | string[] | see below     | Claude permission rules allowed on every step (`Read`, `Bash(git *)`, ...)                                                 |
| `runtimes.codex.driver`            | string   | `"cli"`       | Only `"cli"` (`codex exec`) for now; `"session"` falls back to `"cli"`                                                     |
| `runtimes.codex.permissions`       | string   | `"allowlist"` | `"allowlist"`: the `codex.sandbox` mode applies. `"bypass"`: no sandbox, no approvals                                      |
| `runtimes.codex.inline_references` | boolean  | `false`       | `skill` steps on Codex also append the files `SKILL.md` links to (see [Skills on Codex](coding-agents.md#skills-on-codex)) |

Installed Claude plugins and skills load on both Claude drivers through your Claude settings, as with `claude -p`; `plugins` adds directories that are not installed.

The default `runtimes.claude.allow` is `Read`, `Glob`, `Grep`, `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `TodoWrite`, `Skill` and `Task`: shell commands are not on it. A workflow's `required-tools` adds to the list for its steps (the bundled workflows add `Bash`). Setting `allow` replaces the default list. The same list drives both Claude drivers: the `cli` driver passes it as `--settings '{"permissions":{"allow":[...]}}'`, and the session driver auto-approves it. A call outside the list (and outside your own Claude settings) becomes a permission `needs_input` on the session driver, and is denied on the `cli` driver.

`"bypass"` passes `--dangerously-skip-permissions` (Claude) or `--dangerously-bypass-approvals-and-sandbox` (Codex), and every step that runs with it logs a warning. A workflow or step `bypass-permissions: true` does the same for that workflow or step.

```json
{
  "runtimes": {
    "claude": {
      "allow": [
        "Read",
        "Edit",
        "Write",
        "Glob",
        "Grep",
        "Bash(git *)",
        "Bash(pnpm *)"
      ]
    }
  }
}
```

### skill_config

Configuration snapshots for skill packs, keyed by pack (the plugin of `<plugin>:<skill>`, or the skill name). A `skill` step writes `skill_config.<pack>` to `<run dir>/skill-config/<pack>.json` and passes it as `--config-snapshot` (see [harness contract](harness-contract.md#invocation)). The format belongs to the skill pack; its values win over the pack's own config files. Unset packs get `{}`.

| Key                   | Type   | Default | Description                          |
| --------------------- | ------ | ------- | ------------------------------------ |
| `skill_config.<pack>` | object | unset   | Snapshot passed to the pack's skills |

```json
{ "skill_config": { "esp-skills": { "plan": { "depth": "deep" } } } }
```

### skill_packs

Where af finds skill packs: plugin directories that ship agentic-forge workflows in an `af-workflows/` directory. Their workflows come after the project and user-global workflows and before the bundled demos (see `af workflows`). A directory without `af-workflows/` is skipped.

| Key                       | Type     | Default | Description                                                                                     |
| ------------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------- |
| `skill_packs.paths`       | string[] | `[]`    | Plugin root directories (absolute, or relative to the repository), searched first               |
| `skill_packs.auto_detect` | boolean  | `true`  | Also use the Claude Code plugins listed in `<claude config dir>/plugins/installed_plugins.json` |

Auto-detection reads Claude Code's installed plugin list (`CLAUDE_CONFIG_DIR`, else `~/.claude`), not the plugin cache directory, so only the installed version of each plugin is used. It includes user-scope installs, and project or local installs whose project is the dispatching repository. A plugin disabled in Claude Code (`enabledPlugins` set to `false` in the user `settings.json`, or the repository's `.claude/settings.json` or `.claude/settings.local.json`, the later overriding the earlier) is skipped. When Claude Code moves that file, `af doctor` warns, and `skill_packs.paths` still works. A plain array (`"skill_packs": ["../my-pack"]`) is read as `paths` with auto-detection on.

```json
{ "skill_packs": { "paths": ["C:/src/my-pack"], "auto_detect": true } }
```

### github

Settings of the GitHub step types (`wait-for-review`, `wait-for-checks`, `merge`). The supervisor calls `gh` (it must be installed and logged in; `af doctor` checks it); no coding agent runs while these steps wait.

| Key                                 | Type     | Default                         | Description                                                                                            |
| ----------------------------------- | -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `github.reviewers`                  | object   | `claude`, `codex` (see below)   | Reviewer names usable in `reviewers:`, each `{ login, trigger }`; entries add to the defaults          |
| `github.auto_trigger`               | boolean  | `false`                         | Post the reviewers' trigger comments when a step does not set `trigger`                                |
| `github.trigger_after_seconds`      | number   | `120`                           | Time a reviewer gets on a new head before its trigger comment is posted                                |
| `github.poll_seconds`               | number   | `30`                            | First polling interval (a step's `poll-seconds` overrides it)                                          |
| `github.max_poll_seconds`           | number   | `300`                           | The interval doubles up to this value                                                                  |
| `github.review_timeout_minutes`     | number   | `30`                            | `wait-for-review` timeout, then `awaiting-human`                                                       |
| `github.checks_timeout_minutes`     | number   | `30`                            | `wait-for-checks` timeout, then `awaiting-human`                                                       |
| `github.merge.method`               | string   | `"repo"`                        | `repo` resolves the method from the repository settings and rulesets, else `squash`, `rebase`, `merge` |
| `github.merge.preference`           | string[] | `["squash", "rebase", "merge"]` | Order used when the repository allows several methods                                                  |
| `github.merge.delete_branch`        | boolean  | `true`                          | Delete the remote head branch after a native merge (never a fork branch)                               |
| `github.merge.lock_timeout_minutes` | number   | `30`                            | Wait for a busy merge lock, then `awaiting-human`                                                      |

Default reviewers, verified on real pull requests: `claude` is `claude[bot]` (the Claude Code GitHub Action, with no trigger: when it reviews depends on the repository's workflow, `pull_request` events or an `@claude` mention), and `codex` is `chatgpt-codex-connector[bot]` with the trigger `@codex review` (Codex reviews on its own when a pull request is opened or marked ready, and needs the trigger for a later head).

```json
{
  "github": {
    "reviewers": {
      "bot": { "login": "my-review-bot[bot]", "trigger": "/review" }
    },
    "auto_trigger": true,
    "merge": { "preference": ["rebase", "squash"] }
  }
}
```

The merge lock is `<global dir>/locks/merge-<hash>.lock`, keyed by the repository's git common dir, so the main checkout and all its worktrees share it.

### notifications

Notifications the supervisor sends when a run event matches a trigger, so a user who walked away learns that a run needs them. Every channel is off until enabled. Each run uses the `notifications` section of the config it was dispatched with (global, then project-local); `af notify` without a run uses the supervisor's global config.

| Key                                    | Type    | Default                                                                   | Description                                                                                    |
| -------------------------------------- | ------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `notifications.enabled`                | boolean | `true`                                                                    | Master switch                                                                                  |
| `notifications.triggers`               | array   | `needs_input`, `run.halted`, `run.failed`, `run.completed` of overseers   | Event types (`run.*` prefixes work), or `{ "event": ..., "run_type": "overseer" }` entries     |
| `notifications.templates.<event>`      | object  | `{}`                                                                      | `{ title, body }` with `{{placeholders}}` for one event type                                   |
| `notifications.channels.desktop`       | object  | `{ enabled: false }`                                                      | Desktop toast (Windows toast through PowerShell, `osascript` on macOS, `notify-send` on Linux) |
| `notifications.channels.ntfy`          | object  | `{ enabled: false, server: "https://ntfy.sh", topic: null, token: null }` | ntfy topic; `token` is sent as a bearer token                                                  |
| `notifications.channels.slack`         | object  | `{ enabled: false, webhook_url: null }`                                   | Slack incoming webhook                                                                         |
| `notifications.channels.discord`       | object  | `{ enabled: false, webhook_url: null }`                                   | Discord webhook                                                                                |
| `notifications.channels.github`        | object  | `{ enabled: false }`                                                      | Comment on the run's pull request (outward-facing: opt-in; skipped for a run without a PR)     |
| `notifications.channels.<id>.triggers` | array   | none                                                                      | Replaces `notifications.triggers` for one channel                                              |

A `needs_input` message names the run, its workflow, repository and step, the question and its options (the recommended one marked), and both ways to answer: `af answer <run> <request> <option>` and `af_answer(run, request_id, answer)`. A failed or halted run's message says how to inspect and resume it. Each delivery appends `notification.sent` to the run (`event_seq`, `trigger`, `channels`, and `errors` for the channels that failed); a channel that fails never stops the others.

Template placeholders: `run`, `workflow`, `repo`, `status`, `run_type`, `pr`, `event`, `step`, `reason` (error or reason of the event), `request_id`, `question`, `context`, `options`, `recommended`, `answer_cli`, `answer_mcp`. Empty lines are dropped and the body is cut at 1,800 characters.

```json
{
  "notifications": {
    "triggers": ["needs_input", "run.failed", "merge.completed"],
    "channels": {
      "desktop": { "enabled": true },
      "ntfy": { "enabled": true, "topic": "my-af-runs" },
      "slack": {
        "enabled": true,
        "webhook_url": "https://hooks.slack.com/services/...",
        "triggers": ["needs_input"]
      }
    },
    "templates": {
      "needs_input": {
        "title": "{{repo}} needs you",
        "body": "{{question}}\n{{answer_cli}}"
      }
    }
  }
}
```

Webhook URLs and tokens are secrets: keep them in the global config, and note that each run stores its config snapshot in its run directory (`dispatch.json`). The supervisor reads new events every 2 seconds and keeps its read positions in `<global dir>/notifications/positions.json`, so a restarted supervisor sends nothing twice.

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
