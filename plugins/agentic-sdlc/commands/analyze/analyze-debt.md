---
name: analyze-debt
description: Identify technical debt, optimization opportunities, and refactoring needs
argument-hint: [paths...]
---

# Analyze Debt

## Overview

Identify technical debt, optimization opportunities, and refactoring needs. Analyzes architecture, code quality, patterns, and performance issues. Returns structured JSON for workflow integration and generates a markdown report.

## Arguments

- **`[paths...]`** (optional): Space-separated list of files or directories to analyze. When provided, only these paths are analyzed. Otherwise, the entire codebase is analyzed.

## Core Principles

- Focus on REAL debt - not everything needs refactoring
- Working code has value - perfect is the enemy of good
- Consider why patterns exist before flagging them
- Prioritize by impact - frequently touched code > rarely touched
- Avoid over-engineering and premature abstractions
- Only report UNFIXED issues - if the issue has been resolved, do not include it
- Understand why patterns exist before flagging them - some "debt" is intentional
- Base recommendations on concrete requirements, not hypothetical future needs
- If no issues found, return success with zero counts

## Instructions

1. **Determine Scope**
   - If `[paths]` are provided, focus only on those files/directories
   - Otherwise, analyze the entire codebase
   - Exclude test files, node_modules, build outputs

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
   - **Severity**: Critical / Major / Medium / Low
   - **Effort**: Low / Medium / High

4. **Generate Report**
   - Save to `agentic/analysis/debt.md`
   - Group by category

5. **Return JSON Output**

## Output Guidance

Return a JSON object AND save a detailed markdown report.

### JSON Output

```json
{
  "success": true,
  "analysis_type": "debt",
  "findings_count": {
    "architecture": 0,
    "code_quality": 0,
    "performance": 0,
    "total": 0
  },
  "findings": [
    {
      "id": "DEBT-001",
      "category": "architecture",
      "severity": "major",
      "effort": "medium",
      "title": "Brief title",
      "location": "path/to/file.ts or module name",
      "issue": "What is wrong",
      "improvement": "How to improve",
      "benefit": "Why it matters"
    }
  ],
  "document_path": "agentic/analysis/debt.md"
}
```

## Templates

### Markdown Report Structure

Save to `agentic/analysis/debt.md`:

```markdown
# Tech Debt

**Date**: YYYY-MM-DD
**Scope**: Entire codebase | Specified paths

## Summary

| Category     | Issues | Total Effort |
| ------------ | ------ | ------------ |
| Architecture | X      | Low/Med/High |
| Code Quality | Y      | Low/Med/High |
| Performance  | Z      | Low/Med/High |

## Architecture

### DEBT-001: Brief title

**Location:** file or module
**Issue:** Current problematic pattern
**Improvement:** Suggested improvement
**Benefit:** Why this matters
**Effort:** Low / Medium / High

---

## Code Quality

[Same format as Architecture]

## Performance

[Same format as Architecture]
```

### Effort Estimation

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
