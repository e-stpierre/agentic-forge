# Improvements

This file tracks improvement opportunities identified during code analysis. Each improvement has a checklist entry for progress tracking and a detailed section explaining the issue.

## How to Use This File

1. **Adding Improvements**: Add a checkbox to the Progress Tracking section (`- [ ] IMP-XXX: Short title`) and a corresponding details section with problem description, files to investigate, and acceptance criteria.
2. **Working on Improvements**: Mark the item as in-progress by keeping `[ ]` and update the Status in the details section to "In Progress".
3. **Completing Improvements**: Change `[ ]` to `[x]` and update the Status to "Completed".
4. **Implementation**: Use `/interactive-sdlc:one-shot` or `/agentic-sdlc:build` to implement individual improvements.

## Progress Tracking

- [x] IMP-001: Workflow outputs should write to workflow output directory
- [x] IMP-002: Fix analysis summary template malformed output
- [x] IMP-003: Split analyse command into 5 distinct commands
- [ ] IMP-004: Commands must use full namespace in workflows
- [ ] IMP-005: Normalize PR creation as workflow variable with conditional step
- [ ] IMP-006: Replace fix prompt steps with ralph-loop in analyse workflows
- [ ] IMP-007: Standardize Claude session output format and execution context
- [ ] SEC-001: Fix Jinja2 template injection vulnerability (disabled autoescaping)
- [ ] SEC-002: Fix command injection via shell=True using shutil.which()
- [ ] DEBT-001: Refactor monolithic executor, orchestrator, and CLI classes
- [ ] TEST-001: Setup pytest architecture and add initial tests for agentic-sdlc
- [ ] TEST-002: Add comprehensive test coverage for all agentic-sdlc modules
- [ ] TEST-003: Add CI GitHub action for Python tests

## Improvements List

List the details of every improvement request, 100 lines maximum per item.

---

### IMP-001: Workflow outputs should write to workflow output directory

**Status**: Completed

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

**Status**: Completed

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

- [x] Template context flattens nested steps or provides proper accessor
- [x] No empty lines in rendered output
- [x] All analysis steps are properly rendered in the summary table
- [x] Step summaries contain actual analysis results, not "Unknown skill: analyse"

---

### IMP-003: Split analyse command into 5 distinct commands

**Status**: Completed

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
- Add an important instruction that only real issue must be reported, don't add anything in the document that is already resolved
- The analyse commands must all support an optional argument that is the list of path to consider during the analysis. When this argument is provided, only this list of path is considered. The analyse workflows must support this list of path as variable and pass it to the commands.

**Workflows to Update**:

- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase.yaml`
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-codebase-merge.yaml`
- `plugins/agentic-sdlc/src/agentic_sdlc/workflows/analyse-single.yaml`

**Acceptance Criteria**:

- [x] 5 separate command files created in `commands/analyse/` subdirectory
- [x] Each command follows the command template exactly
- [x] Each command has type-specific criteria, output format, and report template
- [x] Commands return JSON for workflow integration
- [x] Original `analyse.md` removed or deprecated
- [x] All 3 workflows updated to use new command names (analyse-bug, analyse-debt, etc.)

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

---

### SEC-001: Fix Jinja2 template injection vulnerability (disabled autoescaping)

**Status**: Pending

**Severity**: High (CWE-1336: Server-Side Template Injection)

**Problem**: The Jinja2 template environment is configured with `autoescape=False`, which disables automatic HTML escaping. While templates are used for generating prompts (not HTML), the template resolver accepts arbitrary template strings via `from_string()` and renders them with user-provided context data.

**Vulnerable Locations**:

- `experimental-plugins/agentic-core/src/agentic_core/workflow/templates.py:15`
- `plugins/agentic-sdlc/src/agentic_sdlc/renderer.py:20-24`

**Current Code**:

```python
self.env = Environment(
    undefined=StrictUndefined,
    autoescape=False,  # DANGEROUS
    trim_blocks=True,
    lstrip_blocks=True,
)
```

**Risk**: If an attacker can control any part of the template string (via workflow files, configuration, or other inputs), they could inject malicious Jinja2 code that executes arbitrary Python code during template rendering. This could lead to:

- Remote code execution
- File system access
- Data exfiltration
- Environment variable leakage

**Remediation**:

1. **Enable autoescape** using `select_autoescape`
2. **Validate template sources**: Only load templates from trusted sources
3. **Use sandboxed environment**: Consider `jinja2.sandbox.SandboxedEnvironment` for untrusted templates

**Fixed Code**:

```python
from jinja2 import Environment, StrictUndefined, select_autoescape

self.env = Environment(
    undefined=StrictUndefined,
    autoescape=select_autoescape(default=True),
    trim_blocks=True,
    lstrip_blocks=True,
)
```

**Alternative (Sandboxed)**:

```python
from jinja2.sandbox import SandboxedEnvironment

self.env = SandboxedEnvironment(
    undefined=StrictUndefined,
    autoescape=select_autoescape(default=True),
    trim_blocks=True,
    lstrip_blocks=True,
)
```

**Files to Modify**:

- `experimental-plugins/agentic-core/src/agentic_core/workflow/templates.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/renderer.py`

**References**:

- CWE-1336: https://cwe.mitre.org/data/definitions/1336.html
- OWASP A03:2021 Injection

**Acceptance Criteria**:

- [ ] `autoescape=select_autoescape(default=True)` enabled in all Jinja2 environments
- [ ] Consider using `SandboxedEnvironment` for workflow templates
- [ ] Template sources validated to be from trusted locations only
- [ ] Test that existing templates still render correctly with autoescaping enabled

---

### SEC-002: Fix command injection via shell=True using shutil.which()

**Status**: Pending

**Severity**: High (CWE-78: OS Command Injection)

**Problem**: Multiple instances of `subprocess.run()` and `subprocess.Popen()` use `shell=True` with dynamically constructed command strings. This was added for Windows compatibility (PATH resolution), but creates a command injection vulnerability if any argument contains shell metacharacters.

**Vulnerable Locations**:

- `.claude/update-plugins.py:137`
- `plugins/agentic-sdlc/src/agentic_sdlc/runner.py:91,132,186`
- `plugins/agentic-sdlc/src/agentic_sdlc/git/worktree.py:37`
- `experimental-plugins/agentic-core/src/agentic_core/git/worktree.py:58`
- `experimental-plugins/agentic-core/src/agentic_core/runner.py:76,117,174`
- `experimental-plugins/agentic-core/src/agentic_core/providers/base.py:149,198`
- `experimental-plugins/agentic-core/src/agentic_core/providers/claude.py:158`

**Current Vulnerable Code**:

```python
cmd = ["claude", "--print", prompt, ...]
process = subprocess.Popen(
    cmd,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    cwd=cwd_str,
    shell=True,  # VULNERABLE - needed for Windows PATH resolution
)
```

**Risk**: If user input (prompts, file paths, branch names) contains shell metacharacters like `; && | $()`, they could be interpreted by the shell, leading to:

- Arbitrary code execution
- Data exfiltration
- System compromise

**Solution**: Use `shutil.which()` to resolve executable path before subprocess call

This approach:

- Resolves the full path to the executable in Python
- Eliminates the need for `shell=True` entirely
- Works on both Windows and Unix
- No input sanitization complexity

**Implementation**:

Create a utility function in each affected module:

```python
import shutil
from pathlib import Path

def get_executable(name: str) -> str:
    """Resolve executable path for cross-platform subprocess calls.

    Uses shutil.which() to find the full path, allowing shell=False
    in subprocess calls while maintaining Windows compatibility.

    Args:
        name: Executable name (e.g., "claude", "git")

    Returns:
        Full path to the executable

    Raises:
        FileNotFoundError: If executable not found in PATH
    """
    path = shutil.which(name)
    if not path:
        raise FileNotFoundError(f"Executable not found in PATH: {name}")
    return path
```

**Fixed Code**:

```python
claude_path = get_executable("claude")
process = subprocess.Popen(
    [claude_path, "--print", prompt, ...],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    cwd=cwd_str,
    shell=False,  # SAFE - full path resolved, no shell needed
)
```

