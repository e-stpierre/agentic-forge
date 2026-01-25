---
name: validate
description: Validate implementation against plan and quality standards
argument-hint: [plan] [severity]
---

# Validate

## Overview

Validate the implementation against the plan and quality standards. This skill runs tests, checks code quality, verifies plan compliance, and ensures the build succeeds before proceeding.

## Arguments

### Definitions

- **`[plan]`** (optional): Path to plan document.
- **`[severity]`** (optional): Minimum severity to report. Values: `minor`, `major`, `critical`. Defaults to `minor`.

### Values

$ARGUMENTS

## Core Principles

- All tests must pass before validation succeeds
- Code quality checks (lint, types) must pass
- Plan compliance is verified when a plan is provided
- Report issues with accurate severity levels
- Build must complete without errors

## Instructions

1. **Load Plan** (if provided)
   - Read and parse the plan document
   - Prepare for compliance verification

2. **Run Validation Checks**
   - **Test Suite**: Run all tests, verify coverage
   - **Linter**: Check for linting errors
   - **Type Checker**: Verify type correctness
   - **Build**: Ensure project builds successfully

3. **Check Plan Compliance** (if plan provided)
   - Verify all milestones completed
   - Verify all tasks marked done
   - Check for scope creep (unplanned changes)

4. **Aggregate Results**
   - Collect all check results
   - Filter issues by severity threshold
   - Generate summary

5. **Return JSON Output**

## Output Guidance

Return JSON with validation details:

```json
{
  "success": true,
  "validation_passed": true,
  "checks": {
    "plan_compliance": {
      "passed": true,
      "milestones_complete": "{{milestones_complete}}",
      "milestones_total": "{{milestones_total}}"
    },
    "tests": {
      "passed": true,
      "total": "{{tests_total}}",
      "passing": "{{tests_passing}}",
      "failing": "{{tests_failing}}",
      "coverage": "{{coverage_percent}}"
    },
    "lint": {
      "passed": true,
      "errors": "{{lint_errors}}",
      "warnings": "{{lint_warnings}}"
    },
    "types": {
      "passed": true,
      "errors": "{{type_errors}}"
    },
    "build": {
      "passed": true
    }
  },
  "issues": ["{{issues_array}}"],
  "summary": "{{summary}}"
}
```

<!--
Placeholders:
- {{milestones_complete}}, {{milestones_total}}: Integer counts for plan compliance
- {{tests_total}}, {{tests_passing}}, {{tests_failing}}: Integer counts for test results
- {{coverage_percent}}: Code coverage percentage (e.g., 82.5)
- {{lint_errors}}, {{lint_warnings}}: Integer counts for lint results
- {{type_errors}}: Integer count for type check errors
- {{issues_array}}: Array of issue objects with severity, category, message, file, line
- {{summary}}: Human-readable summary of validation results
-->

### Issue Schema

```json
{
  "severity": "{{severity}}",
  "category": "{{category}}",
  "message": "{{message}}",
  "file": "{{file}}",
  "line": "{{line}}"
}
```

<!--
Placeholders:
- {{severity}}: One of minor, major, critical
- {{category}}: Check category (tests, lint, types, build, plan_compliance)
- {{message}}: Description of the issue
- {{file}}: Path to the affected file
- {{line}}: Line number where issue occurs
-->
