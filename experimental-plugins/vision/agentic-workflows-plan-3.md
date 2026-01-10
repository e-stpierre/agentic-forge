# Agentic Workflows - Implementation Plan 3

## Commands, Agents, Templates & Built-in Workflows

### Overview

This plan implements all user-facing content: commands adapted for JSON output, agents for specialized tasks, Jinja2 templates for outputs, and the built-in workflows. It builds on Plan 1's infrastructure and Plan 2's orchestration to deliver a complete, usable plugin.

### Prerequisites

- Plan 1 and Plan 2 completed and functional
- All prior tests passing

### Deliverable

A fully functional agentic-workflows plugin with:

- All commands (plan, build, validate, analyse, git operations)
- Explorer and reviewer agents
- All output templates
- Three built-in workflows ready to use
- Complete documentation

---

## Directory Structure Additions

```
experimental-plugins/agentic-workflows/
├── CLAUDE.example.md
├── README.md
├── commands/
│   ├── plan.md
│   ├── build.md
│   ├── validate.md
│   ├── analyse.md
│   └── git/
│       ├── branch.md
│       ├── commit.md
│       ├── pr.md
│       └── worktree.md
├── agents/
│   ├── explorer.md
│   └── reviewer.md
├── templates/
│   ├── plan-feature.md.j2
│   ├── plan-bug.md.j2
│   ├── plan-chore.md.j2
│   └── analysis/
│       ├── bug.md.j2
│       ├── debt.md.j2
│       ├── doc.md.j2
│       ├── security.md.j2
│       └── style.md.j2
└── workflows/
    ├── analyse-codebase.yaml
    ├── one-shot.yaml
    └── plan-build-validate.yaml
```

---

## Implementation Tasks

### Task 1: Plan Command

**File: `commands/plan.md`**

Adapted from `plugins/interactive-sdlc/commands/plan/` for agentic use with JSON output.

````markdown
---
name: plan
description: Create an implementation plan for a task
output: json
arguments:
  - name: type
    description: Plan type (feature, bug, chore, auto)
    required: false
    default: auto
  - name: context
    description: Task description or issue reference
    required: true
  - name: template
    description: Custom template path
    required: false
---

# Plan Command

Create a structured implementation plan for the given task. This command analyzes the codebase and produces a detailed plan with milestones and tasks.

## Behavior

1. **Type Detection** (if type=auto):
   - Analyze the context to determine if it's a feature, bug fix, or chore
   - Features: New functionality, enhancements
   - Bugs: Error fixes, unexpected behavior corrections
   - Chores: Refactoring, dependency updates, maintenance

2. **Codebase Analysis**:
   - Identify files and components relevant to the task
   - Understand existing patterns and conventions
   - Map dependencies and impact areas

3. **Plan Generation**:
   - Create discrete, independent milestones
   - Each milestone should be completable without knowledge of other milestones
   - Include specific file paths and line numbers
   - Estimate complexity (low, medium, high)

## Output Format

```json
{
  "success": true,
  "plan_type": "feature",
  "summary": "Brief one-line summary",
  "milestones": [
    {
      "id": 1,
      "title": "Milestone title",
      "description": "What this milestone accomplishes",
      "complexity": "medium",
      "tasks": [
        {
          "id": "1.1",
          "description": "Task description",
          "files": ["src/path/file.ts:42"],
          "completed": false
        }
      ]
    }
  ],
  "affected_files": ["src/path/file.ts"],
  "dependencies": ["package-name"],
  "risks": ["Potential risk or consideration"],
  "document_path": "agentic/workflows/{id}/plan.md"
}
```
````

## Process

1. Read the task context
2. Use the explorer agent to understand relevant code
3. Determine plan type if auto
4. Generate milestones with specific, actionable tasks
5. Write plan document to workflow directory
6. Return JSON summary

## Guidelines

- Each milestone should take 1-3 implementation sessions
- Tasks should be specific enough to execute without ambiguity
- Include file paths with line numbers where changes are needed
- Consider testing requirements in each milestone
- Flag any unclear requirements or assumptions

---

## Task Context

{{ context }}

{% if type != "auto" %}
Plan Type: {{ type }}
{% endif %}

---

Generate the implementation plan and return JSON output.

````

---

### Task 2: Build Command

**File: `commands/build.md`**

Adapted from `plugins/interactive-sdlc/commands/dev/build.md`.

