# Cost and Tokens

A harness run costs the tokens of its workers (the agent sessions of its steps) plus, when an overseer drives it, the tokens of the overseer session. This page explains where the tokens go, how to keep the overseer's share small, and how to measure and bound both.

## Where Tokens Go

- **Workers**: every prompt, skill and ralph-loop step is a fresh agent session. Its cost is the runtime's own system prompt and tools, the repository files the agent reads, and what af adds (see [What af Adds to a Worker](#what-af-adds-to-a-worker)). Most of it is prompt cache reads: in the measured demo below, 82% of the worker tokens were cache reads
- **Overseer wake-ups**: every tool call ends an overseer turn, and every turn re-sends the overseer's whole context (system prompt, skill, MCP tool schemas, conversation). A Claude Code session starts at about 30k tokens of context, so each wake-up costs at least that much, mostly as cache reads
- **Tool results kept in context**: everything a tool returns stays in the overseer context and is re-sent on every later turn. The af MCP tools return compact JSON, about 8 KB at most by default; the parameters that return more are explicit (`limit`, `max_chars`, `verbose`)
- **Prompt cache lifetime**: a wake-up inside the cache lifetime reads the context from the cache (a tenth of the input price); a wake-up after it expires writes the whole context again. `af_wait` waits 240 seconds per call on Claude Code and Codex, which keeps each wake-up inside the 5 minute cache

## Overseer Patterns

### Recommended

- **Background monitor**: run `af events --follow --compact --types "needs_input,run.*,step.failed"` as a background Monitor (or background Bash command). The overseer wakes once per matching event, and each line is one short summary. Add `--until terminal` (or `attention`) when one run is all you follow. The `af-overseer` skill starts this monitor for you
- **`af_wait` loops**: where no background command runs (the Chat tab, other MCP clients), call `af_wait` with `run` (or `runs`) and `until: attention`, and pass back the `cursor` it returns (the `cursor` of `af_dispatch` works for the first call). It returns only when a run ends or needs you
- **`af_digest` after a compaction**: one line per open run plus the questions and failures raised since its cursor, instead of re-reading events
- **Artifacts only when deciding**: read a summary with `af_artifacts` `frontmatter_only: true` first, then one `section`; never whole artifacts by habit

### Delegating Waits to a Cheap Subagent

The overseer can hand a wait to a subagent on a small model (for example Haiku): the subagent runs the `af_wait` loop and returns only the result block. The waits then run in the subagent's small context, and the overseer pays for one turn when the run ends. The `af-delegate` skill follows the same loop.

### Anti-patterns

- **`af run --foreground` through an agent's Bash tool**: it streams every step's output into the context. Dispatch with `af_dispatch` (or `af run` without `--foreground`) and wait with `af_wait`
- **Short, unfiltered `af_events` polls**: every poll is a full turn, and without `types` every step and iteration event wakes the overseer. In the measurements below it costs 2.8 times the tokens of `af_wait` for the same run
- **Reading transcripts and whole artifacts**: use `af_logs` with a small `limit` to debug a step, and `af_artifacts` without `content` first

## What af Adds to a Worker

| Item                         | Size                                    | Notes                                                                                                                                                                               |
| ---------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agentic system prompt        | about 3.9 KB (1k tokens) per session    | Result block format, `needs_input`, `af_ask` and `af_dispatch` hints. Appended to the Claude system prompt, prepended to the first Codex prompt (not on a resume)                   |
| `## Operator Messages`       | about 50 bytes plus each message's text | Only the pending messages of the step, each delivered once                                                                                                                          |
| af MCP tools (Codex workers) | about 10 KB of schemas per turn         | Only the worker tools: `af_ask`, `af_dispatch`, `af_wait`, `af_status`, `af_answer`, `af_artifacts`, `af_cancel`. Claude workers see af tools only if you added the server yourself |
| Inlined `SKILL.md` (Codex)   | the skill's size                        | Only for a skill step on a runtime without native skill loading                                                                                                                     |
| `--add-dir` paths            | none                                    | The run directory and the working directory. Claude Code does not load `CLAUDE.md` from added directories by default                                                                |

Template variables are the one item you control: `{{ outputs.<step> }}` without a key expands to the step's whole output when its result block has no `outputs` (and to every iteration's output for a ralph loop). Reference `{{ outputs.<step>.<key> }}` from the result block, or pass a file path such as `{{ plan_path }}`.

## Workers: Models Are the Main Lever

The model of each step decides most of a run's cost. Set a cheaper `model` on mechanical steps (create a branch, commit, format, run a check) and keep the large model for planning and review. The bundled `claude-demo` and `multi-demo` workflows run their steps on `haiku`; `plan-loop` plans on `opus` and runs its loop on the default model. See [Coding Agents](./coding-agents.md) for model names per runtime.

## Measuring and Bounding

- `af usage <run> --by step` shows the tokens of every step (input, cached input, cache writes, output) and the reported cost, which is an estimate (notional on a subscription login). It includes the runs a run dispatched
- `af_usage` with `scope: "mcp"` shows the bytes each tool returned in the current MCP session, the only view af has of the overseer's tool-result load. The overseer's own tokens are only visible in the client (`/cost` or `/context` in Claude Code)
- `settings.budgets.max_tokens` and `max_cost_usd` in a workflow, or `runs.budgets` in config, bound a run: a `budget.warning` event at 80%, and a pause with reason `budget` at the limit. `af resume --max-tokens <n>` continues after a raise; a resume without one pauses again before the next step. See [Configuration](./configuration.md)

## Measured Baseline

The `claude-demo` workflow (9 Haiku runtime calls, about 90 seconds) run once with no overseer and once under each pattern, with a Sonnet overseer in a headless Claude Code session (no skill loaded, only the af MCP server). Worker tokens are from `af usage`, MCP bytes from `af_usage(scope: "mcp")`, overseer tokens from the session's reported usage (input, cache reads and writes, output).

| Pattern                           | Worker tokens | MCP calls | MCP bytes | Overseer requests | Overseer tokens | Overhead |
| --------------------------------- | ------------- | --------- | --------- | ----------------- | --------------- | -------- |
| No overseer (`af run`)            | 901,348       | 0         | 0         | 0                 | 0               | 0%       |
| `af_wait` loop                    | 809,528       | 3         | 1,226     | 5                 | 155,871         | 19%      |
| Background monitor (`af events`)  | 911,531       | 2         | 744       | 6                 | 200,308         | 22%      |
| `af_events` every 30 s, no filter | 848,448       | 11        | 6,647     | 13                | 443,654         | 52%      |

Overhead is the overseer's tokens as a share of the worker tokens. The workers of this demo are small, so the share is high: the overseer's cost per wake-up is fixed (31k to 34k tokens here), so the share falls as the steps grow. What grows with the run's length is the number of wake-ups: constant for the monitor (one per matching event), one per 240 seconds for `af_wait`, and one per 30 seconds or per event for unfiltered polling.
