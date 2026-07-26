# Coding Agents

Agentic Forge is a workflow engine for coding agents. Workflows can target Claude Code, Codex CLI, or future agents at the step level.

## Supported Runtimes

| Runtime     | ID       | CLI Tool | Streaming Format | Status       |
| ----------- | -------- | -------- | ---------------- | ------------ |
| Claude Code | `claude` | `claude` | `stream-json`    | Recommended  |
| Codex CLI   | `codex`  | `codex`  | JSONL            | Experimental |

Each runtime must be installed and authenticated independently before use. Agentic Forge does not install or configure the underlying CLI tools.

### Claude Code (recommended)

Claude Code is the primary and recommended coding agent for Agentic Forge. It has the deepest integration and supports all features including bundled skills (`/af-*`), agent sub-configurations, system prompt injection, and worktree isolation. All bundled workflows are designed and tested with Claude Code as the default runtime.

Install and authenticate the Claude Code CLI via Anthropic's official documentation. Verify with:

```bash
claude --version
```

### Codex CLI (experimental)

Codex CLI is supported as an experimental runtime. Its integration is more limited compared to Claude Code:

- Does not support bundled skills (`/af-*` commands) — steps must use inline prompts
- Does not support agent sub-configurations
- May have permission and file access issues, particularly on Windows
- OS-level sandboxing is not enforced on Windows

Codex works best as a secondary runtime for independent tasks like code review in mixed-runtime workflows (e.g., `multi-plan-build-review`), where Claude handles planning and implementation while Codex provides an independent review perspective.

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

| Capability                     | Claude (`claude`) |   Codex (`codex`)   |
| ------------------------------ | :---------------: | :-----------------: |
| Bundled skills (`/af-*`)       |        Yes        |         No          |
| System prompt injection        |        Yes        | Prepended to prompt |
| Agent sub-configurations       |        Yes        |         No          |
| Streaming output               |        Yes        |         Yes         |
| `--skip-permissions`           |        Yes        |         Yes         |
| OS-level sandbox (Linux/macOS) |        N/A        |         Yes         |
| OS-level sandbox (Windows)     |        N/A        |         No          |

> **Note**: Skill-based prompts (`/af-git-commit`, `/af-sdlc-plan`, etc.) only work with the `claude` runtime. Steps that invoke skills must use `runtime: claude` (explicitly or by default).

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