```markdown
---
name: build
description: Implement changes following a plan
output: json
arguments:
  - name: plan
    description: Path to plan document or plan JSON
    required: false
  - name: milestone
    description: Specific milestone to implement
    required: false
  - name: context
    description: Additional context or instructions
    required: false
---

# Build Command

Implement code changes following a plan or direct instructions. This command executes the implementation and tracks progress.

## Behavior

1. **Plan Loading**:
   - If plan path provided, read and parse the plan
   - Identify current milestone or specified milestone
   - Load any existing checkpoints

2. **Implementation**:
   - Execute tasks in order within the milestone
   - Make code changes following project conventions
   - Run tests after significant changes
   - Create commits at logical checkpoints

3. **Progress Tracking**:
   - Update plan document with completed tasks
   - Create checkpoint if approaching context limit
   - Record files changed and tests run

## Output Format

```json
{
  "success": true,
  "milestone_completed": 1,
  "tasks_completed": ["1.1", "1.2", "1.3"],
  "files_changed": [
    {
      "path": "src/auth/handler.ts",
      "action": "modified",
      "lines_added": 45,
      "lines_removed": 12
    }
  ],
  "tests_run": {
    "passed": 12,
    "failed": 0,
    "skipped": 2
  },
  "commits": [
    {
      "hash": "abc123",
      "message": "Implement OAuth callback handler"
    }
  ],
  "next_milestone": 2,
  "checkpoint_created": false
}
````

## Process 1

1. Load plan and identify work to do
2. For each task:
   - Read relevant files
   - Make required changes
   - Run related tests
3. Commit changes at milestone completion
4. Update plan with progress
5. Return JSON summary

## Guidelines 1

- Follow existing code patterns and conventions
- Write tests for new functionality
- Make atomic commits with clear messages
- Stop and checkpoint if hitting context limits
- Do not introduce security vulnerabilities

---

{% if plan %}

## Plan

{{ plan }}
{% endif %}

{% if milestone %}

## Target Milestone

{{ milestone }}
{% endif %}

{% if context %}

## Additional Context

{{ context }}
{% endif %}

---

Implement the changes and return JSON output.

````

---

### Task 3: Validate Command

**File: `commands/validate.md`**

Adapted from `plugins/interactive-sdlc/commands/dev/validate.md`.

```markdown
---
name: validate
description: Validate implementation against plan and quality standards
output: json
arguments:
  - name: plan
    description: Path to plan document
    required: false
  - name: severity
    description: Minimum severity to report (minor, major, critical)
    required: false
    default: minor
---

# Validate Command

Validate the implementation against the plan and quality standards. Runs tests, checks code quality, and verifies plan compliance.

## Checks Performed

1. **Plan Compliance**:
   - All milestones completed
   - All tasks marked done
   - No scope creep (extra unplanned changes)

2. **Test Validation**:
   - All tests pass
   - New code has test coverage
   - No regression in existing tests

3. **Code Quality**:
   - No linting errors
   - Type checking passes
   - No security vulnerabilities introduced

4. **Build Verification**:
   - Project builds successfully
   - No new build warnings

## Output Format

```json
{
  "success": true,
  "validation_passed": true,
  "checks": {
    "plan_compliance": {
      "passed": true,
      "milestones_complete": 3,
      "milestones_total": 3
    },
    "tests": {
      "passed": true,
      "total": 45,
      "passing": 45,
      "failing": 0,
      "coverage": 82.5
    },
    "lint": {
      "passed": true,
      "errors": 0,
      "warnings": 2
    },
    "types": {
      "passed": true,
      "errors": 0
    },
    "build": {
      "passed": true
    }
  },
  "issues": [
    {
      "severity": "minor",
      "category": "lint",
      "message": "Unused import in auth.ts",
      "file": "src/auth.ts",
      "line": 5
    }
  ],
  "summary": "Validation passed with 2 minor warnings"
}
````

## Process 2

1. Load plan if provided
2. Run test suite
3. Run linter
4. Run type checker
5. Run build
6. Check plan compliance
7. Aggregate results
8. Return JSON summary

---

{% if plan %}

## Plan Reference

{{ plan }}
{% endif %}

Severity Threshold: {{ severity }}

---

Run validation checks and return JSON output.

````

---

### Task 4: Analyse Command

**File: `commands/analyse.md`**

