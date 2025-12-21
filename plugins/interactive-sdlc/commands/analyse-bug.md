# Analyse Bug

Analyze codebase for bugs, logic errors, and runtime issues.

## Arguments

- `[context]`: Specific areas or concerns to focus on, or directories/files to analyze

## Behavior

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

## Report Template

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

## Important Principles

1. **No forced findings**: Only report REAL issues
   - If no issues found, report "No issues identified"
   - Quality over quantity

2. **Be specific**: Each finding must include:
   - Exact file and line number
   - Clear description of the issue
   - Specific impact
   - Actionable fix suggestion

3. **Context-aware**: Understand project patterns before flagging
   - Check if apparent issues are handled elsewhere
   - Consider framework conventions
   - Review related code for context

4. **Avoid false positives**: Common false positive patterns:
   - Intentional fallthrough in switch statements
   - Deliberate empty catch blocks (with comments)
   - Framework-handled null checks
   - Test-specific patterns
