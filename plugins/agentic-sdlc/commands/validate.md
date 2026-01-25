---
name: validate
description: Validate implementation against plan and quality standards
argument-hint: [plan] [severity]
---

# Validate Command

## Overview

Validate the implementation against the plan and quality standards. This command runs tests, checks code quality, verifies plan compliance, and ensures the build succeeds before proceeding.

## Arguments

- **`[plan]`** (optional): Path to plan document.
- **`[severity]`** (optional): Minimum severity to report. Values: `minor`, `major`, `critical`. Defaults to `minor`.

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
      "milestones_complete": 3,
      "milestones_total": 3
    },
    "tests": {
      "passed": true,
      "total": 45,
      "passing": 45,
      "failing": 0,
      "coverage": 82.5
    },
    "lint": {
      "passed": true,
      "errors": 0,
      "warnings": 2
    },
    "types": {
      "passed": true,
      "errors": 0
    },
    "build": {
      "passed": true
    }
  },
  "issues": [
    {
      "severity": "minor",
      "category": "lint",
      "message": "Unused import in auth.ts",
      "file": "src/auth.ts",
      "line": 5
    }
  ],
  "summary": "Validation passed with 2 minor warnings"
}
```

---

{% if plan %}

## Plan Reference

{{ plan }}
{% endif %}

Severity Threshold: {{ severity }}

---

Run validation checks and return JSON output.
