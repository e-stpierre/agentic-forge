# Analyse Style

Check code style, consistency, and best practices adherence.

## Arguments

- `[context]`: Specific areas or files to focus on

## Behavior

1. **Read Configuration**
   - Read `.claude/settings.json` for `interactive-sdlc.analysisDirectory` (default: `/analysis`)

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

## Report Template

```markdown
# Style & Consistency Issues

**Date**: YYYY-MM-DD
**Scope**: [Description of analyzed scope]

## Summary

- Major Inconsistencies: X issues
- Minor Issues: X issues

## Project Standards

Based on analysis, the established patterns are:
- Naming: [e.g., camelCase for functions, PascalCase for components]
- Error Handling: [e.g., try/catch with custom Error classes]
- Async: [e.g., async/await preferred]
- Imports: [e.g., absolute imports with aliases]

## Major Inconsistencies

### STYLE-001: [Title]

**Location:** Files affected

**Issue:** Inconsistency or pattern mismatch

**Standard:** Expected pattern/convention

**Fix:** How to align with standard

---

## Minor Issues

[Same format]
```

## Example Usage

```bash
# Analyze entire codebase
/interactive-sdlc:analyse-style

# Focus on specific area
/interactive-sdlc:analyse-style Focus on React components

# Check naming conventions
/interactive-sdlc:analyse-style Check naming consistency across the API layer

# Specific files
/interactive-sdlc:analyse-style src/components/ src/hooks/
```

## What to Check

### Naming Conventions

| Pattern | Variations to Detect |
|---------|---------------------|
| Functions | `getUserData` vs `get_user_data` vs `GetUserData` |
| Variables | `isLoading` vs `loading` vs `is_loading` |
| Constants | `MAX_RETRIES` vs `maxRetries` vs `MaxRetries` |
| Components | `UserCard` vs `userCard` vs `User_Card` |
| Files | `UserCard.tsx` vs `user-card.tsx` vs `userCard.tsx` |

### Patterns

| Area | Variations to Detect |
|------|---------------------|
| Error handling | try/catch vs .catch() vs error boundaries |
| Async | async/await vs .then() vs callbacks |
| State updates | setState vs reducer vs signals |
| Props | destructuring vs props.x |
| Exports | named vs default vs barrel files |

## Important Principles

1. **Normalization is key**: One way to do each thing
   - Reduces cognitive load
   - Makes code predictable
   - Easier onboarding

2. **Respect existing patterns**: Don't impose new standards
   - Work with the codebase, not against it
   - Majority pattern wins
   - Document deviations if intentional

3. **Automated tools first**: Don't flag what tools catch
   - ESLint/Prettier issues should be fixed by tools
   - Focus on what automation misses

4. **Be pragmatic**: Some inconsistency is acceptable
   - Legacy code may have different patterns
   - External dependencies may force patterns
   - Some variations are stylistic preference
