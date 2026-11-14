# Overseer

The overseer is one interactive agent session that drives your agentic-forge (af) runs: it turns an epic into a backlog, dispatches workflows on any runtime (Claude or Codex), follows their events, relays your corrections, answers low-risk questions and asks you the rest. The runs execute in the af supervisor, in the background; the overseer only talks to them through the af MCP server.

There are two ways to run it:

- **Claude Desktop (Code tab)** or any Claude Code session, with the `af-overseer` plugin installed by `af setup claude`. This is the main setup: you chat with the overseer in the Claude UI, from your desktop or from your phone through Remote Control
- **The terminal**: `af overseer` starts `claude` with the same skill and the af MCP server, nothing to install (see the [CLI Reference](./cli.md#overseer))

## Setup

Install agentic-forge, then register it in Claude Code:

```bash
npm install -g agentic-forge
af setup claude
```

`af setup claude` installs the `af-overseer` plugin in Claude Code (user scope, so every project and Claude Desktop see it). The plugin holds:

- the `overseer` skill (`/af-overseer:overseer`): the overseer itself
- the `af-delegate` skill: delegates one task to another runtime and waits for the result (for example, "have Codex review this plan"); Claude uses it on its own when you ask for another agent
- the af MCP server (`agentic-forge`): `af mcp`, started with the absolute path of this af install, so `af` does not need to be on the `PATH` of Claude Desktop

Restart Claude Desktop (or Claude Code) after the setup. `af doctor` shows the registration (`claude mcp` check). Run `af setup claude` again after updating agentic-forge: it only changes what differs.

To run Codex as a client too (a Codex session that dispatches and steers af runs, or uses the af skills):

```bash
af setup codex
```

See [`af setup`](./cli.md#setup) for the options (`--mode mcp` instead of the plugin, `--dry-run`).

## Using It in Claude Desktop

1. Open the Code tab on the repository you want to work on
2. Run `/af-overseer:overseer`, optionally with `--epic <file>` (a new epic), `--resume <run>` (a previous overseer run) or `--new`. Plain words work too ("oversee the epic in docs/epics/search.md")
3. The overseer opens its overseer run (`af overseer --open` in Bash), starts its event monitor, and either runs intake on the epic or rebuilds its picture from the harness

From there, talk to it:

- "Run T03 on Codex" or "have Codex check the plan": it dispatches a run (`af_dispatch` with `runtime: codex`) and waits for it with `af_wait`
- "In T03, use the existing cache client": a correction for a running agent (`af_send`)
- "Drop the migration from scope": an amendment (`af_amend`)
- "Pause T02", "cancel it", "retry the review step": `af_pause`, `af_cancel`, `af_retry_step`
- When a run asks a question, the overseer answers it itself when it is within `overseer.answer_policy` (low risk, a recommended option), and asks you with a question prompt otherwise. Permission requests and high-risk questions always reach you

### Event delivery

A Claude Desktop session cannot receive pushes from the supervisor. The overseer runs `af events --follow` as a background Monitor (Code tab), so it wakes on `needs_input`, run ends and failed steps while you keep chatting. Where no background command is available (the Chat tab), it polls with `af_events` between your messages and waits on one run with `af_wait`. Turn on [notifications](./configuration.md#notifications) to hear about a question or a finished run when the session is closed.

### Durability

The overseer session does not survive a reboot or closing the app; the runs do, in the supervisor. A new session (`/af-overseer:overseer` again, or `--resume <run>`) reopens the open overseer run of the repository and rehydrates from the harness: `af_status`, `af_backlog_list` and the open requests. Nothing is replayed from memory.

## Locality

`af mcp` is a local stdio server. The client (Claude Desktop, Claude Code, Codex) starts it, and it forwards every tool call to the local supervisor on `127.0.0.1` with a per-user token. Agents run on your machine, with your local `claude` and `codex` logins: Claude runs use your Claude plan limits, Codex runs your ChatGPT or Codex plan.

| Where you chat                                                 | Works  | Notes                                                                               |
| -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| Claude Desktop, Code tab                                       | Yes    | Best fit: skills, Bash and the background event monitor                             |
| Claude Code CLI or IDE extension                               | Yes    | Same plugin; `af overseer` also starts it in a terminal                             |
| Remote Control or the mobile app, driving a local Code session | Yes    | The session keeps running on your machine, so the local MCP server stays available  |
| Claude Desktop, Chat tab                                       | Partly | MCP tools only: no skills, no background monitor                                    |
| claude.ai on the web, cloud sessions                           | No     | They cannot reach a local MCP server or supervisor                                  |
| Codex CLI or app                                               | Yes    | After `af setup codex`: the af tools and the `af-overseer` and `af-delegate` skills |

## Limits

- One machine: the supervisor, the runs and the MCP server are local. A remote MCP server (`af mcp --http` behind a tunnel) is not available
- The overseer has no live view of a headless run; it reads `af_logs` on demand. Use `af logs <run> --follow` in a terminal to watch one
- The overseer's own answers are checked against `overseer.answer_policy` (409 outside it), but `from: user` answers are not authenticated (see [Answer policy](./cli.md#answer-policy))
- Every child run is one more agent session on your plan: parallel children use the Claude plan window faster. The run tree guards (`overseer.budgets.max_dispatch_depth`, `max_tree_runs`, `max_tree_active`) stop runaway delegation
- Tools appear twice when both the plugin and a user-scope `agentic-forge` MCP server are registered; `af setup` and `af doctor` say so
