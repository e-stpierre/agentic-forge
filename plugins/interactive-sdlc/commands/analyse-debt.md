---
name: analyse-debt
description: Identify technical debt, optimization opportunities, and refactoring needs
argument-hint: "[context]"
---

# Analyse Debt

Identify technical debt, optimization opportunities, and refactoring needs.

## Arguments

- **`[context]`** (optional): Specific areas or concerns to focus on

## Objective

Identify technical debt, optimization opportunities, and refactoring needs by analyzing architecture, code quality, patterns, and performance issues.

## Core Principles

- Focus on REAL debt - not everything needs refactoring
- Working code has value - perfect is the enemy of good
- Consider why patterns exist before flagging them
- Prioritize by impact - frequently touched code > rarely touched
- Avoid over-engineering and premature abstractions

## Instructions

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

## Output Guidance

Present a summary and save the report:

```
Technical debt analysis complete. Report saved to /analysis/debt.md

## Summary
| Category | Issues | Total Effort |
|----------|--------|--------------|
| Architecture | X | Low/Med/High |
| Code Quality | Y | Low/Med/High |
| Performance | Z | Low/Med/High |

Review the report and prioritize by impact and effort.
```

## Templates

### Report Structure

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

## Don't

- Don't flag everything as debt - working code has value
- Don't ignore why patterns exist - some "debt" is intentional
- Don't suggest premature abstractions or over-engineering
- Don't prioritize rarely-touched code over frequently-used code
- Don't recommend future-proofing without concrete requirements