Wrapper for analysis commands adapted from `plugins/interactive-sdlc/commands/analyse/`.

```markdown
---
name: analyse
description: Analyze codebase for issues
output: json
arguments:
  - name: type
    description: Analysis type (bug, debt, doc, security, style, all)
    required: true
  - name: path
    description: Path to analyze (default: entire codebase)
    required: false
  - name: template
    description: Custom output template path
    required: false
---

# Analyse Command

Analyze the codebase for specific types of issues. Returns a structured report with findings.

## Analysis Types

- **bug**: Potential bugs, logic errors, null pointer risks
- **debt**: Technical debt, code smells, complexity issues
- **doc**: Documentation gaps, outdated comments, missing docstrings
- **security**: Security vulnerabilities, OWASP top 10, secrets exposure
- **style**: Style violations, inconsistent patterns, naming issues
- **all**: Run all analysis types

## Output Format

```json
{
  "success": true,
  "analysis_type": "security",
  "findings": [
    {
      "id": "SEC-001",
      "severity": "critical",
      "category": "injection",
      "title": "SQL Injection vulnerability",
      "description": "User input directly concatenated into SQL query",
      "file": "src/db/queries.ts",
      "line": 42,
      "recommendation": "Use parameterized queries",
      "cwe": "CWE-89"
    }
  ],
  "summary": {
    "critical": 1,
    "major": 3,
    "minor": 8,
    "total": 12
  },
  "document_path": "agentic/analysis/security.md"
}
````

## Process 3

1. Determine analysis scope (path or full codebase)
2. Run analysis using explorer agent
3. Categorize and prioritize findings
4. Generate report using template
5. Return JSON summary

---

Analysis Type: {{ type }}
{% if path %}
Scope: {{ path }}
{% endif %}

---

Perform the analysis and return JSON output.

````

---

### Task 5: Git Commands

**File: `commands/git/branch.md`**

```markdown
---
name: git-branch
description: Create or manage git branches
output: json
arguments:
  - name: action
    description: Action (create, checkout, delete, list)
    required: true
  - name: name
    description: Branch name (for create/checkout/delete)
    required: false
  - name: base
    description: Base branch (for create)
    required: false
---

# Git Branch Command

Manage git branches for the workflow.

## Output Format

```json
{
  "success": true,
  "action": "create",
  "branch": "feature/auth-impl",
  "base": "main",
  "current_branch": "feature/auth-impl"
}
````

---

Action: {{ action }}
{% if name %}Branch: {{ name }}{% endif %}
{% if base %}Base: {{ base }}{% endif %}

---

Execute the git branch operation and return JSON output.

````

**File: `commands/git/commit.md`**

```markdown
---
name: git-commit
description: Create a git commit
output: json
arguments:
  - name: message
    description: Commit message (auto-generated if not provided)
    required: false
  - name: files
    description: Specific files to commit (default: all staged)
    required: false
---

# Git Commit Command

Create a git commit with staged changes.

## Behavior

1. If no message provided, analyze changes and generate appropriate message
2. Stage specified files or use already staged files
3. Create commit
4. Return commit details

## Output Format

```json
{
  "success": true,
  "commit_hash": "abc1234",
  "message": "Implement OAuth callback handler",
  "files_committed": ["src/auth/callback.ts", "src/auth/callback.test.ts"],
  "stats": {
    "files_changed": 2,
    "insertions": 145,
    "deletions": 23
  }
}
````

---

{% if message %}Message: {{ message }}{% endif %}
{% if files %}Files: {{ files }}{% endif %}

---

Create the commit and return JSON output.

````

**File: `commands/git/pr.md`**

```markdown
---
name: git-pr
description: Create a pull request
output: json
arguments:
  - name: title
    description: PR title (auto-generated if not provided)
    required: false
  - name: body
    description: PR body/description
    required: false
  - name: base
    description: Base branch (default: main)
    required: false
  - name: draft
    description: Create as draft PR
    required: false
    default: false
---

# Git PR Command

Create a pull request on GitHub.

## Behavior

1. Push current branch to remote if needed
2. Generate title and body from commits if not provided
3. Create PR using gh CLI
4. Return PR details

## Output Format

```json
{
  "success": true,
  "pr_number": 42,
  "url": "https://github.com/owner/repo/pull/42",
  "title": "Implement OAuth authentication",
  "base": "main",
  "head": "feature/oauth-auth",
  "draft": false
}
````

