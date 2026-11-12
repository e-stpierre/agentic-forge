# Repository Guidelines

## Project Overview

Agentic Forge is a TypeScript/Node.js package that provides YAML-based workflow orchestration for coding agents (Claude Code, Codex CLI, and others). It ships an engine, generic demo workflows and prompts, but no opinionated skills: workflows call the user's own skills (for example the esp-skills plugin) through `skill` steps.

## Purpose

The agentic-forge repository aims to:

1. **Share Best Practices**: Provide battle-tested automation patterns and workflows
2. **Accelerate Development**: Offer ready-to-use components that solve common problems
3. **Automate Development**: Offer reusable and flexible workflows that enable the automation of development tasks during the whole SDLC life-cycle

## Repository Structure

### `src/`

TypeScript source code for the CLI and workflow orchestration engine.

#### `authoring/.claude/skills/`

Interactive authoring skills for users to create and manage workflows (e.g., `workflow-builder`). Exposed via the `authoring-dir` CLI command. These are not used by the workflow engine.

#### `commands/`

CLI command implementations (`run`, `init`, `update`, `authoring-dir`, `workflows`, `doctor`, `mcp`, etc.). `run.ts` holds workflow discovery (`getWorkflowSearchLocations()`, `discoverWorkflow()`, `listAvailableWorkflows()`); `doctor.ts` holds `runDoctorChecks()` (commands through an injectable `Probe`).

#### `prompts/`

System prompt templates used by the workflow runner.

#### `runtimes/`

Runtime adapter layer for coding agent integrations:

- `types.ts` — `RuntimeId`, `RuntimeAdapter`, `RuntimeCommand`, `StreamEvent`, `RuntimeRunOptions`, `RuntimeResult`
- `claude.ts` — `ClaudeAdapter` (extracted from `runner.ts`; `createSession()` and `sessionOptions()` for the session driver)
- `session.ts` — `RuntimeSession` interface, normalized `SessionEvent` model, `SessionHost` (supervisor callbacks: `requestInput`, `nextMessages`, `onLive`, `onEvent` for transcripts on both drivers), `AsyncQueue`
- `claude-stream.ts` — Claude stream message to `SessionEvent` items, shared by the session driver and `ClaudeAdapter.parseTranscriptLine()` (`cli`); Codex maps its JSONL in `codexStreamEvents()`
- `claude-session.ts` — `ClaudeSession`, the Claude Agent SDK session driver (streaming input, `canUseTool` permission and `AskUserQuestion` requests); SDK pinned in `CLAUDE_AGENT_SDK_VERSION`
- `session-runner.ts` — `runSession()`: one step on a session (`runRuntime` delegates to it with `driver: session`)
- `codex.ts` — `CodexAdapter` (Codex CLI with JSONL streaming)
- `process-runner.ts` — `runRuntime()` shared process spawning (`options.signal` kills the process tree)
- `kill-tree.ts` — `killProcessTree()` (`taskkill /T /F` on Windows, process group on POSIX), `treeSpawnOptions()`
- `skill-inline.ts` — `resolveSkill()` (plugin and skill directory lookup) and `inlineSkillPrompt()` (`SKILL.md` with absolute paths and arguments) for runtimes without skill loading
- `utils.ts` — `getExecutable()`, `FileNotFoundError`, `getAgenticSystemPrompt()`
- `index.ts` — `getAdapter()`, `resolveRuntime()`, re-exports

#### `steps/`

Workflow step handlers (prompt, skill, human-input, parallel, serial, conditional, ralph-loop, wait-for-review, wait-for-checks, merge). `github-base.ts` holds the shared pieces of the GitHub steps (pull request reference, abortable polling with `Backoff`, the timeout `needs_input` request).

#### `github/`

`gh` access for the GitHub step types, called from the supervisor (no agent session):

