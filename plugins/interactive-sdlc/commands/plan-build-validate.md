---
name: plan-build-validate
description: Full guided workflow from planning through implementation to validation
argument-hint: "[--git] [--pr] [--explore N] [context]"
---

# Plan-Build-Validate

Full guided workflow from planning through implementation to validation.

## Arguments

- `--git`: Auto-commit throughout workflow (plan file, build checkpoints)
- `--pr`: Create draft PR when validation passes
- `--explore N`: Override explore agent count for planning phase
- `[context]`: Optional task description to reduce prompts

## Behavior

### 1. Determine Task Type

- If `[context]` is provided, analyze to determine type
- Otherwise, ask user:
  - Is this a chore (maintenance task)?
  - Is this a bug fix?
  - Is this a new feature?

### 2. Execute Planning Command

Based on task type, invoke the appropriate planning command using full namespace:

- **Chore**: `/interactive-sdlc:plan-chore`
- **Bug**: `/interactive-sdlc:plan-bug`
- **Feature**: `/interactive-sdlc:plan-feature`

Pass through:
- `--explore N` if specified
- `--git` if specified
- `[context]` if provided

Wait for plan generation to complete.

### 3. Execute Build Command

Invoke the build command with the generated plan:

```
/interactive-sdlc:build <plan-file-path>
```

Pass through:
- `--git` if specified

Implement all tasks from the plan.

### 4. Execute Validate Command

Invoke the validate command:

```
/interactive-sdlc:validate --plan <plan-file-path>
```

Run all validation checks:
- Tests
- Code review
- Build verification
- Plan compliance

### 5. Create PR (if --pr flag and validation passes)

If validation passes:

1. Generate PR title from plan title
2. Generate PR body from plan summary:
   ```markdown
   ## Summary
   - Key changes from the plan

   ## Test plan
   - Validation criteria from the plan

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```
3. Create draft PR using `gh pr create --draft`
4. Report PR URL to user

If validation fails:
- Report issues found
- Do not create PR
- Suggest running `/interactive-sdlc:validate --autofix critical,major`

## Example Usage

```bash
# Full workflow with git and PR
/interactive-sdlc:plan-build-validate --git --pr Add user authentication with OAuth support

# Feature with more exploration
/interactive-sdlc:plan-build-validate --git --pr --explore 5 Implement dark mode toggle in settings

# Bug fix workflow
/interactive-sdlc:plan-build-validate --git --pr Login fails when password contains special characters

# Chore workflow
/interactive-sdlc:plan-build-validate --git Update all npm dependencies to latest versions
```

## Workflow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                   plan-build-validate                        │
├─────────────────────────────────────────────────────────────┤
│  1. Determine Task Type                                      │
│     ├── Analyze context or ask user                         │
│     └── chore / bug / feature                               │
├─────────────────────────────────────────────────────────────┤
│  2. Plan (full namespace command)                           │
│     ├── /interactive-sdlc:plan-chore                        │
│     ├── /interactive-sdlc:plan-bug                          │
│     └── /interactive-sdlc:plan-feature                      │
│     → Saves plan file                                        │
├─────────────────────────────────────────────────────────────┤
│  3. Build                                                    │
│     └── /interactive-sdlc:build <plan-file>                 │
│     → Implements all tasks                                   │
├─────────────────────────────────────────────────────────────┤
│  4. Validate                                                 │
│     └── /interactive-sdlc:validate --plan <plan-file>       │
│     → Tests, review, build, compliance                       │
├─────────────────────────────────────────────────────────────┤
│  5. Create PR (if --pr and validation passes)               │
│     └── gh pr create --draft                                 │
│     → Returns PR URL                                         │
└─────────────────────────────────────────────────────────────┘
```

## Important Notes

- This is the recommended workflow for non-trivial tasks
- Each step must complete successfully before proceeding
- All commands use full namespace (e.g., `/interactive-sdlc:plan-feature`)
- Plan file is saved and can be referenced later
- PR is only created if validation passes
- Use `--git` to maintain atomic commits throughout