**Files to Modify**:

- `plugins/agentic-sdlc/src/agentic_sdlc/runner.py` - Add `get_executable()`, update all subprocess calls
- `plugins/agentic-sdlc/src/agentic_sdlc/git/worktree.py` - Update git subprocess calls
- `experimental-plugins/agentic-core/src/agentic_core/runner.py` - Same pattern
- `experimental-plugins/agentic-core/src/agentic_core/git/worktree.py` - Same pattern
- `experimental-plugins/agentic-core/src/agentic_core/providers/base.py` - Same pattern
- `experimental-plugins/agentic-core/src/agentic_core/providers/claude.py` - Same pattern
- `.claude/update-plugins.py` - Same pattern

**References**:

- CWE-78: https://cwe.mitre.org/data/definitions/78.html
- OWASP A03:2021 Injection

**Acceptance Criteria**:

- [ ] `get_executable()` utility function added to affected modules
- [ ] All `subprocess.Popen()` and `subprocess.run()` calls use `shell=False`
- [ ] Executable paths resolved via `shutil.which()` before subprocess calls
- [ ] Windows compatibility verified (test on Windows with `claude` in PATH)
- [ ] Unix compatibility verified
- [ ] Error handling for missing executables (clear error message)

---

### DEBT-001: Refactor monolithic executor, orchestrator, and CLI classes

**Status**: Pending

**Severity**: Major

**Priority**: High (should be completed before TEST-001 to ensure clean testable code)

**Problem**: Large classes with multiple responsibilities violate Single Responsibility Principle, making them difficult to test, maintain, and extend.

**Affected Files**:

| File                                                    | Lines | Responsibilities                                                                          |
| ------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `plugins/agentic-sdlc/src/agentic_sdlc/executor.py`     | 827   | Parallel execution, conditional logic, step dispatch, error recovery, worktree management |
| `plugins/agentic-sdlc/src/agentic_sdlc/orchestrator.py` | 752   | Decision loop, signal handling, progress updates, workflow coordination                   |
| `plugins/agentic-sdlc/src/agentic_sdlc/cli.py`          | 630   | Argument parsing, subcommand routing, I/O coordination, validation                        |

**Issues**:

- **executor.py**: The `WorkflowExecutor` class handles parallel execution, conditional evaluation, prompt/command execution, Ralph loops, serial steps, error recovery, and worktree management all in one 827-line class
- **orchestrator.py**: Combines decision loop management, signal handling, progress tracking, and workflow state management
- **cli.py**: Mixes argument parsing, validation, subcommand dispatch, and I/O handling

**Proposed Refactoring**:

Extract concerns into focused, single-responsibility classes:

**From executor.py**:

```
executor.py (827 lines) ->
  ├── executor.py (~200 lines)           # Core WorkflowExecutor, step dispatch
  ├── steps/
  │   ├── prompt_step.py (~100 lines)    # Prompt step execution
  │   ├── command_step.py (~80 lines)    # Command step execution
  │   ├── parallel_step.py (~150 lines)  # Parallel execution with worktrees
  │   ├── serial_step.py (~60 lines)     # Serial step execution
  │   ├── conditional_step.py (~80 lines)# Condition evaluation and dispatch
  │   └── ralph_loop_step.py (~120 lines)# Ralph loop iteration logic
  └── error_handler.py (~80 lines)       # Retry logic, error recovery
```

**From orchestrator.py**:

```
orchestrator.py (752 lines) ->
  ├── orchestrator.py (~200 lines)       # Core orchestration logic
  ├── decision_loop.py (~150 lines)      # Decision loop management
  ├── signal_manager.py (~80 lines)      # Graceful shutdown, SIGINT handling
  └── state_manager.py (~100 lines)      # Workflow state transitions
```

**From cli.py**:

```
cli.py (630 lines) ->
  ├── cli.py (~150 lines)                # Main entry point, argument parsing
  ├── commands/
  │   ├── run.py (~100 lines)            # 'run' subcommand handler
  │   ├── resume.py (~80 lines)          # 'resume' subcommand handler
  │   ├── status.py (~60 lines)          # 'status' subcommand handler
  │   └── list.py (~50 lines)            # 'list' subcommand handler
  └── validators.py (~80 lines)          # Input validation, type coercion
```

