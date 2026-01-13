# Improvements

This file tracks improvement opportunities identified during code analysis. Each improvement has a checklist entry for progress tracking and a detailed section explaining the issue.

## How to Use This File

1. **Adding Improvements**: Add a checkbox to the Progress Tracking section (`- [ ] IMP-XXX: Short title`) and a corresponding details section with problem description, files to investigate, and acceptance criteria.
2. **Working on Improvements**: Mark the item as in-progress by keeping `[ ]` and update the Status in the details section to "In Progress".
3. **Completing Improvements**: Change `[ ]` to `[x]` and update the Status to "Completed".
4. **Implementation**: Use `/interactive-sdlc:one-shot` or `/agentic-sdlc:build` to implement individual improvements.

## Progress Tracking

- [ ] IMP-001: Workflow outputs should write to workflow output directory
- [ ] IMP-002: Fix analysis summary template malformed output
- [ ] IMP-003: Split analyse command into 5 distinct commands
- [ ] IMP-004: Commands must use full namespace in workflows
- [ ] IMP-005: Normalize PR creation as workflow variable with conditional step
- [ ] IMP-006: Replace fix prompt steps with ralph-loop in analyse workflows
- [ ] IMP-007: Standardize Claude session output format and execution context

## Improvements List

List the details of every improvement request, 100 lines maximum per item.

---

### IMP-001: Workflow outputs should write to workflow output directory

**Status**: Pending

**Problem**: Workflow output files are written to hardcoded paths (e.g., `agentic/analysis/summary.md`) instead of the workflow output directory (e.g., `agentic/outputs/20260113-111144-analyse-codebase/`).

**Files to Investigate**:

- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase.yaml` - Line 131: `path: agentic/analysis/summary.md`
- `plugins/agentic-sdlc/src/agentic_sdlc/renderer.py` - `render_workflow_output()` function
- Workflow executor code that handles the `outputs` section

**Expected Behavior**: When a workflow defines an output like:

```yaml
outputs:
  - name: analysis-summary
    template: analysis-summary.md.j2
    path: summary.md # Relative to output directory
```

The file should be created at `agentic/outputs/<timestamp>-<workflow>/summary.md`.

**Acceptance Criteria**:

- [ ] Output paths in workflow YAML are relative to workflow output directory
- [ ] Workflow executor resolves output paths against the output directory
- [ ] Existing workflows updated to use relative paths

---

### IMP-002: Fix analysis summary template malformed output

**Status**: Pending

**Problem**: The analysis summary output (`agentic/analysis/summary.md`) contains many empty lines and missing data. The template iterates over all steps but the step structure is nested (parallel > serial > steps) while the template expects a flat dictionary.

**Observed Issues**:

1. Many consecutive empty lines between table rows and sections
2. Step count shows "21 analysis types" but only 6 are rendered
3. Table rows have gaps due to empty iterations
4. Steps like `analyse-bug` are nested inside `bug-analysis` serial block, inside `analyse-and-fix-all` parallel block

**Files to Investigate**:

- `plugins/agentic-sdlc/src/agentic_sdlc/templates/analysis-summary.md.j2` - Template logic
- `plugins/agentic-sdlc/src/agentic_sdlc/renderer.py` - `build_template_context()` function
- Workflow executor that builds `step_outputs` dictionary

**Root Cause**: The Jinja2 template uses:

```jinja
{% for step_name, step in steps.items() %}
{% if step_name.startswith('analyse-') %}
```

But nested steps (inside parallel/serial blocks) are not flattened, so the filter matches incorrectly and produces empty output for non-matching iterations.

**Acceptance Criteria**:

- [ ] Template context flattens nested steps or provides proper accessor
- [ ] No empty lines in rendered output
- [ ] All analysis steps are properly rendered in the summary table
- [ ] Step summaries contain actual analysis results, not "Unknown skill: analyse"

---

### IMP-003: Split analyse command into 5 distinct commands

**Status**: Pending

**Problem**: The current `analyse.md` command is a monolithic command that handles all 5 analysis types via a `type` argument. This causes:

- Context bloat: All analysis guidelines are loaded even when only one type is needed
- Generic output: Single output format must accommodate all types
- Limited customization: Each analysis type has different criteria and output needs
- Incomplete documentation: Each type's specifics are abbreviated

**Current State**:

- `plugins/agentic-sdlc/commands/analyse.md` - Single command with `type` argument (bug, debt, doc, security, style, all)

**Target State**: Create 5 specialized commands:

- `plugins/agentic-sdlc/commands/analyse/analyse-bug.md`
- `plugins/agentic-sdlc/commands/analyse/analyse-debt.md`
- `plugins/agentic-sdlc/commands/analyse/analyse-doc.md`
- `plugins/agentic-sdlc/commands/analyse/analyse-security.md`
- `plugins/agentic-sdlc/commands/analyse/analyse-style.md`

**Reference Implementation**: Use interactive-sdlc commands as templates:

- `plugins/interactive-sdlc/commands/analyse/analyse-bug.md`
- `plugins/interactive-sdlc/commands/analyse/analyse-debt.md`
- `plugins/interactive-sdlc/commands/analyse/analyse-doc.md`
- `plugins/interactive-sdlc/commands/analyse/analyse-security.md`
- `plugins/interactive-sdlc/commands/analyse/analyse-style.md`

**Template Requirements**: Each command must follow `docs/templates/command-template.md`:

- Frontmatter: name, description, argument-hint
- Sections: Arguments, Objective, Core Principles, Instructions, Output Guidance
- Optional: Templates (report structure), Configuration, Important Notes

**Key Differences from interactive-sdlc**:

- Output format: JSON (for workflow integration) + markdown report
- Output location: Workflow output directory, not fixed `/analysis/`
- Configuration: Read from workflow context, not `.claude/settings.json`

**Workflows to Update**:

- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase.yaml`
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase-merge.yaml`
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-single.yaml`

