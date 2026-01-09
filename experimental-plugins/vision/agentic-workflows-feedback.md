# Agentic Workflows Requirements Feedback

This document contains clarifying questions, identified inconsistencies, missing details, and improvement suggestions for the agentic-workflows requirements document.

## Clarification Questions

### 1. Orchestrator Command Contract

The design describes a hybrid Python + Claude orchestration architecture where Python handles deterministic operations and Claude makes intelligent decisions. However:

- **Q1.1**: What exact prompt/command does the Python orchestrator send to Claude's "Orchestrator Command"? Is this `commands/orchestrate.md`?
- **Q1.2**: The JSON response schema shows `context_to_pass` as a string - is this sufficient for complex context like previous step outputs, error details, and checkpoint data?
- **Q1.3**: How does the Python orchestrator validate Claude's response? What happens if Claude returns malformed JSON or an invalid `next_action.type`?

### 2. Terminal Monitoring and Output Streaming

The document mentions streaming Claude session output to the terminal:

- **Q2.1**: When running parallel steps with `terminal-output: all`, you mention "parallel output buffered" - does this mean all parallel output is shown after all parallel steps complete, or is there interleaving with prefixes?
- **Q2.2**: How is the streaming implemented technically? Does the Python orchestrator capture Claude's stdout in real-time, or does it rely on file-based progress updates?

### 3. Git Worktree Lifecycle

- **Q3.1**: For root-level `worktree: true`, when exactly is the worktree created and cleaned up? Is the worktree persistent after workflow completion for inspection, or immediately cleaned up?
- **Q3.2**: If a parallel step fails, what happens to its worktree? Is it preserved for debugging?
- **Q3.3**: How are merge conflicts handled when parallel worktrees try to modify the same files? The document doesn't address this critical scenario.

### 4. Progress Document and Human Input

The `wait-for-human` step type uses polling:

- **Q4.1**: What is the polling interval for checking `progress.json` for human input?
- **Q4.2**: Is there a timeout for human input? What happens if the user never responds?
- **Q4.3**: The `human_input` field in progress.json - what is its structure? Just a string, or structured data?

### 5. Context Window Management

This is marked as an open question, but the approach is critical:

- **Q5.1**: The suggested approach mentions "the orchestrator command include a flag indicating if the session should prepare for handoff" - where does this flag come from? Does Python estimate token usage, or does Claude self-report?
- **Q5.2**: How is the checkpoint "summary" created? Is there a specific prompt or command for summarization?
- **Q5.3**: What information must the next session receive to continue effectively? Just the checkpoint file, or additional context?

### 6. Memory System Integration

- **Q6.1**: The document says memories are created via `/create-memory` skill - but when is this skill available? Is it injected into every Claude session, or only when explicitly enabled in the workflow?
- **Q6.2**: How does a Claude session search memories? Is there a `/search-memory` skill, or does Claude use the glob/grep tools on the memory directory?
- **Q6.3**: The memory frontmatter includes a `relevance` field (high/medium/low) - who determines this? Claude, or is it derived from something?

### 7. Error Recovery and Retries

- **Q7.1**: When a step is retried, does it receive any information about the previous failure? The document says "same prompt, new session" but doesn't mention error context.
- **Q7.2**: For "Recoverable" errors (test failure, validation error), who decides what the "fix" is? Does Claude auto-fix, or does the orchestrator provide guidance?
- **Q7.3**: What distinguishes a "Transient" error from a "Recoverable" error in practice? How is this classification determined?

---

## Inconsistencies

### 1. Memory System Architecture Mismatch

The requirements document says:

> "Memory uses simple keyword matching in YAML frontmatter or file glob patterns. No database or vector embeddings required."

However, the referenced `agentic-core/memory/manager.py` uses:

- PostgreSQL with pgvector
- Semantic search with embeddings
- `sentence-transformers` for local embeddings

**Issue**: The implementation reference contradicts the requirements. You need to specify which approach is correct for agentic-workflows.

### 2. Log Level Naming Inconsistency

In the Configuration Schema:

> `logging.level: enum: critical, error, warning, info, debug`

In the Create Log skill section:

> `Critical`, `Error`, `Warning`, `Information`

**Issue**: "Information" vs "info" inconsistency, and capitalization differs.

### 3. Command Output Format

The document states that commands from interactive-sdlc will be used but need "fixed json output for agentic use case." However:

