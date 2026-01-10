# Agentic Workflows Requirements Feedback

This document contains clarifying questions, identified inconsistencies, missing details, and improvement suggestions for the agentic-workflows requirements document.

## Clarification Questions

### 1. Orchestrator Command Contract

The design describes a hybrid Python + Claude orchestration architecture where Python handles deterministic operations and Claude makes intelligent decisions. However:

- **Q1.1**: What exact prompt/command does the Python orchestrator send to Claude's "Orchestrator Command"? Is this `commands/orchestrate.md`?

Yes

- **Q1.2**: The JSON response schema shows `context_to_pass` as a string - is this sufficient for complex context like previous step outputs, error details, and checkpoint data?

Yes

- **Q1.3**: How does the Python orchestrator validate Claude's response? What happens if Claude returns malformed JSON or an invalid `next_action.type`?

If invalid response is returned, retry up to retry amount, then fail the workflow

### 2. Terminal Monitoring and Output Streaming

The document mentions streaming Claude session output to the terminal:

- **Q2.1**: When running parallel steps with `terminal-output: all`, you mention "parallel output buffered" - does this mean all parallel output is shown after all parallel steps complete, or is there interleaving with prefixes?

Ideally interleaving with prefixes

- **Q2.2**: How is the streaming implemented technically? Does the Python orchestrator capture Claude's stdout in real-time, or does it rely on file-based progress updates?

Python orchestrator capture Claude's stdout in real-time.
Important example to consider from the agentic-core plugin:

```
In runner.py:67-107, when print_output=True:

  # Line 69-71: Start process with pipes
  process = subprocess.Popen(
      cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, ...
  )

  # Line 81-82: Send prompt via stdin (avoids shell escaping issues)
  process.stdin.write(prompt.encode("utf-8"))
  process.stdin.close()

  # Lines 87-90: Stream stdout line-by-line
  for line in iter(process.stdout.readline, b""):
      decoded = line.decode("utf-8")
      print(decoded, end="", flush=True)  # Immediate display
      output_lines.append(decoded)

  Key points:
  - Uses subprocess.Popen() for streaming (not run())
  - flush=True ensures immediate console output
  - Line-by-line iteration prevents buffering delays

  Silent Capture (Workflow Mode)

  In runner.py:109-134, when print_output=False:

  result = subprocess.run(
      cmd, input=prompt.encode("utf-8"), capture_output=True, ...
  )

  Used by the workflow executor for structured JSON parsing.

  Provider Architecture

  In providers/claude.py:38-76, the build_command() method constructs the CLI call with --print --output-format json for structured output when running multi-step workflows.

  Multi-Agent Meetings

  In cli.py:498-517, a callback function _print_meeting_message() receives agent output and displays it with rich formatting:

  console.print(f"[bold]{agent_name}[/bold]", ...)
  console.print(message_content)
```

### 3. Git Worktree Lifecycle

- **Q3.1**: For root-level `worktree: true`, when exactly is the worktree created and cleaned up? Is the worktree persistent after workflow completion for inspection, or immediately cleaned up?

Worktree is immediately cleaned-up as soon as the workflows complete and has the branch and PR ready

- **Q3.2**: If a parallel step fails, what happens to its worktree? Is it preserved for debugging?

WOrktree is cleaned up

- **Q3.3**: How are merge conflicts handled when parallel worktrees try to modify the same files? The document doesn't address this critical scenario.

Parallel execution must support two modes of completion, independant and merge. The case of independant is simpler, the branch from worktrees all stay independant, and can create one PR per branch, that the user merge and resolve conflict in the order he wants. Merged will use sequential merge with auto-resolve: Merge branches one-by-one; if conflicts occur, spawn an agent to resolve them before continuing

### 4. Progress Document and Human Input

The `wait-for-human` step type uses polling:

- **Q4.1**: What is the polling interval for checking `progress.json` for human input?

15 seconds default, configurable in workflow step config

- **Q4.2**: Is there a timeout for human input? What happens if the user never responds?

