# CLI Reference

Agentic Forge provides two CLI aliases: `agentic-forge` and `af`. All examples below use `af` for brevity.

## Commands

| Command         | Description                                          |
| --------------- | ---------------------------------------------------- |
| `run`           | Dispatch a workflow run to the supervisor            |
| `resume`        | Resume a paused, waiting or failed run               |
| `status`        | Show status of a run                                 |
| `cancel`        | Cancel a queued, running or paused run               |
| `send`          | Queue an operator message for a run                  |
| `pause`         | Pause a run at its next boundary, or now             |
| `list`          | List runs                                            |
| `input`         | Provide input to a paused workflow                   |
| `init`          | Initialize directory structure                       |
| `config`        | Get or set configuration values                      |
| `configure`     | Display current configuration                        |
| `workflows`     | List available workflows with descriptions           |
| `paths`         | Show resolved directory and config paths             |
| `serve`         | Run, start, inspect or stop the supervisor           |
| `skills-dir`    | Print path to bundled workflow skills directory      |
| `authoring-dir` | Print path to interactive authoring skills directory |
| `release-notes` | Show release notes and changelog                     |
| `version`       | Show current version                                 |

## run

Dispatch a workflow to the supervisor with optional key=value variables, and print the run ID. Prompts interactively for missing required variables.

The client resolves everything the run needs: the workflow file (path and contents), the config of the current directory (defaults, global, local), and an allowlisted set of environment variables (`PATH`, system variables, `CLAUDE_*`, `CODEX_*`, `GH_*`, `ANTHROPIC_*`, `OPENAI_*`, plus `supervisor.env_passthrough`). The supervisor stores them in the run directory and never uses its own working directory, so a run dispatched from one repository uses that repository's config even when the supervisor was started elsewhere. The supervisor is started on demand when none is running.

The run goes through the supervisor's queue (see `supervisor.max_parallel_runs` and `supervisor.max_parallel_tasks` in [configuration](configuration.md)). Two runs never share one checkout: a run on a repository that is not using its own worktree waits until the other non-worktree run on that repository ends.

Each run writes a contract run directory, `<runs.root>/YYYY-MM-DD-<slug>/` (default `<global dir>/runs/`), with `run.json`, `events.jsonl`, `dispatch.json` and the engine state `progress.json`. See [harness-contract.md](harness-contract.md).

```bash
af run <workflow> [vars...] [options]
```

### Arguments

| Argument     | Required | Description                               |
| ------------ | -------- | ----------------------------------------- |
| `<workflow>` | No       | Workflow name or path to YAML file        |
| `[vars...]`  | No       | Variables as positional `key=value` pairs |

### Options

| Option                     | Description                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `--var <key=value>`        | Set workflow variable (repeatable)                                                                                                         |
| `--slug <slug>`            | Slug of the run ID (`YYYY-MM-DD-<slug>`, default: the workflow name). Auto-increments on collision (`-2`, `-3`).                           |
| `--foreground`             | Stream the run's events until it ends. Ctrl+C detaches and leaves the run going. Exit code follows the contract (`0` done, `10` waiting).  |
| `--from-step <step>`       | Resume from a specific step                                                                                                                |
| `--runtime <runtime>`      | Runtime to use for this invocation (`claude`, `codex`). Overrides config default and workflow settings, but not per-step `runtime` values. |
| `--no-interactive`         | Disable interactive prompts for missing variables                                                                                          |
| `--terminal-output <mode>` | Terminal output granularity: `base` or `all`                                                                                               |
| `--list`                   | List all available workflows                                                                                                               |

### Examples

```bash
# Run with a variable
af run one-shot --var "task=Add dark mode support"

# Run with multiple variables
af run plan-build-review --var "task=Add auth" --var "create_pr=true"

# Run with positional variables
af run one-shot task="Add dark mode support"

# Run with a custom slug (run ID 2026-11-10-dark-mode)
af run plan-build-review --slug "dark-mode" --var "task=Add dark mode"

# Dispatch and follow the run until it ends
af run one-shot --foreground --var "task=Add dark mode"

# Resume from a specific step
af run one-shot --from-step review --var "task=Add dark mode"

# Non-interactive mode (fails if required variables are missing)
af run one-shot --no-interactive --var "task=Add dark mode"

# Run a workflow from a YAML file path
af run ./agentic/workflows/my-workflow.yaml --var "key=value"
```

## resume

Re-queue a `paused`, `awaiting-human` or `failed` run in the supervisor. It resumes from the last completed step with the inputs stored at dispatch, and reuses the worktree recorded in `run.json`. Runs interrupted by a supervisor crash are resumed automatically when the supervisor starts again (event `run.recovered`).

Legacy runs (under `outputs/`, from versions before the supervisor) cannot be resumed: finish them with the version that started them, or discard them.

```bash
af resume <run_id> [options]
```

