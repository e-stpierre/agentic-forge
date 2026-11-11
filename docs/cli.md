# CLI Reference

Agentic Forge provides two CLI aliases: `agentic-forge` and `af`. All examples below use `af` for brevity.

## Commands

| Command         | Description                                          |
| --------------- | ---------------------------------------------------- |
| `run`           | Dispatch a workflow run to the supervisor            |
| `resume`        | Resume a paused, waiting, blocked or failed run      |
| `status`        | Show status of a run                                 |
| `cancel`        | Cancel a queued, running or paused run               |
| `send`          | Queue an operator message for a run                  |
| `pause`         | Pause a run at its next boundary, or now             |
| `answer`        | Answer a step's needs_input request and resume       |
| `amend`         | Record a requirement change for a run                |
| `retry-step`    | Rerun a step of a stopped run, with extra context    |
| `reprioritize`  | Change the queue priority of a run                   |
| `list`          | List runs                                            |
| `events`        | Print or follow run events                           |
| `artifacts`     | Show the plan, summary, decisions and review files   |
| `input`         | Provide input to a paused workflow                   |
| `init`          | Initialize directory structure                       |
| `config`        | Get or set configuration values                      |
| `configure`     | Display current configuration                        |
| `workflows`     | List available workflows with descriptions           |
| `paths`         | Show resolved directory and config paths             |
| `serve`         | Run, start, inspect or stop the supervisor           |
| `mcp`           | Run a stdio MCP server to dispatch and steer runs    |
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

| Option                     | Description                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--var <key=value>`        | Set workflow variable (repeatable)                                                                                                                                                                                     |
| `--slug <slug>`            | Slug of the run ID (`YYYY-MM-DD-<slug>`, default: the workflow name). Auto-increments on collision (`-2`, `-3`).                                                                                                       |
| `--foreground`             | Stream the run's events until it ends. Ctrl+C detaches and leaves the run going. Exit code follows the contract: `0` done or merged, `10` awaiting-human, `20` halted, `30` blocked (a step escalated), `1` otherwise. |
| `--from-step <step>`       | Resume from a specific step                                                                                                                                                                                            |
| `--runtime <runtime>`      | Runtime to use for this invocation (`claude`, `codex`). Overrides config default and workflow settings, but not per-step `runtime` values.                                                                             |
| `--no-interactive`         | Disable interactive prompts for missing variables                                                                                                                                                                      |
| `--terminal-output <mode>` | Terminal output granularity: `base` or `all`                                                                                                                                                                           |
| `--list`                   | List all available workflows                                                                                                                                                                                           |

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

Re-queue a `paused`, `awaiting-human`, `blocked` or `failed` run in the supervisor. It resumes from the last completed step with the inputs stored at dispatch, and reuses the worktree recorded in `run.json`. Runs interrupted by a supervisor crash are resumed automatically when the supervisor starts again (event `run.recovered`).

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

| Option            | Description                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `--step <name>`   | Deliver to this step only (default: the next step of the run)                                                |
| `--from <sender>` | Sender recorded in the message: `user` (default) or `overseer`                                               |
| `--mode <mode>`   | `next` (default): deliver at the next boundary. `now`: kill the current step and restart it with the message |

### Examples

```bash
# Add an instruction for the next step
af send 2026-11-10-dark-mode "Reuse the existing theme tokens instead of adding new ones."

# Target the review step
af send 2026-11-10-dark-mode "Check the contrast ratios too." --step review

# Correct the running step immediately
af send 2026-11-10-dark-mode "Stop: use pnpm, not npm." --mode now
```

With `--mode now`, a running step on the Claude session driver (the default, see [Coding Agents](coding-agents.md#drivers)) gets the message in its live session: it reaches the agent at its next tool call, with no restart, and the output says `delivered into the live session`. With `--mode next`, a live session step gets the message as its next turn when the current turn ends. On the `cli` driver, `--mode now` kills the running step's process tree (as `pause --now` does) and runs the step again from its start, with the message in its `## Operator Messages` section. The event log shows `step.retried` with `reason: message`, and no `run.paused`. A run that is not executing a step delivers the message at its next start, as with `next`.

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

## answer