---

{% if title %}Title: {{ title }}{% endif %}
{% if body %}Body: {{ body }}{% endif %}
Base: {{ base | default("main") }}
Draft: {{ draft }}

---

Create the pull request and return JSON output.

````

**File: `commands/git/worktree.md`**

```markdown
---
name: git-worktree
description: Manage git worktrees
output: json
arguments:
  - name: action
    description: Action (create, remove, list)
    required: true
  - name: branch
    description: Branch name (for create)
    required: false
  - name: path
    description: Worktree path (for remove)
    required: false
---

# Git Worktree Command

Manage git worktrees for parallel development.

## Output Format

```json
{
  "success": true,
  "action": "create",
  "worktree": {
    "path": ".worktrees/agentic-feature-auth-abc123",
    "branch": "agentic/feature-auth-abc123"
  }
}
````

---

Action: {{ action }}
{% if branch %}Branch: {{ branch }}{% endif %}
{% if path %}Path: {{ path }}{% endif %}

---

Execute the worktree operation and return JSON output.

````

---

### Task 6: Explorer Agent

**File: `agents/explorer.md`**

```markdown
---
name: explorer
description: Efficiently explores codebase to find relevant files and code
persona: codebase-explorer
capabilities:
  - file-search
  - code-analysis
  - pattern-recognition
---

# Explorer Agent

You are a codebase exploration specialist. Your role is to efficiently navigate and understand codebases to find information relevant to specific tasks.

## Core Capabilities

1. **File Discovery**: Find files relevant to a task using glob patterns and content search
2. **Code Analysis**: Understand code structure, dependencies, and relationships
3. **Pattern Recognition**: Identify conventions, patterns, and architectural decisions

## Exploration Strategy

1. **Start Broad**: Use glob patterns to identify candidate files
2. **Filter by Content**: Use grep to narrow down to relevant code
3. **Trace Dependencies**: Follow imports and references
4. **Map Architecture**: Understand how components connect

## Output Format

Return findings as structured data:

```json
{
  "relevant_files": [
    {
      "path": "src/auth/handler.ts",
      "relevance": "high",
      "reason": "Contains authentication logic",
      "key_lines": [42, 78, 156]
    }
  ],
  "patterns_found": [
    {
      "name": "Error handling middleware",
      "location": "src/middleware/error.ts",
      "description": "Centralized error handling pattern"
    }
  ],
  "dependencies": ["express", "jsonwebtoken"],
  "architecture_notes": "Service layer pattern with repository abstraction"
}
````

## Guidelines 2

- Minimize file reads - use search tools first
- Focus on finding the minimum set of files needed
- Note patterns and conventions for future reference
- Report uncertainty or ambiguity
- Provide line numbers for specific findings

## Tools to Use

- `Glob`: Find files by pattern
- `Grep`: Search file contents
- `Read`: Read specific files (use sparingly)
- `Task`: Delegate sub-explorations

---

You are now the Explorer agent. Efficiently explore the codebase to answer questions or find relevant code.

````

---

### Task 7: Reviewer Agent

**File: `agents/reviewer.md`**

```markdown
---
name: reviewer
description: Reviews code for quality, correctness, and best practices
persona: code-reviewer
capabilities:
  - code-review
  - test-validation
  - security-analysis
---

# Reviewer Agent

You are a code review specialist. Your role is to validate code changes for correctness, quality, and adherence to best practices.

## Review Dimensions

1. **Correctness**: Does the code do what it's supposed to?
2. **Security**: Are there any security vulnerabilities?
3. **Performance**: Are there obvious performance issues?
4. **Maintainability**: Is the code readable and maintainable?
5. **Testing**: Is there adequate test coverage?
6. **Conventions**: Does it follow project patterns?

## Review Process

1. **Understand Context**: Read the plan or task description
2. **Review Changes**: Examine modified files systematically
3. **Run Tests**: Verify tests pass and cover new code
4. **Check Patterns**: Ensure consistency with codebase
5. **Report Findings**: Categorize by severity

## Output Format

```json
{
  "review_passed": true,
  "findings": [
    {
      "severity": "major",
      "category": "security",
      "file": "src/api/users.ts",
      "line": 45,
      "issue": "User input not sanitized before database query",
      "suggestion": "Use parameterized query or ORM method"
    }
  ],
  "tests": {
    "passed": true,
    "coverage": 85,
    "missing_coverage": ["src/auth/refresh.ts:30-45"]
  },
  "summary": {
    "critical": 0,
    "major": 1,
    "minor": 3,
    "info": 5
  },
  "recommendation": "Address major security issue before merging"
}
````