### Arguments

| Argument   | Required | Description      |
| ---------- | -------- | ---------------- |
| `<run_id>` | Yes      | Run ID to resume |

### Options

| Option         | Description                                                  |
| -------------- | ------------------------------------------------------------ |
| `--foreground` | Stream the run's events until it ends (Ctrl+C detaches only) |

### Examples

```bash
# Resume a failed run
af resume 2026-11-10-dark-mode

# Resume and follow it
af resume 2026-11-10-dark-mode --foreground
```

## status

Show the status of a run from the run registry: status, repository, run directory, worktree, current step, completed steps (interrupted steps are marked `!`), pending steps, and errors. Legacy runs under `outputs/` are shown read-only, marked as legacy. Does not need a running supervisor.

```bash
af status <run_id>
```

### Arguments

| Argument   | Required | Description |
| ---------- | -------- | ----------- |
| `<run_id>` | Yes      | Run ID      |

### Examples

```bash
af status 2026-11-10-dark-mode
```

## cancel

Cancel a run. A running run stops now: the supervisor kills the current step's whole process tree (`taskkill /T /F` on Windows, the process group on POSIX), then commits pending work in the run's worktree (`safetyCommit`) and applies the worktree cleanup policy (`on-complete` removes it, `on-success` and `manual` keep it). A queued, paused or waiting run is canceled at once, with the same safety commit and policy applied to its recorded worktree. Runs that already ended, and legacy runs, cannot be canceled.

```bash
af cancel <run_id>
```

### Arguments

| Argument   | Required | Description      |
| ---------- | -------- | ---------------- |
| `<run_id>` | Yes      | Run ID to cancel |

### Examples

```bash
af cancel 2026-11-10-dark-mode
```

## send

Queue an operator message for a run. The supervisor writes it to the run's `inbox/` and prepends it, as an `## Operator Messages` section, to the next step prompt or ralph-loop iteration prompt of the run (or of the step named with `--step`). Each message is delivered once, then marked delivered (`delivered_at`), with the events `message.queued` and `message.delivered` and an `operator` entry in `decisions.jsonl`. A message sent to a paused run is delivered when it resumes.

```bash
af send <run_id> <text> [options]
```

### Arguments

| Argument   | Required | Description  |
| ---------- | -------- | ------------ |
| `<run_id>` | Yes      | Run ID       |
| `<text>`   | Yes      | Message text |

### Options

| Option            | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `--step <name>`   | Deliver to this step only (default: the next step of the run)         |
| `--from <sender>` | Sender recorded in the message: `user` (default) or `overseer`        |
| `--mode <mode>`   | Delivery mode; only `next` (the default) is supported in this version |

### Examples

```bash
# Add an instruction for the next step
af send 2026-11-10-dark-mode "Reuse the existing theme tokens instead of adding new ones."

# Target the review step
af send 2026-11-10-dark-mode "Check the contrast ratios too." --step review
```

## pause

Pause a running or queued run. By default a running run stops at its next boundary: before its next step, or between two ralph-loop iterations. With `--now`, the supervisor kills the current step's process tree; the step is recorded as `interrupted` and reruns from its start on `af resume`. A paused run keeps its worktree whatever the cleanup policy. Resume it with `af resume`.

```bash
af pause <run_id> [--now]
```

### Arguments

| Argument   | Required | Description     |
| ---------- | -------- | --------------- |
| `<run_id>` | Yes      | Run ID to pause |

### Options

| Option  | Description                                               |
| ------- | --------------------------------------------------------- |
| `--now` | Stop the current step now instead of at the next boundary |

### Examples

```bash
af pause 2026-11-10-dark-mode
af pause 2026-11-10-dark-mode --now
af resume 2026-11-10-dark-mode
```

## list

List the runs in the run registry (newest first), then the legacy runs of the current directory (read-only). Shows ID, workflow, status, and start time.

```bash
af list [options]
```

### Options

| Option              | Description                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `--status <status>` | Filter by run status: `queued`, `running`, `paused`, `awaiting-human`, `failed`, `canceled`, `done` |

### Examples

```bash
# List all workflow runs
af list

# List only running runs
af list --status running

# List failed runs
af list --status failed
```

## input

Provide a text response to a paused workflow that is waiting for human input.

```bash
af input <workflow_id> <response>
```

### Arguments

| Argument        | Required | Description              |
| --------------- | -------- | ------------------------ |
| `<workflow_id>` | Yes      | Workflow run ID          |
| `<response>`    | Yes      | Response text to provide |

### Examples

```bash
af input abc123 "yes, proceed with the refactor"
```

## init

Initialize the agentic-forge directory structure with bundled workflows and config. Defaults to global initialization.

```bash
af init [options]
```

### Options

