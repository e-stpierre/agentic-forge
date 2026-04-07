# Worktree Improvements Plan

## Overview

Redesign git worktree management in agentic-forge to support workflow-level isolation, configurable worktree locations, proper cleanup lifecycle, and correct `agentic/` directory resolution. Remove unused git settings that were parsed but never consumed.

### Guiding Principle

1 worktree = 1 branch = 1 task

## Current State Summary

| Aspect                 | Current Behavior                                                    | Problem                                                                |
| ---------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Worktree location      | Hardcoded `.worktrees/` inside repo root (`worktree.ts:105`)        | Not configurable, can cause long-path issues on Windows                |
| Workflow-level git     | `settings.git` parsed but never consumed by any executor            | Dead config that misleads users                                        |
| `branchPrefix`         | Parsed in types/parser but hardcoded `agentic/` in `createWorktree` | Config has no effect                                                   |
| Ralph-loop cwd         | Always uses `context.repoRoot` (`ralph-loop-step.ts:119`)           | Ignores `cwdOverride`, breaks worktree isolation                       |
| Worktree scope         | Only parallel steps support worktrees                               | No workflow-level isolation                                            |
| Cleanup                | Always immediate, even on failure                                   | Loses working state for debugging                                      |
| `merge-mode: merge`    | Merges branches then deletes worktrees                              | Conflict handling is fragile, worktrees deleted before merge completes |
| `agentic/` in worktree | Not handled                                                         | Local `agentic/` would be duplicated inside each worktree              |

## Changes

### Phase 1. Remove Dead Git Config

Remove all unused git settings from workflow settings, config defaults, types, parser, documentation, and reference files.

#### 1.1 Remove `GitSettings` and `StepGitSettings` from types

**File:** `src/types.ts`

- Delete `GitSettings` interface (lines 32-38): `enabled`, `worktree`, `autoCommit`, `autoPr`, `branchPrefix`
- Delete `StepGitSettings` interface (lines 40-44): `worktree`, `autoPr`, `branchPrefix`
- Remove `git: GitSettings` from `WorkflowSettings` (line 58)
- Remove `git?: StepGitSettings | null` from `StepDefinition` (line 83)

#### 1.2 Remove git parsing from parser

**File:** `src/parser.ts`

- Remove `GitSettings`, `StepGitSettings` from imports (lines 7-8)
- Remove `gitData` / `git` block from `parseSettings` (lines 94-101, 113)
- Remove `gitData` / `step.git` block from parallel step parsing (lines 180-187)
- Remove `git: null` from default step object (line 168)

#### 1.3 Remove git config defaults

**File:** `src/config.ts`

- Remove `git` block from `DEFAULT_CONFIG` (lines 13-17): `mainBranch`, `autoCommit`, `autoPr`

#### 1.4 Remove from parallel step executor

**File:** `src/steps/parallel-step.ts`

- Remove `const useWorktree = step.git?.worktree ?? false` (line 34) -- will be replaced in Phase 3

#### 1.5 Remove merge-mode support

**File:** `src/steps/parallel-step.ts`

The `merge-mode: merge` option is fragile. Conflict handling during automated merges is unreliable, and the current implementation deletes worktrees before downstream steps can use the merged result. Remove `merge` as an option.

- Remove `mergeWorktreeBranches` method (lines 188-226)
- Remove merge-mode `"merge"` branch in `execute` (lines 141-151)
- Keep `"independent"` as the only mode (worktrees preserved or cleaned per cleanup policy)
- Remove `mergeMode` and `mergeStrategy` from `StepDefinition` type and parser (simplify to always `wait-all` + `independent`)

**Impact on workflows:**

- `analyze-codebase-merge.yaml` uses `merge-mode: merge`. This workflow must be updated: parallel branches produce independent branches (each can become a PR or be merged manually by the user)
- Update workflow description and post-parallel steps to reflect no auto-merge

#### 1.6 Update documentation

**Files:**

