---
name: analyse-style
description: Check code style, consistency, and best practices adherence
argument-hint: "[paths]"
---

# Analyse Style

Check code style, consistency, and best practices adherence. Returns structured JSON for workflow integration and generates a markdown report.

## Arguments

- **`[paths]`** (optional): Space-separated list of files or directories to analyze. When provided, only these paths are analyzed. Otherwise, the entire codebase is analyzed.

## Objective

Check code style, consistency, and best practices adherence by identifying inconsistent patterns and normalizing the codebase to use ONE way of doing things.

## Core Principles

- Normalization is key - one way to do each thing reduces cognitive load
- Respect existing patterns - work with the codebase, not against it
- Majority pattern wins - align outliers to dominant pattern
- Automated tools first - focus on what automation misses
- Some inconsistency is acceptable for legacy code or external dependencies
- Only report UNFIXED issues - if the issue has been resolved, do not include it

## Instructions

1. **Determine Scope**
   - If `[paths]` are provided, focus only on those files/directories
   - Otherwise, analyze the entire codebase
   - Exclude node_modules, build outputs, vendor directories

2. **Understand Project Conventions**
   - Check for ESLint, Prettier, Ruff configs
   - Read CLAUDE.md for project-specific guidelines
   - Analyze existing code patterns
   - Identify the "standard" way of doing things

3. **Analyze for Inconsistencies**
   Focus on NORMALIZATION - there should be ONE way of doing things:

   **Naming:**
   - Inconsistent naming conventions
   - Mixed camelCase/snake_case
   - Inconsistent abbreviations

   **Patterns:**
   - Different ways of handling the same thing
   - Inconsistent error handling patterns
   - Mixed async patterns (callbacks vs promises vs async/await)
   - Inconsistent component patterns

   **Structure:**
   - Inconsistent file organization
   - Mixed import styles
   - Inconsistent export patterns

   **Formatting:**
   - Issues not caught by automated formatters
   - Inconsistent whitespace in logic
   - Comment style inconsistencies

4. **Categorize Findings**
   - **Major**: Significant inconsistencies that harm readability
   - **Minor**: Small deviations from established patterns

5. **Generate Report**
   - Save to `agentic/analysis/style.md`
   - Group by category

6. **Return JSON Output**
   - Return structured JSON with findings summary

## Output Guidance

Return a JSON object AND save a detailed markdown report.

### JSON Output (Required)

```json
{
  "success": true,
  "analysis_type": "style",
  "findings_count": {
    "major": 0,
    "minor": 0,
    "total": 0
  },
  "project_standards": {
    "naming": "camelCase for functions, PascalCase for components",
    "error_handling": "try/catch with custom Error classes",
    "async": "async/await preferred",
    "imports": "absolute imports with @ alias"
  },
  "findings": [
    {
      "id": "STYLE-001",
      "severity": "major",
      "title": "Brief title",
      "location": "path/to/file.ts",
      "issue": "What is inconsistent",
      "standard": "Expected pattern",
      "fix": "How to align with standard"
    }
  ],
  "document_path": "agentic/analysis/style.md"
}
```

### Markdown Report Structure

Save to `agentic/analysis/style.md`:

```markdown
# Style & Consistency Issues

**Date**: YYYY-MM-DD
**Scope**: Entire codebase | Specified paths

## Summary

- Major Inconsistencies: X issues
- Minor Issues: Y issues

## Project Standards

Based on analysis, the established patterns are:

- Naming: [identified pattern]
- Error Handling: [identified pattern]
- Async: [identified pattern]
- Imports: [identified pattern]

## Major Inconsistencies

### STYLE-001: Brief title

**Location:** affected files
**Issue:** What is inconsistent
**Standard:** Expected pattern/convention
**Fix:** How to align with standard

---

## Minor Issues

[Same format as Major]
```

## What to Check

### Naming Conventions

| Pattern    | Variations to Detect                                |
| ---------- | --------------------------------------------------- |
| Functions  | `getUserData` vs `get_user_data` vs `GetUserData`   |
| Variables  | `isLoading` vs `loading` vs `is_loading`            |
| Constants  | `MAX_RETRIES` vs `maxRetries` vs `MaxRetries`       |
| Components | `UserCard` vs `userCard` vs `User_Card`             |
| Files      | `UserCard.tsx` vs `user-card.tsx` vs `userCard.tsx` |

### Patterns

| Area           | Variations to Detect                      |
| -------------- | ----------------------------------------- |
| Error handling | try/catch vs .catch() vs error boundaries |
| Async          | async/await vs .then() vs callbacks       |
| State updates  | setState vs reducer vs signals            |
| Props          | destructuring vs props.x                  |
| Exports        | named vs default vs barrel files          |

## Important Notes

- Work with existing codebase patterns - identify the dominant style and normalize to it
- Focus on issues that automated tools miss - ESLint/Prettier handle formatting
- Consider context before normalizing legacy code
- Focus on actual inconsistencies, not stylistic preferences
- Recognize that external dependencies may require certain patterns
- Do NOT include issues that have already been fixed or resolved
- If no issues found, return success with zero counts