| Option              | Description                                      |
| ------------------- | ------------------------------------------------ |
| `--local`           | Initialize project-local `agentic/` directory    |
| `--global`          | Initialize global user directory (default)       |
| `--force`           | Overwrite existing workflow files and config     |
| `--list`            | List available bundled workflows without copying |
| `--config-only`     | Only create config, skip workflow copy           |
| `--workflows-only`  | Only copy workflows, skip config creation        |
| `--workflow <name>` | Copy only the named bundled workflow             |

### Examples

```bash
# Initialize global directory (default)
af init

# Initialize project-local directory
af init --local

# Copy only one specific workflow locally
af init --local --workflow plan-build-review

# List available bundled workflows
af init --list

# Force overwrite existing files
af init --local --force

# Only create config, no workflows
af init --local --config-only
```

## config

Get or set configuration values. Supports dot notation for nested keys.

### config get

```bash
af config get <key>
```

| Argument | Required | Description                                              |
| -------- | -------- | -------------------------------------------------------- |
| `<key>`  | Yes      | Configuration key (dot notation, e.g., `defaults.model`) |

### config set

```bash
af config set <key> <value> [options]
```

| Argument  | Required | Description       |
| --------- | -------- | ----------------- |
| `<key>`   | Yes      | Configuration key |
| `<value>` | Yes      | Value to set      |

| Option     | Description                   |
| ---------- | ----------------------------- |
| `--global` | Write to global config        |
| `--local`  | Write to local project config |

Values are auto-parsed: `true`/`false` become booleans, numeric strings become numbers.

### Examples

```bash
# Get a config value
af config get defaults.model

# Set model globally
af config set defaults.model opus --global

# Set output directory locally
af config set outputDirectory local --local

# Set max workers
af config set execution.maxWorkers 8 --local
```

## configure

Display the current merged configuration (defaults + global + local).

```bash
af configure
```

## workflows

List available workflows with descriptions, grouped by location (project, user, bundled).

```bash
af workflows [options]
```

### Options

| Option          | Description                                   |
| --------------- | --------------------------------------------- |
| `-v, --verbose` | Show workflow variables and full descriptions |

### Examples

```bash
# List all workflows
af workflows

# List with variable details
af workflows --verbose
```

## paths

Show all resolved directory and config paths with existence status.

```bash
af paths
```

Displays: global config, global workflows, global outputs, local config, local workflows, local outputs, bundled workflows, and the resolved output directory.

## serve

Run the af supervisor: one long-lived background process per user that owns all workflow runs (registry, queue, execution and crash recovery). Clients (`af run`, `af mcp`, `af overseer`) start it on demand, so running `af serve` yourself is optional.

```bash
af serve [options]
```

### Options

| Option          | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `--foreground`  | Run in this process until stopped (the default)                            |
| `--detach`      | Start a detached background supervisor if none is running                  |
| `--status`      | Show whether a supervisor is running, its pid, version and active runs     |
| `--stop`        | Stop the running supervisor (refused while runs are active, see `--force`) |
| `--restart`     | Stop the running supervisor and start a detached one                       |
| `--force`       | With `--stop` or `--restart`, stop even when runs are active               |
| `--port <port>` | Listen on a fixed port instead of a random one (debugging only)            |

Only one supervisor runs per user. Starting a second one prints the running instance and exits. The supervisor listens on `127.0.0.1` with a random port and accepts only requests that carry the per-user token from `supervisor.json` in the global directory (readable by the user only). A detached supervisor writes its output to `supervisor.log` in the same directory.

On start, the supervisor recovers the runs a previous supervisor left `running`: it marks the interrupted step `interrupted`, re-queues the run so it resumes from that step (reusing its recorded worktree), and emits `run.recovered`. The run registry is `runs/index.json` in the global directory.

When a client's version differs from the running supervisor's (for example after `npm i -g agentic-forge`), the client restarts the supervisor if no run is active, and otherwise warns and keeps it.

### Examples

```bash
# Start a background supervisor
af serve --detach

# Check it
af serve --status

# Stop it
af serve --stop
```

## skills-dir

Print the absolute path to the bundled workflow skills directory. Used internally by the workflow engine.

```bash
af skills-dir
```

## authoring-dir

Print the absolute path to the interactive authoring skills directory. Use this to add authoring skills to your Claude Code session:

```bash
claude --add-dir $(af authoring-dir)
```

## release-notes

Show release notes from the changelog.

```bash
af release-notes [version] [options]
```

### Arguments

| Argument    | Required | Description                       |
| ----------- | -------- | --------------------------------- |
| `[version]` | No       | Show notes for a specific version |

### Options

| Option     | Description                       |
| ---------- | --------------------------------- |
| `--latest` | Show only the most recent version |

### Examples

```bash
# Show all release notes
af release-notes

# Show latest version only
af release-notes --latest

# Show specific version
af release-notes 0.7.0
```

## version

Show the current agentic-forge version.

```bash
af version
```