- The referenced interactive-sdlc commands (build.md, validate.md, plan-\*.md) produce markdown output, not JSON
- The referenced agentic-sdlc plugin has JSON I/O, but uses a different command namespace (`/agentic-sdlc:`)

**Issue**: It's unclear whether agentic-workflows will:

1. Create new commands that produce JSON
2. Wrap existing interactive-sdlc commands
3. Reuse agentic-sdlc commands directly

### 4. Workflow Step Types vs agentic-core

The YAML schema defines step types: `prompt | command | parallel | conditional | recurring | wait-for-human`

The agentic-core workflow models have: `StepDefinition` with an `agent` field and `TaskDefinition` - no step types.

**Issue**: The workflow step model needs to be explicitly different from agentic-core, or you should document why you're diverging.

### 5. Variable Reference Syntax

The document uses both:

- `{{ outputs.step_name }}` (Jinja2 standard)
- `{{ variable_name }}` for template placeholders

But the condition examples show:

- `"{{ outputs.validate.issues_count > 0 }}"` (accessing nested properties)

**Issue**: How does the orchestrator handle nested property access in Jinja2? Standard Jinja2 would require `outputs.validate['issues_count']` or a custom filter.

---

## Missing Details

### 1. Agent Definitions

The package structure lists `agents/` with orchestrator.md, explorer.md, reviewer.md, fixer.md, documenter.md, but:

- No schema or structure for agent markdown files is provided
- No explanation of how agents differ from commands
- No specification of what persona/instructions each agent has
- The workflow YAML schema doesn't show how to reference agent files

### 2. Checkpoint Restore Mechanism

The CLI shows `agentic-workflow checkpoint restore <checkpoint-id>`, but:

- How does restoration work? Does it restart the workflow from a specific step?
- What state is preserved/restored? Variables, step outputs, file changes?
- How does it interact with git worktrees that may have been cleaned up?

### 3. Conditional Expression Evaluation

The document says conditions are "Jinja2 expression evaluated by the Claude Orchestrator" but:

- Is Claude evaluating the condition, or Python?
- What context variables are available in conditions?
- Can conditions access external state (file contents, command results)?

### 4. Parallel Step Merge Strategy

The schema mentions `merge-strategy: "wait-all" | "first-success"` but:

- What happens to the other branches when `first-success` completes?
- How are their worktrees cleaned up?
- Is there a way to cancel running parallel steps?

### 5. Output Template Resolution

Templates use Jinja2, but:

- What variables are available in output templates?
- Are templates rendered by Python or Claude?
- When are outputs generated (end of workflow, or incrementally)?

### 6. Configuration Inheritance

The document mentions workflow-level settings can override global config, but:

- What is the exact precedence order?
- Can step-level settings override workflow-level settings?
- Are there any settings that cannot be overridden?

### 7. Analyse Command Autofix Flow

The Analyse Codebase workflow mentions:

> "When autofix is enabled, the workflow is composed of 5 branches, that each have two steps (analyse + fix)."

But:

- How does the fix step receive the analysis results?
- What determines which issues get fixed (the `autofix` severity level)?
- Is the fix step a separate command or a prompt with the analysis output?

### 8. Worktree Naming Convention

For parallel steps using worktrees:

- What naming convention is used for worktree directories?
- How are branch names generated for each parallel step?
- What happens if a branch name conflicts with an existing branch?

### 9. Session Variables and State Passing

The document doesn't specify:

- How step outputs are made available to subsequent steps
- What format step outputs use (raw text, structured JSON, file paths)?
- Maximum size of outputs that can be passed between steps

---

## Design Suggestions

### 1. Explicit Session Handoff Protocol

Instead of relying on Claude to self-detect context limits, consider:

```yaml
steps:
  - name: build
    type: command
    command: build
    max_turns: 50 # Force handoff after 50 API round-trips
    handoff_checkpoint: true # Always create checkpoint on exit
```

This makes handoff deterministic and testable.

### 2. Structured Step Output Schema

Instead of free-form output, define expected output schemas per command:

```yaml
steps:
  - name: plan
    type: command
    command: plan
    output_schema: plan # References schemas/plan.schema.json
```

This allows Python to validate outputs and provide better error messages.

### 3. Error Context for Retries

When retrying a failed step, include failure context:

```yaml
# In the retry prompt, automatically include:
Previous attempt failed with error: { error_message }
Error type: { error_type }
Last checkpoint: { checkpoint_summary }
```

### 4. Parallel Step Dependencies

Allow parallel steps to have dependencies within the parallel block:

```yaml
- type: parallel
  merge-strategy: wait-all
  steps:
    - name: analyse-bug
      # independent
    - name: fix-bug
      depends-on: analyse-bug # Waits for analyse-bug within parallel block
```

### 5. Workflow Inheritance

Allow workflows to extend other workflows:

```yaml
extends: base-plan-build.yaml
steps:
  - name: custom-step
    insert-after: plan
    # ...
```

### 6. Progress Webhooks

For CI/CD integration, allow webhook notifications:

```yaml
settings:
  webhooks:
    on-step-complete: https://ci.example.com/webhook
    on-error: https://ci.example.com/alert
```

### 7. Dry Run Mode

Add a more detailed dry-run that validates:

- All referenced templates exist
- All commands/agents are available
- Variable types match expected schemas
- Git repository state is valid for worktree operations

---

## Technical Concerns

### 1. Race Conditions in Progress.json

Multiple parallel Claude sessions writing to progress.json could cause race conditions. Consider:

- File locking mechanisms
- Separate progress files per parallel branch (as noted in the document)
- Using a proper database for concurrent access

### 2. Worktree Cleanup on Crash

If the Python orchestrator crashes mid-workflow:

- How are orphaned worktrees cleaned up?
- Is there a recovery mechanism to resume from the last checkpoint?
- What happens to in-flight Claude sessions?

### 3. Windows Path Handling

The document uses `/agentic` for paths, but on Windows:

- Should this be relative to the repository root?
- How are paths normalized across platforms?
- The referenced code uses `Path` objects - is Windows compatibility tested?

### 4. Claude Session Timeout

The workflow timeout is in minutes, but:

- What happens if a Claude session hangs without returning?
- Is there a mechanism to kill stuck sessions?
- How is the timeout enforced (Python-side process timeout)?

### 5. Jinja2 Template Security

If user-provided templates are evaluated:

- Are dangerous Jinja2 features disabled (exec, import)?
- Can templates access the filesystem or environment?
- Is there sandboxing for template execution?

---

## Errors and Corrections

### 1. Typo in References Section

```
experimental-plugins\core\src\claude_core\runner.py - Legacy plugin, only kept because it's script can be use as example
```

Should be: "its scripts can be used as examples"

### 2. Inconsistent Kebab vs Snake Case

The document uses:

- `max-retry` in YAML schema
- `maxRetry` in config.json schema

Pick one convention and use it consistently.

### 3. Missing Schema Version in Progress.json

The progress.json example doesn't include a schema version, which will make future migrations difficult:

```json
{
  "schema_version": "1.0",
  "workflow_id": "uuid",
  ...
}
```

### 4. Duplicate Section

"Existing Agentic Plugins" and "Related Frameworks" sections cover similar ground and could be consolidated.

### 5. Incomplete Memory Category List

The Memory Categories table lists 5 categories:
`pattern, lesson, error, decision, context`

But the Memory Document Format example uses `category: pattern` without defining all valid categories in the frontmatter schema.

---

## Architectural Questions

### 1. Plugin vs Standalone Tool

Is agentic-workflows:

- A Claude Code plugin (installed via marketplace)?
- A standalone CLI tool (installed via `uv tool install`)?
- Both?

The document implies both, but the installation and configuration flows differ.

### 2. Dependency on interactive-sdlc

Many commands reference interactive-sdlc. Does agentic-workflows:

- Depend on interactive-sdlc being installed?
- Include copies of these commands?
- Provide its own implementations?

This affects package dependencies and maintenance.

### 3. Claude Code Version Requirements

The document doesn't specify:

- Minimum Claude Code version required
- Which Claude Code features are used (--print, --dangerously-skip-permissions, etc.)
- Compatibility with different Claude Code configurations

### 4. Provider Lock-in

The design assumes Claude Code specifically. The agentic-core vision included provider abstraction for Cursor, Codex, etc. Should agentic-workflows:

- Be Claude-only (simpler)?
- Include provider abstraction (more complex, but aligns with agentic-core)?

---

## Summary of Highest-Priority Items

1. **Clarify the orchestrator command contract** - The exact interface between Python and Claude is the core of the architecture
2. **Resolve memory system architecture** - File-based vs database-backed is a fundamental design decision
3. **Define command JSON output format** - Without this, the Python orchestrator can't parse step results
4. **Specify agent file structure** - Agents are mentioned but never defined
5. **Detail checkpoint/restore mechanism** - Critical for long-running workflows
6. **Address parallel worktree merge conflicts** - Common scenario with no documented handling