**Implementation Approach**:

1. **Phase 1**: Extract step executors from `executor.py`
   - Create `steps/` directory with base class and implementations
   - Each step type becomes its own class with `execute()` method
   - Core executor dispatches to appropriate step handler

2. **Phase 2**: Extract orchestrator concerns
   - Signal handling into dedicated `SignalManager`
   - State management into `StateManager`
   - Decision loop into `DecisionLoop`

3. **Phase 3**: Extract CLI concerns
   - Subcommands into individual handler modules
   - Validation into dedicated validators

**Benefits**:

- **Testability**: Each class can be unit tested in isolation
- **Maintainability**: Changes to one step type don't affect others
- **Extensibility**: Adding new step types is a new file, not editing a 800-line class
- **Readability**: Each file has a clear, focused purpose

**Files to Create**:

- `plugins/agentic-sdlc/src/agentic_sdlc/steps/__init__.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/steps/base.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/steps/prompt_step.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/steps/command_step.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/steps/parallel_step.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/steps/serial_step.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/steps/conditional_step.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/steps/ralph_loop_step.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/error_handler.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/signal_manager.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/commands/__init__.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/commands/run.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/commands/resume.py`
- `plugins/agentic-sdlc/src/agentic_sdlc/validators.py`

**Files to Modify**:

- `plugins/agentic-sdlc/src/agentic_sdlc/executor.py` - Reduce to dispatcher
- `plugins/agentic-sdlc/src/agentic_sdlc/orchestrator.py` - Extract concerns
- `plugins/agentic-sdlc/src/agentic_sdlc/cli.py` - Extract subcommands

**Acceptance Criteria**:

- [ ] Step executors extracted into `steps/` directory with base class
- [ ] Each step type (prompt, command, parallel, serial, conditional, ralph-loop) in own file
- [ ] Error handling extracted into dedicated `error_handler.py`
- [ ] Signal handling extracted from orchestrator
- [ ] CLI subcommands extracted into `commands/` directory
- [ ] No single file exceeds 300 lines
- [ ] All existing functionality preserved (no behavioral changes)
- [ ] `uv run agentic-sdlc run` works correctly after refactoring

---

### TEST-001: Setup pytest architecture and add initial tests for agentic-sdlc

**Status**: Pending (depends on DEBT-001)

**Priority**: Critical

**Context**: The agentic-sdlc plugin has 4,692 lines of Python code across 20 modules with 0 test files. This is a critical gap for a workflow orchestration system that handles complex state management, parallel execution, file I/O, and error recovery.

**Objective**: Establish the testing infrastructure and create initial tests to validate the setup works correctly.

**Dependencies to Add** (`pyproject.toml`):

```toml
[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "pytest-cov>=4.0",
    "pytest-mock>=3.12",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = "-v --tb=short"

[tool.coverage.run]
source = ["src/agentic_sdlc"]
omit = ["*/tests/*"]

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "raise NotImplementedError",
]
```

**Directory Structure**:

```
plugins/agentic-sdlc/
  tests/
    __init__.py
    conftest.py              # Shared fixtures
    test_parser.py           # YAML parser tests
    test_config.py           # Configuration tests
    test_executor.py         # Workflow executor tests
    test_progress.py         # Progress tracking tests
    test_renderer.py         # Template rendering tests
```

**Initial Test Files**:

1. `conftest.py` - Shared fixtures:

```python
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch
import tempfile

@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)

@pytest.fixture
def mock_subprocess():
    """Mock subprocess.Popen for Claude calls."""
    with patch('agentic_sdlc.runner.subprocess.Popen') as mock:
        process = MagicMock()
        process.communicate.return_value = ('{"success": true}', '')
        process.returncode = 0
        mock.return_value = process
        yield mock

@pytest.fixture
def sample_workflow_yaml():
    """Return a minimal valid workflow YAML."""
    return """
name: test-workflow
version: "1.0"
steps:
  - name: test-step
    type: prompt
    prompt: "Test prompt"
"""
```

