---
name: analyse-bug
description: Analyze codebase for bugs, logic errors, and runtime issues
argument-hint: [paths...]
---

# Analyse Bug

Analyze codebase for bugs, logic errors, and runtime issues. Returns structured JSON for workflow integration and generates a markdown report.

## Arguments

- **`[paths]`** (optional): Space-separated list of files or directories to analyze. When provided, only these paths are analyzed. Otherwise, the entire codebase is analyzed.

## Objective

Analyze codebase for real bugs, logic errors, and runtime issues, categorizing findings by criticality with specific file locations and actionable fix suggestions.

## Core Principles

- Only report REAL issues - quality over quantity
- Be specific with exact file and line numbers
- Understand project patterns before flagging issues
- Avoid false positives by considering framework conventions
- Focus on bugs that will actually cause problems, not theoretical concerns
- Only report UNFIXED issues - if the issue has been resolved, do not include it

## Instructions

1. **Determine Scope**
   - If `[paths]` are provided, focus only on those files/directories
   - Otherwise, analyze the entire codebase
   - Exclude test files, node_modules, build outputs, and vendor directories

2. **Analyze for Issues**
   Focus on finding REAL bugs, not theoretical concerns:
   - **Logic errors**: Incorrect conditions, off-by-one errors
   - **Runtime errors**: Null/undefined access, type mismatches
   - **Error handling**: Unhandled exceptions, missing error cases
   - **Race conditions**: Async timing issues, state corruption
   - **Resource leaks**: Unclosed handles, memory leaks
   - **Edge cases**: Boundary conditions, empty inputs

3. **Categorize Findings**
   Rate each finding by criticality:
   - **Critical**: Will cause crashes, data loss, or security issues
   - **Major**: Significant functional bugs affecting users
   - **Medium**: Edge case bugs, minor functional issues
   - **Low**: Potential issues, defensive improvements

4. **Generate Report**
   - Save to `agentic/analysis/bug.md`
   - Include date in report header

5. **Return JSON Output**
   - Return structured JSON with findings summary

## Output Guidance

Return a JSON object AND save a detailed markdown report.

### JSON Output (Required)

```json
{
  "success": true,
  "analysis_type": "bug",
  "findings_count": {
    "critical": 0,
    "major": 0,
    "medium": 0,
    "low": 0,
    "total": 0
  },
  "findings": [
    {
      "id": "BUG-001",
      "severity": "critical",
      "title": "Brief title",
      "file": "path/to/file.ts",
      "line": 42,
      "description": "What is wrong",
      "fix": "How to fix it"
    }
  ],
  "document_path": "agentic/analysis/bug.md"
}
```

### Markdown Report Structure

Save to `agentic/analysis/bug.md`:

```markdown
# Bug Report

**Date**: YYYY-MM-DD
**Scope**: Entire codebase | Specified paths

## Summary

- Critical: X issues
- Major: Y issues
- Medium: Z issues
- Low: W issues

## Critical

### BUG-001: Brief title

**Location:** file:line
**Issue:** What is wrong and why it's a problem
**Impact:** What happens because of this bug
**Fix:** How to fix it

---

## Major

[Same format as Critical]

## Medium

[Same format as Critical]

## Low

[Same format as Critical]
```

## Important Notes

- Only report real bugs, not theoretical concerns
- Check if apparent issues are handled elsewhere before flagging
- Understand framework conventions that handle common issues
- Include exact file location, line number, and fix approach for each finding
- Recognize test-specific patterns and intentional design choices
- Do NOT include issues that have already been fixed or resolved
- If no issues found, return success with zero counts
