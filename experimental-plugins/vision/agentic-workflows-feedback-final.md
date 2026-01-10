# Agentic Workflows Requirements - Final Feedback

This document contains the final round of feedback for the agentic-workflows requirements document. The focus is on quality improvements while maintaining document conciseness.

---

## Clarifying Questions

### 1. Worktree Base Path Location

The document specifies worktree path as `.worktrees/{workflow_name}-{step_name}-{random_6_char}`, but the referenced `worktree.py:289-304` creates worktrees in `repo_root.parent / ".worktrees"` (outside the repository).

**Question**: Should worktrees be inside the repository (`.worktrees/`) or outside (`../.worktrees/`)? Inside is easier for cleanup but pollutes the repo; outside avoids `.gitignore` but may have permission issues.

**Recommendation**: Use `.worktrees/` inside the repository (add to `.gitignore`). This is simpler for cleanup and aligns with the document's current wording.

### 2. Logs File Extension

The document specifies `logs.ndjson` but the Output Directory Structure shows `logs.md`.

**Question**: Is the log format NDJSON (as specified in Create Log skill) or markdown?

**Recommendation**: Use NDJSON (`logs.ndjson`) as specified - it's machine-parseable and consistent with structured logging best practices.

### 3. Step Output vs Orchestrator Response

The Step Output Format section defines a JSON structure, but it's unclear if this is:

- What Claude returns from a step
- What the orchestrator stores internally
- What's passed to the next step

**Recommendation**: Clarify that this is the **internal orchestrator format** for storing step results. Claude sessions may return free-form output that the orchestrator wraps in this structure.

---

## Inconsistencies

### 1. Default Terminal Output Setting

The settings table shows:

```
defaults.terminalOutput: enum, default: base
```

But the workflow YAML schema shows:

```yaml
terminal-output: string # "base" | "all"
```

**Issue**: The config uses camelCase (`terminalOutput`) while YAML uses kebab-case (`terminal-output`). This is intentional per previous feedback, but it should be explicitly noted.

**Recommendation**: Add a note in the Configuration Schema section: "JSON config uses camelCase keys; YAML workflows use kebab-case."

### 2. Worktree Cleanup Location

The Worktree Lifecycle section says:

> "Worktrees are immediately cleaned up after workflow completes"

But the Crash Recovery section references `.agentic-wt-` prefix:

```python
if wt.startswith(".agentic-wt-") and is_stale(wt):
```

**Issue**: The naming convention uses `{workflow_name}-{step_name}-{random_6_char}` but crash recovery checks for `.agentic-wt-` prefix.

**Recommendation**: Standardize to `.worktrees/agentic-{workflow_name}-{step_name}-{random_6_char}` and update the crash recovery code to match.

### 3. Explorer Agent File Location

The Package Structure shows `agents/explorer.md` but describes `orchestrator.md` which was removed per previous feedback.

**Recommendation**: Update the agents/ directory listing to only show:

- `explorer.md`
- `reviewer.md`

---

## Missing Details

### 1. Recoverable Error New Session Context

The document states recoverable errors spawn "a new session with error context to fix" but doesn't specify the exact context format.

**Recommendation**: Add to the Error Types table Action column for Recoverable:

```
New session with: original prompt + error message + affected files + fix instruction
```

### 2. Parallel Block Completion Signal

For parallel steps, there's no specification of how the orchestrator knows when all parallel steps are complete.

**Recommendation**: Add to the parallel step section:

> "The orchestrator polls each parallel worktree's `progress.json` file until all report `completed` or `failed` status. Polling interval: 5 seconds."

### 3. Command JSON Output Schema Reference

Commands are described as having "JSON-only output structure" but the exact schema isn't referenced.

**Recommendation**: Add to the Commands section:

> "All commands output JSON conforming to `schemas/step-output.schema.json`. Commands must not produce non-JSON output."

### 4. Memory Skill Installation

The document mentions `/create-memory` and `/search-memory` skills but doesn't clarify that these are installed as part of the plugin.

**Recommendation**: Add to the Skills section header:

> "Skills are automatically available to all Claude sessions invoked by the workflow. They can also be used independently outside of workflows."

---

## Design Suggestions

### 1. Clearer Separation of Orchestrator Responsibilities

The document could benefit from a clear table showing what Python does vs what Claude (Orchestrator Command) does:

| Responsibility            | Owner  | Rationale          |
| ------------------------- | ------ | ------------------ |
| Parse YAML workflow       | Python | Deterministic      |
| Read/write progress.json  | Python | File I/O           |
| Decide next step          | Claude | Requires judgment  |
| Evaluate conditions       | Claude | May need context   |
| Spawn Claude sessions     | Python | Process management |
| Retry logic               | Python | Deterministic      |
| Timeout enforcement       | Python | Process management |
| Git worktree operations   | Python | Shell commands     |
| Merge conflict resolution | Claude | Requires judgment  |

### 2. Simplify Variables Section Syntax

The variables section in the YAML schema could include a concrete example:

```yaml
variables:
  - name: feature_name
    type: string
    required: true
    description: Name of the feature to implement
  - name: priority
    type: string
    default: medium
    description: Task priority level
```

### 3. Add Wait-for-Human Example

The wait-for-human step type could benefit from a complete example:

```yaml
- name: review-plan
  type: wait-for-human
  message: "Please review the generated plan in agentic/workflows/{workflow-id}/plan.md and provide feedback."
  polling-interval: 15
  timeout-minutes: 30
  on-timeout: abort
```

---

## Technical Concerns

### 1. File Lock Library Specification

The document mentions using `filelock` library for cross-platform file locking but this should be added to the Python package dependencies.

**Recommendation**: Add to the package structure section:

> "Dependencies: `pyyaml`, `jinja2`, `filelock` (for cross-platform file locking)"

### 2. YAML Workflow Validation

There's no mention of workflow YAML validation before execution.

**Recommendation**: Add a note in the CLI Entry Point section:

> "The `run` command validates the workflow YAML against `schemas/workflow.schema.json` before execution. Invalid workflows fail immediately with descriptive errors."

### 3. Concurrent Session Limit Not in Config

The document mentions `max_workers` (default: 4) for parallel execution but this isn't in the config.json schema.

**Recommendation**: Add to Configuration Schema:

```json
"execution": {
  "maxWorkers": 4,
  "pollingIntervalSeconds": 5
}
```

### 4. Windows Signal Handling

The Graceful Shutdown section mentions SIGINT/SIGTERM, but Windows doesn't support SIGTERM.

**Recommendation**: Add: "On Windows, the orchestrator handles CTRL_C_EVENT and CTRL_BREAK_EVENT equivalently."

---

## Minor Corrections

### 1. Duplicate Content in Related Frameworks

The "Inspiration" subsection lists BMAD, GetShitDone, and Ralph-Wiggum, and these are described again in the Comparison table.

**Recommendation**: Remove the "Inspiration" bullet list and keep only the Comparison table, which is more informative.

### 2. Inconsistent Timestamp Format

Progress.json example uses `2024-01-15T10:30:00Z` but Checkpoint example uses `2024-01-15T14:30:00Z` without timezone.

**Recommendation**: Standardize all timestamps to ISO 8601 with Z suffix: `2024-01-15T14:30:00Z`

### 3. Trailing Whitespace in Code Blocks

Several code blocks have inconsistent indentation. Not critical but affects readability.