2. `test_parser.py` - 3-5 initial parser tests:

```python
import pytest
from agentic_sdlc.parser import parse_workflow

def test_parse_minimal_workflow(sample_workflow_yaml, temp_dir):
    """Test parsing a minimal valid workflow."""
    workflow_file = temp_dir / "workflow.yaml"
    workflow_file.write_text(sample_workflow_yaml)
    workflow = parse_workflow(workflow_file)
    assert workflow.name == "test-workflow"
    assert len(workflow.steps) == 1

def test_parse_missing_name_raises_error(temp_dir):
    """Test that missing name field raises validation error."""
    workflow_file = temp_dir / "workflow.yaml"
    workflow_file.write_text("steps: []")
    with pytest.raises(ValueError):
        parse_workflow(workflow_file)

def test_parse_invalid_yaml_raises_error(temp_dir):
    """Test that invalid YAML syntax raises error."""
    workflow_file = temp_dir / "workflow.yaml"
    workflow_file.write_text("name: [invalid yaml")
    with pytest.raises(Exception):
        parse_workflow(workflow_file)
```

3. `test_config.py` - Configuration merge test:

```python
import pytest
from agentic_sdlc.config import load_config, merge_configs

def test_load_default_config():
    """Test loading default configuration when no file exists."""
    config = load_config(Path("/nonexistent"))
    assert "defaults" in config
    assert config["defaults"]["model"] == "sonnet"
```

**Files to Create**:

- `plugins/agentic-sdlc/tests/__init__.py`
- `plugins/agentic-sdlc/tests/conftest.py`
- `plugins/agentic-sdlc/tests/test_parser.py`
- `plugins/agentic-sdlc/tests/test_config.py`

**Files to Modify**:

- `plugins/agentic-sdlc/pyproject.toml` - Add dev dependencies and pytest config

**Acceptance Criteria**:

- [ ] `pytest` and related dependencies added to `pyproject.toml`
- [ ] `tests/` directory created with proper structure
- [ ] `conftest.py` with shared fixtures (temp_dir, mock_subprocess, sample_workflow_yaml)
- [ ] 3-5 initial tests passing for parser and config modules
- [ ] `uv run pytest` executes successfully from plugin directory
- [ ] Coverage report generates correctly with `uv run pytest --cov`

---

### TEST-002: Add comprehensive test coverage for all agentic-sdlc modules

**Status**: Pending (depends on TEST-001)

**Priority**: High

**Objective**: Achieve comprehensive test coverage for all 20 modules in agentic-sdlc, targeting critical paths and error scenarios.

**Modules to Test** (by priority):

1. **Critical - Core Execution**:
   - `executor.py` - Workflow execution, step dispatch, error handling
   - `runner.py` - Claude subprocess calls, output parsing
   - `parser.py` - YAML parsing, validation, type conversion
   - `progress.py` - Progress tracking, file locking, state management

2. **High - Workflow Features**:
   - `ralph_loop.py` - Completion detection, iteration limits, JSON parsing
   - `renderer.py` - Jinja2 template rendering, variable interpolation
   - `config.py` - Configuration loading, deep merge, defaults

3. **Medium - Git Operations**:
   - `git/worktree.py` - Worktree creation, cleanup, branch management
   - `git/operations.py` - Git command execution

4. **Standard - Utilities**:
   - `console.py` - Output formatting, progress display
   - `logging/logger.py` - Workflow logging
   - `memory/` - Memory search, categorization

**Test Categories per Module**:

```python
# Example: test_executor.py structure
class TestExecutorPromptStep:
    def test_execute_prompt_success(self): ...
    def test_execute_prompt_with_retry(self): ...
    def test_execute_prompt_timeout(self): ...
    def test_execute_prompt_with_agent(self): ...

class TestExecutorParallelStep:
    def test_parallel_all_succeed(self): ...
    def test_parallel_one_fails_wait_all(self): ...
    def test_parallel_with_worktree(self): ...

class TestExecutorConditionalStep:
    def test_condition_true_executes_then(self): ...
    def test_condition_false_executes_else(self): ...
    def test_condition_variable_resolution(self): ...

class TestExecutorRalphLoop:
    def test_ralph_completes_on_promise(self): ...
    def test_ralph_max_iterations(self): ...
```