- `gh.ts` — `runGh()` / `gh()` / `ghJson()` (async `execFile`; `AF_GH_CMD` replaces the executable, `ghRunner.run` is the test seam), `parsePaginated()`, `repoFromPrUrl()`
- `pr.ts` — `viewPr()`, `listReviews()`, `listIssueComments()`, `commentOnPr()`, `listChecks()`, `repoMergeSettings()`, `branchRules()`, `mergePr()` (`--repo`, never `--delete-branch`), `deleteRemoteBranch()`
- `reviews.ts` — `reviewOfHead()` (review on the head, Codex summary marker, later comment), `resolveReviewers()`, `DEFAULT_REVIEWERS`
- `merge-method.ts` — `mergePolicy()`, `resolveMergeMethod()` (same rules as esp-merge)
- `merge-lock.ts` — `gitCommonDir()`, `mergeLockPath()`, `acquireMergeLock()` (esp-merge `AF_MERGE_LOCK` format, heartbeat, stale takeover)

GitHub step tests (`tests/github-steps.test.ts`) use `tests/helpers/fake-gh.mjs`: in-process through `ghRunner.run`, or as a process through `AF_GH_CMD`.

#### `contract/`

Harness contract helpers: `validateArtifact()`, `validateContractFile()`, `exitCodeFor()`, `EXIT_CODES`. Loads the schemas from `schemas/contract-v1/`. `result.ts`: `parseResultBlock()` (result block on the last output line), `resultStatusFromExit()`, `exitCodeForRun()`, `ResultBlock`, `NeedsInput`. `plan.ts`: `latestPlan()` (`plan.md` / `plan.v<N>.md`).

#### `supervisor/`

The af supervisor (`af serve`) and its thin client:

- `server.ts` — `Supervisor` (HTTP on 127.0.0.1, per-user token, single instance, `route()` for new endpoints)
- `client.ts` — `SupervisorClient`, `findSupervisor()`, `ensureSupervisor()` (on-demand start, version handshake), `stopSupervisor()`, `spawnDetachedSupervisor()`
- `discovery.ts` — `supervisor.json` discovery file, `supervisor.pid`, `isPidAlive()`
- `lock.ts` — contract lock protocol (`<file>.lock`, exclusive create, 30 s stale timeout)

Tests that start a supervisor or write locks use `tests/helpers/temp-home.ts` (`useTempGlobalRoot()`, which sets `AGENTIC_FORGE_HOME` to a temp dir).

#### `runs/`

Runs owned by the supervisor:

- `manager.ts` — `RunManager` (dispatch, `/v1/runs` routes, scheduling, execution in the supervisor, crash recovery, run control: `send` (next and now), `pause`, `cancel`, `resume`, `answer`, `amend`, `retryStep`, `reprioritize`; result blocks to `steps/<NN-step>/result.json`; needs_input deadlines; live transcripts through the session host and `logs()` behind `GET /v1/runs/:id/logs`; session resume or restart in recovery, `run.recovered` `sessions`)
- `run-store.ts` — `RunStore` (one run directory: validated `run.json`, append-only `events.jsonl` under the contract lock)
- `registry.ts` — `RunRegistry` (`<global dir>/runs/index.json`), `filterRuns()` and `parseSince()` (the `af list` / `af_list_runs` filters)
- `events.ts` — event cursors across runs (`encodeCursor()`, `decodeCursor()`), type filters (`matchesTypes()`, `run.*` prefixes), `readEventPage()` behind `GET /v1/events` (long-poll in `RunManager.events()`)
- `artifacts.ts` — `listArtifacts()` by kind (`plan`, `summary`, `decisions`, `review`) for `af artifacts`
- `inbox.ts` — `Inbox` (contract `inbox/<timestamp>-<id>.json` messages), `formatOperatorMessages()` (the `## Operator Messages` section)
- `transcript.ts` — per-step live transcripts (`steps/<NN-step>/transcript.jsonl`, `TranscriptWriter`, `transcriptEntries()`, `readTranscriptPage()` with its own cursor and caps) and `session.json` (`readStepSession()`, read by crash recovery to resume a session); `stepDirName()`
- `scheduler.ts` — `pickRunnable()` (global and per-repo limits, one run per checkout)
- `dispatch.ts` — `DispatchPayload`, `filterEnv()` (client-resolved repo root, workflow, config snapshot and environment), `buildDispatchPayload()` (shared by `af run` and `af_dispatch`)
- `client.ts` — `dispatchRun()`, `followRun()` used by `af run`, `af resume`; `fetchEvents()`, `followEvents()` (cursor, long-poll, abort) used by `af events`; `fetchLogs()`, `followLogs()` used by `af logs` and `af_logs`

