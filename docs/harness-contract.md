# Harness Contract v1

The harness contract is a versioned specification that lets a harness supervise, steer and recap the skills and workflows it runs. agentic-forge owns, versions and publishes it. Skill packs (esp-skills or any other) implement it, and can do so from this document and the JSON Schemas alone, without reading agentic-forge code.

A skill that ignores the contract still runs: it is a [Plain](#compliance-levels) step that reports only its exit code. Each compliance level adds files the skill writes and gives the harness more to work with.

## Contents

- [Versioning](#versioning)
- [Compliance Levels](#compliance-levels)
- [Skill Metadata](#skill-metadata)
- [Invocation](#invocation)
- [Runs Root](#runs-root)
- [Run Directory Layout](#run-directory-layout)
- [Artifacts](#artifacts)
- [run.json](#runjson)
- [Result Block](#result-block)
- [needs_input Protocol](#needs_input-protocol)
- [Inbox Messages](#inbox-messages)
- [Amendments and Plan Versions](#amendments-and-plan-versions)
- [events.jsonl](#eventsjsonl)
- [decisions.jsonl](#decisionsjsonl)
- [summary.md](#summarymd)
- [Exit Codes](#exit-codes)
- [Append Protocol](#append-protocol)
- [Extension Fields](#extension-fields)
- [Using the Schemas](#using-the-schemas)

## Versioning

The contract has one integer version, `contract_version`. This document describes version `1`. Every `run.json` carries it, and a result block may carry it.

A change **requires a `contract_version` bump** when an implementation of the previous version could break or be misread:

- Removing or renaming a field, a file, a directory, an event type or an enum value
- Making an optional field required, or adding a required field
- Changing the meaning, type or format of an existing field, or narrowing the values it accepts
- Changing an exit code, the run directory naming rule, the append protocol, or what a compliance level requires
- Changing how the harness passes `--run-dir` and `--config-snapshot`, or how it injects messages

A change **does not require a bump** when every valid v1 artifact stays valid and keeps its meaning:

- Adding an optional field, a new optional file, or an enum value to a field that readers are told to tolerate (event `type`, `discovered_items[].type`)
- Loosening a constraint (for example a longer `maxLength`)
- Fixing descriptions, titles, examples, fixtures or this document

Readers must ignore event types they do not know. Writers must only write values that the schema of the version they declare accepts.

Non-bumping changes are released in an agentic-forge minor version and listed in the CHANGELOG as contract deltas. A bump ships new schemas under `schemas/contract-v<N>/`, and agentic-forge keeps reading the previous version for at least one minor release. Workflows declare the version they need with `requires: { contract: 1 }`.

## Compliance Levels

Each level includes the requirements of the levels above it.

| Level      | The skill must                                                                                                                                                                                                                                                      | The harness gains                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Plain      | Nothing                                                                                                                                                                                                                                                             | Runs it as a step; success is the exit code only |
| Reporting  | Print and write the [result block](#result-block); keep `run.json` fields up to date when it owns the run; exit with the [contract exit codes](#exit-codes)                                                                                                         | Status, outputs, chaining of steps               |
| Steerable  | Read injected `## Operator Messages` sections and pending [inbox messages](#inbox-messages) at its boundaries; read the latest [plan version](#amendments-and-plan-versions); emit [`needs_input`](#needs_input-protocol) instead of guessing on blocking decisions | Mid-run corrections, amendments, human input     |
| Recappable | Append to [`decisions.jsonl`](#decisionsjsonl) when each decision is made; write [`summary.md`](#summarymd) with valid frontmatter when it owns the run                                                                                                             | Recaps, risk reports, Q&A over past runs         |

A skill that claims a level must meet it in every run, not only when a harness is present.

## Skill Metadata

Skills declare the contract version and level they implement in their `SKILL.md` frontmatter, under `metadata`:

```yaml
---
name: my-skill
description: ...
metadata:
  af-contract: 1
  af-level: recappable
---
```

| Key           | Type    | Values                                          | Meaning                                  |
| ------------- | ------- | ----------------------------------------------- | ---------------------------------------- |
| `af-contract` | integer | `1`                                             | Contract version the skill implements    |
| `af-level`    | string  | `plain`, `reporting`, `steerable`, `recappable` | Highest compliance level the skill meets |

A skill without these keys is treated as `plain`. A harness may refuse to use a skill whose `af-contract` it does not support for a step that needs more than `plain`.

## Invocation

The harness passes two options to every step it runs, in the step prompt or as skill arguments:

| Option                     | Value                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `--run-dir <path>`         | Absolute path of the run directory the step writes into. It already contains `run.json` |
| `--config-snapshot <path>` | Absolute path of a JSON file with the skill pack configuration resolved for this run    |

When the harness passes `--run-dir`, the harness owns `run.json`: the step may update fields it learns (`branch`, `pr`, `max_risk`) but never changes `status`. A step reports its outcome through its result block and exit code, and the harness sets the run status from them.

When a skill runs **standalone** (no harness), the top-level skill creates the run directory itself under its own runs root and owns `run.json`. It passes `--run-dir` to the skills it calls, which then behave exactly as under a harness. Skills never assume which of the two situations they are in.

The config snapshot format belongs to the skill pack. The contract only guarantees that it is a JSON file and that its values win over the user and project config files of the skill pack.

## Runs Root

A runs root is a directory that holds run directories. Every product that creates runs has its own default root, and they are **separate by default**:

| Producer                 | Default runs root                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agentic-forge (harness)  | `<global dir>/runs/`, where `<global dir>` is `%APPDATA%\agentic-forge` on Windows, `~/Library/Application Support/agentic-forge` on macOS and `$XDG_CONFIG_HOME/agentic-forge` (default `~/.config/agentic-forge`) on Linux |
| A skill pack, standalone | Chosen by the skill pack. esp-skills uses `~/.esp-skills/runs/`                                                                                                                                                              |

Every root follows the same layout, so a recap tool reads any number of roots the same way. A recap tool takes a list of roots from its own configuration (esp-skills: `recap.roots`), and users add the agentic-forge root to it. This keeps skill packs free of harness paths and lets the harness stay skill-pack agnostic. The roots never need to be merged: run IDs are unique within a root, and a recap reports which root each run came from.

## Run Directory Layout

```text
<runs-root>/
  2026-11-10-oauth-epic/              # overseer run (type: overseer)
    run.json
    events.jsonl
    inbox/
      20261110T120000000Z-m001.json
    backlog.json                      # harness-owned, not part of v1 schemas
    overseer-summary.md               # harness-owned, not part of v1 schemas
    tasks/
      T01-add-oauth-provider/         # child workflow run (type: workflow)
        run.json
        events.jsonl
        inbox/
        plan.md                       # plan version 1
        plan.v2.md                    # plan version 2, after an amendment
        amendments.jsonl
        decisions.jsonl
        state.json                    # owner-private resume state
        review-1.md
        summary.md
        steps/
          01-plan/
            result.json
          02-build-M1/
            result.json
  2026-11-11-fix-login-timeout/       # top-level workflow or standalone skill run
    run.json
    ...
```

Rules:

- A top-level run directory is named `YYYY-MM-DD-<slug>`, using the local date the run was created. The date prefix lets tools filter by date without opening any file. When the name is taken, the creator appends `-2`, `-3`, and so on.
- A child run lives under its parent's `tasks/` directory, is named `<task-id>-<slug>`, and inherits the date of its parent for filtering.
- `run.json` `id` equals the directory name, and a child's `parent` is the parent's `id`.
- `<slug>` uses lowercase letters, digits and dashes. Every directory name is a valid ID (see [Artifacts](#artifacts)).
- Step directories are named `NN-<step>` with a two-digit, one-based sequence number (`01-plan`, `02-build-M1`). A retried step reuses its directory.
- Files the contract does not define (`state.json`, `review-<n>.md`, logs and transcripts under `steps/`) are private to their writer. Readers must not depend on them.
- Plans, summaries and other run files are never committed to the repository the run works on.

## Artifacts

Every artifact has a JSON Schema in `schemas/contract-v1/`, plus valid and invalid fixtures in `schemas/contract-v1/fixtures/<artifact>/{valid,invalid}/`.

| Artifact            | Schema                            | Location in a run directory              | Minimum level |
| ------------------- | --------------------------------- | ---------------------------------------- | ------------- |
| Run metadata        | `run.schema.json`                 | `run.json`                               | Reporting     |
| Step result block   | `result.schema.json`              | `steps/<NN-step>/result.json` and stdout | Reporting     |
| Decision request    | `needs-input.schema.json`         | `needs_input` field of a result block    | Steerable     |
| Operator message    | `inbox-message.schema.json`       | `inbox/<timestamp>-<id>.json`            | Steerable     |
| Amendment           | `amendment.schema.json`           | one line of `amendments.jsonl`           | Steerable     |
| Event envelope      | `event.schema.json`               | one line of `events.jsonl`               | Reporting     |
| Decision            | `decision.schema.json`            | one line of `decisions.jsonl`            | Recappable    |
| Summary frontmatter | `summary-frontmatter.schema.json` | YAML frontmatter of `summary.md`         | Recappable    |
| Shared definitions  | `common.schema.json`              | none, referenced by the other schemas    | -             |

Shared value types (`common.schema.json`):

| Type          | Rule                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| ID            | `^[A-Za-z0-9][A-Za-z0-9._-]*$`, at most 200 characters                                                       |
| Timestamp     | RFC 3339 date-time; UTC (`Z`) recommended                                                                    |
| Risk          | `low`, `medium`, `high`                                                                                      |
| Commit        | Lowercase hex SHA, 7 to 64 characters, or `null`                                                             |
| Run status    | `queued`, `running`, `paused`, `blocked`, `awaiting-human`, `halted`, `failed`, `canceled`, `done`, `merged` |
| Result status | `done`, `merged`, `halted`, `awaiting-human`, `failed`, `escalate`                                           |

## run.json

Metadata and status of one run. Required: `contract_version`, `id`, `type`, `status`, `started_at`. Nullable fields are written as `null` when unknown.

| Field              | Type              | Description                                                                            |
| ------------------ | ----------------- | -------------------------------------------------------------------------------------- |
| `contract_version` | `1`               | Contract version of the run directory                                                  |
| `id`               | ID                | Equal to the directory name                                                            |
| `type`             | enum              | `overseer`, `workflow` or `skill`                                                      |
| `title`            | string or null    | Short human-readable title                                                             |
| `workflow`         | string or null    | Workflow or skill that owns the run                                                    |
| `parent`           | string or null    | Parent run ID, `null` for a top-level run                                              |
| `repo`             | string or null    | `owner/name` when known, otherwise a local path                                        |
| `base`             | string or null    | Base branch                                                                            |
| `branch`           | string or null    | Working branch                                                                         |
| `worktree`         | string or null    | Absolute worktree path, `null` when working in place                                   |
| `pr`               | string or null    | Pull request URL                                                                       |
| `status`           | run status        | Current status                                                                         |
| `max_risk`         | risk or null      | Highest risk recorded by any decision or result. It only ever rises                    |
| `started_at`       | timestamp         | Creation time                                                                          |
| `updated_at`       | timestamp         | Last write                                                                             |
| `ended_at`         | timestamp or null | Set when `status` becomes terminal: `halted`, `failed`, `canceled`, `done`, `merged`   |
| `runtime`          | string or null    | Runtime that executes the run, for example `claude` or `codex`                         |
| `models`           | object            | Model per role: `{ "<role>": { "model": "...", "effort": "..." } }`, `effort` optional |
| `budgets_used`     | object            | Budget consumption by name: `{ "<name>": <number >= 0> }`                              |

`paused`, `blocked` and `awaiting-human` are not terminal: a run in those statuses can resume.

## Result Block

Every Reporting step ends its output with one result block: a JSON object printed on a **single line**, as the **last line** of the step output. It also writes the same object to `steps/<NN-step>/result.json` when it has a run directory. When the two differ, the file wins.

Required: `status`, `summary`.

| Field              | Type           | Description                                                                      |
| ------------------ | -------------- | -------------------------------------------------------------------------------- |
| `contract_version` | `1`            | Optional                                                                         |
| `status`           | result status  | Outcome of the step, mapped to an [exit code](#exit-codes)                       |
| `summary`          | string         | One or two sentences                                                             |
| `files_changed`    | string[]       | Paths relative to the repository root                                            |
| `commit`           | commit         | Last commit the step created                                                     |
| `pr`               | string or null | Pull request URL                                                                 |
| `gates`            | object         | Gate outcome by name: `{ "tests": "pass", "lint": "fail", "build": "skipped" }`  |
| `max_risk`         | risk or null   | Highest risk of the decisions the step made                                      |
| `outputs`          | object         | Step-specific values later steps can consume, for example `plan_path`            |
| `discovered_items` | object[]       | Work found but not done: `{ type, title, evidence?, severity?, files? }`         |
| `needs_input`      | object or null | A [decision request](#needs_input-protocol). Non-null only with `awaiting-human` |
| `blockers`         | string[]       | Reasons the step could not finish                                                |

Status meanings:

| Status           | Meaning                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `done`           | The step did its job                                                                                     |
| `merged`         | The step merged a pull request                                                                           |
| `awaiting-human` | The step needs an answer (`needs_input`) or a human action (for example an unmet branch protection rule) |
| `halted`         | The step stopped on purpose: a stop policy, budget or safety rule triggered                              |
| `escalate`       | The step cannot decide within its policy and hands the decision to the overseer or user                  |
| `failed`         | The step hit an error it could not recover from                                                          |

`discovered_items[].type` is one of `bug`, `debt`, `security`, `docs`, `test`, `follow-up`, `other`. `severity` is one of `low`, `medium`, `high`, `critical`.

The harness never trusts a self-reported `gates` value for a merge decision on its own: gates that matter are re-verified independently.

## needs_input Protocol

A step that needs a decision it may not take alone ends with `status: awaiting-human` and a `needs_input` object, then exits with code `10`.

| Field         | Type           | Description                                                                                                     |
| ------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`          | ID             | Unique within the run                                                                                           |
| `question`    | string         | The question                                                                                                    |
| `options`     | object[]       | `{ id, label, description? }`. Empty for a free-form answer                                                     |
| `recommended` | string or null | ID of the recommended option                                                                                    |
| `context`     | string         | Evidence and trade-offs the answerer needs, with paths to run artifacts                                         |
| `blocking`    | boolean        | `false` lets the harness continue other work and apply `recommended` after the configured `needs_input_timeout` |

Flow:

1. The harness reads the result block and emits a `needs_input` event with the request in `data`.
2. The overseer answers within its policy, or forwards the question to the user.
3. The answer is recorded as an `input.answered` event and as an `operator` decision, then the harness resumes or reruns the step with the answer injected as an operator message.

A non-blocking request with no `recommended` option is treated as blocking.

## Inbox Messages

Operator messages are queued as one JSON file each: `inbox/<YYYYMMDDTHHMMSSmmmZ>-<id>.json`, where the timestamp is the UTC queue time. Sorting the file names gives the queue order.

Required: `id`, `at`, `from`, `mode`, `text`, `target`.

| Field          | Type              | Description                                                             |
| -------------- | ----------------- | ----------------------------------------------------------------------- |
| `id`           | ID                | Unique within the run                                                   |
| `at`           | timestamp         | Queue time                                                              |
| `from`         | enum              | `user` or `overseer`                                                    |
| `mode`         | enum              | `next`: deliver at the next boundary. `now`: interrupt the current step |
| `text`         | string            | The message                                                             |
| `target`       | enum              | `run`: the next step of the run. `step`: the step named in `step`       |
| `step`         | string or null    | Step name. Required and non-empty when `target` is `step`               |
| `delivered_at` | timestamp or null | Absent or `null` while pending, set on delivery                         |

Delivery:

- A message is pending until `delivered_at` is set. The file stays in `inbox/` after delivery.
- Under a harness, the harness injects pending messages by prepending this section to the next step or iteration prompt, then sets `delivered_at`, emits `message.delivered`, and logs an `operator` decision:

  ```md
  ## Operator Messages

  - [user, 2026-11-10T12:00:00Z, m001] Use the existing token cache instead of adding a new one.
  ```

- A Steerable skill treats an injected `## Operator Messages` section and its own pending inbox messages the same way, at its own boundaries (between milestones, before a commit, before opening a pull request). Running standalone, it marks the messages it applied as delivered in the same way.
- `mode: now`: the harness interrupts the running step, then resumes or restarts it with the message injected. A skill needs no extra support for it.

## Amendments and Plan Versions

An amendment changes the requirements of the remaining work. `amendments.jsonl` holds one entry per line.

Required: `id`, `at`, `text`, `affects`, `plan_version`.

| Field          | Type            | Description                                                                                                       |
| -------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`           | ID              | `A001`, `A002`, ...                                                                                               |
| `at`           | timestamp       | When it was applied                                                                                               |
| `from`         | enum            | `user`, `overseer` or `agent` (optional)                                                                          |
| `text`         | string          | The requirement change                                                                                            |
| `affects`      | string[]        | IDs of the milestones it changes. Completed milestones are never changed                                          |
| `plan_version` | integer or null | Version of the plan produced by the amendment, at least `2`. `null` when no plan version was produced (see below) |

Plan versions are immutable files: `plan.md` is version 1, `plan.v2.md` is version 2, and so on. The amending step writes `plan.v<N>.md` first, then appends the amendment, emits `amendment.applied` and logs an `operator` decision that references the amendment and the affected milestones. Every later step reads the highest plan version present.

A workflow without an amend step still records the amendment, with `plan_version: null`: the harness appends it, logs the `operator` decision, emits `amendment.applied`, and delivers the text as an operator message prefixed `Amendment:` at the next boundary.

## events.jsonl

An append-only log, one event per line. Required: `seq`, `at`, `run`, `type`; `data` is optional and holds the event payload. The envelope accepts no other fields.

- `seq` equals the physical line number, starting at `1`, with no gaps. The file has no blank lines, except the final newline.
- `run` is the ID of the run the event belongs to.
- Readers must ignore event types they do not know.

| Group      | Types                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Run        | `run.queued`, `run.started`, `run.paused`, `run.resumed`, `run.canceled`, `run.halted`, `run.failed`, `run.completed`     |
| Step       | `step.started`, `step.completed`, `step.failed`, `step.retried`, `iteration.started`, `iteration.completed`               |
| Steering   | `message.queued`, `message.delivered`, `amendment.applied`, `needs_input`, `input.answered`                               |
| Git/GitHub | `branch.created`, `commit.created`, `pr.opened`, `review.received`, `checks.completed`, `merge.locked`, `merge.completed` |
| Harness    | `notification.sent`, `supervisor.restarted`, `run.recovered`                                                              |

`run.completed` covers both `done` and `merged`; `run.json` holds which.

## decisions.jsonl

An append-only log of decisions, one per line, appended when the decision is made, never reconstructed afterward.

Required: `id`, `at`, `phase`, `source`, `risk`, `decision`, `rationale`.

| Field          | Type      | Description                                                                                              |
| -------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `id`           | ID        | `D001`, `D002`, ...                                                                                      |
| `at`           | timestamp | When the decision was made                                                                               |
| `phase`        | string    | Phase or step that made it: `plan`, `build`, `review`, `fix-review`, `merge`, ...                        |
| `source`       | enum      | `agent` (chosen by the model), `operator` (a message, answer or amendment), `policy` (a configured rule) |
| `risk`         | risk      | Risk of the decision; raises `run.json` `max_risk`                                                       |
| `decision`     | string    | What was decided                                                                                         |
| `rationale`    | string    | Why                                                                                                      |
| `alternatives` | string[]  | Options considered and rejected                                                                          |
| `files`        | string[]  | Files the decision touches                                                                               |
| `commit`       | commit    | Commit that implements it                                                                                |
| `refs`         | string[]  | Milestone IDs, review comment URLs, message or amendment IDs                                             |

Every delivered message, answered `needs_input` and applied amendment is logged as an `operator` decision.

## summary.md

The run owner writes `summary.md` when the run ends. It is markdown with YAML frontmatter. Frontmatter values are flat scalars (strings, numbers, booleans, null) so simple parsers can read them.

Required: `task`, `title`, `status`.

| Field               | Type                     | Description                            |
| ------------------- | ------------------------ | -------------------------------------- |
| `task`              | ID                       | ID of the run the summary describes    |
| `title`             | string                   | Title of the work                      |
| `workflow`          | string or null           | Workflow or skill that ran             |
| `status`            | run status or `escalate` | Final status                           |
| `pr`                | string or null           | Pull request URL                       |
| `max_risk`          | risk or null             | Highest recorded risk                  |
| `decisions`         | integer                  | Number of entries in `decisions.jsonl` |
| `critical_findings` | integer                  | Number of critical findings            |
| `duration_minutes`  | number or null           | Wall time of the run                   |

The body uses these sections, in this order, and omits a section that has nothing to report: Outcome, Decisions, Surprises, Critical Findings, Review Comment Resolution, Operator Messages and Amendments, Deviations from Plan, Follow-ups Created, Metrics.

## Exit Codes

A step's process exit code follows its result status:

| Code | Status                     |
| ---- | -------------------------- |
| `0`  | `done` or `merged`         |
| `10` | `awaiting-human`           |
| `20` | `halted`                   |
| `30` | `escalate`                 |
| `1`  | `failed`, or any other end |

Plain skills only use `0` and `1`. A harness that runs a step through a coding agent CLI, whose exit code it does not control, derives the code from the result block on the last output line instead; with no valid result block, a zero exit is `done` and anything else is `failed`.

## Append Protocol

Several processes may write to the same run (the harness, a step, a background helper). Every writer of `events.jsonl`, `decisions.jsonl`, `amendments.jsonl` and `run.json` follows this protocol:

1. Take the lock `<file>.lock` next to the target, created with exclusive create. A lock older than 30 seconds is stale and may be removed.
2. Under the lock, read the current content, build the entry (next `seq` or next ID), validate it, then append exactly one complete line (or rewrite `run.json`).
3. Remove the lock.

Inbox messages need no lock: each message is its own file, and only `delivered_at` is updated afterward, by the deliverer.

## Extension Fields

Unknown fields are invalid, with one exception: fields whose name starts with `x-` are allowed on every artifact except the event envelope, for producer-specific data (for example `x-esp-class` on a decision). Readers must ignore extension fields they do not know. Event-specific data goes in the event's `data` object.

## Using the Schemas

The schemas and fixtures ship in the `agentic-forge` npm package under `schemas/contract-v1/`. Each schema's `$id` is a URN (`urn:harness-contract:v1:<artifact>`), and schemas reference each other by URN, so the files work unchanged when copied into another repository. Load every `*.schema.json` file of the directory into a JSON Schema draft 2020-12 validator, then validate by `$id`:

```js
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const require = createRequire(import.meta.url);
const dir = join(
  dirname(require.resolve("agentic-forge/package.json")),
  "schemas",
  "contract-v1"
);
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(readFileSync(join(dir, file), "utf8")));
}
const validateResult = ajv.getSchema("urn:harness-contract:v1:result");
```

Inside agentic-forge, `src/contract/` wraps this: `validateArtifact(artifact, value)`, `validateContractFile(path)` (infers the artifact from the file name, checks jsonl files line by line and event `seq` continuity, reads `summary.md` frontmatter), `exitCodeFor(status)` and `EXIT_CODES`.

Implementers should run the fixtures as contract tests: every file in `fixtures/<artifact>/valid/` must pass and every file in `fixtures/<artifact>/invalid/` must fail.

## References

- [Configuration](configuration.md): agentic-forge global directory and config layering
- [Workflows](workflows.md): bundled workflows
- `schemas/contract-v1/`: JSON Schemas and fixtures