**Acceptance Criteria**:

- [ ] 5 separate command files created in `commands/analyse/` subdirectory
- [ ] Each command follows the command template exactly
- [ ] Each command has type-specific criteria, output format, and report template
- [ ] Commands return JSON for workflow integration
- [ ] Original `analyse.md` removed or deprecated
- [ ] All 3 workflows updated to use new command names (analyse-bug, analyse-debt, etc.)

---

### IMP-004: Commands must use full namespace in workflows

**Status**: Pending

**Problem**: Workflows currently use short command names (e.g., `analyse`, `validate`, `git-pr`) without plugin namespace prefix. This creates ambiguity and risk of executing commands from other plugins like `interactive-sdlc` instead of `agentic-sdlc`.

**Example of Current Issue**:

```yaml
- type: command
  command: analyse # Could match interactive-sdlc:analyse or agentic-sdlc:analyse
```

**Required Format**:

```yaml
- type: command
  command: agentic-sdlc:analyse # Explicit, unambiguous
```

**Commands Requiring Namespace**:

- `analyse` -> `agentic-sdlc:analyse` (or `agentic-sdlc:analyse-bug`, etc. after IMP-003)
- `validate` -> `agentic-sdlc:validate`
- `git-pr` -> `agentic-sdlc:git-pr`
- `plan` -> `agentic-sdlc:plan`

**Workflows to Update**:

- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase.yaml` - uses: analyse
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase-merge.yaml` - uses: analyse, validate, git-pr
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-single.yaml` - uses: analyse
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/one-shot.yaml` - uses: validate, git-pr
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/plan-build-validate.yaml` - uses: plan, validate, git-pr

**Documentation Updates Required**:

- `CLAUDE.md` - Add guideline that commands in workflows must use full namespace
- `README.md` - Document namespace convention in usage examples
- Plugin README files - Update examples to show namespaced commands

**Acceptance Criteria**:

- [ ] All workflows updated to use `agentic-sdlc:` prefix for commands
- [ ] `CLAUDE.md` updated with namespace guideline for workflows
- [ ] `README.md` updated with namespace convention documentation
- [ ] Runner code validates/warns when non-namespaced commands are used

---

### IMP-005: Normalize PR creation as workflow variable with conditional step

**Status**: Pending

**Problem**: PR creation in parallel workflows is handled by `_create_branch_pr` method in executor.py (lines 584-607), which is triggered by `git.auto_pr: true` on parallel steps. This:

- Mixes infrastructure logic with workflow execution
- Hardcodes PR behavior that should be declarative in YAML
- Creates inconsistency with workflows like `one-shot.yaml` that use conditional steps

**Current Pattern** (executor.py lines 533-534):

```python
if auto_pr and worktree and step.merge_mode == "independent":
    self._create_branch_pr(branch_step.name, worktree, logger, console)
