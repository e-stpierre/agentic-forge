# Coding Agents

Agentic Forge is a workflow engine for coding agents. Workflows can target Claude Code, Codex CLI, or future agents at the step level.

## Supported Runtimes

| Runtime     | ID       | CLI Tool | Streaming Format | Status       |
| ----------- | -------- | -------- | ---------------- | ------------ |
| Claude Code | `claude` | `claude` | `stream-json`    | Recommended  |
| Codex CLI   | `codex`  | `codex`  | JSONL            | Experimental |

Each runtime must be installed and authenticated independently before use. Agentic Forge does not install or configure the underlying CLI tools.

## Drivers

A runtime runs a step through a driver, set per runtime with `runtimes.<id>.driver` (see [Configuration](configuration.md#runtimes)):

| Driver    | Claude                                                     | Codex                     |
| --------- | ---------------------------------------------------------- | ------------------------- |
| `session` | Default. A live Claude Agent SDK session (streaming input) | Not available yet (`cli`) |
| `cli`     | One-shot `claude -p --output-format stream-json`           | Default. `codex exec`     |

A step on the `session` driver stays alive while it works and while it waits:

- **Permissions**: tool calls allowed by the step's allowlist (`runtimes.claude.allow` plus the workflow's `required-tools`, see [Permissions](#permissions)) or by your Claude settings run without asking. Any other call becomes a `needs_input` request (`Allow <tool>? <command or path>`, options `allow` and `deny`). The run is `awaiting-human` while the session waits, and `af answer <run> <request> allow` (or `deny`) lets the same session continue. A denied call is reported to the agent, which carries on.
- **Questions**: when Claude uses `AskUserQuestion`, each question becomes a `needs_input` request with its options (`a`, `b`, ...). The answer (an option id, a label or free text) is returned to Claude as the tool result.
- **Messages**: `af send` (`--mode next`) reaches the session as its next turn when the current turn ends; `--mode now` is delivered into the running turn, at the next tool call, with no step restart.
- **Result**: the final message of the last turn holds the result block, read the same way as on the `cli` driver.
- **Resume**: when a session step ends with an `awaiting-human` result block, `af answer` resumes the same session by its id with the answer, instead of running the step again from its start.

- **Supervisor restart**: the session id is stored in `steps/<NN-step>/session.json`. When the supervisor stops while a prompt or skill step runs (or waits for an answer), the next supervisor resumes that session with a prompt saying the harness restarted, instead of running the step from its start. The choice is in `run.recovered` and `decisions.jsonl` (see [`af serve`](cli.md#serve)).

Parallel steps each run their own session and can each wait on a request; answer them by request id.

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

Both drivers write a live transcript per step, `steps/<NN-step>/transcript.jsonl`, in one normalized format: messages, tool calls and results, file diffs, permission requests and answers. The session driver maps the Agent SDK messages; the `cli` driver maps the `claude -p` stream-json lines and the `codex exec --json` lines (Codex commands, MCP tool calls and file changes). Edits by Claude's `Edit`, `MultiEdit`, `Write` and `NotebookEdit` tools get a `diff` entry with a line patch; Codex file changes get one with the path and change kind. Read it with [`af logs`](cli.md#logs) or the `af_logs` MCP tool.

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

- Does not support `skill` steps yet — steps must use inline prompts
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

| Capability                            | Claude (`claude`)  |   Codex (`codex`)   |
| ------------------------------------- | :----------------: | :-----------------: |
| `skill` steps (`<plugin>:<skill>`)    |        Yes         | No (fails, not yet) |
| System prompt injection               |        Yes         | Prepended to prompt |
| Agent sub-configurations              |        Yes         |         No          |
| Streaming output                      |        Yes         |         Yes         |
| Permission allowlist (`runtimes`)     | Yes (both drivers) |    Sandbox mode     |
| Opt-in bypass (`permissions: bypass`) |        Yes         |         Yes         |
| `send --mode now` on the `cli` driver |  Kill, `--resume`  | Kill, `exec resume` |
| Session driver (live steering)        |        Yes         |         No          |
| Permission requests (`needs_input`)   |   Yes (session)    |         No          |
| Live transcript (`af logs`)           |        Yes         |         Yes         |
| Session resume after a restart        |        Yes         |         Yes         |
| OS-level sandbox (Linux/macOS)        |        N/A         |         Yes         |
| OS-level sandbox (Windows)            |        N/A         |         No          |

> **Note**: `skill` steps and slash-command prompts only work with the `claude` runtime. agentic-forge bundles no execution skills: they come from the plugins and `.claude/skills/` directories Claude Code loads. Steps that invoke skills must use `runtime: claude` (explicitly or by default).

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
