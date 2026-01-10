---
name: validate
description: Validate implementation against plan and quality standards
output: json
arguments:
  - name: plan
    description: Path to plan document
    required: false
  - name: severity
    description: Minimum severity to report (minor, major, critical)
    required: false
    default: minor
---

# Validate Command

Validate the implementation against the plan and quality standards. Runs tests, checks code quality, and verifies plan compliance.

## Checks Performed

1. **Plan Compliance**:
   - All milestones completed
   - All tasks marked done
   - No scope creep (extra unplanned changes)

2. **Test Validation**:
   - All tests pass
   - New code has test coverage
   - No regression in existing tests

3. **Code Quality**:
   - No linting errors
   - Type checking passes
   - No security vulnerabilities introduced

4. **Build Verification**:
   - Project builds successfully
   - No new build warnings

## Output Format

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

## Process

1. Load plan if provided
2. Run test suite
3. Run linter
4. Run type checker
5. Run build
6. Check plan compliance
7. Aggregate results
8. Return JSON summary

---

{% if plan %}

## Plan Reference

{{ plan }}
{% endif %}

Severity Threshold: {{ severity }}

---

Run validation checks and return JSON output.