Timeout is configurable on the workflow step configuration, default to 5 minutes. Another configuration instruct what to do if the human never provided input: continue or abort workflow.

- **Q4.3**: The `human_input` field in progress.json - what is its structure? Just a string, or structured data?

Just a string, that can be multi-line, that act as a prompt. It must have a similar behavior as if the Claude Agent ask a question to the user, and the user answer.

For example, this step could be used to validate the plan status after building an implementation plan. The human can input "valid" or "mostly good, update section 1 and 3 to add X and Y". The the wait for human input step must trigger a Claude instance to analyse the wait for human input-step, validate the human input, and then apply any requested change or take requested action, and then exit. The wait for human input steps completes and the workflow proceed to the next step

### 5. Context Window Management

This is marked as an open question, but the approach is critical:

- **Q5.1**: The suggested approach mentions "the orchestrator command include a flag indicating if the session should prepare for handoff" - where does this flag come from? Does Python estimate token usage, or does Claude self-report?

For a large feature build:

1. Plan produces discrete, independent milestones - each milestone should be completable without knowledge of other milestones implementation details
2. Orchestrator is the source of truth - track completed milestones, file changes, test results externally
3. Each Claude invocation is a worker - gets task description + relevant file content, nothing more
4. Context = task prompt + target files - not accumulated history

This mirrors how real teams work: developers don't need to know every line their teammates wrote, just the interfaces and their specific assignment.

- **Q5.2**: How is the checkpoint "summary" created? Is there a specific prompt or command for summarization?

The Checkpoint skill should cover this aspect.

- **Q5.3**: What information must the next session receive to continue effectively? Just the checkpoint file, or additional context?

Just the checkpoint file, that can contain some information about the current implementation

### 6. Memory System Integration

- **Q6.1**: The document says memories are created via `/create-memory` skill - but when is this skill available? Is it injected into every Claude session, or only when explicitly enabled in the workflow?

1. CLAUDE.md instructions define when to create and search memories. A ## Memory Management section in CLAUDE.example.md provides heuristics for Claude to autonomously decide when memory creation is warranted (architectural decisions, user preferences, discovered patterns, error solutions).
2. /create-memory and /search-memory skills provide the mechanism. These skills are installed via the plugin and handle:
   - Structured file creation with consistent metadata
   - Automatic index.md updates
   - Proper directory organization (decisions/, patterns/, context/)
   - Semantic search capability (future)

Example CLAUDE.md section:

## Memory Management

Create memories using `/create-memory` when you encounter:

- Architectural decisions and their rationale
- User preferences expressed during sessions
- Patterns/conventions discovered in the codebase
- Errors encountered and their solutions

Before starting complex tasks, use `/search-memory` or check
`.agentic/memory/index.md` for relevant context.

This separation allows Claude to make autonomous decisions about when to memorize while the skills ensure consistent structure and discoverability.

- **Q6.2**: How does a Claude session search memories? Is there a `/search-memory` skill, or does Claude use the glob/grep tools on the memory directory?

Use a well-structured memory directory that makes glob/grep effective:

.agentic/memory/
├── decisions/
│ ├── 2024-01-09-auth-approach.md
│ └── 2024-01-08-database-choice.md
├── patterns/
│ └── error-handling-convention.md
├── context/
│ └── project-architecture.md
└── index.md ← summary/TOC Claude reads first

How Claude searches:

1. Reads index.md to understand what's available
2. Uses grep for specific keywords
3. Reads relevant files

Why this works:

- Markdown files are grep-friendly
- Descriptive filenames aid discovery
- index.md acts as a lightweight "semantic" layer
- Can upgrade to /search-memory skill later without changing memory format

- **Q6.3**: The memory frontmatter includes a `relevance` field (high/medium/low) - who determines this? Claude, or is it derived from something?

Claude, can be edited later manually by human

### 7. Error Recovery and Retries

- **Q7.1**: When a step is retried, does it receive any information about the previous failure? The document says "same prompt, new session" but doesn't mention error context.