Session driver tests use `tests/helpers/fake-sdk.ts` (`fakeSdk`, mocks `@anthropic-ai/claude-agent-sdk`; never mock `runRuntime` there). Workflow tests that run through the supervisor use `tests/helpers/fake-runtime.ts` (`fakeRuntime`, a `runRuntime` replacement) with an in-process `Supervisor` and `RunManager`.

#### `notifications/`

Notifications sent by the supervisor (`RunManager.notifier`):

- `config.ts` — `getNotificationsConfig()` (the `notifications` section over its defaults), `parseTrigger()`, `matchesTrigger()`, `channelsFor()`
- `message.ts` — `buildNotification()` (default templates per event type, `notifications.templates` overrides, answer commands), `manualNotification()`, `renderTemplate()`
- `channels.ts` — `deliver()` to desktop, ntfy, Slack, Discord and GitHub through a `NotificationTransport` (`defaultTransport`; tests pass a mock), `desktopCommand()`
- `notifier.ts` — `Notifier` (tails the events of active runs, read positions in `<global dir>/notifications/positions.json`, `notification.sent`, `notify()` behind `POST /v1/notifications`)

Tests (`tests/notifications.test.ts`) build `RunManager` with `notifications: { transport, pollMs: 0 }` and call `manager.notifier.poll()`.

#### `mcp/`

The stdio MCP server behind `af mcp`, a thin client of the supervisor:

- `server.ts` — `createMcpServer()` (`McpServer` named `agentic-forge`; `getClient` injected, plus `registryRoot` and `cwd`)
- `tools.ts` — dispatch and read tools (`af_dispatch`, `af_status`, `af_list_runs`, `af_events`, `af_logs`, `af_artifacts`), zod input schemas, `register()` (handler errors become `isError` results)
- `tools-control.ts` — steering tools (`af_send`, `af_amend`, `af_answer`, `af_pause`, `af_resume`, `af_cancel`, `af_retry_step`) and `af_notify` over the `/v1/runs/:id/*` control endpoints
- `errors.ts` — `jsonResult()`, `toolError()` (hints for 400, 404, 409 and an unreachable supervisor), `ClientCache`, `withClient()` (one retry of the read tools when the supervisor is unreachable; write tools get a hint to check af_status before calling again)
- `commands/mcp.ts` — `cmdMcp()` (console output to stderr, supervisor started on demand at the first tool call, `StdioServerTransport`)

MCP tests (`tests/mcp-server.test.ts`) connect an SDK `Client` to `createMcpServer()` through `InMemoryTransport.createLinkedPair()`, with an in-process `Supervisor` and `RunManager` and `fakeRuntime`. `tests/mcp-stdio.test.ts` runs the built `dist/cli.js mcp` over real stdio (skipped without a build).

#### `workflows/`

Bundled generic demo workflows (7 workflows: `claude-demo`, `codex-demo`, `multi-demo`, `ralph-loop`, `plan-loop`, `permission-test-claude`, `permission-test-codex`). They use only generic steps (no skill calls); `tests/bundled-workflows.test.ts` checks it.

### `schemas/`