- `docs/configuration.md`: Remove `git.mainBranch`, `git.autoCommit`, `git.autoPr` rows
- `docs/workflows.md`: Remove git settings section from workflow settings, remove `merge-mode` references
- `src/authoring/.claude/skills/workflow-builder/references/REFERENCE.md`: Remove Git Settings table, remove `merge-mode` from parallel step, remove `branch-prefix` references
- `src/authoring/.claude/skills/workflow-builder/references/workflow-example.yaml`: Remove git settings from example

#### 1.7 Update tests

- Update all tests referencing `GitSettings`, `StepGitSettings`, `step.git`, `mergeMode`, `branchPrefix`
- Remove merge-mode test cases from `worktree.test.ts` and `steps.test.ts`

### Phase 2. New Worktree Settings Schema

Replace the removed `settings.git` with a new `settings.worktree` at the workflow level. This also adds a config-level default for worktree location.

#### 2.1 New types

**File:** `src/types.ts`

```typescript
export type WorktreeLocation = "sibling" | "nested" | "absolute";
export type WorktreeCleanup = "on-success" | "on-complete" | "manual";

export interface WorktreeSettings {
  enabled: boolean | string; // boolean or template string "{{ variables.use_worktree }}"
  location: WorktreeLocation;
  directory: string | null; // required when location is "absolute"
  cleanup: WorktreeCleanup;
}
```

The `enabled` field accepts a template string so workflows can expose worktree as a user-configurable variable (see 2.6).

Add to `WorkflowSettings`:

```typescript
export interface WorkflowSettings {
  // ... existing fields (minus git)
  worktree: WorktreeSettings;
}
```

Add to `StepDefinition` for parallel steps (replaces `StepGitSettings`):

```typescript
export interface StepDefinition {
  // ... existing fields (minus git)
  worktree?: boolean | string | null; // parallel step: enable worktree per-branch
}
```

#### 2.2 YAML schema

**Workflow-level** (isolate entire workflow in a single worktree):

```yaml
settings:
  worktree:
    enabled: true
    location: "sibling" # sibling | nested | absolute
    directory: "C:/worktrees" # only required when location is "absolute"
    cleanup: "on-success" # on-success | on-complete | manual
```

**Parallel step-level** (each branch gets its own worktree):

```yaml
steps:
  - name: parallel-work
    type: parallel
    worktree: true # uses workflow-level location/cleanup settings
    steps:
      - name: branch-a
        type: prompt
        prompt: "..."
```

#### 2.3 Defaults

| Key         | Default        | Notes                                  |
| ----------- | -------------- | -------------------------------------- |
| `enabled`   | `false`        | Opt-in                                 |
| `location`  | `"sibling"`    | Worktrees created alongside the repo   |
| `directory` | `null`         | Only used when `location: "absolute"`  |
| `cleanup`   | `"on-success"` | Keep worktree on failure for debugging |

#### 2.4 Parser changes

**File:** `src/parser.ts`

- Parse `settings.worktree` as `WorktreeSettings` (replace git parsing)
- `enabled` is stored as-is: `boolean` or `string` (template resolved at runtime)
- Parse `step.worktree` as `boolean | string` for parallel steps
- Validate: if `location: "absolute"` then `directory` must be set

#### 2.5 Config-level worktree defaults

**File:** `src/config.ts`

Add to `DEFAULT_CONFIG`:

```typescript
worktree: {
  location: "sibling",
  directory: null,
  cleanup: "on-success",
}
```

Config precedence: workflow YAML > local config > global config > defaults

#### 2.6 Variable-driven worktree (runtime resolution)

The `worktree.enabled` field supports Nunjucks template strings, following the same pattern as `ralph-loop.max-iterations`. This lets users toggle worktree isolation per run from the CLI.

**Workflow YAML:**

```yaml
settings:
  worktree:
    enabled: "{{ variables.use_worktree }}"
    cleanup: "on-success"

variables:
  - name: use_worktree
    type: boolean
    required: false
    default: true
    description: Whether to run in an isolated worktree
```

**CLI usage:**