Error context should be captured by the python orchestrator and passed to the retried step

- **Q7.2**: For "Recoverable" errors (test failure, validation error), who decides what the "fix" is? Does Claude auto-fix, or does the orchestrator provide guidance?

Claude should auto-fix

- **Q7.3**: What distinguishes a "Transient" error from a "Recoverable" error in practice? How is this classification determined?

Transient error can be a network failure, throttling, etc.

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

Important: Add an important note in the requirement document that the references files are only used as reference, that some code can be re-used. They will not be used as-is and will never be refer in the final plugin. In this case, the correct approach is yaml frontmatter and file blob pattern. We're not using PostgreSQL, semantic serach or sentence-transformers.

### 2. Log Level Naming Inconsistency

In the Configuration Schema:

> `logging.level: enum: critical, error, warning, info, debug`

In the Create Log skill section:

> `Critical`, `Error`, `Warning`, `Information`

**Issue**: "Information" vs "info" inconsistency, and capitalization differs.

Valid: > `Critical`, `Error`, `Warning`, `Information`

### 3. Command Output Format

The document states that commands from interactive-sdlc will be used but need "fixed json output for agentic use case." However:

- The referenced interactive-sdlc commands (build.md, validate.md, plan-\*.md) produce markdown output, not JSON
- The referenced agentic-sdlc plugin has JSON I/O, but uses a different command namespace (`/agentic-sdlc:`)

**Issue**: It's unclear whether agentic-workflows will:

1. Create new commands that produce JSON
2. Wrap existing interactive-sdlc commands
3. Reuse agentic-sdlc commands directly

agentic-workflows will create new commands that produce only json, that will be mostly capy past of referenced commands, adapted for agentic use. The agenti-workflows plugin will be standalone.

### 4. Workflow Step Types vs agentic-core

The YAML schema defines step types: `prompt | command | parallel | conditional | recurring | wait-for-human`

The agentic-core workflow models have: `StepDefinition` with an `agent` field and `TaskDefinition` - no step types.

**Issue**: The workflow step model needs to be explicitly different from agentic-core, or you should document why you're diverging.

The workflow step model is valid and will be different from the agentic core workflow

### 5. Variable Reference Syntax

The document uses both:

- `{{ outputs.step_name }}` (Jinja2 standard)
- `{{ variable_name }}` for template placeholders

But the condition examples show:

- `"{{ outputs.validate.issues_count > 0 }}"` (accessing nested properties)

**Issue**: How does the orchestrator handle nested property access in Jinja2? Standard Jinja2 would require `outputs.validate['issues_count']` or a custom filter.

Fix this to use standard jinja2

---

## Missing Details

### 1. Agent Definitions

The package structure lists `agents/` with orchestrator.md, explorer.md, reviewer.md, fixer.md, documenter.md, but:

- No schema or structure for agent markdown files is provided
- No explanation of how agents differ from commands
- No specification of what persona/instructions each agent has
- The workflow YAML schema doesn't show how to reference agent files

remove the fixer and documenter agent. Add the required details for each other agents (orchestrator is the main entity that manage a whole workflow, explorer is responsible of exploring the codebase in an efficient way to find files for a specific task, and return the files and line number of interest to the main agent, reviewer ensure validity of tests, review code quality, etc.)

### 2. Checkpoint Restore Mechanism

The CLI shows `agentic-workflow checkpoint restore <checkpoint-id>`, but:

- How does restoration work? Does it restart the workflow from a specific step?
- What state is preserved/restored? Variables, step outputs, file changes?
- How does it interact with git worktrees that may have been cleaned up?

Remove both checkpoint commands. Checkpoint are only "save" made by agents to track their own progress or share important details to other agents. They will never be used to continue a workflow, this is what the workflow resume command is for.
agentic-workflow checkpoint list <workflow-id>
agentic-workflow checkpoint restore <checkpoint-id>

### 3. Conditional Expression Evaluation

The document says conditions are "Jinja2 expression evaluated by the Claude Orchestrator" but:

- Is Claude evaluating the condition, or Python?
- What context variables are available in conditions?
- Can conditions access external state (file contents, command results)?

The condition should be evaluated by the Claude orchestrator to allow the best flexibility, for example, after a validation step that would outputs a list of issues and improvements, a conditional step could be do start a "build" workflow step to fix major+issues if there are any.

### 4. Parallel Step Merge Strategy

The schema mentions `merge-strategy: "wait-all" | "first-success"` but:

- What happens to the other branches when `first-success` completes?
- How are their worktrees cleaned up?
- Is there a way to cancel running parallel steps?

Phase 1: Implement only wait-all

- All parallel steps complete
- All produce branches/PRs
- Worktrees cleaned after all finish

### 5. Output Template Resolution

Templates use Jinja2, but:

- What variables are available in output templates?
- Are templates rendered by Python or Claude?
- When are outputs generated (end of workflow, or incrementally)?

```
 Q: What variables are available?

  Expose a structured context object built by the orchestrator:

  template_context = {
      # Workflow metadata
      "workflow": {
          "name": "feature-implementation",
          "started_at": "2024-01-09T10:00:00Z",
          "completed_at": "2024-01-09T10:45:00Z",
      },

      # Step results (keyed by step id)
      "steps": {
          "plan": {"status": "completed", "output": "...", "files_changed": [...]},
          "implement": {"status": "completed", "output": "...", "files_changed": [...]},
          "test": {"status": "completed", "test_results": {"passed": 12, "failed": 0}},
      },

      # Aggregated data
      "files_changed": ["src/auth.ts", "src/auth.test.ts"],
      "branches": ["feature/auth-impl"],
      "pull_requests": [{"number": 42, "url": "..."}],

      # User inputs
      "inputs": {"feature_name": "authentication", "priority": "high"},
  }

  ---
  Q: Python or Claude renders?

  Python (Jinja2) - not Claude.

  Why:
  - Deterministic output (same context → same result)
  - No token cost for template rendering
  - Faster execution
  - Claude's job is producing content, not formatting it

  from jinja2 import Template

  template = Template(workflow.output_template)
  output = template.render(template_context)

  ---
  Q: When are outputs generated?

  At workflow completion (not incrementally).

  Why:
  - Templates often need final aggregated data (total files changed, all PRs, final status)
  - Incremental outputs create partial/inconsistent artifacts
  - Simpler implementation

  Exception: Progress reporting can be incremental, but that's different from the final output artifact.

  outputs:
    - template: "summary.md.j2"      # Rendered once at end
      path: ".agentic/outputs/summary.md"
      when: completed                 # Only on success

    - template: "error-report.md.j2"
      path: ".agentic/outputs/error.md"
      when: failed                    # Only on failure

  ---
  Example Template

  # Workflow Summary: {{ workflow.name }}

  ## Status: {{ steps | selectattr('status', 'eq', 'completed') | list | length }}/{{ steps | length }} steps completed

  ## Files Changed
  {% for file in files_changed %}
  - {{ file }}
  {% endfor %}

  ## Pull Requests
  {% for pr in pull_requests %}
  - [#{{ pr.number }}]({{ pr.url }})
  {% endfor %}

  Generated: {{ workflow.completed_at }}
```

### 6. Configuration Inheritance

The document mentions workflow-level settings can override global config, but:

- What is the exact precedence order?
- Can step-level settings override workflow-level settings?
- Are there any settings that cannot be overridden?

Step levels settings override workflow level settings which can override global settings

### 7. Analyse Command Autofix Flow

The Analyse Codebase workflow mentions:

> "When autofix is enabled, the workflow is composed of 5 branches, that each have two steps (analyse + fix)."

But:

- How does the fix step receive the analysis results?
  The analysis result is saved as .md file
- What determines which issues get fixed (the `autofix` severity level)?
  Yes
- Is the fix step a separate command or a prompt with the analysis output?
  A prompt step that instruct Claude to fix every elements in the document that are X severity or higher

### 8. Worktree Naming Convention

For parallel steps using worktrees:

- What naming convention is used for worktree directories?
  Use workflow name, step name (in the parallel) and random 6 char identifier
- How are branch names generated for each parallel step?
  Use workflow name, step name (in the parallel) and random 6 char identifier
- What happens if a branch name conflicts with an existing branch?
  Retry branch creation and fail step if it fails again

### 9. Session Variables and State Passing

The document doesn't specify:

- How step outputs are made available to subsequent steps
  Almost every cases will be a .md document generated by the previous step. The step will output json, for exemple with the document path and additional context. This output should be stored in the workflow progress document (to allow continuation) and it should then be passed as input to the next workflow step
- What format step outputs use (raw text, structured JSON, file paths)?
  Structured json
- Maximum size of outputs that can be passed between steps
  Json metadata 10 KB

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

Don't include this for now. COnsidering that every milestone of a plan will be a session, it should cover the session context limit correctly. Plan results should include, as a first section (add to the template) a short list of every milestones and task used to track progress. When an implementation session ends, it update the plan with the progress made.

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

No, use Claude during generation, but support providing a plan template in the step, that would then be passed to the plan command. If no plan template is provided, the default template is used.

### 3. Error Context for Retries

When retrying a failed step, include failure context:

```yaml
# In the retry prompt, automatically include:
Previous attempt failed with error: { error_message }
Error type: { error_type }
Last checkpoint: { checkpoint_summary }
```

Yes.

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

Yes

### 5. Workflow Inheritance

Allow workflows to extend other workflows:

```yaml
extends: base-plan-build.yaml
steps:
  - name: custom-step
    insert-after: plan
    # ...
```

Not exacly, but in Phase 2 / future development, we might want to consider a step that runs a full existing workflow, to be able to run workflows within workflows.

### 6. Progress Webhooks

For CI/CD integration, allow webhook notifications:

```yaml
settings:
  webhooks:
    on-step-complete: https://ci.example.com/webhook
    on-error: https://ci.example.com/alert
```

For Phase 2

### 7. Dry Run Mode

Add a more detailed dry-run that validates:

- All referenced templates exist
- All commands/agents are available
- Variable types match expected schemas
- Git repository state is valid for worktree operations

Don't add dry-run, I'll never use it and it adds unecessary complexity, extra arguments, additional code, etc.

---

## Technical Concerns

### 1. Race Conditions in Progress.json

Multiple parallel Claude sessions writing to progress.json could cause race conditions. Consider:

- File locking mechanisms
- Separate progress files per parallel branch (as noted in the document)
- Using a proper database for concurrent access

Use a file locking mechanism for now.

### 2. Worktree Cleanup on Crash

If the Python orchestrator crashes mid-workflow:

- How are orphaned worktrees cleaned up?
- Is there a recovery mechanism to resume from the last checkpoint?
- What happens to in-flight Claude sessions?