Versioned harness contract JSON Schemas and fixtures (`schemas/contract-v1/`), shipped in the npm package. agentic-forge owns the contract: every change follows the versioning rules in `docs/harness-contract.md` and is listed in the CHANGELOG as a contract delta.

### `tests/`

Vitest test suite for all TypeScript source code.

### `src/paths.ts`

Central path resolver module. Single source of truth for all directory resolution:

- `getGlobalRoot()` — platform-native global directory (`%APPDATA%`, `~/Library/Application Support`, `$XDG_CONFIG_HOME`)
- `getOutputRoot(config, cwd)` — resolves output base dir (global default, local override)
- `getOutputDir(workflowId, config, cwd)` — full output path for a workflow run
- `getWorkflowDirs(bundledDir, cwd, packDirs)` — ordered workflow search path (project-local > user-global > skill packs > bundled)
- `getConfigPaths()` — global and local config file paths
- `ensureGlobalDir()` — lazy-initializes global directory on first use
- `sanitizeSlug(input)` — cleans user-provided slugs for safe directory names
- `getClaudeConfigDir()` — Claude Code config directory (`CLAUDE_CONFIG_DIR`, else `~/.claude`), used by skill pack detection and `af doctor`

### `docs/`

User-facing documentation, linked from the README via GitHub `blob/main/` URLs. Not included in the npm package.

- `getting-started.md` — Installation, quick tour, init, and first workflow creation
- `cli.md` — Complete CLI reference with all commands, arguments, and options
- `workflows.md` — Bundled workflows with use cases, variables, and examples
- `coding-agents.md` — Supported runtimes, per-step configuration, and model names
- `configuration.md` — All configuration options, defaults, and layering behavior
- `harness-contract.md` — Harness contract v1 specification (owned by agentic-forge): run directory layout, artifacts, exit codes, compliance levels, versioning rules

### `agentic/`

Optional project-local directory for workflow configuration and outputs. Created by `agentic-forge init --local`. When `outputDirectory` is set to `"global"` (the default), outputs go to the global directory instead.

## Development Guidelines

### Language Style

Use US English spelling in all code, comments, documentation, and UI strings when a word has both UK and US variants (e.g., "analyze" not "analyse", "color" not "colour", "canceled" not "cancelled").

### Naming Conventions

- **Skills**: Directory name in kebab-case with `SKILL.md` inside (e.g., `workflow-builder/SKILL.md`)
- **Workflows**: Descriptive kebab-case YAML files (e.g., `claude-demo.yaml`)

### Documentation Guidelines

- **Character encoding**: Code files must use ASCII only. Documentation and markdown files (skills, agents, READMEs) may use minimal emojis where they add clarity (e.g., checkmarks, robot emoji for Claude attribution). Avoid decorative emoji use.
- **Workflow diagrams**: Use arrow notation (`->`) for workflow documentation instead of long multi-line ASCII boxes. Example: `Plan -> Implement -> Review -> Output` is preferred over complex box diagrams

### File Formats

- **Authoring skills**: `SKILL.md` files in skill directories: `src/authoring/.claude/skills/<skill-name>/SKILL.md`
- **Workflows**: YAML files in `src/workflows/`
- **TypeScript Source**: TypeScript modules in `src/` with root `package.json`

**Placeholder Convention:**

Prompt templates use **Mustache/Handlebars-style placeholders** with the following format:

```markdown
## {{section_title}}

{{content}}

<!--
Instructions:
- Replace {{content}} with the actual content
- Additional guidance for this section
- Suggested elements (include others as needed):
  - Element 1
  - Element 2
-->
```

**Key principles:**

- Use `{{variable_name}}` for all placeholders (not `<placeholder>` or other formats)
- Include HTML comments with instructions below each section
- Mark suggested elements as "include others as needed" to allow flexibility
- Required sections must be present; optional sections can be omitted
- Section names must match the template exactly (case-sensitive)

