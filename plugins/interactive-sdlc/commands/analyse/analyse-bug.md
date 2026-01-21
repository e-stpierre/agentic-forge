---
name: analyse-bug
description: Analyze codebase for bugs, logic errors, and runtime issues
argument-hint: "[context]"
arguments:
  - name: context
    description: Specific areas or concerns to focus on, or directories/files to analyze
    required: false
---

# Analyse Bug

Analyze codebase for bugs, logic errors, and runtime issues.

## Arguments

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
   - Read `.claude/settings.json` for `interactive-sdlc.analysisDirectory` (default: `analysis`)

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
Bug analysis complete. Report saved to analysis/bug.md

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

**Date**: {{date}}

<!--
Instructions:
- Replace {{date}} with the analysis date in YYYY-MM-DD format
-->

**Scope**: {{scope}}

<!--
Instructions:
- Replace {{scope}} with description of what was analyzed
- Example: "Entire codebase" or "src/auth/ and src/api/"
-->

## Summary

- Critical: {{critical_count}} issues
- Major: {{major_count}} issues
- Medium: {{medium_count}} issues
- Low: {{low_count}} issues

<!--
Instructions:
- Replace {{critical_count}}, {{major_count}}, {{medium_count}}, {{low_count}} with actual counts
- If count is 0, you can say "0 issues" or omit the category
-->

## Critical

### BUG-{{bug_number}}: {{bug_title}}

<!--
Instructions:
- Replace {{bug_number}} with sequential number (001, 002, etc.)
- Replace {{bug_title}} with concise bug title
- Use this format for each critical bug found
-->

**Location:** {{file_location}}

<!--
Instructions:
- Replace {{file_location}} with the file(s) where the bug is located
- Format: file:line (e.g., "src/auth/login.ts:45")
- If multiple locations, list them all
-->

**Issue:** {{issue_description}}

<!--
Instructions:
- Replace {{issue_description}} with clear description of the bug
- Explain what is wrong and why it's a problem
-->

**Impact:** {{impact}}

<!--
Instructions:
- Replace {{impact}} with what happens because of this bug
- Focus on user impact and consequences
-->

**Fix:** {{fix_suggestion}}

<!--
Instructions:
- Replace {{fix_suggestion}} with suggested fix approach
- Be specific and actionable
-->

---

## Major

<!--
Instructions:
- Use same format as Critical section
- Include all major severity bugs
-->

## Medium

<!--
Instructions:
- Use same format as Critical section
- Include all medium severity bugs
-->

## Low

<!--
Instructions:
- Use same format as Critical section
- Include all low severity bugs
-->
```

## Important Notes

- Only report real bugs, not theoretical concerns
- Check if apparent issues are handled elsewhere before flagging
- Understand framework conventions that handle common issues
- Include exact file location, line number, and fix approach for each finding
- Recognize test-specific patterns and intentional design choices