```
Simplest Approach: Startup Cleanup + Progress Document Resume

  1. Orphaned Worktrees

  Run cleanup at workflow start, not during crashes:

  def start_workflow():
      # Clean any orphaned worktrees from previous runs
      subprocess.run(["git", "worktree", "prune"])

      # Also clean worktrees with known prefix
      for wt in list_worktrees():
          if wt.startswith(".agentic-wt-") and is_stale(wt):
              subprocess.run(["git", "worktree", "remove", "--force", wt])

  Why this works:
  - No complex crash detection needed
  - Always starts clean
  - Git's built-in prune handles most cases

  ---
  2. Resume from Checkpoint

  Use the workflow progress document you already have:

  # .agentic/progress/workflow-abc123.yaml
  workflow: feature-implementation
  started: 2024-01-09T10:00:00Z
  steps:
    - id: plan
      status: completed
      output: { plan_path: ".agentic/plans/feature.md" }
    - id: implement
      status: in_progress    # <-- Crashed here
      started: 2024-01-09T10:15:00Z

  On restart:
  def resume_workflow(progress_file):
      progress = load_progress(progress_file)

      for step in progress.steps:
          if step.status == "completed":
              continue
          if step.status == "in_progress":
              step.status = "pending"  # Retry from scratch

          execute_step(step)

  ---
  3. In-Flight Claude Sessions

  Simplest: Let them die, retry the step.

  - Child processes die when parent crashes
  - Even if Claude finished, output wasn't captured
  - Treat the step as failed, re-run on resume

  No special handling needed. The progress document shows in_progress, resume logic retries it.

  ---
  Summary
  ┌────────────────────┬───────────────────────────────────────────────────────────────────┐
  │      Problem       │                             Solution                              │
  ├────────────────────┼───────────────────────────────────────────────────────────────────┤
  │ Orphaned worktrees │ git worktree prune + prefix cleanup at startup                    │
  ├────────────────────┼───────────────────────────────────────────────────────────────────┤
  │ Resume mechanism   │ Progress document tracks state; restart retries in_progress steps │
  ├────────────────────┼───────────────────────────────────────────────────────────────────┤
  │ In-flight Claude   │ Dies with parent; retry on resume                                 │
  └────────────────────┴───────────────────────────────────────────────────────────────────┘
  Total complexity: ~20 lines of code. No crash handlers, no signal trapping, no distributed state.
```

### 3. Windows Path Handling

The document uses `/agentic` for paths, but on Windows:

- Should this be relative to the repository root?
- How are paths normalized across platforms?
- The referenced code uses `Path` objects - is Windows compatibility tested?

1. Always Use Relative Paths from Repo Root
2. In YAML/JSON: Always use forward slashes
   In Python: Use pathlib.Path consistently
3. Windows Compatibility

Simple rules:

- Use pathlib.Path everywhere, never string concatenation
- Forward slashes in all config files
- Use Path.as_posix() when writing paths to YAML/JSON
- Test on Windows (you're on Windows now, so this should be natural)

### 4. Claude Session Timeout

The workflow timeout is in minutes, but:

- What happens if a Claude session hangs without returning?
- Is there a mechanism to kill stuck sessions?
- How is the timeout enforced (Python-side process timeout)?

Use python-side process timeout

### 5. Jinja2 Template Security

If user-provided templates are evaluated:

- Are dangerous Jinja2 features disabled (exec, import)?
  yes
- Can templates access the filesystem or environment?
  no
- Is there sandboxing for template execution?
  no

---

## Errors and Corrections

Fix all these.

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

It's both, command are installed as a claude plugin, and the python CLI tools are install with uv tool

### 2. Dependency on interactive-sdlc

Many commands reference interactive-sdlc. Does agentic-workflows:

- Depend on interactive-sdlc being installed?
- Include copies of these commands?
- Provide its own implementations?

This affects package dependencies and maintenance.

It includes it's own implementation of these commands, that will be very similar, but adapted to agentic workflow, like json outputs, no user interaction, etc. The agentic workflow plugin will never depend on another plugin.

### 3. Claude Code Version Requirements

The document doesn't specify:

- Minimum Claude Code version required
- Which Claude Code features are used (--print, --dangerously-skip-permissions, etc.)
- Compatibility with different Claude Code configurations

For now assume no compatibility issue and latest version of Claude Code.

### 4. Provider Lock-in

The design assumes Claude Code specifically. The agentic-core vision included provider abstraction for Cursor, Codex, etc. Should agentic-workflows:

- Be Claude-only (simpler)?
- Include provider abstraction (more complex, but aligns with agentic-core)?

Be Claude-only (simpler)

---

## Summary of Highest-Priority Items

1. **Clarify the orchestrator command contract** - The exact interface between Python and Claude is the core of the architecture
2. **Resolve memory system architecture** - File-based vs database-backed is a fundamental design decision
3. **Define command JSON output format** - Without this, the Python orchestrator can't parse step results
4. **Specify agent file structure** - Agents are mentioned but never defined
5. **Detail checkpoint/restore mechanism** - Critical for long-running workflows
6. **Address parallel worktree merge conflicts** - Common scenario with no documented handling
