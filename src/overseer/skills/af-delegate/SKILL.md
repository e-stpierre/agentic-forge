---
name: af-delegate
description: Delegate one task to another coding agent (Codex or Claude) as an agentic-forge run, wait for its result, and relay its questions. Use when asked to have another agent or runtime do, check or review something, or to run a task as an af run.
argument-hint: "[--runtime claude|codex] [--workflow <name>] <task>"
---

# af Delegate

## Overview

Run one task on another coding agent through agentic-forge (af), wait for it, and bring back its result. The af supervisor runs the task as an af run: it has a run directory, events, a transcript and a result block, and it keeps running if this session ends. Use the `agentic-forge` MCP tools (`af_*`) when they are available, else the af CLI in Bash (see Without the MCP Server).

Do the work yourself instead when it is quick and read-only, and no other runtime or model is asked for: a delegated run costs a full agent session.

## Arguments

- `--runtime <id>`: `codex` or `claude`. Default: the runtime the user names, else the other runtime than yours
- `--workflow <name>`: the workflow to run. Default: `instruction` (bundled, one prompt step, variable `instruction`)
- `<task>`: what the agent should do, in a few sentences, with the files it concerns and what to report back

## Workflow

1. Write the task as a self-contained instruction: the agent sees none of this conversation. Name the files, the expected outcome and the result to report (for a review: the findings; for a check: pass or fail with reasons). Say whether it may change files
2. Dispatch with `af_dispatch`: `workflow`, `repo` (the absolute repository path), `runtime`, `vars` (`{ "instruction": "<task>" }` for `instruction`), `wait: true`. Inside an af run or an overseer session the parent is set for you; from an overseer session pass `parent: <overseer run id>`
3. Read the returned `wait` object. While its `state` is not `ended`, call `af_wait` (`run`, `until: attention`, `cursor` = the last returned `cursor`) again. Tell the user the run id once, at the start, and keep each wait short (the default `timeout_seconds` is right)
4. When `state` is `attention` and `needs_input` lists an open request, handle it (see Questions), then wait again
5. When `state` is `ended`, report `result.status` and `result.summary` to the user in a few lines. Read more only when needed: `af_artifacts` (`run`) for the summary or review file, `af_logs` (`run`, a small `limit`) for what the agent did. A run that `failed` or `halted` has a reason in `error` or the summary: report it and propose a retry with a clearer instruction, `af_retry_step`, or doing it yourself

A dispatch refused with `Dispatch refused: ...` hit a run tree guard (depth or tree size): do the task yourself or tell the user, never retry in a loop.

## Questions

A run may stop and ask (`needs_input`): a question, a decision or a permission, with `kind`, `risk`, options and a recommended option.

- When you can answer from the user's request (the task already says it), answer with `af_answer` (`run`, `request_id`, `answer`: an option id or text)
- Otherwise ask the user: AskUserQuestion when available, else a plain question. Show the question, its context in one sentence and the options, recommended first. Then `af_answer` with what the user chose
- Always ask the user for `kind: permission` and for `risk: high`

To correct the run while it works (the user adds a detail), use `af_send` (`run`, `text`); it reaches the agent at its next turn.

## Without the MCP Server

When the `af_*` tools are not available, use the af CLI in Bash (`af`, or `agentic-forge`):

```bash
af dispatch instruction --runtime codex --var instruction="<task>" --no-interactive --wait --until attention --timeout 300
```

- It prints the wait result as one JSON line (`run`, `status`, `state`, `cursor`, `result`, `needs_input`) and exits `0` (done or merged), `10` (awaiting human), `11` (needs attention: paused, or a step failed while the run continues; read the JSON line), `20` (halted), `30` (blocked: a step escalated), `1` (failed or canceled, or an af error: read `status` in the JSON line) or `124` (still running at the timeout)
- On `124`, or on `10` or `11` once you have handled the request or the failure, continue with `af wait <run> --until attention --cursor <cursor> --timeout 300`
- Answer a request with `af answer <run> <request-id> "<answer>"`, send a correction with `af send <run> "<text>"`
- Run long waits in the background when your client supports it, so the user can keep talking to you
