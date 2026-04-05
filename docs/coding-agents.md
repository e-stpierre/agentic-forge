# Coding Agents

Agentic Forge is a workflow engine for coding agents. Workflows can target Claude Code, Codex CLI, or future agents at the step level. The engine orchestrates whichever runtimes you specify; it is not tied to any one agent.

## Supported Runtimes

| Runtime     | ID       | CLI Tool | Streaming Format |
| ----------- | -------- | -------- | ---------------- |
| Claude Code | `claude` | `claude` | `stream-json`    |
| Codex CLI   | `codex`  | `codex`  | JSONL            |

Each runtime must be installed and authenticated independently before use. Agentic Forge does not install or configure the underlying CLI tools.

### Claude Code

Install and authenticate the Claude Code CLI via Anthropic's official documentation. Verify with:

```bash
claude --version
```

### Codex CLI

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

Model values are passed to the underlying CLI as raw strings. Agentic Forge does not validate model names. Use the model identifier expected by the specific runtime:

- Claude: `haiku`, `sonnet`, `opus` (or full model IDs like `claude-opus-4-6`)
- Codex: `codex-mini`, `o3`, or any model supported by the Codex CLI

```yaml
steps:
  - name: plan
    type: prompt
    runtime: claude
    model: opus
    prompt: ...

  - name: codex-step
    type: prompt
    runtime: codex
    model: codex-mini
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

> **Windows note**: Codex does not apply OS-level sandboxing on Windows. The `codex.sandbox` setting is passed to the CLI but has no enforcement effect.

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
