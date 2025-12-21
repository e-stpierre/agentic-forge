---
name: review
description: Review code changes for quality and correctness
argument-hint: [branch | commit-range]
---

# Review Command

Reviews code changes and provides structured feedback on quality, correctness, and potential issues.

## Parameters

- **`target`** (optional): What to review. Can be:
  - Empty: Review uncommitted changes (staged + unstaged)
  - Branch name: Review changes on branch vs main
  - Commit range: Review specific commits (e.g., `HEAD~3..HEAD`)

## Objective

Provide actionable, high-quality code review feedback that helps improve code quality.

## Core Principles

- Focus on issues that matter - bugs, security, maintainability
- Be specific and actionable - explain why and how to fix
- Acknowledge good patterns and decisions
- Avoid nitpicking style issues that linters should catch
- Consider the context and intent of the changes
- Prioritize feedback by severity

## Instructions

1. Determine the review target:
   - If no argument: `git diff` (uncommitted changes)
   - If branch name: `git diff main...<branch>` (branch changes)
   - If commit range: `git diff <range>` (specific commits)

2. Gather the changes:

   ```bash
   git diff [target] --stat  # Summary of changes
   git diff [target]         # Full diff
   ```

3. For each changed file, analyze:
   - **Correctness**: Logic errors, edge cases, error handling
   - **Security**: Input validation, injection risks, auth issues
   - **Performance**: Inefficient patterns, N+1 queries, memory leaks
   - **Maintainability**: Complexity, readability, documentation
   - **Testing**: Test coverage, test quality

4. Read the full file context when needed:
   - Use Read tool to understand surrounding code
   - Check how changes integrate with existing code

5. Categorize findings by severity:
   - **Critical**: Must fix - bugs, security issues, data loss risks
   - **Major**: Should fix - significant quality issues
   - **Minor**: Consider fixing - small improvements
   - **Positive**: Good practices worth noting

6. Generate the review report

## Output Guidance

Structure the review as follows:

````markdown
## Code Review: [Target Description]

### Summary

**Files Changed**: N **Lines Added**: +X **Lines Removed**: -Y

**Overall Assessment**: [Brief 1-2 sentence summary]

---

### Critical Issues

#### [Issue Title]

**File**: `path/to/file.ts:123`

**Issue**: [Description of the problem]

**Impact**: [What could go wrong]

**Suggestion**:

```diff
- current code
+ suggested fix
```
````

---

### Major Issues

#### [Issue Title]

**File**: `path/to/file.ts:45`

**Issue**: [Description]

**Suggestion**: [How to fix]

---

### Minor Issues

- `file.ts:10` - [Brief issue description]
- `file.ts:25` - [Brief issue description]

---

### Positive Notes

- Good use of [pattern] in `file.ts`
- Clear error handling in `handler.ts`
- Well-structured tests

---

### Checklist

- [ ] No critical issues
- [ ] Error handling is adequate
- [ ] Edge cases are covered
- [ ] Tests are included/updated
- [ ] No security concerns

### Verdict

[Approve | Request Changes | Needs Discussion]

[Final recommendation and any blocking items]

```

## Examples

**Review uncommitted changes:**
```

/sdlc:review

```

**Review a feature branch:**
```

/sdlc:review feature/add-auth

```

**Review recent commits:**
```

/sdlc:review HEAD~5..HEAD

```

```