Answer the pending `needs_input` request of an `awaiting-human` run. A step asks by ending with a result block whose `status` is `awaiting-human` and whose `needs_input` holds the question (see [harness contract](harness-contract.md#needs_input-protocol)). A step on the Claude session driver also asks while it runs: a tool call outside its allowlist (options `allow` and `deny`) or an `AskUserQuestion` question. The supervisor stores each pending request in the `run.json` list `x-af-needs-input` (keyed by request id, so parallel steps can each wait) and emits a `needs_input` event with the request in `data` (`live: true` and `tool` for a request of a live session).

`af answer` records an `input.answered` event and an `operator` decision. For a request of a live session, the answer goes straight to the waiting session and the run is `running` again once no request is left. Otherwise it queues the answer as an operator message for the asking step and resumes the run: the step runs again with `Answer to <id> ("<question>"): <answer>` in its `## Operator Messages` section, resuming its own session when it ran on the session driver. With several pending requests, `<request_id>` picks the one to answer.

```bash
af answer <run_id> <request_id> <answer> [--from user|overseer]
```

### Arguments

| Argument       | Required | Description                                       |
| -------------- | -------- | ------------------------------------------------- |
| `<run_id>`     | Yes      | Run ID                                            |
| `<request_id>` | Yes      | `needs_input` request ID (`data.id` of the event) |
| `<answer>`     | Yes      | Option ID, option label, or a free-form answer    |

A non-blocking request (`blocking: false`) with a `recommended` option is answered automatically with that option after `supervisor.needs_input_timeout` minutes, when the key is set (see [configuration](configuration.md)). The decision is logged with `source: policy`. Without the key, every request waits for an answer.

### Examples

```bash
af answer 2026-11-10-dark-mode q1 a
af answer 2026-11-10-dark-mode q2 "Keep both stores for one release."
```

## amend

Record a requirement change for a run that has not ended.

- When the workflow names an amend step in `settings.amend.step`, the amendment is queued for that step: at the next step boundary the supervisor runs the amend step (with `Amendment A001 (affects M2): <text>` in its `## Operator Messages` section), then continues with the next step. When the amend step completes, the amendment is appended to `amendments.jsonl` with the latest plan version (`plan.v<N>.md` in the run directory), and `amendment.applied` and an `operator` decision follow. Later steps read the new plan through `{{ plan_path }}`.
- Otherwise, the amendment is recorded at once with `plan_version: null`, logged as an `operator` decision, and delivered to the next step as an operator message prefixed `Amendment:`, with no pause.

```bash
af amend <run_id> <text> [--affects M2,M3] [--from user|overseer]
```

### Options

| Option            | Description                                         |
| ----------------- | --------------------------------------------------- |
| `--affects <ids>` | Comma-separated milestone IDs the amendment changes |
| `--from <sender>` | Sender: `user` (default) or `overseer`              |

### Examples

```bash
af amend 2026-11-10-oauth "Support GitHub Enterprise hosts too." --affects M2,M3
```

## retry-step

Rerun a top-level step of a `failed`, `paused`, `blocked` or `awaiting-human` run. The step and every step after it run again, even the ones that completed. `--context` is delivered to the step as an operator message. The supervisor emits `step.retried` with `reason: operator`.

```bash
af retry-step <run_id> <step> [--context <text>] [--from user|overseer]
```

### Examples

```bash
af retry-step 2026-11-10-dark-mode build --context "The flaky test is fixed on main; rebase first."
```

## reprioritize

Change the queue priority of a run that has not ended. The scheduler starts queued runs by priority (higher first), then by creation time. The default priority is `0`.

```bash
af reprioritize <run_id> <priority>
```

## list

List the runs in the run registry (newest first), then the legacy runs of the current directory (read-only, only when no filter other than a single `--status` is set). Shows ID, workflow, status, and start time.

```bash
af list [options]
```

### Options

| Option              | Description                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--status <status>` | Filter by run status, or a comma-separated list: `queued`, `running`, `paused`, `awaiting-human`, `blocked`, `halted`, `failed`, `canceled`, `done` |
| `--repo <path>`     | Only runs dispatched from this repository root                                                                                                      |
| `--since <when>`    | Only runs created since an ISO date or a duration (`30m`, `2h`, `7d`, `1w`)                                                                         |
| `--parent <run>`    | Only child runs of this parent run (`run.json` `parent`)                                                                                            |
| `--json`            | Print the registry entries as JSON (supervisor runs only)                                                                                           |

### Examples

```bash
# List all workflow runs
af list

# Runs that need attention
af list --status paused,awaiting-human,blocked

# Runs of this repository from the last day, as JSON
af list --repo . --since 1d --json
```

## events

Print the events of every run (or of one run) from the run's `events.jsonl`, oldest first, and optionally follow new ones. Each event is a contract envelope `{ seq, at, run, type, data }` (see [Harness contract](harness-contract.md)). Goes through the supervisor, which is started on demand.

```bash
af events [options]
```

A cursor records the last event seen in each run. When the command ends, it prints the cursor on stderr (`Cursor: c1....`); passing it back with `--cursor` continues exactly after it, without gaps or duplicates, even across runs that started in between. `--cursor-file` reads the cursor at start and rewrites it after every batch, which is the way to run a resumable background monitor. Type filters never hold the cursor back: a filtered-out event is skipped, not delivered later.

With `--follow`, the command long-polls the supervisor (`--wait` seconds per request) and prints events as they arrive until Ctrl+C.

### Options

| Option                 | Description                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `--run <run>`          | Only events of this run                                                                        |
| `--types <types>`      | Comma-separated event types. A trailing `*` matches a prefix: `run.*`, `step.*`, `iteration.*` |
| `--follow`             | Keep streaming new events until Ctrl+C                                                         |
| `--cursor <cursor>`    | Start after this cursor                                                                        |
| `--cursor-file <path>` | Read the start cursor from this file and keep it updated                                       |
| `--new`                | Skip the existing events and only print new ones (ignored with a cursor)                       |
| `--json`               | Print events as JSON lines instead of one readable line per event                              |
| `--wait <seconds>`     | Long-poll length per request with `--follow` (default 30, max 120)                             |

### Event types

| Group    | Types                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| Run      | `run.queued`, `run.started`, `run.paused`, `run.resumed`, `run.canceled`, `run.halted`, `run.failed`, `run.completed` |
| Step     | `step.started`, `step.completed`, `step.failed`, `step.retried`, `iteration.started`, `iteration.completed`           |
| Steering | `message.queued`, `message.delivered`, `amendment.applied`, `needs_input`, `input.answered`                           |
| Harness  | `supervisor.restarted`, `run.recovered`                                                                               |

`run.queued` is also emitted when a stopped run is queued again (`data.reason: resumed`, from `af resume`, `af answer` or `af retry-step`). `step.retried` carries `data.reason`: `retry` (automatic retry after a failed attempt), `operator` (`af retry-step`) or `message` (`af send --mode now`). `iteration.completed` carries `data.outcome`: `continue`, `complete`, `failed`, `error` or `max_iterations`. A supervisor that takes over runs left `running` or `queued` by a previous one emits `supervisor.restarted` once in each of them.

### Examples

```bash
# Everything so far, as JSON lines
af events --json

# Follow one run
af events --run 2026-11-10-dark-mode --follow

# Background monitor: wake on questions and run status changes, resumable
af events --follow --types needs_input,run.*,step.failed --cursor-file ~/.af-monitor-cursor
```

## artifacts

Show the contract artifacts of a run: plan versions (`plan.md`, `plan.v<N>.md`), `summary.md`, `decisions.jsonl` and review files (`review-<n>.md`). Reads the run registry directly.

```bash
af artifacts <run_id> [options]
```

### Options

| Option          | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| `--kind <kind>` | Only one kind: `plan`, `summary`, `decisions` or `review`          |
| `--content`     | Print the latest file of `--kind` (truncated at 20,000 characters) |
| `--json`        | Print the paths as JSON                                            |

### Examples

```bash
# All artifact paths of a run
af artifacts 2026-11-10-dark-mode

# The current plan
af artifacts 2026-11-10-dark-mode --kind plan --content
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

## mcp

Run a stdio MCP server that MCP clients (Claude Code, Claude Desktop, and other agents) use to dispatch, observe and steer runs. It is a thin client of the supervisor: each tool validates its input, then calls the same supervisor endpoint as the matching CLI command. The supervisor is started on demand at the first tool call, not when the server starts.

```bash
af mcp
```

The server speaks MCP over stdin and stdout and writes nothing else to stdout (warnings and logs go to stderr). It runs until the client closes the stream. Tool results are JSON text (`content: [{ type: "text", text: "<json>" }]`), so any client can read them.

### Tools

| Tool            | Inputs                                                                         | Supervisor endpoint                         | CLI equivalent  |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------- | --------------- |
| `af_dispatch`   | `workflow`, `repo?`, `vars?`, `runtime?`, `slug?`, `priority?`                 | `POST /v1/runs`                             | `af run`        |
| `af_status`     | `run?` (without it: the active runs)                                           | `GET /v1/runs/:id`, `GET /v1/runs`          | `af status`     |
| `af_list_runs`  | `status?` (one or a list), `repo?`, `since?`, `parent?`, `limit?`              | `GET /v1/runs`                              | `af list`       |
| `af_events`     | `cursor?`, `run?`, `types?`, `wait_seconds?` (0 to 120), `limit?`, `from_now?` | `GET /v1/events`                            | `af events`     |
| `af_send`       | `run`, `text`, `mode?` (`next` or `now`), `step?`, `from?`                     | `POST /v1/runs/:id/messages`                | `af send`       |
| `af_amend`      | `run`, `text`, `affects?`, `from?`                                             | `POST /v1/runs/:id/amend`                   | `af amend`      |
| `af_answer`     | `run`, `answer`, `request_id?`, `from?`                                        | `POST /v1/runs/:id/answer`                  | `af answer`     |
| `af_pause`      | `run`, `now?`                                                                  | `POST /v1/runs/:id/pause`                   | `af pause`      |
| `af_resume`     | `run`                                                                          | `POST /v1/runs/:id/resume`                  | `af resume`     |
| `af_cancel`     | `run`                                                                          | `POST /v1/runs/:id/cancel`                  | `af cancel`     |
| `af_retry_step` | `run`, `step`, `context?`, `from?`                                             | `POST /v1/runs/:id/retry`                   | `af retry-step` |
| `af_artifacts`  | `run`, `kind?` (`plan`, `summary`, `decisions`, `review`), `content?`          | none (reads the run registry and directory) | `af artifacts`  |

- `af_dispatch`: `workflow` is a name (looked up in `<repo>/agentic/workflows`, then the user-global and bundled workflows) or a path to a YAML file (absolute, or relative to `repo`). `repo` defaults to the server's working directory. `vars` values are strings; numbers and booleans are converted to strings. Returns `{ run_id, status, dir, workflow, warnings }`
- `af_list_runs`: newest first, cut to `limit` (default 50); returns `{ runs, total }`
- `af_events`: returns `{ events, cursor, more, status }`; pass `cursor` back to resume without duplicates. `wait_seconds` long-polls until a new event arrives or the wait ends. `types` takes exact types or prefixes such as `run.*`
- `af_artifacts`: `content: true` needs a `kind` and returns the latest file of that kind (cut at 20,000 characters)
- `from` (steering tools) is `user` or `overseer` (default `overseer`)

The MCP SDK client's default request timeout is 60 seconds, below the `wait_seconds` cap of 120. Use shorter waits (for example 30) unless your client sets a longer timeout.

### Errors

Invalid inputs and supervisor errors come back as tool results with `isError: true`. The text names the problem, the HTTP status when the supervisor returned one, and a next step:

```text
Run not found: 2026-11-10-dark-mode (HTTP 404). Use af_list_runs to find run ids.
Cannot resume run in 'running' status (HTTP 409). Call af_status to see the run's current status.
Missing required variable: task (HTTP 400). Pass it in vars (for example vars: { "task": "<value>" }) and call af_dispatch again.
The af supervisor is not reachable: <reason>. Start it with af serve --detach, then call af_list_runs again.
```

When the supervisor becomes unreachable (for example after a restart on a new port), the server finds or starts it again on the next call. The read tools (`af_status`, `af_list_runs`, `af_events`) retry the call once; the other tools return the error without resending, since the supervisor may already have handled the request (check with `af_status` or `af_list_runs` before calling them again).

### Setup

Claude Code:

```bash
claude mcp add agentic-forge -- af mcp
```

Project `.mcp.json` (Claude Code) or `claude_desktop_config.json` (Claude Desktop):

```json
{
  "mcpServers": {
    "agentic-forge": {
      "command": "af",
      "args": ["mcp"]
    }
  }
}
```

`af_dispatch` uses the server's working directory as the default `repo`. Claude Desktop starts servers outside any project, so pass `repo` explicitly there.

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