```bash
# Run with worktree (default)
agentic-forge run plan-build-review task="Add feature X"

# Run without worktree
agentic-forge run plan-build-review task="Add feature X" use_worktree=false
```

**Resolution in executor** (`src/executor.ts`):

The template is resolved after variables are available but before the step loop begins. This is the same point where `max-iterations` templates are resolved in the ralph-loop executor.

```typescript
function resolveWorktreeEnabled(
  settings: WorktreeSettings,
  renderer: TemplateRenderer,
  variables: Record<string, unknown>
): boolean {
  if (typeof settings.enabled === "boolean") return settings.enabled;
  const rendered = renderer.renderString(settings.enabled, {
    variables,
    ...variables
  });
  return rendered.trim().toLowerCase() === "true";
}
```

The same pattern applies to `step.worktree` on parallel steps:

```typescript
function resolveStepWorktree(
  value: boolean | string | null | undefined,
  renderer: TemplateRenderer,
  variables: Record<string, unknown>
): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  const rendered = renderer.renderString(value, { variables, ...variables });
  return rendered.trim().toLowerCase() === "true";
}
```

### Phase 3. Worktree Location Resolution

Redesign `createWorktree` to support the three location modes.

#### 3.1 Location modes

**sibling** (default): Worktrees are created at the same level as the repo, inside a `.worktrees` directory, prefixed with the repo name.

```text
/repositories/
  my-project/              <- repo root
  .worktrees/
    my-project-plan-build-review-a3f2c1/
    my-project-analyze-bug-b7d4e2/
```

Git command equivalent: `git worktree add ../.worktrees/my-project-feature-abc123 -b agentic/feature-abc123`

**nested**: Worktrees are created inside the repo root in a `.worktrees/` directory (current behavior).

```text
/repositories/
  my-project/
    .worktrees/
      agentic-plan-build-review-a3f2c1/
```

**absolute**: Worktrees are created at a user-specified absolute path.

```text
C:/worktrees/
  my-project-plan-build-review-a3f2c1/
```

#### 3.2 Update `createWorktree` signature

**File:** `src/git/worktree.ts`

```typescript
export interface CreateWorktreeOptions {
  workflowName: string;
  stepName: string;
  baseBranch?: string | null;
  repoRoot?: string | null;
  location: WorktreeLocation;
  directory?: string | null; // for "absolute" mode
}

export function createWorktree(options: CreateWorktreeOptions): Worktree;
```

#### 3.3 Path resolution logic

```typescript
function resolveWorktreePath(
  repoRoot: string,
  dirName: string,
  location: WorktreeLocation,
  directory: string | null
): string {
  switch (location) {
    case "sibling": {
      const parentDir = path.dirname(repoRoot);
      return path.join(parentDir, ".worktrees", dirName);
    }
    case "nested":
      return path.join(repoRoot, ".worktrees", dirName);
    case "absolute": {
      if (!directory)
        throw new Error("Worktree directory required for absolute location");
      return path.join(directory, dirName);
    }
  }
}
```

#### 3.4 Directory naming

For `sibling` and `absolute` modes, prefix with repo name for disambiguation:

```text
{repo-name}-{workflow}-{step}-{suffix}
```

For `nested`, keep current naming (repo context is implicit):

```text
agentic-{workflow}-{step}-{suffix}
```

#### 3.5 Update `.gitignore` handling

- For `nested` mode: `.worktrees/` entry in repo `.gitignore` (current behavior)
- For `sibling` mode: The `.worktrees/` dir is outside the repo, no `.gitignore` needed
- For `absolute` mode: No `.gitignore` needed

#### 3.6 Update `pruneOrphaned`

Must search the correct location based on config, not just `path.join(root, ".worktrees")`.

### Phase 4. Agentic Directory Resolution in Worktrees

When running inside a worktree, the `agentic/` directory must resolve correctly. A worktree should never create its own local `agentic/` directory.

#### 4.1 Problem