```

**Desired Pattern** (as shown in one-shot.yaml):

```yaml
variables:
  - name: create_pr
    type: boolean
    required: false
    default: true
    description: Whether to create a PR

steps:
  # ... other steps ...
  - name: create-pr
    type: conditional
    condition: "variables.create_pr"
    then:
      - name: open-pr
        type: command
        command: agentic-sdlc:git-pr
        args:
          draft: false
```

**Code Changes Required**:

- `plugins/agentic-sdlc/src/agentic_sdlc/executor.py`:
  - Delete `_create_branch_pr` method (lines 584-607)
  - Remove call to `_create_branch_pr` in `_execute_parallel_step` (lines 533-534)
  - Keep worktree management but remove auto-pr logic

**Schema Changes Required**:

- `plugins/agentic-sdlc/schemas/workflow.schema.json`:
  - Remove or deprecate `auto-pr` from `step-git` definition (lines 254-258)
  - Keep `settings.git.auto-pr` only for workflow-level default behavior reference

**Workflows to Update**:

- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase.yaml`:
  - Remove `auto-pr: true` from parallel step git config
  - Add `create_pr` variable at workflow level
  - Add conditional step with git-pr command inside each serial block (or after parallel)
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase-merge.yaml`:
  - Same pattern as above
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/one-shot.yaml`:
  - Already follows correct pattern (reference implementation)
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/plan-build-validate.yaml`:
  - Verify follows correct pattern

**Acceptance Criteria**:

- [ ] `_create_branch_pr` method deleted from executor.py
- [ ] Auto-pr call removed from `_execute_parallel_step`
- [ ] `auto-pr` removed from `step-git` schema definition
- [ ] All workflows use `create_pr` variable at workflow level
- [ ] All workflows use conditional step with git-pr command for PR creation
- [ ] Parallel branches in worktrees still work correctly (just without auto-pr)

---

### IMP-006: Replace fix prompt steps with ralph-loop in analyse workflows

**Status**: Pending

**Problem**: Current analyse workflows use simple `prompt` steps to fix issues (e.g., "Fix all issues with severity X or higher"). This approach:

- Tries to fix everything in one go, which can overwhelm the agent
- No iterative progress tracking
- No structured completion detection
- Agent may skip issues or produce incomplete fixes

**Current Pattern** (analyse-codebase.yaml lines 42-46):

```yaml
- name: apply-bug-fixes
  type: prompt
  prompt: |
    Review the bug analysis in agentic/analysis/bug.md.
    Fix all issues with severity {{ variables.autofix }} or higher.
    Commit fixes with clear messages.
```

**Desired Pattern** (using ralph-loop):

````yaml
- name: apply-bug-fixes
  type: ralph-loop
  max-iterations: 10
  completion-promise: "ANALYSIS_FIXES_COMPLETE"
  model: sonnet
  timeout-minutes: 30
  prompt: |
    ## Task
    Fix issues from the bug analysis document.

    ## Instructions
    1. Read the analysis document at agentic/analysis/bug.md
    2. If the document does not exist or has no unfixed issues, return the completion promise
    3. Pick the NEXT unfixed issue (highest severity first)
    4. Navigate the code to understand the issue context
    5. Implement the fix
    6. Run 'pnpm build' and 'pnpm lint' and fix any errors
    7. Mark the issue as fixed in the analysis document
    8. Commit using /agentic-sdlc:git-commit with title starting with issue ID
    9. End this session (do NOT continue to next issue)

    ## Completion
    When ALL issues are fixed OR the document doesn't exist, output:
    ```json
    {"ralph_complete": true, "promise": "ANALYSIS_FIXES_COMPLETE"}
    ```

    IMPORTANT:
    - Fix only ONE issue per iteration, then end session
    - If an issue cannot be fixed (error, missing data), mark as skipped with reason
    - Only return completion promise when genuinely done
````

**Reference Implementation**:

- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/ralph-loop.yaml` - Ralph loop pattern example

**Workflows to Update**:

- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase.yaml`:
  - Replace all 5 `apply-*-fixes` prompt steps with ralph-loop steps
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase-merge.yaml`:
  - Same pattern
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-single.yaml`:
  - Add ralph-loop fix step if autofix is enabled

**Variables to Add**:

- `max_fix_iterations` (default: 10) - Maximum iterations per analysis type

**Acceptance Criteria**:

- [ ] All `apply-*-fixes` prompt steps replaced with ralph-loop steps
- [ ] Each ralph-loop reads analysis doc, picks ONE issue, fixes it, commits, ends
- [ ] Completion promise returned when doc missing or all issues fixed
- [ ] Issues that can't be fixed are marked as skipped with reason
- [ ] Commits include issue ID in title (e.g., "[BUG-001] Fix null check")
- [ ] Build and lint run after each fix

---

### IMP-007: Standardize Claude session output format and execution context

**Status**: Pending

**Problem**: Claude sessions in agentic-sdlc have no standardized output format or execution context. This causes:

- Inconsistent outputs that are hard to parse programmatically
- No session ID for resuming failed sessions
- No clear success/failure indicator
- Claude may ask questions or request permissions that can't be granted in agentic mode

**Required Base System Prompt**: Create `plugins/agentic-sdlc/prompts/agentic-system.md`:

````markdown
## Execution Context

You are being executed in an agentic workflow without user interaction.

**Constraints**:

- You CANNOT ask user questions - make reasonable decisions autonomously
- You CANNOT request additional permissions - if permissions are missing, end the session
- You MUST complete the task or report failure with details

## Required Output Format

At the END of your session, you MUST output a JSON block. The block MUST contain these base keys:

```json
{
  "sessionId": "<session-id-for-resume>",
  "isSuccess": true|false,
  "context": "2-5 sentence summary of what was done, any errors encountered, and important notes"
}
```

**Base Keys** (REQUIRED in every output):
- `sessionId`: The session ID for /resume capability
- `isSuccess`: Boolean indicating if the task completed successfully
- `context`: 2-5 sentence summary of what was done, errors if any, important notes

**Additional Keys**: The prompt or command may require additional keys in the output JSON. Include any extra keys requested alongside the base keys.

This JSON block is REQUIRED. Include it as the last thing in your output.
````

**Implementation**: Use `--append-system-prompt` flag in runner.py

This approach:
- Appends to Claude's default system prompt (doesn't replace it)
- Works automatically for both `run_claude()` and `run_claude_with_command()`
- No need to modify individual commands
- System prompt defined once in a file

**Files to Create**:

- `plugins/agentic-sdlc/prompts/agentic-system.md` - Base system prompt file

**Files to Modify**:

- `plugins/agentic-sdlc/src/agentic_sdlc/runner.py`:
  - Add `--append-system-prompt` flag pointing to `prompts/agentic-system.md`
  - Apply to both `run_claude()` and `run_claude_with_command()` subprocess calls

```python
SYSTEM_PROMPT_FILE = Path(__file__).parent.parent / "prompts" / "agentic-system.md"

def run_claude(...):
    cmd = [
        "claude",
        "--append-system-prompt", SYSTEM_PROMPT_FILE.read_text(),
        ...
    ]
```

- `plugins/agentic-sdlc/src/agentic_sdlc/executor.py`:
  - Parse JSON output from Claude sessions
  - Store `sessionId` for potential resume
  - Use `isSuccess` for step success/failure determination
  - Log `context` in workflow output

**Output Parsing**:

```python
import json
import re

def parse_session_output(stdout: str) -> dict:
    """Extract the required JSON block from Claude output."""
    # Find last JSON block containing base keys
    json_pattern = r'\{[^{}]*"sessionId"[^{}]*"isSuccess"[^{}]*"context"[^{}]*\}'
    matches = re.findall(json_pattern, stdout, re.DOTALL)
    if matches:
        return json.loads(matches[-1])
    return {"sessionId": None, "isSuccess": False, "context": "No output JSON found"}
```

**Acceptance Criteria**:

- [ ] `prompts/agentic-system.md` file created with base system prompt
- [ ] `--append-system-prompt` flag added to all Claude subprocess calls in runner.py
- [ ] Execution context clearly states no questions, no permission requests
- [ ] Output JSON format documents base keys AND that additional keys may be required
- [ ] Executor parses JSON output for success/failure/context
- [ ] Session ID captured for potential /resume capability
- [ ] No modifications needed to individual commands