### Code Style and Formatting

CI validates format, lint, and tests on all pull requests. Run locally before opening a pull request:

```bash
pnpm check          # Format and lint (biome)
pnpm test           # Vitest tests
```

## Technical Considerations

### Path Resolution

All directory resolution flows through `src/paths.ts`. The system uses a 3-tier model:

- **Config**: built-in defaults -> global (`getGlobalRoot()/config.json`) -> local (`agentic/config.json`)
- **Workflows**: project-local (`agentic/workflows/`) -> user-global (`getGlobalRoot()/workflows/`) -> skill packs (`<plugin>/af-workflows/`, from `src/skill-packs.ts`: config `skill_packs.paths`, then Claude Code's `installed_plugins.json` when `skill_packs.auto_detect`) -> bundled
- **Requires**: `src/requires.ts` parses a workflow's `requires` (agentic-forge version range, contract version) and `checkRequires()` runs in `RunManager.dispatch()`; `ignore_requires` in the dispatch payload overrides only the version
- **Outputs**: global by default (`getGlobalRoot()/outputs/<project-slug>/`), or local (`agentic/outputs/`) when `outputDirectory: "local"`

The global directory is lazy-initialized by `ensureGlobalDir()` on first use. No `init` is required to run workflows.

Worktrees always use local output (`outputDirectory: "local"`) since they are ephemeral.

### Runtime Adapter Pattern

The workflow engine delegates all coding agent interactions to runtime adapters in `src/runtimes/`. Each adapter implements the `RuntimeAdapter` interface:

- `buildCommand(options)` — constructs the CLI command and stdin input
- `parseStreamLine(line)` — parses streaming output into normalized `StreamEvent` objects
- `buildFinalResult()` — assembles the `RuntimeResult` from process output

Runtime resolution order: `step.runtime` > `--runtime` CLI flag > `workflow settings.runtime` > `config.defaults.runtime` > `"claude"`.

**Skill steps load natively only on the `claude` runtime.** agentic-forge bundles no execution skills: a `skill` step calls a skill the user installed (a Claude Code plugin or a `.claude/skills/` directory). On any other runtime (Codex) the step finds the skill on disk and sends its `SKILL.md` inline (`src/runtimes/skill-inline.ts`: `resolveSkill()`, `inlineSkillPrompt()`; `NATIVE_SKILL_RUNTIMES` in `src/steps/skill-step.ts`). The prompt step `agent:` file resolves relative to the workflow file, then the repo root.

To add a new runtime: create an adapter in `src/runtimes/`, register it in `src/runtimes/index.ts`, and add the `RuntimeId` to the union type in `src/runtimes/types.ts`.

### Workflow Engine Changes

When modifying the workflow engine in `src/`, you must update the workflow-builder skill reference files to keep them in sync:

- `src/authoring/.claude/skills/workflow-builder/references/REFERENCE.md` - Complete schema reference
- `src/authoring/.claude/skills/workflow-builder/references/workflow-example.yaml` - Annotated reference workflow

Changes to workflow settings, step types, or features require updates to both files.

### Documentation Updates

When modifying CLI commands, configuration options, workflow variables, or user-facing behavior, update the corresponding documentation in `docs/`:

- CLI changes (new commands, arguments, options) -> `docs/cli.md`
- Workflow changes (new workflows, variable changes) -> `docs/workflows.md`
- Configuration changes (new keys, default changes) -> `docs/configuration.md`
- Setup or init flow changes -> `docs/getting-started.md`

### Node.js Development

- **Always use `pnpm` for package management**: This repository uses pnpm for all Node.js operations
- **Building**: Use `pnpm build` (runs `tsc` + asset copy script)
- **Testing**: Use `pnpm test` (runs Vitest)
- **Linting**: Use `pnpm check` (runs Biome)
- **Development**: Use `pnpm dev` for TypeScript watch mode
