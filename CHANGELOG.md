# Changelog

## Unreleased

- Added harness contract v1, owned by agentic-forge: specification in `docs/harness-contract.md` (run directory layout, artifacts, `needs_input`, inbox and amendments, events, decisions, `summary.md`, exit codes, compliance levels, `af-contract`/`af-level` skill metadata, versioning rules, append protocol)
- Added contract v1 JSON Schemas and valid/invalid fixtures in `schemas/contract-v1/`, shipped in the npm package and importable by path (`agentic-forge/schemas/contract-v1/<artifact>.schema.json`)
- Added `src/contract` validation helpers (`validateArtifact`, `validateContractFile`, `exitCodeFor`) backed by `ajv`
- Decided the runs root default: harness runs go to `<global dir>/runs/`, separate from skill pack roots; recap tools read a list of roots
- Contract deltas from the esp-skills draft: schema titles drop the `(draft)` marker; fixtures reformatted by prettier (no value changes); inbox messages with `target: step` must name a non-empty `step`; jsonl files reject interior blank lines, so event `seq` matches the physical line number
- Added the af supervisor (`af serve`): one long-lived process per user, single instance through a pidfile and the contract lock, HTTP IPC on `127.0.0.1` with a random port and a per-user token in a user-only `supervisor.json` discovery file; runs in the foreground or detached (`--detach`, hidden with no console on Windows), with `--status`, `--stop`, `--restart` and stale lock and pidfile recovery
- Added a supervisor client that starts the supervisor on demand and applies a version handshake (restarts an idle supervisor with a different version, warns when runs are active); shutdown uses a named request on every platform, with `SIGTERM` as the POSIX fallback
- Added the `AGENTIC_FORGE_HOME` environment variable to override the global directory on every platform
- **Breaking:** `af run` now dispatches the workflow to the supervisor (started on demand) and returns a run ID; `--foreground` follows the run's events until it ends, and Ctrl+C detaches without stopping it
- Added the run registry (`<global dir>/runs/index.json`) and contract run directories (`<runs.root>/YYYY-MM-DD-<slug>/` with `run.json`, `events.jsonl`, `dispatch.json` and `progress.json`), replacing output directories; `{{ output_dir }}` now points at the run directory
- Added the dispatch payload: the client sends the repo root, the workflow (path and contents), its resolved config and an allowlisted environment, so the supervisor never reads its own cwd
- Added the supervisor scheduler: `supervisor.max_parallel_runs` (global, default 4), `supervisor.max_parallel_tasks` (per repo, default 2), and one run per checkout unless the run has its own worktree; `supervisor.env_passthrough` forwards extra environment variables
- Added crash recovery: on start, the supervisor marks the step a dead supervisor left running as `interrupted`, resumes the run from it (reusing the worktree recorded in `run.json`), rebuilds missing step events from disk, and emits `run.recovered` once
- Added `run.*` and `step.*` events to `events.jsonl`, written after the state they describe
- Added `runs.root`; **Deprecated** `outputDirectory` (`local` maps to `<repo>/agentic/runs/` with a warning)
- Changed `af status`, `af list`, `af cancel` and `af resume` to use the run registry; legacy `outputs/` runs are listed read-only and cannot be resumed; `af resume --terminal-output` is replaced by `--foreground`, and `af cancel` stops a running run before its next step
- Fixed the global config path ignoring `AGENTIC_FORGE_HOME`
- Added `af send <run> <text>` (`POST /v1/runs/:id/messages`): queues a contract inbox message (`inbox/<timestamp>-<id>.json`) that the supervisor prepends as an `## Operator Messages` section to the next step or ralph-loop iteration prompt (or to the step named with `--step`), delivered once, marked `delivered_at`, with `message.queued` and `message.delivered` events and an `operator` entry in `decisions.jsonl`; only `mode: next` is supported so far
- Added `af pause <run> [--now]` (`POST /v1/runs/:id/pause`): stops a run at its next step or ralph-loop iteration boundary, or with `--now` kills the current step (recorded `interrupted`, rerun on resume)
- **Breaking:** `af cancel` now stops a running run immediately instead of at its next step, then runs `safetyCommit` and applies the worktree cleanup policy; canceling a queued or paused run applies the same policy to its recorded worktree
- Changed step processes to be killed as a whole process tree (`taskkill /T /F` on Windows, process group on POSIX) on `pause --now`, `cancel` and step timeouts, and spawned with `windowsHide`
- Fixed the `on-complete` worktree cleanup policy removing the worktree of a paused or awaiting-human run; such runs now always keep their worktree
- Changed `pruneOrphaned` to accept the worktree paths af recorded, so it never prunes nested worktrees created by a step
- **Breaking:** The agentic system prompt now asks for the contract result block (one JSON line, `status` and `summary`, optional `needs_input`, `outputs`, `max_risk`, `pr`, ...) instead of `{ sessionId, isSuccess, context }`; the adapters read the session id from the stream (Claude `session_id`, Codex `thread.started`). The legacy block is still read when no result block is present
- Added result-status handling for prompt steps: `done`/`merged` complete the step (a run with a `merged` step ends `merged`), `failed` fails it, `awaiting-human` puts the run in `awaiting-human`, `halted` ends it `halted`, `escalate` puts it in `blocked`; without a block, process exit codes `0`/`10`/`20`/`30` map the same way. Blocks are written to `steps/<NN-step>/result.json`, and `max_risk` and `pr` are copied to `run.json`. `af run --foreground` exits `20` for halted and `30` for blocked runs
- Added `needs_input` handling: an `awaiting-human` result with `needs_input` emits a `needs_input` event and stores the request in `run.json` (`x-af-needs-input`); `af answer <run> <request> <answer>` (`POST /v1/runs/:id/answer`) logs `input.answered` and an `operator` decision, and reruns the step with the answer as an operator message
- Added `supervisor.needs_input_timeout` (minutes, default `null`): a non-blocking request with a `recommended` option is answered with it after the timeout, logged as a `policy` decision; deadlines survive a supervisor restart
- Added `af amend <run> <text> [--affects]` (`POST /v1/runs/:id/amend`) and the `settings.amend.step` workflow setting: the amend step runs at the next step boundary with the amendment, then the harness appends it to `amendments.jsonl` with the latest plan version, emits `amendment.applied` and logs an `operator` decision; without an amend step the amendment is recorded with `plan_version: null` and delivered as an `Amendment:` operator message
- Added the `{{ plan_path }}` and `{{ plan_version }}` template variables (latest `plan.md` / `plan.v<N>.md` in the run directory)
- Added `af retry-step <run> <step> [--context]` (`POST /v1/runs/:id/retry`): reruns a top-level step and every later step of a failed, paused, blocked or awaiting-human run, emitting `step.retried`
- Added `af send --mode now`: kills the running step and restarts it at once with the message (`step.retried` with `reason: message`)
- Added `af reprioritize <run> <priority>` (`POST /v1/runs/:id/priority`)
- Changed `af resume` to accept `blocked` runs, and worktrees of `blocked` and `halted` runs to be kept whatever the cleanup policy
- Contract delta (no version bump, loosening): `amendments.jsonl` `plan_version` accepts `null` for an amendment delivered as an operator message because the workflow has no amend step
- Added `af events [--run] [--types] [--follow] [--cursor | --cursor-file] [--new] [--json]` and `GET /v1/events`: the event stream across runs with type filters (`run.*` prefixes), opaque cursors that resume without gaps or duplicates, and a long-poll (`wait`, max 120 s) for `--follow` and the coming MCP `af_events`
- Added `iteration.started` / `iteration.completed` events for ralph-loop iterations, `step.retried` with `reason: retry` for automatic prompt retries, `run.queued` with `reason: resumed` when a stopped run is queued again, and `supervisor.restarted` in each run a new supervisor takes over
- Added `af list` filters `--status` (comma-separated), `--repo`, `--since` (ISO date or `2h`, `7d`), `--parent` and `--json`, also on `GET /v1/runs`
- Added `af artifacts <run> [--kind plan|summary|decisions|review] [--content] [--json]`
- Fixed `events.jsonl` appends after a torn last line: the new event starts on its own line and its `seq` follows the last valid event
- Added `af mcp`: a stdio MCP server, thin client of the supervisor (started on demand at the first tool call), with the tools `af_dispatch`, `af_status`, `af_list_runs`, `af_events` (`wait_seconds` long-poll, max 120), `af_send`, `af_amend`, `af_answer`, `af_pause`, `af_resume`, `af_cancel`, `af_retry_step` and `af_artifacts`; inputs are validated with zod schemas, and errors are `isError` results naming the problem, the HTTP status and a next step. Depends on `@modelcontextprotocol/sdk` and `zod`
- Changed `af run` to build its dispatch payload with the shared `buildDispatchPayload()` (`src/runs/dispatch.ts`), also used by `af_dispatch`; workflow name and path resolution accept a base directory (no behavior change for `af run`)
- Added runtime sessions: the `RuntimeSession` interface (`start`, `resume`, `send`, `steer`, `interrupt`, `respond`, `close`) and a normalized session event model (stable item ids, `idle` and `awaiting-input` states)
- Added the Claude session driver on `@anthropic-ai/claude-agent-sdk` `0.3.322` (pinned), and `runtimes.<id>.driver: session | cli`; **Changed** Claude prompt and ralph-loop steps to run on the session driver by default (`runtimes.claude.driver: cli` restores `claude -p`). The driver uses the Claude Code login, never Claude credentials
- Added live `needs_input` requests: on the session driver, a tool call outside the allowlist becomes a permission request and `AskUserQuestion` a question request, while the session waits alive (run `awaiting-human`); `af answer` resolves it in the same session (`input.answered` with `live: true`, `message: null`), and the run is `running` again
- Changed `run.json` `x-af-needs-input` to a list of pending requests keyed by request id (the single-object form is still read); `af answer` needs the request id when several are pending
- Changed `af send` on session steps: `--mode next` is sent as the session's next turn, and `--mode now` is delivered into the running turn with no step restart (`steered: true` in the response); the kill-and-restart path stays for the `cli` driver
- Changed `af answer` on a session step that ended `awaiting-human` to resume the same session by id with the answer instead of rerunning the step from its start; step session ids are now kept in `progress.json` (`session_id`)
- Added `runtimes.claude.plugins` (local plugin directories for the session driver)
- Added live step transcripts: every step writes `steps/<NN-step>/transcript.jsonl` (prompt and operator messages, assistant messages, tool calls and results, file diffs, permission requests and answers, turns) in one normalized format on both drivers; the `cli` driver maps the `claude -p` stream-json and `codex exec --json` lines. Transcripts are kept apart from `events.jsonl` and have their own cursor
- Added `af logs <run> [--step] [--follow] [--cursor] [--limit] [--json]` and `GET /v1/runs/:id/logs` (cursor, long-poll): prints the tail of a run's transcript, and with `--follow` streams it until the step (or the run) ends
- Added the `af_logs` MCP tool: a compact, capped tail of a run's transcript with a cursor (default 20 entries, 500 characters per text, about 8 KB per page, `truncated: true` when cut; `max_chars` opts in to more)
- Added session resume after a supervisor restart: the step's session id is stored in `steps/<NN-step>/session.json`, and recovery resumes a prompt step's session on the session driver (or restarts the step from its boundary otherwise), listed in `run.recovered` `data.sessions` and logged as a `policy` decision; a resumed session that fails is retried from the step's start
- Fixed a supervisor shutdown dropping the live requests of a run that waited `awaiting-human` on a session, which left it waiting with nothing to answer; the requests are kept, and after the restart `af answer` resumes the stored session with the answer
- Added the `skill` step type: `skill: <plugin>:<skill>` (or a plain skill name) and `args` (templates) run `/<skill> <args> --run-dir <run dir> --config-snapshot <run dir>/skill-config/<pack>.json` on the Claude runtime, like a prompt step (drivers, retries, result block, steering); operator messages follow the slash command. The snapshot holds the new af config key `skill_config.<pack>` (`{}` when unset). A skill step on Codex fails with "not supported yet"
- Changed prompt and skill steps to store the `outputs` object of their result block as the step output, so later steps read `{{ outputs.<step>.<key> }}` (a fenced JSON block or the raw output is still used when the block has no `outputs`)
- Added the `human-input` step type: asks `message` (with `context`, `options`, `recommended`, `blocking`) through the contract `needs_input` protocol with no runtime session (request id `input-<step>-<n>`), waits for `af answer`, and completes with the outputs `answer`, `option`, `from` and `request_id`; `timeout-minutes` (non-blocking with `recommended` only) overrides `supervisor.needs_input_timeout` for that request (af extension `x-af-timeout-minutes` on the request)
- **Breaking:** `wait-for-human` is now an alias of `human-input`: `on-timeout: continue` becomes a non-blocking request whose only option, `continue`, is recommended and applied after `timeout-minutes` (stop the run with `af cancel`), any other value waits for an answer, and `polling-interval` is ignored
- **Breaking:** `af input <run> <response>` now answers the single pending `needs_input` request of an awaiting-human run (`af answer` without a request id)
- **Removed:** the LLM orchestrator (`src/orchestrator.ts`, `WorkflowOrchestrator`) and the `af-orchestrate` skill; workflows stay deterministic and judgment belongs to the overseer
- Added interrupt and resume on the `cli` driver: `af send --mode now` kills the step, runs `safetyCommit` in the run's worktree, and resumes the session recorded in `steps/<NN-step>/session.json` with the message (`claude -p --resume <id>`, `codex exec resume <thread> <message>`); `af answer` on a `cli` step that ended `awaiting-human` and crash recovery resume it the same way. A failed resume restarts the step from its start without using a retry, with `step.retried` `reason: resume-failed`
- Added per-runtime permissions: `runtimes.<id>.permissions` (`allowlist` by default, or `bypass`) and `runtimes.claude.allow` (default `Read`, `Glob`, `Grep`, `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `TodoWrite`, `Skill`, `Task`), extended by a workflow's `required-tools`. The same list drives both Claude drivers (`--settings` permission rules on the `cli` driver, auto-approved on the session driver)
- **Breaking:** the Claude `cli` driver passes the allowlist as `--settings '{"permissions":{"allow":[...]}}'` instead of `--allowedTools`, and steps without `required-tools` now get the default allowlist. Permission checks are only bypassed through `runtimes.<id>.permissions: bypass` or `bypass-permissions: true`, and every bypassed step logs a warning
- **Removed:** every bundled execution skill (`af-sdlc-plan`, `af-sdlc-review`, `af-git-branch`, `af-git-commit`, `af-git-pr`, `af-analyze`, `af-fix-analyze`, `af-create-checkpoint`, `af-create-log`), the `src/claude/` directory and its `--add-dir` on both Claude drivers, and the `af skills-dir` command. agentic-forge is now a naked engine: workflows call the user's own skills with `skill` steps (see "Bring your own skills" in `docs/workflows.md`, with esp-skills as one example)
- **Removed:** the `plan-build-review`, `multi-plan-build-review`, `one-shot`, `analyze-codebase` and `analyze-single` workflows, the bundled agents (`explorer.md`, `reviewer.md`), `src/checkpoints/`, and the unused or SDLC templates (`plan-*`, `checkpoint`, `memory`, `progress.json`, `implementation-report`, `analysis-summary`, `analysis/*`); the kept workflows are generic demos (`claude-demo`, `codex-demo`, `multi-demo`, `ralph-loop`, `plan-loop`, `permission-test-claude`, `permission-test-codex`)
- Changed `claude-demo` and `plan-loop` to plain git instructions instead of `/af-git-branch` and `/af-git-commit`; the `claude-demo` and `codex-demo` steps `git-branch` and `git-commit` are renamed `create-branch` and `commit-files`
- **Breaking:** the prompt step `agent:` file now resolves relative to the workflow file, then the repo root (absolute paths as is), with no bundled fallback
- Fixed `settings.max-retry` being ignored: prompt and skill steps now use it before `defaults.maxRetry` (an unset setting parses as `null` instead of `3`)
- Changed `pnpm build` to clean `dist/` first, so deleted sources and assets are not shipped
- Added skill pack workflow discovery: workflows in a plugin's `af-workflows/` directory are found after the project and user-global workflows and before the bundled demos. New config `skill_packs` (`paths`, `auto_detect`, default `true`); auto-detection reads Claude Code's `installed_plugins.json` (`CLAUDE_CONFIG_DIR`, else `~/.claude`), using only the installed version of each user-scope plugin and the project or local installs of the dispatching repository
- Changed `af workflows` (and `af run --list`, which now prints the same output) to group workflows by origin in search order (project, user, each skill pack, bundled) and mark names shadowed by an earlier origin
- Added workflow `requires: { agentic-forge: "<range>", contract: <n> }`: the supervisor refuses a workflow whose requirements are unmet before the run exists, naming the required and installed versions. `af run --ignore-requires` (and `ignore_requires` on `af_dispatch`) runs it anyway when only the agentic-forge version is unmet, with a warning; a contract mismatch is always refused
- Added `af doctor` (`--json`): pass, warn or fail checks with a fix hint for Node.js, config, git, Claude Code and its auth method (plan login or API key, with a warning when `ANTHROPIC_API_KEY` is set), Codex and its login, `gh` and its auth, the supervisor version, the runs root (also printed), Claude plugin detection, and the contract and version compatibility of every discovered skill pack workflow
- Added the `wait-for-review` step type: the supervisor polls GitHub with `gh` (backoff from `poll-seconds`) until every listed reviewer reviewed the pull request's current head commit (a pull request review on it, the Codex `codex-review-state` summary on it, or a review result comment such as Claude's "No issues found" posted after it and, for a head pushed during the step, after the step first saw that head), restarts the wait and its timeout on a new head, can post each reviewer's trigger comment (`trigger: true`, `@codex review`), emits `review.received`, and stops `awaiting-human` on timeout with a `needs_input` request (`wait` or `continue`). No agent session runs while it waits
- Added the `wait-for-checks` step type: waits for the required checks of the head (read from the base branch rules; all checks when they require none until a required check shows up, or `checks: all`; a head with no check passes after a grace period counted from the time the step first saw that head), emits `checks.completed`, and reports pass or fail in its result; a failing check fails the step unless `on-fail: continue`
- Added the `merge` step type with a per-repository merge lock (`<global dir>/locks/merge-<hash>.lock`, keyed by the git common dir so every worktree of a repository shares it; contract lock protocol with a 10 s heartbeat, so a lock left by a crashed supervisor goes stale and is taken over). Natively it resolves the method from the repository settings and rulesets (merge queue, single method, `github.merge.preference`, linear history), logs it as a `policy` decision, merges with `gh pr merge --repo --match-head-commit <expected head>` from outside the checkout and deletes the remote branch through the API (branch name encoded; a failed delete is reported, not taken for "already gone"), emitting `merge.locked` and `merge.completed`; refusals (draft, branch protection) stop `awaiting-human` and are never bypassed. With `skill:` it runs the merge skill with `AF_MERGE_LOCK` set
- Added the `merge` step field `head` (template): the head SHA the native merge expects, by default the `head` output of the run's latest `wait-for-review` or `wait-for-checks` step; a pull request whose head moved since stops the run `awaiting-human` with a `needs_input` request (`merge` anyway or `stop`)
- Added the `on-merge` worktree cleanup policy: once a step reported `merged`, the run's worktree is removed, then its local branch (kept when leftover changes were auto-saved on it)
- Added the `branch.created` (worktree branch created) and `pr.opened` (first pull request a step reports for the run) events
- Added the `github` config section: `reviewers` (defaults `claude` = `claude[bot]`, `codex` = `chatgpt-codex-connector[bot]` with the `@codex review` trigger), `auto_trigger`, `trigger_after_seconds`, `poll_seconds`, `max_poll_seconds`, `review_timeout_minutes`, `checks_timeout_minutes` and `merge` (`method`, `preference`, `delete_branch`, `lock_timeout_minutes`)
- Added `skill` steps on Codex: the step finds the skill where Claude Code would load it (`skill_packs.paths`, `runtimes.claude.plugins`, the installed Claude Code plugins, `.claude/skills/`, `~/.claude/skills/`) and sends its `SKILL.md` inline, with `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_SKILL_DIR}` and relative links made absolute and `$ARGUMENTS` filled; a skill that is not found fails the step with the plugins searched. Replaces the "not supported yet" failure
- Added `runtimes.codex.inline_references` (default `false`): inlined skills also carry the files `SKILL.md` links to
- Changed Codex steps to send a prompt longer than 8,000 characters on stdin (`codex exec -`) instead of as an argument, so a large inlined skill stays under the command line limits
- Added notifications: the supervisor tails every run's events and, for the configured triggers (default `needs_input`, `run.halted`, `run.failed`, and `run.completed` of overseer runs), sends a message to the enabled channels: desktop toast (Windows, macOS, Linux), ntfy topic, Slack and Discord webhooks, and an opt-in comment on the run's pull request. Messages name the run, the question and its options, and the `af answer` and `af_answer` commands (an ended overseer run's message points to its summary and `af overseer --new`); templates per event type. Slack text is escaped, so agent text cannot mention anyone, and an overseer run follows the config of its latest session. Each delivery appends `notification.sent` to the run, and a restarted supervisor sends nothing twice
- Added the `notifications` config section (`enabled`, `triggers`, `templates`, `channels.<desktop|ntfy|slack|discord|github>` with optional per-channel `triggers`); every channel is off by default
- Added `af notify <text> [--title] [--level] [--run]` (`POST /v1/notifications`) and the `af_notify` MCP tool
- Added `af overseer [--epic <file|text>] [--resume <run>] [--new] [--model] [--print-command]`: opens an overseer run (`run.json` `type: overseer`, or reuses the open one of the repository; `--resume` from another repository is refused with a 409) and starts an interactive `claude` session with the bundled `af-overseer` plugin (`overseer` skill), the af MCP server (`--mcp-config`) and the overseer run directory. The skill runs `af events --follow` as a background Monitor (cursor file in the run directory, so a resumed session misses nothing), dispatches workflows with itself as `parent`, relays corrections with `af_send`, escalates `needs_input` with AskUserQuestion, and rehydrates from `af_status`, `af_list_runs` and the epic after a restart. `af overseer --finish <run> [--status] [--summary]` writes `summary.md` and emits `run.completed`
- Added overseer runs to the supervisor (`POST /v1/overseer`, `POST /v1/overseer/:id/finish`): `running` while open, never executed, no checkout held, skipped by crash recovery and the active-run count; `pause`, `resume`, `send`, `amend`, `retry-step`, `answer` and `reprioritize` are refused for them; `run.started` and `run.resumed` carry the session number
- Added `parent` to dispatch: `af run --parent <run>` and `af_dispatch` `parent` record the parent run in `run.json` (an unknown parent is refused)
- Added the overseer backlog: `backlog.json` in the overseer run, written only by the harness, behind the MCP tools `af_backlog_list`, `af_backlog_add` and `af_backlog_update` (`GET`/`POST /v1/overseer/:id/backlog`, `POST /v1/overseer/:id/backlog/:item`). Items carry their triage (`track` `instruction`, `light` or `full`, always with a `track_reason`), dependencies (unknown ones and cycles refused) and conflict zones
- Added backlog scheduling: `af_dispatch` `item` and `af run --item` start a backlog item only when its dependencies are done, no conflict zone overlaps a running item and fewer than `overseer.max_parallel` (default 2) items run; the item takes the outcome of its run, and `af_backlog_list` reports `runnable`, why the other items wait, and `halt` (`overseer.halt_epic_on`)
- Added discovered items: the `discovered_items` of a child run's result blocks join its overseer's backlog per `overseer.accept_discovered_items` (`auto`, `ask` by default, `log`), each logged as a `policy` decision
- Added the overseer answer policy: `needs_input` events of child runs carry `overseer_policy`; the overseer answers a request itself only within `overseer.answer_policy` (default: low step risk and the recommended option, never a permission request), logged as a `policy` decision. The supervisor refuses its other answers sent with `from: overseer` (409), a guard against overseer mistakes rather than enforcement: `from` is declared by the caller and not authenticated, so an answer sent with `from: user` (or a send and resume of the waiting run) is not checked (known limitation)
- Added the `overseer` config section with budget defaults (`max_tasks` 20, `max_retries` 1, `max_run_minutes` 480), recorded in the overseer run's `budgets_used`
- Added the bundled `instruction` workflow (one prompt step) for the overseer's `instruction` track
- Changed the overseer skill to run the backlog loop: intake, triage, approval, scheduling, discovered items, policy answers and merges through the merge lock
- Added the Codex session driver on `codex app-server` (JSON-RPC over stdio): one thread per step, `send --mode next` as the next turn, `send --mode now` through `turn/steer`, `turn/interrupt`, `thread/resume` for `af answer`, `send --mode now` fallbacks and crash recovery, and transcripts from the app-server items (commands, MCP and dynamic tool calls, web searches, file changes with their diff)
- Added Codex approvals and questions as `needs_input`: command and file change approvals and permission requests (`Allow shell? <command>`, `Allow apply_patch? ...`, `Allow request_permissions? ...`) and `request_user_input` questions wait alive for `af answer`; approvals covered by the new `runtimes.codex.allow` or the workflow's `required-tools` (`Bash`, `Bash(<prefix> *)`, `Edit`, `Write`) are accepted without asking; MCP elicitations are declined
- Added native Codex skills for `skill` steps on the session driver: a skill Codex lists (`skills/list`: `.agents/skills/`, `.codex/skills/`, `~/.codex/skills/`, Codex plugins) is sent as a `skill` input with `$<skill> <arguments>`, else the step falls back to the inlined `SKILL.md`; the choice is logged in the step output and the transcript (new `notice` transcript entry)
- Added typed Codex app-server bindings in `src/runtimes/codex-protocol/`, generated by `scripts/codex-bindings.js` from `codex app-server generate-ts --experimental` and pinned to Codex `0.128.0` (`CODEX_PROTOCOL_VERSION`)
- **Breaking:** `runtimes.codex.driver` now defaults to `session` (`codex app-server`); set it to `cli` to keep `codex exec`. On the session driver the agentic system prompt goes in the thread's developer instructions instead of being prepended to the prompt
- Contract delta (no version bump, additive): `needs_input` gains the optional `kind` (`question`, `permission`, `decision`; absent means `decision`) and `risk` (`low`, `medium`, `high`; absent counts as not low). Existing requests without them stay valid. New fixtures `needs-input/valid/kind-and-risk.json` and `needs-input/invalid/unknown-kind.json`
- Added `kind` and `risk` to `needs_input` events: session permission requests are `permission`, `AskUserQuestion` and Codex `requestUserInput` questions are `question`, result-block requests default to `decision`; `risk` is the request's own, else the asking step's `max_risk`
- Added the `af_ask` MCP tool (`POST /v1/runs/:id/ask`, `GET /v1/runs/:id/ask/:request`): an agent inside a running step asks a question on any runtime, including Claude subagents; the call waits for the answer (`wait_seconds`, default 50) and returns it, or returns `pending`, after which the answer is the session's next turn (the session stays open while the question is open). Steps get `AF_RUN_ID` and `AF_STEP` in their environment so the tool finds its run and step
- **Breaking:** `supervisor.needs_input_timeout` now only auto-answers requests of risk `low` (the request's `risk`, else the step's `max_risk`); a request without a risk is never auto-answered. A `human-input` step's own `timeout-minutes` is unchanged
- Changed the overseer answer policy to read the request's `kind` (`permission` is always asked) and its own `risk` before the step's `max_risk`
- Added `kind` and `risk` filters to notification triggers (`{ "event": "needs_input", "kind": "permission" }`) and the `kind`, `kind_label`, `risk` and `risk_suffix` template placeholders; the `needs_input` title names the kind, and a high-risk request is an `error` level notification
- Added the `af_wait` MCP tool and `GET /v1/runs/:id/wait`: waits until a run ends (`until: terminal`) or needs attention (`until: attention`: a `needs_input`, a failed step, a pause), for `timeout_seconds` (default 50, max 3600, looped in supervisor requests of at most 120 s), and returns compact JSON with the status, the last step's result block (summary cut to 1,000 characters, `result_path` for the rest), the open requests and a `cursor` to wait again without seeing an attention event twice
- Added `wait` and `timeout_seconds` to `af_dispatch` (dispatch, then the `af_wait` result as `wait`), and `af wait <run> [--until] [--timeout] [--cursor]` and `af run --wait [--until] [--timeout]` (alias `af dispatch`), which print the wait result as one JSON line and exit with the run's code (`124` when the timeout ran out)
- Added run trees: dispatch records `parent` in the registry entry; `af_dispatch` (and `af run`) inside a run's step default `parent` to the calling run (`AF_RUN_ID`, else `AF_OVERSEER_RUN`); `af_list_runs` and `af_status` return `parent` and `depth`, `af_list_runs tree` and `af list --tree` list a run and every run below it, `af_status` of a run returns its `tree`, and `af status` prints the run tree
- Added the run tree guards `overseer.budgets.max_dispatch_depth` (default 3), `max_tree_runs` (default 50) and `max_tree_active` (default 6): a dispatch past one is refused with a 409 `Dispatch refused: <reason>`
- Changed the scheduler so a child run is never held back by its running ancestors (they lend it their queue slot and checkout), and a child run inherits its parent's dispatch environment under its own
- Added the af MCP server to every Codex session the supervisor starts (thread config `mcp_servers.agentic-forge`, with the run and step, a 900 s tool timeout and its tools approved without asking), so a Codex agent can dispatch, wait for and ask through af runs
- Added overseer guidance on native subagents versus af runs and on waiting for a delegated run, and a delegation paragraph to the agentic system prompt

## 0.11.0

- **Breaking:** Raised the minimum Node.js version from 20 to 22; Node 20 reached end of life and pnpm 11 no longer runs on it
- Updated the CI test matrix to Node 22 and 24, and pinned the package manager to pnpm 11 via the `packageManager` field
- Removed the pinned default Codex model; `--model` is now omitted so Codex CLI applies its own default instead of a SKU that goes stale
- Fixed the orchestrator falling back to the hardcoded `sonnet` alias for every runtime; it now uses the adapter's own default model
- Fixed `settings.model` leaking into steps that override `runtime`, so a Codex step in a Claude workflow no longer inherits a Claude alias
- Fixed the legacy `defaults.model` fallback leaking into non-Claude runtimes; it now applies to the `claude` runtime only
- Fixed `--runtime` CLI overrides pulling `settings.model` into the overriding runtime; the model namespace now follows the workflow and config runtime
- Fixed `formatModelName` failing to match current model IDs by handling undated IDs and the fable and mythos families
- Updated docs and workflow-builder references for the Claude model aliases and the new Codex model behavior
- Fixed `pnpm install` failing with `ERR_PNPM_IGNORED_BUILDS` by declaring build approvals in `pnpm-workspace.yaml` and dropping the legacy `pnpm.onlyBuiltDependencies` field

## 0.10.2

- Fixed Codex writable output directories by granting both the working directory and workflow output directory as `--add-dir` roots, restoring writes when global outputs live outside the target repo
- Fixed orchestrator to propagate `workflowId` and `outputDir` to Codex runs so the output directory is correctly registered as a writable root

## 0.10.1

- Added `plan` variable to `plan-build-review` and `multi-plan-build-review` workflows; when set to a path, the existing plan is copied to the output directory instead of generating a new one
- Added `plan-loop` workflow that generates a checkbox-tracked plan from arbitrary input and drives a Ralph loop completing one task per iteration with Memory carryover and per-task commits
- Updated default Codex model from `gpt-5.4` to `gpt-5.5` across adapter, config, tests, and bundled workflows
- Updated Codex model lists in docs and workflow-builder references to reflect actually available models
- Updated `create-branch` step in `plan-build-review` and `multi-plan-build-review` to scope the agent to deriving a branch name only, preventing it from starting implementation work during the branch step
- Fixed Codex adapter to use `--sandbox workspace-write` instead of the deprecated `--full-auto` flag
- Fixed cumulative Codex agent output in BASE mode by finalizing each `agent_message` as its own turn, and switched non-TTY streams to plain incremental deltas instead of ANSI in-place rewrites

## 0.10.0

- **Breaking:** Removed `settings.git` from workflow settings (`enabled`, `worktree`, `auto-commit`, `auto-pr`, `branch-prefix` no longer recognized)
- **Breaking:** Removed `merge-mode: merge` from parallel steps; branches are always independent
- **Breaking:** Removed `step.git` from parallel step definitions; replaced with `step.worktree: true`
- **Breaking:** Removed `git.mainBranch`, `git.autoCommit`, `git.autoPr` config defaults
- Added `settings.worktree` schema with `enabled`, `location`, `directory`, and `cleanup` fields
- Added workflow-level worktree isolation (entire workflow runs in a single worktree when `worktree.enabled: true`)
- Added three worktree location modes: `sibling` (default, alongside repo), `nested` (inside repo), `absolute` (user-specified path)
- Added three cleanup policies: `on-success` (default, preserve on failure), `on-complete` (always remove), `manual` (always preserve)
- Added template-driven `worktree.enabled` supporting Nunjucks variables for per-run toggling
- Added `safetyCommit` to auto-save uncommitted changes before worktree removal, preventing data loss
- Added `getWorktreeOutputRoot` to force global output directory for worktree runs
- Added `findOutputDir` with worktree-aware output lookup for resume/status/cancel commands
- Added `worktree-settings.ts` shared helpers for resolving worktree template strings
- Added validation blocking parallel worktree inside workflow-level worktree (nested worktrees not supported)
- Added `on-failure` option to parallel steps: `fail` (default, fail workflow) or `warn` (log warning, continue workflow)
- Updated `plan-build-review` workflow with variable-driven worktree (`use_worktree` variable)
- Updated `analyze-codebase-merge` workflow to use `step.worktree: true` instead of `merge-mode: merge`
- Updated all bundled workflows to remove legacy git settings
- Fixed ralph-loop CWD to respect `cwdOverride` for worktree isolation
- Fixed `config.worktree` defaults (location, directory, cleanup) not being applied to workflow settings
- Fixed `af list` not finding worktree-backed runs when invoked from inside a worktree
- Fixed `pruneOrphaned` to scan both nested and sibling worktree directories by default
- Fixed `pruneOrphaned` missing workflow-level nested worktrees that lack the `agentic-` prefix
- Fixed worktree and output directory names diverging when using `--slug` with incremental suffixes
- Removed `update` CLI command; updates are now handled via `npm install -g agentic-forge@latest`

## 0.9.0

- Added multi-runtime support with `RuntimeAdapter` interface for pluggable coding agent backends
- Added `ClaudeAdapter` for Claude Code CLI with stream-JSON parsing
- Added `CodexAdapter` for Codex CLI with JSONL streaming
- Added `process-runner.ts` shared subprocess execution layer for all runtimes
- Added runtime resolution chain: step → CLI flag → workflow settings → config defaults → `"claude"`
- Added `codex-demo`, `multi-demo`, and `multi-plan-build-review` bundled workflows
- Renamed `demo` workflow to `claude-demo` for clarity
- Added `docs/coding-agents.md` guide covering supported runtimes and configuration
- Updated workflow YAML schema to support `runtime` field in settings and step level
- Updated authoring skill references to document multi-runtime options

## 0.8.0

- Added `paths.ts` central path resolver as single source of truth for all directory resolution
- Added `paths` CLI command to display resolved global, local, and bundled directory paths
- Added 3-layer config loading: built-in defaults → global config → local config
- Added `saveConfig()` with `--global`/`--local` scope support for targeted config writes
- Updated `init` command to default to global directory; added `--local` flag for project-local init
- Added `--config-only`, `--workflows-only`, and `--workflow <name>` flags to `init` command
- Added `--global`/`--local` scope flags to `config set` command
- Added `--slug` flag to `run` command for custom workflow run ID suffix
- Updated output directory to default to global (`%APPDATA%/agentic-forge/outputs/<project>/`) with local override via config
- Updated `status` command to show output directory source and resolved paths

## 0.7.1

- Added bare `key=value` argument support for passing workflow variables without the `--var` flag
- Added interactive prompts for missing required workflow variables when running in a TTY
- Added `--no-interactive` flag to disable interactive prompts in scripts and CI
- Updated `workflows --verbose` to show variable type, default value, and description per variable
- Added `authoring-dir` command to print path to interactive authoring skills (e.g., `workflow-builder`)
- Moved `workflow-builder` skill from workflow execution skills to dedicated authoring skills directory
- Updated usage examples in CLI help and `workflows` command output
- Fixed interactive prompt for variables with defaults and empty descriptions

## 0.7.0

- **Breaking:** Full rewrite from Python to TypeScript/Node.js
- **Breaking:** Renamed package from `agentic-sdlc` to `agentic-forge` (CLI command also renamed)
- **Breaking:** Removed Claude Code marketplace dependency; skills now loaded via `--add-dir`
- **Breaking:** Replaced Jinja2 templates with Nunjucks for template rendering
- **Breaking:** Distribution changed from PyPI (`uv tool install`) to npm (`npm i -g agentic-forge`)
- Ported all 14 CLI command handlers to TypeScript with Commander.js
- Ported workflow executor, orchestrator, and checkpoint manager to TypeScript
- Ported all step executors (prompt, serial, parallel, conditional, ralph-loop) with shared base class
- Ported runner module with Claude CLI subprocess management and stream-JSON parsing
- Ported progress tracking, signal management, and workflow logger
- Ported parallel step executor with git worktree management
- Added `skills-dir` command to print bundled skills path for `--add-dir` integration
- Skills, agents, and prompts bundled as npm package data
- Repository restructured: flat layout at root instead of `plugins/agentic-sdlc/`
- Added Biome for TypeScript/JSON linting and formatting
- Added markdownlint-cli2 for Markdown linting
- Added Vitest test suite
- CI updated from Python (pytest, uv) to Node.js (pnpm, vitest, biome)
- Fixed wait-for-human progress state and parallel concurrency cap
- Fixed 5 major correctness issues from code review

## 0.6.0

- Added `workflow-builder` skill for creating, updating, explaining, validating, and debugging workflows
- Added parallel branch display in terminal with multi-branch status updates (BASE mode)
- Added queue-based message streaming for parallel steps (ALL mode)
- Added stream-JSON parsing for real-time Claude output processing
- Added model name detection and display in step headers (e.g., `sonnet-4.5`)
- Added `strict-mode` setting for failing on undefined template variables
- Added config file copy during `init` command
- Added comprehensive test coverage for console, runner, init, parser, and step modules
- Rewrote console output module with `ParallelOutputHandler` for parallel execution display
- Increased default `max_iterations` from 5-10 to 25 across all workflows
- Changed `create_pr` default to `false` across all workflows
- Changed `bypass-permissions` default to `false` in ralph-loop workflow
- Set `terminal-output: base` as explicit default in plan-build-review and ralph-loop workflows
- Consolidated workflow documentation from `docs/` into `workflow-builder` skill references
- Fixed workflow resume losing state on re-run
- Fixed fix-issues step in plan-build-review reading wrong file for review output
- Fixed JSON template placeholders in fix-issues step replaced with proper syntax

## 0.5.0

- Converted all CLI commands to skills for consistency and reusability
- Added `create-skill` skill for generating new skills from templates
- Renamed `validate` command to `sdlc-review` skill
- Prefixed plan and review skills with `sdlc-` to avoid naming conflicts with Claude Code built-ins
- Added workflow-id argument support across skills
- Fixed step output and reference handling between workflow steps
- Fixed full skill name usage in workflows to avoid command conflicts

## 0.4.0

- Added `fix-analysis` skill for iteratively fixing issues from analysis documents
- Added `workflows` CLI command to list available workflows with descriptions
- Removed `/build`, `one-shot`, and `analyze` CLI commands in favor of workflow-based execution
- Refactored analyze workflows to use the new `fix-analysis` skill
- Removed experimental-plugins directory
- Fixed `git-pr` command to fetch and compare against remote base branch to avoid stale local branch issues

## 0.3.0

- Standardized US English spelling across all code, commands, and documentation (e.g., `analyse` to `analyze`)
- Renamed workflow files from `analyse-*.yaml` to `analyze-*.yaml` and `demo-workflow.yaml` to `demo.yaml`
- Removed interactive-sdlc plugin

## 0.2.0

- Added `version` command to display installed version
- Added `release-notes` command to display release notes from CHANGELOG.md
- Added `update` command for self-updating from local marketplace
- Added `add-improvement` command for tracking improvement suggestions
- Added workflow auto-discovery with search order: project-local, user-global, bundled
- Added `--list` flag for `run` command to list all available workflows
- Added demo workflow for showcasing capabilities
- Fixed `list` command to correctly find workflow progress files in `agentic/outputs/`
- Fixed workflow logging to capture agent messages in both base and terminal-output modes
- Fixed ralph-loop first iteration template evaluation
- Fixed plan output when used in workflow context
- Fixed plan-build-validate build step failures and ralph failure handling

## 0.1.0

- Initial release of agentic-sdlc
- YAML-based workflow orchestration with sequential, parallel, and Ralph loop step types
- Checkpoint manager for session state tracking
- Python CLI for workflow management (`run`, `init`)
- Core commands: plan, build, validate, analyze, orchestrate
- Git commands: git-branch, git-commit, git-pr
- Explorer and reviewer agents for specialized tasks
- Jinja2 templates for plans, reports, and analysis outputs
- Git worktree support for parallel step execution
- Console output module for workflow progress display
- Plugin discovery and download system with marketplace structure
- Claude GitHub Actions for CI
- NuGet vulnerability detection and security analysis commands
