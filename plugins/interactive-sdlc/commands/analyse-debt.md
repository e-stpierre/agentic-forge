---
name: analyse-debt
description: Identify technical debt, optimization opportunities, and refactoring needs
argument-hint: "[context]"
---

# Analyse Debt

Identify technical debt, optimization opportunities, and refactoring needs.

## Arguments

- `[context]`: Specific areas or concerns to focus on

## Behavior

1. **Read Configuration**
   - Read `.claude/settings.json` for `interactive-sdlc.analysisDirectory` (default: `/analysis`)

2. **Analyze Codebase**
   Look for technical debt indicators:

   **Architecture:**
   - Circular dependencies
   - Overly complex module structures
   - Missing abstraction layers
   - Tight coupling between components

   **Code Quality:**
   - Code duplication
   - Complex functions (high cyclomatic complexity)
   - Long methods/classes
   - Poor naming conventions
   - Magic numbers/strings

   **Patterns:**
   - Outdated patterns (callbacks vs async/await)
   - Inconsistent patterns across codebase
   - Anti-patterns
   - Framework misuse

   **Performance:**
   - Obvious performance bottlenecks
   - N+1 query patterns
   - Unnecessary re-renders
   - Missing caching opportunities

3. **Categorize Findings**
   Rate each finding by:
   - **Effort**: Low / Medium / High
   - **Benefit**: Impact of addressing the debt

4. **Generate Report**
   - Save to `{analysisDirectory}/debt.md`
   - Group by category

## Report Template

```markdown
# Tech Debt

**Date**: YYYY-MM-DD
**Scope**: [Description of analyzed scope]

## Summary

| Category | Issues | Total Effort |
|----------|--------|--------------|
| Architecture | X | Low/Med/High |
| Code Quality | X | Low/Med/High |
| Performance | X | Low/Med/High |

## Architecture

### DEBT-001: [Title]

**Location:** Files or modules affected

**Issue:** Current problematic pattern

**Improvement:** Suggested improvement

**Benefit:** Why this matters

**Effort:** Low / Medium / High

---

## Code Quality

[Same format]

## Performance

[Same format]
```

## Example Usage

```bash
# Analyze entire codebase
/interactive-sdlc:analyse-debt

# Focus on specific area
/interactive-sdlc:analyse-debt Focus on the data access layer

# Performance focused
/interactive-sdlc:analyse-debt Identify performance bottlenecks

# Specific concern
/interactive-sdlc:analyse-debt Look for code duplication in components/
```

## Effort Estimation

**Low Effort:**
- Simple refactoring
- Renaming for clarity
- Extracting small functions
- Adding types/documentation

**Medium Effort:**
- Extracting modules/classes
- Refactoring patterns
- Adding caching
- Query optimization

**High Effort:**
- Architectural changes
- Major refactoring
- Database schema changes
- API redesign

## Important Principles

1. **Focus on REAL debt**: Not everything needs refactoring
   - Working code has value
   - Perfect is the enemy of good
   - Some "debt" is intentional trade-offs

2. **Consider context**: Understand why patterns exist
   - Legacy constraints
   - Performance requirements
   - Time-to-market decisions

3. **Be pragmatic**: Prioritize by impact
   - Code touched frequently > rarely touched
   - User-facing issues > internal issues
   - Security implications > style preferences

4. **Avoid over-engineering**: Don't suggest
   - Premature abstractions
   - Unnecessary complexity
   - Future-proofing without requirements