- If `outputDirectory: "local"`, outputs go to `{cwd}/agentic/outputs/`. Inside a worktree, this would create `{worktree}/agentic/outputs/`, which is wrong.
- The `agentic/config.json` should always be read from the main repo root, not the worktree.
- Workflow output files (plan.md, review.md, ralph state) must be accessible from all worktrees.

#### 4.2 Rule

When a step runs in a worktree:

- **Config**: Always resolve from the main repo root (already works because `loadConfig` uses the executor's `repoRoot`)
- **Output directory**: Always use the global output directory, never local. Worktrees should force `outputDirectory: "global"` behavior regardless of config.
- **Ralph state files**: Stored in the output directory (already global), so they are shared across worktrees. File names must include the step name to avoid collisions (already the case via `ralph-{step-name}.md`)
- **Skills directory**: Resolved from the bundled package path, not from cwd (already works)

#### 4.3 Implementation

**File:** `src/paths.ts`

Add a helper:

```typescript
export function getWorktreeOutputRoot(
  config: Record<string, unknown>,
  cwd?: string
): string {
  // Worktrees always use global output, regardless of outputDirectory config
  return path.join(getGlobalRoot(), "outputs", slugifyCwdName(cwd));
}
```

**File:** `src/executor.ts`

When worktree is enabled, override the output directory resolution to always use global.

#### 4.4 Parallel worktree + agentic directory

Each parallel branch worktree must:

- Use the shared global output directory for writing results
- Never attempt to read `{worktree}/agentic/config.json`
- The `context.repoRoot` must remain the main repo root (for config resolution), while `context.cwdOverride` points to the worktree (for file operations)

This is already partially the case. The key change is ensuring `getOutputDir` uses global when in worktree mode.

### Phase 5. Workflow-Level Worktree Isolation

When `settings.worktree.enabled: true`, the entire workflow runs in a single worktree.

#### 5.1 Lifecycle

Git push/commit during execution is the runtime agent's responsibility (via prompts like `/af-git-commit`, `/af-git-pr`). The workflow engine only manages worktree creation and cleanup.

```text
Workflow start
-> Resolve worktree.enabled (may be a template variable)
-> Create worktree (single branch for entire workflow)
-> Set cwdOverride on root context
-> All sequential steps run in worktree
-> On cleanup: safety-commit any uncommitted changes (see 5.4)
-> On success + cleanup=on-success/on-complete: remove worktree, keep branch
-> On failure + cleanup=on-success: preserve worktree, log path
-> On failure + cleanup=on-complete: remove worktree, keep branch
-> On cleanup=manual: always preserve worktree, log path
```

#### 5.2 Implementation

**File:** `src/executor.ts` -- `run()` method

Before the step loop (after output dir setup, after variables are resolved):

```typescript
let workflowWorktree: Worktree | null = null;
const worktreeSettings = workflow.settings.worktree;
const worktreeEnabled = resolveWorktreeEnabled(
  worktreeSettings,
  this.renderer,
  vars
);

if (worktreeEnabled) {
  workflowWorktree = createWorktree({
    workflowName: workflow.name,
    stepName: "workflow",
    location: worktreeSettings.location,
    directory: worktreeSettings.directory,
    repoRoot: this.repoRoot
  });
  logger.info("workflow", `Created worktree: ${workflowWorktree.path}`);
  logger.info("workflow", `Branch: ${workflowWorktree.branch}`);
  console.info(`Worktree created: ${workflowWorktree.path}`);
}
```

In `executeStep`, set `cwdOverride` from the workflow worktree:

```typescript
const context: StepContext = {
  repoRoot: this.repoRoot // main repo for config
  // ...
};
if (workflowWorktree) {
  context.cwdOverride = workflowWorktree.path;
}
```

After the step loop, cleanup based on `worktreeSettings.cleanup`:

```typescript
if (workflowWorktree) {
  const shouldCleanup =
    worktreeSettings.cleanup === "on-complete" ||
    (worktreeSettings.cleanup === "on-success" &&
      progress.status === WORKFLOW_STATUS.COMPLETED);

  if (shouldCleanup) {
    // Safety commit: prevent data loss from uncommitted changes (see 5.4)
    safetyCommit(workflowWorktree.path, logger);
    removeWorktree(workflowWorktree, this.repoRoot, false); // keep branch
    logger.info(
      "workflow",
      `Worktree cleaned up, branch preserved: ${workflowWorktree.branch}`
    );
    console.info(`Worktree cleaned up. Branch: ${workflowWorktree.branch}`);
  } else {
    logger.info("workflow", `Worktree preserved: ${workflowWorktree.path}`);
    logger.info("workflow", `Branch: ${workflowWorktree.branch}`);
    console.info(`Worktree preserved at: ${workflowWorktree.path}`);
  }
}
```

#### 5.3 Safety commit before worktree removal

Before removing any worktree (workflow-level or parallel branch), check for uncommitted changes and auto-commit them. This prevents data loss when the runtime agent didn't commit everything.

**File:** `src/git/worktree.ts`

Add a `safetyCommit` helper:

```typescript
export function safetyCommit(
  worktreePath: string,
  logger?: WorkflowLogger
): boolean {
  const status = runGit(["status", "--porcelain"], worktreePath, false);
  if (!status.stdout.trim()) return false;

  runGit(["add", "-A"], worktreePath);
  runGit(
    [
      "commit",
      "-m",
      "chore: auto-save uncommitted changes before worktree cleanup"
    ],
    worktreePath,
    false
  );
  if (logger) {
    logger.warning(
      "worktree",
      `Auto-committed uncommitted changes in ${worktreePath}`
    );
  }
  return true;
}
```

This helper is called from both the workflow-level cleanup (Phase 5.2) and the parallel branch cleanup (Phase 7.2) before any `removeWorktree` call.

#### 5.4 Parallel steps inside a workflow worktree

When the workflow is already in a worktree and a parallel step has `worktree: true`:

- **Block this combination.** Creating nested worktrees from a worktree is not supported by git.
- At parse time or execution time, throw a clear error: "Parallel step worktree is not supported when workflow-level worktree is enabled. The parallel branches will run within the workflow worktree."
- Parallel steps without `worktree: true` run normally within the workflow worktree (sequentially-safe since they share the same cwd).

**Validation in executor:**

```typescript
if (workflowWorktree && step.type === "parallel" && step.worktree) {
  throw new Error(
    `Step '${step.name}': parallel worktree is not supported ` +
      `when workflow-level worktree is enabled`
  );
}
```

### Phase 6. Fix Ralph-Loop CWD

#### 6.1 Bug fix

**File:** `src/steps/ralph-loop-step.ts`

Line 119, change:

```typescript
cwd: context.repoRoot,
```

To:

```typescript
cwd: context.cwdOverride ?? context.repoRoot,
```

This ensures ralph-loop iterations run in the worktree when `cwdOverride` is set (from workflow-level worktree or parallel step worktree).

#### 6.2 Ralph state file uniqueness

Ralph state files are already namespaced by `{workflowId}` and `{stepName}` via `ralph-{step-name}.md`. When multiple ralph loops run in parallel (e.g., `analyze-codebase-merge`), each has a unique step name, so no collision occurs. No change needed.

Verify: `createRalphState` and `loadRalphState` in `src/ralph-loop.ts` use `step.name` for file naming.

### Phase 7. Update Parallel Step Executor

#### 7.1 Replace git settings with worktree boolean

**File:** `src/steps/parallel-step.ts`

Replace:

```typescript
const useWorktree = step.git?.worktree ?? false;
```

With:

```typescript
const useWorktree = step.worktree ?? false;
```

#### 7.2 Cleanup policy

Read cleanup policy from `context.workflowSettings.worktree.cleanup`:

```typescript
const cleanup = context.workflowSettings?.worktree?.cleanup ?? "on-success";
```

After all branches complete:

- `"on-success"`: Remove worktrees for successful branches, preserve failed ones
- `"on-complete"`: Remove all worktrees
- `"manual"`: Preserve all worktrees, log paths

Replace the current unconditional cleanup with policy-aware cleanup. Safety commit is called before removal to prevent data loss (see Phase 5.3):

```typescript
for (const [name, worktree] of Object.entries(worktrees)) {
  const branchFailed = failedBranches.includes(name);
  const shouldCleanup =
    cleanup === "on-complete" || (cleanup === "on-success" && !branchFailed);

  if (shouldCleanup) {
    safetyCommit(worktree.path, logger);
    removeWorktree(worktree, context.repoRoot, false); // keep branch
    logger.info(
      name,
      `Worktree cleaned up, branch preserved: ${worktree.branch}`
    );
  } else {
    logger.info(name, `Worktree preserved: ${worktree.path}`);
    console.info(`  Worktree preserved for '${name}': ${worktree.path}`);
  }
}
```

Git push is the runtime agent's responsibility, not the workflow engine's. Branches are preserved after worktree removal and can be pushed/PR'd by subsequent workflow steps or by the user.

### Phase 8. Update Bundled Workflows

#### 8.1 `plan-build-review.yaml`

Replace:

```yaml
settings:
  git:
    enabled: true
    worktree: true
    auto-commit: true
    branch-prefix: "feature"
```

With:

```yaml
settings:
  worktree:
    enabled: "{{ variables.use_worktree }}"
    cleanup: "on-success"

variables:
  # ... existing variables ...
  - name: use_worktree
    type: boolean
    required: false
    default: true
    description: Whether to run in an isolated worktree
```

Users can now toggle worktree per run: `agentic-forge run plan-build-review task="..." use_worktree=false`

#### 8.2 `analyze-codebase-merge.yaml`

Remove top-level git settings. Update parallel step:

```yaml
settings:
  worktree:
    enabled: false # workflow-level worktree not needed

steps:
  - name: analyze-and-fix-all
    type: parallel
    worktree: true
    steps:
      # ... branches unchanged
```

Remove `merge-mode: merge` and update post-parallel steps to not assume merged state. Each branch produces an independent branch that can be reviewed/merged manually or via PR.

#### 8.3 Other workflows

Audit all workflows in `src/workflows/` for `git:` or `merge-mode:` references and update.

### Phase 9. Update Documentation and References

#### 9.1 Files to update

| File                                                                             | Changes                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `docs/configuration.md`                                                          | Remove `git.*` config keys, add `worktree.*` config keys            |
| `docs/workflows.md`                                                              | Replace git settings with worktree settings, remove merge-mode      |
| `docs/cli.md`                                                                    | No changes expected                                                 |
| `src/authoring/.claude/skills/workflow-builder/references/REFERENCE.md`          | Replace Git Settings section, update parallel step properties       |
| `src/authoring/.claude/skills/workflow-builder/references/workflow-example.yaml` | Update example workflow with new worktree settings                  |
| `CLAUDE.md`                                                                      | Update any references to git settings in the repo structure section |

#### 9.2 New documentation for worktree settings

Document in `docs/workflows.md` and `REFERENCE.md`:

- Workflow-level `settings.worktree` schema
- Step-level `worktree: true` for parallel steps
- Location modes with directory structure examples
- Cleanup policies
- Constraint: no parallel worktree inside workflow worktree

### Phase 10. Tests

#### 10.1 Unit tests to add/update

| Test file                  | Changes                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `tests/worktree.test.ts`   | Update `createWorktree` tests for new signature and location modes   |
| `tests/worktree.test.ts`   | Remove merge-mode test cases                                         |
| `tests/worktree.test.ts`   | Add cleanup policy tests                                             |
| `tests/steps.test.ts`      | Update parallel step tests for `step.worktree` instead of `step.git` |
| `tests/parser.test.ts`     | Update settings parsing tests for new worktree schema                |
| `tests/executor.test.ts`   | Add workflow-level worktree lifecycle tests                          |
| `tests/ralph-loop.test.ts` | Add test for `cwdOverride` being respected                           |

#### 10.2 Key test scenarios

- Worktree created in sibling location (path resolves to `../.worktrees/`)
- Worktree created in nested location (path resolves to `.worktrees/`)
- Worktree created in absolute location
- Absolute location without directory throws error
- Cleanup `on-success`: preserved on failure, removed on success
- Cleanup `on-complete`: always removed
- Cleanup `manual`: always preserved
- Safety commit called before worktree removal when dirty
- Safety commit is a no-op when worktree is clean
- Workflow worktree + parallel `worktree: true` throws error
- Ralph-loop runs in worktree cwd when `cwdOverride` is set
- Output directory resolves to global when running in worktree
- `worktree.enabled` as template string resolves to true/false from variables
- `worktree.enabled` as boolean works directly (no template resolution)
- `step.worktree` as template string resolves correctly for parallel steps

## Implementation Order

| Order | Phase                             | Dependency  | Estimated Scope |
| ----- | --------------------------------- | ----------- | --------------- |
| 1     | Phase 1: Remove dead git config   | None        | Medium          |
| 2     | Phase 2: New worktree schema      | Phase 1     | Small           |
| 3     | Phase 3: Location resolution      | Phase 2     | Medium          |
| 4     | Phase 4: Agentic dir in worktrees | Phase 3     | Small           |
| 5     | Phase 6: Fix ralph-loop cwd       | Phase 2     | Small           |
| 6     | Phase 7: Update parallel executor | Phase 2-3   | Medium          |
| 7     | Phase 5: Workflow-level worktree  | Phase 3-4-6 | Medium          |
| 8     | Phase 8: Update workflows         | Phase 7     | Small           |
| 9     | Phase 9: Update docs              | Phase 8     | Small           |
| 10    | Phase 10: Tests                   | All         | Medium          |

## Files Modified Summary

| File                                                                             | Action     | Phases |
| -------------------------------------------------------------------------------- | ---------- | ------ |
| `src/types.ts`                                                                   | Major edit | 1, 2   |
| `src/parser.ts`                                                                  | Major edit | 1, 2   |
| `src/config.ts`                                                                  | Edit       | 1, 2   |
| `src/git/worktree.ts`                                                            | Major edit | 3      |
| `src/paths.ts`                                                                   | Edit       | 4      |
| `src/executor.ts`                                                                | Major edit | 5      |
| `src/steps/parallel-step.ts`                                                     | Major edit | 1, 7   |
| `src/steps/ralph-loop-step.ts`                                                   | Bug fix    | 6      |
| `src/steps/base.ts`                                                              | No change  | --     |
| `src/workflows/*.yaml`                                                           | Edit       | 8      |
| `docs/configuration.md`                                                          | Edit       | 9      |
| `docs/workflows.md`                                                              | Edit       | 9      |
| `src/authoring/.claude/skills/workflow-builder/references/REFERENCE.md`          | Edit       | 9      |
| `src/authoring/.claude/skills/workflow-builder/references/workflow-example.yaml` | Edit       | 9      |
| `tests/*.test.ts`                                                                | Edit       | 10     |

## Resolved Decisions

1. **Push/commit is the runtime's job**: The workflow engine does not push or commit. Git operations (commit, push, PR) are handled by the runtime agent via prompts and skills (`/af-git-commit`, `/af-git-pr`). The engine only manages worktree creation and removal.

2. **Safety commit before cleanup**: Before removing any worktree, the engine checks for uncommitted changes and auto-commits them with a `chore:` message. This is a data-loss safety net, not a replacement for the agent committing properly. Uses the existing `commitChanges` function in `worktree.ts`.

3. **`create-branch` step stays**: The `create-branch` step in `plan-build-review` remains. When worktree is enabled the worktree already creates a branch, so the user should set `create_branch=false`. This is a user choice, not something the engine enforces.

4. **Worktree is variable-driven**: `worktree.enabled` accepts a template string (e.g., `"{{ variables.use_worktree }}"`), resolved at runtime before the step loop. This lets users toggle worktree isolation per CLI run without modifying the workflow YAML.