## Severity Levels

- **Critical**: Must fix before merge (security holes, data loss risk)
- **Major**: Should fix before merge (bugs, significant issues)
- **Minor**: Nice to fix (code quality, minor improvements)
- **Info**: Informational (suggestions, alternatives)

## Guidelines 3

- Be thorough but efficient
- Focus on substance over style
- Provide actionable feedback
- Explain the "why" behind suggestions
- Consider the broader context

---

You are now the Reviewer agent. Review the code changes thoroughly and provide structured feedback.

````

---

### Task 8: Output Templates

**File: `templates/plan-feature.md.j2`**

```jinja2
# Feature Plan: {{ title }}

Created: {{ created }}
Status: {{ status }}
Workflow: {{ workflow_id }}

## Summary

{{ summary }}

## Progress Tracker

{% for milestone in milestones %}
### Milestone {{ milestone.id }}: {{ milestone.title }}

Complexity: {{ milestone.complexity }}

{% for task in milestone.tasks %}
- [{% if task.completed %}x{% else %} {% endif %}] {{ task.id }}: {{ task.description }}
  {%- if task.files %} ({{ task.files | join(", ") }}){% endif %}
{% endfor %}

{% endfor %}

## Affected Files

{% for file in affected_files %}
- {{ file }}
{% endfor %}

## Dependencies

{% for dep in dependencies %}
- {{ dep }}
{% endfor %}

## Risks & Considerations

{% for risk in risks %}
- {{ risk }}
{% endfor %}
````

**File: `templates/plan-bug.md.j2`**

```jinja2
# Bug Fix Plan: {{ title }}

Created: {{ created }}
Status: {{ status }}
Workflow: {{ workflow_id }}

## Bug Summary

{{ summary }}

## Root Cause Analysis

{{ root_cause }}

## Progress Tracker

{% for milestone in milestones %}
### Milestone {{ milestone.id }}: {{ milestone.title }}

{% for task in milestone.tasks %}
- [{% if task.completed %}x{% else %} {% endif %}] {{ task.id }}: {{ task.description }}
{% endfor %}

{% endfor %}

## Affected Files

{% for file in affected_files %}
- {{ file }}
{% endfor %}

## Test Plan

{% for test in test_plan %}
- {{ test }}
{% endfor %}
```

**File: `templates/plan-chore.md.j2`**

```jinja2
# Chore Plan: {{ title }}

Created: {{ created }}
Status: {{ status }}

## Summary

{{ summary }}

## Tasks

{% for task in tasks %}
- [{% if task.completed %}x{% else %} {% endif %}] {{ task.description }}
{% endfor %}

## Affected Files

{% for file in affected_files %}
- {{ file }}
{% endfor %}
```

**File: `templates/analysis/security.md.j2`**

```jinja2
# Security Analysis Report

Generated: {{ generated }}
Scope: {{ scope }}

## Summary

| Severity | Count |
|----------|-------|
| Critical | {{ summary.critical }} |
| Major | {{ summary.major }} |
| Minor | {{ summary.minor }} |
| **Total** | {{ summary.total }} |

## Findings

{% for finding in findings %}
### {{ finding.id }}: {{ finding.title }}

**Severity**: {{ finding.severity | upper }}
**Category**: {{ finding.category }}
**File**: {{ finding.file }}:{{ finding.line }}
{% if finding.cwe %}**CWE**: {{ finding.cwe }}{% endif %}

{{ finding.description }}

**Recommendation**: {{ finding.recommendation }}

---

{% endfor %}
```

**File: `templates/analysis/bug.md.j2`**

```jinja2
# Bug Analysis Report

Generated: {{ generated }}
Scope: {{ scope }}

## Summary

Found {{ summary.total }} potential issues.

## Findings

{% for finding in findings %}
### {{ finding.id }}: {{ finding.title }}

**Severity**: {{ finding.severity }}
**File**: {{ finding.file }}:{{ finding.line }}

{{ finding.description }}

**Recommendation**: {{ finding.recommendation }}

---

