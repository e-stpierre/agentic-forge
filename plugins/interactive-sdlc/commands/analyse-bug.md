---
name: analyse-bug
description: Analyze codebase for bugs, logic errors, and runtime issues
argument-hint: "[context]"
---

# Analyse Bug

Analyze codebase for bugs, logic errors, and runtime issues.

## Parameters

- **`[context]`** (optional): Specific areas or concerns to focus on, or directories/files to analyze

## Objective

Analyze codebase for real bugs, logic errors, and runtime issues, categorizing findings by criticality with specific file locations and actionable fix suggestions.

## Core Principles

- Only report REAL issues - quality over quantity
- Be specific with exact file and line numbers
- Understand project patterns before flagging issues
- Avoid false positives by considering framework conventions
- Focus on bugs that will actually cause problems, not theoretical concerns

## Instructions

1. **Read Configuration**
   - Read `.claude/settings.json` for `interactive-sdlc.analysisDirectory` (default: `/analysis`)

2. **Determine Scope**
   - If `[context]` specifies files/directories, focus on those
   - Otherwise, analyze the entire codebase
   - Exclude test files, node_modules, build outputs

3. **Analyze for Issues**
   Focus on finding REAL bugs, not theoretical concerns:
   - **Logic errors**: Incorrect conditions, off-by-one errors
   - **Runtime errors**: Null/undefined access, type mismatches
   - **Error handling**: Unhandled exceptions, missing error cases
   - **Race conditions**: Async timing issues, state corruption
   - **Resource leaks**: Unclosed handles, memory leaks
   - **Edge cases**: Boundary conditions, empty inputs

4. **Categorize Findings**
   Rate each finding by criticality:
   - **Critical**: Will cause crashes, data loss, or security issues
   - **Major**: Significant functional bugs affecting users
   - **Medium**: Edge case bugs, minor functional issues
   - **Low**: Potential issues, defensive improvements

5. **Generate Report**
   - Save to `{analysisDirectory}/bug.md`
   - Include date in report header

## Output Guidance

Present a summary and save the report:

```
Bug analysis complete. Report saved to /analysis/bug.md

## Summary
- Critical: X issues
- Major: Y issues
- Medium: Z issues
- Low: W issues

[If no issues found:]
No bugs identified - codebase appears healthy.

[If issues found:]
Review the report and prioritize fixes by criticality.
```

## Templates

### Report Structure

```markdown
# Bug Report

**Date**: YYYY-MM-DD
**Scope**: [Description of analyzed scope]

## Summary

- Critical: X issues
- Major: X issues
- Medium: X issues
- Low: X issues

## Critical

### BUG-001: [Title]

**Location:** file:line

**Issue:** Clear description of the bug

**Impact:** What happens because of this bug

**Fix:** Suggested fix approach

---

## Major

[Same format for major issues]

## Medium

[Same format for medium issues]

## Low

[Same format for low issues]
```

## Example Usage

```bash
# Analyze entire codebase
/interactive-sdlc:analyse-bug

# Focus on specific area
/interactive-sdlc:analyse-bug Focus on authentication and session management

# Analyze specific files
/interactive-sdlc:analyse-bug src/auth/ src/middleware/

# Analyze with specific concern
/interactive-sdlc:analyse-bug Check for null pointer issues in the API handlers
```

## Don't

- Don't report issues just to meet a quota - report only real bugs
- Don't flag issues without checking if they're handled elsewhere
- Don't ignore framework conventions that handle common issues
- Don't report vague findings - include exact file, line, and fix approach
- Don't flag test-specific patterns or intentional design choices