**Edge Cases to Cover**:

- YAML parser: Invalid syntax, missing required fields, type coercion
- Executor: Step failures, timeouts, retries, nested steps
- Progress: Concurrent access, file lock contention, corruption recovery
- Ralph loop: Malformed JSON, partial promise match, iteration boundary
- Git worktree: Missing git, permission errors, orphan cleanup
- Renderer: Missing variables (StrictUndefined), recursive templates

**Target Coverage**: 80%+ line coverage for critical modules

**Files to Create**:

- `tests/test_executor.py`
- `tests/test_runner.py`
- `tests/test_progress.py`
- `tests/test_ralph_loop.py`
- `tests/test_renderer.py`
- `tests/test_git_worktree.py`
- `tests/test_console.py`
- `tests/test_memory.py`

**Acceptance Criteria**:

- [ ] Test files created for all 20 modules
- [ ] Critical modules (executor, runner, parser, progress) have 80%+ coverage
- [ ] Error scenarios tested (timeouts, failures, retries, invalid input)
- [ ] Edge cases covered (empty inputs, boundary conditions, race conditions)
- [ ] All tests pass with `uv run pytest`
- [ ] Coverage report shows 80%+ overall coverage

---

### TEST-003: Add CI GitHub action for Python tests

**Status**: Pending (depends on TEST-001, TEST-002)

**Priority**: High

**Objective**: Create a GitHub Actions workflow that runs Python tests on every PR and push, ensuring code quality and preventing regressions.

**Workflow File**: `.github/workflows/python-tests.yml`

```yaml
name: Python Tests

on:
  push:
    branches: [main]
    paths:
      - "plugins/agentic-sdlc/**"
      - ".github/workflows/python-tests.yml"
  pull_request:
    branches: [main]
    paths:
      - "plugins/agentic-sdlc/**"
      - ".github/workflows/python-tests.yml"

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
        python-version: ["3.11", "3.12"]
      fail-fast: false

    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v4
        with:
          version: "latest"

      - name: Set up Python ${{ matrix.python-version }}
        run: uv python install ${{ matrix.python-version }}

      - name: Install dependencies
        working-directory: plugins/agentic-sdlc
        run: uv sync --dev

      - name: Run tests with coverage
        working-directory: plugins/agentic-sdlc
        run: uv run pytest --cov --cov-report=xml --cov-report=term

      - name: Upload coverage to Codecov
        if: matrix.os == 'ubuntu-latest' && matrix.python-version == '3.12'
        uses: codecov/codecov-action@v4
        with:
          file: plugins/agentic-sdlc/coverage.xml
          flags: agentic-sdlc
          fail_ci_if_error: false

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v4

      - name: Install dependencies
        working-directory: plugins/agentic-sdlc
        run: uv sync --dev

      - name: Run ruff check
        working-directory: plugins/agentic-sdlc
        run: uv run ruff check src/

      - name: Run ruff format check
        working-directory: plugins/agentic-sdlc
        run: uv run ruff format --check src/
```

**Features**:

- **Matrix testing**: Ubuntu + Windows, Python 3.11 + 3.12
- **Path filtering**: Only runs when agentic-sdlc files change
- **Coverage reporting**: Uploads to Codecov for tracking
- **Linting**: Runs ruff for code quality

**Files to Create**:

- `.github/workflows/python-tests.yml`

**Files to Modify** (if needed):

- `plugins/agentic-sdlc/pyproject.toml` - Add ruff to dev dependencies if not present

**Acceptance Criteria**:

- [ ] GitHub Actions workflow file created
- [ ] Tests run on both Ubuntu and Windows
- [ ] Tests run on Python 3.11 and 3.12
- [ ] Coverage report uploaded to Codecov (or similar)
- [ ] Workflow only triggers on relevant file changes
- [ ] All tests pass in CI (fix any failures)
- [ ] PR checks block merge if tests fail
