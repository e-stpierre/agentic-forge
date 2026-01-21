---
name: analyse-style
description: Check code style, consistency, and best practices adherence
argument-hint: "[context]"
arguments:
  - name: context
    description: Specific areas or files to focus on
    required: false
---

# Analyse Style

Check code style, consistency, and best practices adherence.

## Arguments

- **`[context]`** (optional): Specific areas or files to focus on

## Objective

Check code style, consistency, and best practices adherence by identifying inconsistent patterns and normalizing the codebase to use ONE way of doing things.

## Core Principles

- Normalization is key - one way to do each thing reduces cognitive load
- Respect existing patterns - work with the codebase, not against it
- Majority pattern wins - align outliers to dominant pattern
- Automated tools first - focus on what automation misses
- Some inconsistency is acceptable for legacy code or external dependencies

## Instructions

1. **Read Configuration**
   - Read `.claude/settings.json` for `interactive-sdlc.analysisDirectory` (default: `analysis`)

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

4. **Generate Report**
   - Save to `{analysisDirectory}/style.md`
   - Group by category

## Output Guidance

Present a summary and save the report:

```
Style & consistency analysis complete. Report saved to analysis/style.md

## Summary
- Major Inconsistencies: X issues
- Minor Issues: Y issues

Project standards identified:
- [list of established patterns]

Review the report to normalize outliers to the dominant patterns.
```

## Templates

### Report Structure

```markdown
# Style & Consistency Issues

**Date**: {{date}}

<!--
Instructions:
- Replace {{date}} with the analysis date in YYYY-MM-DD format
-->

**Scope**: {{scope}}

<!--
Instructions:
- Replace {{scope}} with description of what was analyzed
- Example: "Entire codebase" or "React components"
-->

## Summary

- Major Inconsistencies: {{major_count}} issues
- Minor Issues: {{minor_count}} issues

<!--
Instructions:
- Replace {{major_count}}, {{minor_count}} with actual counts
- If count is 0, you can say "0 issues" or omit the category
-->

## Project Standards

Based on analysis, the established patterns are:

- Naming: {{naming_pattern}}
- Error Handling: {{error_handling_pattern}}
- Async: {{async_pattern}}
- Imports: {{import_pattern}}

<!--
Instructions:
- Replace {{naming_pattern}}, {{error_handling_pattern}}, {{async_pattern}}, {{import_pattern}} with identified patterns
- Examples:
  - Naming: "camelCase for functions, PascalCase for components"
  - Error Handling: "try/catch with custom Error classes"
  - Async: "async/await preferred over .then()"
  - Imports: "absolute imports with @ alias"
- Add additional standards as needed
-->

## Major Inconsistencies

### STYLE-{{issue_number}}: {{issue_title}}

<!--
Instructions:
- Replace {{issue_number}} with sequential number (001, 002, etc.)
- Replace {{issue_title}} with concise issue title
- Use this format for each major inconsistency found
-->

**Location:** {{location}}

<!--
Instructions:
- Replace {{location}} with files affected
- Example: "src/components/Button.tsx, src/components/Card.tsx"
-->

**Issue:** {{issue_description}}

<!--
Instructions:
- Replace {{issue_description}} with inconsistency or pattern mismatch
- Explain what is inconsistent
-->

**Standard:** {{standard}}

<!--
Instructions:
- Replace {{standard}} with expected pattern/convention
- This should match the majority pattern in the codebase
-->

**Fix:** {{fix_suggestion}}

<!--
Instructions:
- Replace {{fix_suggestion}} with how to align with standard
- Be specific and actionable
-->

---

## Minor Issues

<!--
Instructions:
- Use same format as Major Inconsistencies section
- Include all minor style issues
-->
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