{% endfor %}
```

Create similar templates for `debt.md.j2`, `doc.md.j2`, and `style.md.j2`.

---

### Task 9: Built-in Workflows

**File: `workflows/analyse-codebase.yaml`**

```yaml
name: analyse-codebase
version: "1.0"
description: Run comprehensive codebase analysis with optional autofix

settings:
  max-retry: 2
  timeout-minutes: 120
  track-progress: true
  terminal-output: base

variables:
  - name: autofix
    type: string
    required: false
    default: "none"
    description: Severity level for automatic fixes (none, minor, major, critical)

steps:
  - name: analyse-all
    type: parallel
    merge-strategy: wait-all
    merge-mode: independent
    steps:
      - name: analyse-bug
        type: command
        command: analyse
        args:
          type: bug

      - name: analyse-debt
        type: command
        command: analyse
        args:
          type: debt

      - name: analyse-doc
        type: command
        command: analyse
        args:
          type: doc

      - name: analyse-security
        type: command
        command: analyse
        args:
          type: security

      - name: analyse-style
        type: command
        command: analyse
        args:
          type: style

  - name: check-autofix
    type: conditional
    condition: "variables.autofix != 'none'"
    then:
      - name: fix-issues
        type: parallel
        merge-mode: independent
        steps:
          - name: fix-bug
            type: prompt
            prompt: |
              Review the bug analysis in agentic/analysis/bug.md.
              Fix all issues with severity {{ variables.autofix }} or higher.
              Commit fixes with clear messages.

          - name: fix-security
            type: prompt
            prompt: |
              Review the security analysis in agentic/analysis/security.md.
              Fix all issues with severity {{ variables.autofix }} or higher.
              Commit fixes with clear messages.

outputs:
  - name: analysis-summary
    template: analysis-summary.md.j2
    path: agentic/analysis/summary.md
    when: completed
```

**File: `workflows/one-shot.yaml`**

```yaml
name: one-shot
version: "1.0"
description: Complete a single task from start to finish with PR

settings:
  max-retry: 3
  timeout-minutes: 60
  track-progress: true
  git:
    enabled: true
    worktree: true
    auto-commit: true
    auto-pr: true
    branch-prefix: "agentic"

variables:
  - name: task
    type: string
    required: true
    description: Task description or prompt
  - name: create_pr
    type: boolean
    required: false
    default: true
    description: Whether to create a PR

steps:
  - name: execute-task
    type: prompt
    prompt: |
      Complete the following task:

      {{ variables.task }}

      Guidelines:
      - Analyze the codebase to understand context
      - Make necessary changes following project conventions
      - Write tests for new functionality
      - Commit changes with clear messages
    model: sonnet

  - name: validate
    type: command
    command: validate
    args:
      severity: major

  - name: create-pr
    type: conditional
    condition: "variables.create_pr"
    then:
      - name: open-pr
        type: command
        command: git-pr
        args:
          draft: false
```

**File: `workflows/plan-build-validate.yaml`**

```yaml
name: plan-build-validate
version: "1.0"
description: Full SDLC workflow with planning, implementation, and validation

settings:
  max-retry: 3
  timeout-minutes: 180
  track-progress: true
  git:
    enabled: true
    worktree: true
    auto-commit: true
    auto-pr: true
    branch-prefix: "feature"

variables:
  - name: task
    type: string
    required: true
    description: Feature/task description
  - name: type
    type: string
    required: false
    default: "auto"
    description: Task type (feature, bug, chore, auto)
  - name: fix_severity
    type: string
    required: false
    default: "major"
    description: Minimum severity for auto-fix

steps:
  - name: plan
    type: command
    command: plan
    args:
      type: "{{ variables.type }}"
      context: "{{ variables.task }}"
    checkpoint: true

  - name: implement
    type: recurring
    max-iterations: 5
    until: "outputs.implement_milestone.milestone_completed == outputs.plan.milestones | length"
    steps:
      - name: implement-milestone
        type: command
        command: build
        args:
          plan: "agentic/workflows/{{ workflow_id }}/plan.md"
        checkpoint: true

  - name: validate
    type: command
    command: validate
    args:
      plan: "agentic/workflows/{{ workflow_id }}/plan.md"
      severity: minor

  - name: fix-issues
    type: conditional
    condition: "outputs.validate.issues | selectattr('severity', 'ge', variables.fix_severity) | list | length > 0"
    then:
      - name: apply-fixes
        type: prompt
        prompt: |
          Review the validation results and fix all issues with severity {{ variables.fix_severity }} or higher.

          Validation output:
          {{ outputs.validate | tojson }}

          Make the necessary fixes and commit them.
        agent: agents/reviewer.md

      - name: revalidate
        type: command
        command: validate
        args:
          severity: "{{ variables.fix_severity }}"

  - name: create-pr
    type: command
    command: git-pr
    args:
      title: "{{ outputs.plan.summary }}"
      draft: false

