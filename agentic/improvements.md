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
    path: summary.md  # Relative to output directory
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
  command: analyse  # Could match interactive-sdlc:analyse or agentic-sdlc:analyse
```

**Required Format**:
```yaml
- type: command
  command: agentic-sdlc:analyse  # Explicit, unambiguous
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
