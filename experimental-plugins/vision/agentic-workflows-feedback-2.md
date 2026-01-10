# Agentic Workflows Requirements - Final Feedback

This document contains the final round of clarifying questions, identified issues, missing details, and improvement suggestions for the agentic-workflows requirements document.

---

## Clarifying Questions

### 1. Orchestrator Agent vs Orchestrator Command

The document defines both:

- `agents/orchestrator.md` - "The main entity that manages whole workflows"
- `commands/orchestrate.md` - "Evaluate state, return next action"

**Question**: Are these the same thing with different naming, or are they distinct? The Python orchestrator calls "Claude Orchestrator Command" but agents and commands have different structures in Claude Code plugins.

**Recommendation**: Clarify that `orchestrate.md` is the command that invokes Claude to make orchestration decisions. The agent file (`orchestrator.md`) could be removed or renamed to avoid confusion, since the command already defines the behavior.

**answer**: Remove the orchestrator agent and only keep the command

### 2. Output Directory Path: Absolute vs Relative

The document states:

- "Base output folder: `/agentic` in the current directory"
- Design decisions say: "Always use relative paths from repo root (not absolute paths like `/agentic`)"

**Question**: Is the path `/agentic` or `agentic/` (relative)?

**Recommendation**: Use `agentic/` consistently (no leading slash) to make it clear this is relative to the repository root.

### 3. Search Memory Skill

The document mentions `/search-memory` skill in the CLAUDE.example.md section but this skill is not listed in the package structure under `skills/`.

**Recommendation**: Add `search-memory.md` to the skills directory list, or clarify that memory search uses native glob/grep tools instead of a dedicated skill.

### 4. Retry Behavior for Transient vs Recoverable Errors

The document states:

- Transient errors: "Retry with same prompt, new session"
- Recoverable errors: "Fix and retry"

**Question**: For recoverable errors (e.g., test failures), does "fix and retry" mean the same Claude session attempts to fix, or does the Python orchestrator spawn a new session with fix instructions?

**Recommendation**: Clarify that for recoverable errors, the Python orchestrator spawns a new session with context about what failed and instructions to fix before retrying the original task.

---

## Inconsistencies

### 1. Step State: "Aborted" Missing from State Diagram

The step states diagram shows:

```
failed --retry--> running (if retries left)
       --abort--> aborted (if max retries reached)
```

But the `StepStatus` enum in the workflow schema section only lists: `pending | running | completed | failed | skipped`

**Recommendation**: Add `aborted` to the step status enum, or clarify that steps reaching max-retry stay in `failed` state.

### 2. Terminal Output Granularity Naming

In settings:

```yaml
terminal-output: string # "base" | "all"
```

But the referenced runner.py code uses `print_output: bool` (true/false).

**Recommendation**: This is fine since the requirements document defines the new interface. Just ensure the implementation maps `base` to limited output and `all` to full streaming.

**answer**: Use the boolean print_output. In any case, the "base output" should always be printed, to track step completion, errors and other important, high level information.

### 3. Worktree Naming Convention Incomplete

The document states: "Use workflow name, step name (in the parallel) and random 6 char identifier"

But the worktree naming convention section says: `{workflow_name}-{step_name}-{random_6_char}`

**Recommendation**: Ensure branch names follow the same convention, documented as:

- Worktree path: `.worktrees/{workflow_name}-{step_name}-{random_6_char}`
- Branch name: `agentic/{workflow_name}-{step_name}-{random_6_char}`

---

## Missing Details

### 1. JSON Schema for Orchestrator Response

The Orchestrator JSON Response Schema shows the structure, but doesn't specify:

- What values are valid for `next_action.type` (the document mentions `execute_step | retry_step | wait_for_human | complete | abort` but this should be in the schema)
- Required vs optional fields

**Recommendation**: Add a formal JSON Schema file reference (`schemas/orchestrator-response.schema.json`) to the package structure, or include the complete schema inline.

### 2. Progress.json Schema Details

The progress.json example is helpful but lacks:

- Schema version (addressed in feedback but should be in the example)
- `running_steps` array for tracking currently executing parallel steps
- Step retry count tracking

**Recommendation**: Add to the progress.json example:

```json
{
  "schema_version": "1.0",
  "current_step": {
    "name": "build",
    "retry_count": 0,
    "started_at": "..."
  },
  "running_steps": []
}
```

### 3. Logging File Format

The Create Log skill mentions log levels but doesn't specify:

- Log file location per workflow (`agentic/workflows/{workflow-id}/logs.md` is shown in structure)
- Log entry format (timestamp, level, message, step context?)

**Recommendation**: Specify that logs use NDJSON format (one JSON object per line) matching the existing `claude_core/logging.py` pattern, with fields: `timestamp`, `level`, `step`, `message`, `context`.

### 4. Memory Index File Structure

The document mentions `index.md` in the memory directory but doesn't specify its format.

**Recommendation**: Add example structure:

```markdown
# Memory Index

Last updated: 2024-01-15T10:30:00Z

## Decisions

- [2024-01-09-auth-approach.md](decisions/2024-01-09-auth-approach.md) - OAuth vs JWT decision

## Patterns

- [error-handling-convention.md](patterns/error-handling-convention.md) - Error handling patterns
```