outputs:
  - name: implementation-report
    template: implementation-report.md.j2
    path: agentic/workflows/{{ workflow_id }}/report.md
    when: completed
```

---

### Task 10: CLI Convenience Commands

Add to `cli.py`:

```python
# one-shot command
oneshot_parser = subparsers.add_parser("one-shot", help="Execute a single task end-to-end")
oneshot_parser.add_argument("prompt", help="Task description")
oneshot_parser.add_argument("--git", action="store_true", help="Enable git integration")
oneshot_parser.add_argument("--pr", action="store_true", help="Create PR on completion")

# analyse command
analyse_parser = subparsers.add_parser("analyse", help="Analyze codebase")
analyse_parser.add_argument("--type", choices=["bug", "debt", "doc", "security", "style", "all"],
                           default="all", help="Analysis type")
analyse_parser.add_argument("--autofix", choices=["none", "minor", "major", "critical"],
                           default="none", help="Auto-fix severity level")

# memory commands
memory_parser = subparsers.add_parser("memory", help="Memory management")
memory_subparsers = memory_parser.add_subparsers(dest="memory_command")
memory_subparsers.add_parser("list", help="List memories")
memory_search = memory_subparsers.add_parser("search", help="Search memories")
memory_search.add_argument("query", help="Search query")
memory_prune = memory_subparsers.add_parser("prune", help="Prune old memories")
memory_prune.add_argument("--older-than", default="30d", help="Age threshold (e.g., 30d)")
```

---

### Task 11: Documentation

**File: `CLAUDE.example.md`**

```markdown
# Agentic Workflows Integration

Add these sections to your CLAUDE.md to enable agentic workflow features.

## Memory Management

Create memories using `/create-memory` when you encounter:

- Architectural decisions and their rationale
- User preferences expressed during sessions
- Patterns/conventions discovered in the codebase
- Errors encountered and their solutions

Before starting complex tasks, use `/search-memory` or check `agentic/memory/index.md` for relevant context.

## Checkpoint Guidelines

Create checkpoints using `/create-checkpoint` when:

- Completing a milestone in implementation
- About to hand off to another session
- Encountering issues that need documentation
- Reaching 80% of context capacity

## Workflow Integration

This repository uses agentic-workflows for automated development. Key directories:

- `agentic/workflows/` - Workflow execution state and logs
- `agentic/memory/` - Persistent learnings and patterns
- `agentic/analysis/` - Code analysis reports

When working in a workflow context, always:

1. Check for existing checkpoints before starting
2. Update progress after completing tasks
3. Create memories for significant learnings
4. Use structured JSON output for commands
```

**File: `README.md`**

Create comprehensive README following `docs/templates/readme-template.md`.

---

## Acceptance Criteria

1. **Plan Command**: Generates structured plans with milestones and tasks
2. **Build Command**: Implements changes following plans, tracks progress
3. **Validate Command**: Runs all validation checks, reports issues
4. **Analyse Command**: All analysis types work and produce reports
5. **Git Commands**: All git operations work with JSON output
6. **Explorer Agent**: Efficiently finds relevant code
7. **Reviewer Agent**: Provides thorough code review
8. **Templates**: All templates render correctly
9. **analyse-codebase Workflow**: Runs parallel analysis with optional autofix
10. **one-shot Workflow**: Completes task and creates PR
11. **plan-build-validate Workflow**: Full SDLC cycle works end-to-end

---

## Final Integration Test

Run the complete plan-build-validate workflow:

```bash
agentic-workflow run workflows/plan-build-validate.yaml \
  --var "task=Add a health check endpoint at /api/health that returns server status" \
  --terminal-output all
```

Expected behavior:

1. Creates plan with milestones
2. Implements each milestone
3. Validates implementation
4. Fixes any major issues
5. Creates PR with summary
