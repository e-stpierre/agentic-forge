# Coding Agents

Agentic Forge is a workflow engine for coding agents. Workflows can target Claude Code, Codex CLI, or future agents at the step level.

## Supported Runtimes

| Runtime     | ID       | CLI Tool | Streaming Format                | Status       |
| ----------- | -------- | -------- | ------------------------------- | ------------ |
| Claude Code | `claude` | `claude` | `stream-json`                   | Recommended  |
| Codex CLI   | `codex`  | `codex`  | `app-server` JSON-RPC, or JSONL | Experimental |

Each runtime must be installed and authenticated independently before use. Agentic Forge does not install or configure the underlying CLI tools.

## Drivers

A runtime runs a step through a driver, set per runtime with `runtimes.<id>.driver` (see [Configuration](configuration.md#runtimes)):

| Driver    | Claude                                                     | Codex                                           |
| --------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `session` | Default. A live Claude Agent SDK session (streaming input) | Default. A `codex app-server` thread (JSON-RPC) |
| `cli`     | One-shot `claude -p --output-format stream-json`           | One-shot `codex exec --json`                    |

A step on the `session` driver stays alive while it works and while it waits:

- **Permissions**: tool calls allowed by the step's allowlist (`runtimes.claude.allow` plus the workflow's `required-tools`, see [Permissions](#permissions)) or by your Claude settings run without asking. Any other call becomes a `needs_input` request (`Allow <tool>? <command or path>`, options `allow` and `deny`). The run is `awaiting-human` while the session waits, and `af answer <run> <request> allow` (or `deny`) lets the same session continue. A denied call is reported to the agent, which carries on.
- **Questions**: when Claude uses `AskUserQuestion`, each question becomes a `needs_input` request with its options (`a`, `b`, ...). The answer (an option id, a label or free text) is returned to Claude as the tool result.
- **Messages**: `af send` (`--mode next`) reaches the session as its next turn when the current turn ends; `--mode now` is delivered into the running turn, at the next tool call, with no step restart.
- **Result**: the final message of the last turn holds the result block, read the same way as on the `cli` driver.
- **Resume**: when a session step ends with an `awaiting-human` result block, `af answer` resumes the same session by its id with the answer, instead of running the step again from its start.

- **Supervisor restart**: the session id is stored in `steps/<NN-step>/session.json`. When the supervisor stops while a prompt or skill step runs (or waits for an answer), the next supervisor resumes that session with a prompt saying the harness restarted, instead of running the step from its start. The choice is in `run.recovered` and `decisions.jsonl` (see [`af serve`](cli.md#serve)).

Parallel steps each run their own session and can each wait on a request; answer them by request id.

### Codex sessions

On the `session` driver, a Codex step starts one `codex app-server` process and one thread (the thread id is the session id, also used by `codex exec resume`). It has the same controls as a Claude session:

- **Turns**: the step prompt starts the first turn; `af send --mode next` starts the next turn when one ends; `--mode now` is added to the running turn with `turn/steer` (a message that misses the turn starts the next one). The agentic system prompt goes in the thread's developer instructions instead of being prepended to the prompt.
- **Approvals**: the thread runs in the `codex.sandbox` mode with the approval policy `on-request`, and the run directory and working directory as write roots. When Codex asks to run a command or change files outside the sandbox, the request is approved without asking when the step allowlist covers it (`runtimes.codex.allow` plus the workflow's `required-tools`: `Bash`, `Bash(<prefix> *)` or `Bash(<command>)` for commands, `Edit` or `Write` for file changes). Any other request becomes a `needs_input` (`Allow shell? <command>`, `Allow apply_patch? ...`, `Allow request_permissions? ...`), and `af answer` accepts or declines it while the session waits. MCP elicitations are declined.
- **Questions**: `request_user_input` questions become `needs_input` requests with their options, one at a time; the answer goes back to Codex.
- **Bypass**: `permissions: bypass` runs the thread with `danger-full-access` and the approval policy `never`.
- **Resume**: `af answer` on an `awaiting-human` block, `send --mode now` fallbacks and crash recovery resume the thread with `thread/resume`; when that fails, the step restarts from its start like on the `cli` driver.
- **af MCP server**: the thread config adds the af MCP server (`mcp_servers.agentic-forge`: this af CLI with `mcp`, the step's `AF_RUN_ID` and `AF_STEP` and what it needs to find the supervisor, a 900 second tool timeout, tools approved without asking). The agent can dispatch child runs on any runtime with `af_dispatch`, wait for them with `af_wait`, and ask with `af_ask` (see [Run trees](cli.md#run-trees)). The `cli` driver does not add it.

The driver uses the bindings generated by `codex app-server generate-ts --experimental` from Codex `0.128.0` (`scripts/codex-bindings.js`). It needs the `experimentalApi` capability for `turn/steer`, `skills/list`, `skill` inputs, the thread `config` overrides and `item/permissions/requestApproval`. Set `runtimes.codex.driver: cli` to go back to `codex exec`.

### Interrupt and resume on the `cli` driver

A `cli` step is a one-shot process, so `af send --mode now` kills its process tree. The supervisor then runs `safetyCommit` in the run's worktree (never in your own checkout) and starts the step again by resuming the session it recorded in `steps/<NN-step>/session.json`, with the message:

- Claude: `claude -p --resume <session id>`, so the agent keeps its context
- Codex: `codex exec resume <thread id> <message>`

`af answer` on a `cli` step that ended `awaiting-human` resumes its session the same way, and so does crash recovery after a supervisor restart. When the resume fails (for example the session no longer exists), the step restarts from its start with its original prompt and the message, without using one of its retries. The step log says which one happened, and a failed resume emits `step.retried` with `reason: resume-failed` and its `session_id`.

### Permissions

Steps never bypass permission checks by default. Each runtime has a permission mode, `runtimes.<id>.permissions` (see [Configuration](configuration.md#runtimes)):

- **`allowlist`** (default): Claude steps may use the tools on `runtimes.claude.allow` and the workflow's `required-tools` without asking, on both drivers (`--settings` on the `cli` driver, auto-approved on the session driver). Anything else asks (session driver) or is denied (`cli` driver). Codex steps run in the `codex.sandbox` mode (`workspace-write` by default) with the run directory as an extra write root.
- **`bypass`**: `--dangerously-skip-permissions` (Claude) or `--dangerously-bypass-approvals-and-sandbox` (Codex). Every step that runs this way logs a warning. `bypass-permissions: true` on a workflow or step has the same effect for that workflow or step.

### Transcripts

Both drivers write a live transcript per step, `steps/<NN-step>/transcript.jsonl`, in one normalized format: messages, tool calls and results, file diffs, permission requests and answers, and notices (such as the native or inlined skill choice). The session driver maps the Agent SDK messages and the `codex app-server` items (commands, MCP and dynamic tool calls, web searches, file changes with their diff); the `cli` driver maps the `claude -p` stream-json lines and the `codex exec --json` lines (Codex commands, MCP tool calls and file changes). Edits by Claude's `Edit`, `MultiEdit`, `Write` and `NotebookEdit` tools get a `diff` entry with a line patch; Codex file changes get one with the path and change kind. Read it with [`af logs`](cli.md#logs) or the `af_logs` MCP tool.

### Authentication and billing

The Agent SDK (`@anthropic-ai/claude-agent-sdk`, pinned to `0.3.322`) runs the unmodified Claude Code binary with its own login, so a Claude plan sign-in draws from the plan limits exactly like `claude -p`. Agentic Forge never reads, stores or passes Claude credentials, and never sets `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL`. The step environment is the one the dispatching client forwarded: an `ANTHROPIC_API_KEY` set in your shell bills the API key instead of your plan. Anthropic changed the Agent SDK and `-p` billing rules in 2026; check the help article "Use the Claude Agent SDK with your Claude plan" if in doubt, and set `runtimes.claude.driver: cli` to go back to `claude -p`.

### Claude Code (recommended)

Claude Code is the primary and recommended coding agent for Agentic Forge. It has the deepest integration and supports all features including `skill` steps (your own skills, see [Bring your own skills](workflows.md#bring-your-own-skills)), agent sub-configurations, system prompt injection, and worktree isolation. All bundled demo workflows are designed and tested with Claude Code as the default runtime.

Install and authenticate the Claude Code CLI via Anthropic's official documentation. Verify with:

```bash
claude --version
```

### Codex CLI (experimental)

Codex CLI is supported as an experimental runtime. Its integration is more limited compared to Claude Code:

- Runs `skill` steps with Codex's own skill when it has it, else by inlining the skill's `SKILL.md` (see [Skills on Codex](#skills-on-codex))
- Does not support agent sub-configurations
- May have permission and file access issues, particularly on Windows
- OS-level sandboxing is not enforced on Windows

Codex works best as a secondary runtime for independent tasks like code review in mixed-runtime workflows (e.g., `multi-demo`), where Claude handles planning and implementation while Codex provides an independent review perspective.

Install and authenticate the Codex CLI (OpenAI). Verify with:

```bash
codex --version
```

## Selecting a Runtime

Runtimes are resolved in the following priority order (highest to lowest):

1. **Step-level** — `runtime: codex` on a specific step
2. **CLI flag** — `--runtime codex` on `af run`
3. **Workflow settings** — `settings.runtime: codex` in the workflow YAML
4. **Config default** — `defaults.runtime` in `config.json`
5. **Built-in fallback** — `"claude"` if nothing else is set

The step-level `runtime` field is never overridden by the CLI flag. This ensures mixed-runtime workflows work predictably even when a global flag is set.

### Workflow-level default

```yaml
settings:
  runtime: codex
```

All steps in this workflow use Codex unless overridden at the step level.

### Step-level override

```yaml
steps:
  - name: plan
    type: prompt
    runtime: claude
    model: opus
    prompt: ...

  - name: review
    type: prompt
    runtime: codex
    prompt: ...
```

### CLI flag

```bash
af run my-workflow --runtime codex
```

Overrides the config default and workflow settings, but not per-step `runtime` fields.

## Runtime Capabilities

| Capability                            |      Claude (`claude`)      |                   Codex (`codex`)                   |
| ------------------------------------- | :-------------------------: | :-------------------------------------------------: |
| `skill` steps (`<plugin>:<skill>`)    |             Yes             |           Native (session), else inlined            |
| System prompt injection               |             Yes             | Developer instructions (session), prepended (`cli`) |
| Agent sub-configurations              |             Yes             |                         No                          |
| Streaming output                      |             Yes             |                         Yes                         |
| Permission allowlist (`runtimes`)     |     Yes (both drivers)      |          Sandbox, plus approvals (session)          |
| Opt-in bypass (`permissions: bypass`) |             Yes             |                         Yes                         |
| `send --mode now` on the `cli` driver |      Kill, `--resume`       |                 Kill, `exec resume`                 |
| Session driver (live steering)        |             Yes             |                 Yes (`turn/steer`)                  |
| Permission requests (`needs_input`)   |        Yes (session)        |                    Yes (session)                    |
| Questions (`needs_input`)             | `AskUserQuestion` (session) |           `request_user_input` (session)            |
| Live transcript (`af logs`)           |             Yes             |                         Yes                         |
| Session resume after a restart        |             Yes             |                         Yes                         |
| OS-level sandbox (Linux/macOS)        |             N/A             |                         Yes                         |
| OS-level sandbox (Windows)            |             N/A             |                         No                          |

> **Note**: slash-command prompts only work with the `claude` runtime. `skill` steps work on both: Claude loads the skill natively; Codex loads it natively on the session driver when it has the skill, else gets it inline. agentic-forge bundles no execution skills: they come from the plugins and `.claude/skills/` directories Claude Code loads.

### Skills on Codex

On the `session` driver, a `skill` step on Codex first asks the app-server for its skills (`skills/list` in the step's working directory). Codex finds skills in the repo's `.agents/skills/` and `.codex/skills/`, in `~/.codex/skills/` and in installed Codex plugins (named `<plugin>:<skill>`). When one matches the step's skill (its full id, else the name after `<plugin>:`), the first turn is a native `skill` input plus `$<skill> <arguments>`. Otherwise the step falls back to the inlined skill below. The step log and the transcript say which one ran.

Codex on the `cli` driver does not load skills, so a `skill` step there always sends the skill itself as the prompt. agentic-forge finds the skill where Claude Code would load it:

- `<plugin>:<skill>`: the plugin named `<plugin>` (its `.claude-plugin/plugin.json` name, else its directory name) in `skill_packs.paths`, then `runtimes.claude.plugins`, then the installed Claude Code plugins (with `skill_packs.auto_detect`). Inside the plugin, the skill comes from the `skills` paths of `plugin.json`, then `<plugin>/skills/`, matched by its frontmatter `name` or its directory
- `<skill>`: the repo's `.claude/skills/<skill>/`, then `<claude config dir>/skills/<skill>/`, then any plugin above

The prompt is a short header (the skill, its arguments, its directory and plugin root), then the body of `SKILL.md` without its frontmatter:

- `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` become absolute paths
- `$ARGUMENTS` and `$ARGUMENTS[N]` get the arguments (`<args> --run-dir <run dir> --config-snapshot <file>`); a skill without them gets an `ARGUMENTS:` line at the end
- Markdown links relative to the skill directory become absolute paths, so Codex reads a reference when the skill tells it to
- With `runtimes.codex.inline_references: true`, the files `SKILL.md` links to are appended too (up to 200 KB, larger files are only listed)

A skill that is not found (by Codex or on disk) fails the step and names the plugins searched: add the plugin directory to `skill_packs.paths`. Operator messages follow the skill, and the result block, outputs chaining and resume work as on Claude. Shell preprocessing in a skill and Claude-only tools (subagents, `AskUserQuestion`) are not available: a skill should give an inline fallback for them, as the esp-skills skills do.

## Model Names

Model values are passed to the underlying CLI as raw strings. Agentic Forge does not validate model names. Use the model identifier expected by the specific runtime.

### Claude

Prefer the version-agnostic aliases — `haiku`, `sonnet`, `opus`, `fable`. Claude Code resolves each alias to the latest model in that family, so a workflow written today keeps using the current model as new versions ship.

Pinned IDs (`claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`) also work, but they freeze the workflow to one version and must be updated by hand.

**Default**: `sonnet`.

### Codex

Codex CLI has no aliases: the value passed to `--model` is the model ID itself, and every ID eventually ages out. Because of that, Agentic Forge pins **no** default model for the `codex` runtime — when no `model` is set, the `--model` flag is omitted entirely and Codex CLI uses its own configured default (from `~/.codex/config.toml`, or its built-in default). This keeps the version-tracking behavior in the place that actually knows the current model.

Set a model explicitly only when you need a specific one:

```bash
af config set codex.model gpt-5.3-codex --global
```

At the time of writing, `gpt-5.3-codex` is the current Codex model ID. Earlier IDs (`gpt-5.2-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `gpt-5-codex`, `codex-mini-latest`) are deprecated. Check OpenAI's model documentation before pinning.

Reasoning effort is not a model name — it is configured separately as `reasoning.effort` on models that support it.

### Mixing runtimes in one workflow

`settings.model` is written in the workflow runtime's model namespace, so it is **not** applied to a step that overrides `runtime`. A `codex` step inside a `claude` workflow will never inherit `sonnet`; it falls back to `codex.model` from config, or to no `--model` flag at all.

```yaml
settings:
  runtime: claude
  model: sonnet

steps:
  - name: plan
    type: prompt
    model: opus # claude namespace
    prompt: ...

  - name: codex-review
    type: prompt
    runtime: codex # does not inherit "sonnet"; Codex CLI picks its own model
    prompt: ...
```

## Runtime-Specific Configuration

### codex.sandbox

Controls the Codex sandbox mode. Only applies when using the `codex` runtime.

| Value                  | Description                                |
| ---------------------- | ------------------------------------------ |
| `"workspace-write"`    | Read anything; write only within workspace |
| `"read-only"`          | Read-only access                           |
| `"danger-full-access"` | Unrestricted access (no sandbox)           |

**Default**: `"workspace-write"`

Configure globally or per-project:

```bash
af config set codex.sandbox workspace-write --global
```

> **Windows note**: Native Windows Codex uses an OS sandbox (`elevated` or `unelevated`) in addition to the Codex sandbox mode. Agentic Forge passes workflow output directories through both `--add-dir` and `sandbox_workspace_write.writable_roots` so Codex can write global outputs under `workspace-write`. If your Windows sandbox still denies those writes, set `outputDirectory: "local"` to keep workflow outputs inside the workspace, or explicitly set `bypass-permissions: true` for workflows where you accept Codex's `danger-full-access` mode.

## Setting the Default Runtime

To use Codex as your default runtime instead of Claude:

```bash
# Set globally
af config set defaults.runtime codex --global

# Set for a specific project
af config set defaults.runtime codex --local
```

To restore Claude as the default:

```bash
af config set defaults.runtime claude --global
```