### 5. Wait-for-Human Step Processing

The document explains that the human input is "a multi-line string that acts as a prompt" but doesn't specify what happens with this input.

**Recommendation**: Add: "After receiving human input, the orchestrator spawns a Claude session with the step's original context plus the human input, allowing Claude to validate and act on the feedback before marking the step complete."

---

## Design Suggestions

### 1. Add Step ID to Distinguish Retries

Currently, if a step is retried, it's unclear how to distinguish between attempts in logs/progress.

**Recommendation**: Add `attempt_id` or `execution_id` to step tracking:

```json
{
  "name": "build",
  "attempt": 2,
  "execution_id": "exec-abc123"
}
```

### 2. Standardize Output JSON Structure

The document mentions "structured JSON (max 10 KB for metadata)" but doesn't define a standard structure.

**Recommendation**: Define a standard step output schema:

```json
{
  "success": true,
  "output_type": "document",
  "document_path": "agentic/plans/feature.md",
  "summary": "Created feature plan with 3 milestones",
  "metrics": {
    "files_changed": 0,
    "lines_added": 0
  },
  "next_step_context": "..."
}
```

### 3. Explicit Merge Conflict Resolution Strategy

The document mentions "spawn an agent to resolve conflicts" for the `merge` mode but doesn't specify:

- Which agent handles conflict resolution
- What happens if conflict resolution fails

**Recommendation**: Add: "Conflict resolution uses a dedicated prompt instructing Claude to resolve git merge conflicts. If resolution fails after max-retry attempts, the parallel block fails and the workflow pauses for human intervention."

---

## Technical Concerns

### 1. File Locking Implementation

The document mentions "file locking mechanism" for progress.json but doesn't specify the approach.

**Recommendation**: Specify: "Use `fcntl.flock()` on Unix or `msvcrt.locking()` on Windows. Acquire exclusive lock before writing, release immediately after. For cross-platform support, use the `filelock` library."

**answer**: Use the filelock library

### 2. Worktree Path Length on Windows

Windows has a 260-character path limit by default. With naming like `.worktrees/{workflow_name}-{step_name}-{random_6_char}`, long workflow/step names could cause issues.

**Recommendation**: Add: "Workflow and step names are truncated to 30 characters each when generating worktree paths. Use short, descriptive names to avoid path length issues on Windows."

### 3. Parallel Step Count Limit

The document doesn't specify a maximum number of parallel steps.

**Recommendation**: Add: "The orchestrator limits concurrent Claude sessions to `max_workers` (default: 4) to prevent resource exhaustion. Additional parallel steps queue until a slot is available."

### 4. Signal Handling for Graceful Shutdown

The document doesn't address what happens if the user presses Ctrl+C during workflow execution.

**Recommendation**: Add: "The Python orchestrator handles SIGINT/SIGTERM by:

1. Setting workflow status to 'cancelled'
2. Sending SIGTERM to running Claude processes
3. Waiting up to 30 seconds for graceful cleanup
4. Updating progress.json with final state
5. Running `git worktree prune` to clean orphaned worktrees"

---

## Minor Corrections

### 1. Duplicate "Existing Framework" Sections

The document has both "Existing Framework" and "Related Frameworks" sections near the end. The "Existing Framework" section lists BMAD, GetShitDone, and Ralph-Wiggum, while "Related Frameworks" has the comparison table.

**Recommendation**: Merge these into a single "Related Frameworks and Inspiration" section.

### 2. Config.json Logging Level Values

The config schema shows:

```json
"level": "Error"
```

But the error types table uses "Critical, Error, Warning, Information" while the referenced logging.py uses "DEBUG, INFO, WARN, ERROR".

**Recommendation**: Standardize on: `Critical | Error | Warning | Information` for config, mapping internally to standard Python logging levels.

### 3. Memory Directory Path Inconsistency

The document uses both:

- `/agentic/memory/` (Output Directory Structure section)
- `.agentic/memory/` (Self-Learning Process section)

**Recommendation**: Use `agentic/memory/` consistently (no leading dot or slash).

---

## Schema Completeness Checklist

The following schemas are referenced but should be fully defined:

| Schema File                         | Status                    | Recommendation                |
| ----------------------------------- | ------------------------- | ----------------------------- |
| `workflow.schema.json`              | Partially defined in YAML | Create complete JSON Schema   |
| `config.schema.json`                | Example provided          | Create complete JSON Schema   |
| `progress.schema.json`              | Example provided          | Create complete JSON Schema   |
| `orchestrator-response.schema.json` | Not listed                | Add to package structure      |
| `step-output.schema.json`           | Not defined               | Add standard output structure |

---

## Summary

The requirements document is comprehensive and well-structured. The main areas for improvement are:

1. **Clarify orchestrator naming** - command vs agent distinction
2. **Standardize paths** - use `agentic/` consistently without leading slash/dot
3. **Complete schema definitions** - especially orchestrator response and step output
4. **Add implementation details** - file locking, signal handling, parallel limits
5. **Resolve minor inconsistencies** - log levels, memory paths, step states

These are refinements rather than fundamental issues. The document provides a solid foundation for implementation.
