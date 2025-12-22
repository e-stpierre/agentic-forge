---
name: validate
description: Comprehensive validation including tests, code review, build verification, and plan compliance
argument-hint: "[--plan <plan-file>] [--skip-tests] [--skip-build] [--skip-review] [--autofix <levels>] [context]"
---

# Validate

Comprehensive validation including tests, code review, build verification, and plan compliance.

## Arguments

- **`--plan <plan-file>`** (optional): Plan file to verify compliance against
- **`--skip-tests`** (optional): Skip test execution
- **`--skip-build`** (optional): Skip build verification
- **`--skip-review`** (optional): Skip code review
- **`--autofix <levels>`** (optional): Comma-separated list of severity levels to auto-fix (e.g., "critical,major")
- **`[context]`** (optional): Optional freeform context for validation focus

## Objective

Perform comprehensive validation of code changes including tests, build verification, code review, and plan compliance to ensure implementation quality before deployment.

## Core Principles

- All validation types run by default unless explicitly skipped
- Findings are rated by criticality for proper prioritization
- Auto-fix only applies to programmatically fixable issues
- Plan compliance checks verify requirements are met
- Re-run validation after auto-fix to confirm all issues resolved

## Instructions

Perform ALL validation types (unless skipped):

### 1. Run Tests

- Detect test framework from project files:
  - `package.json` with test script: `npm test`
  - `pytest.ini`, `pyproject.toml` with pytest: `pytest`
  - `Cargo.toml`: `cargo test`
  - `go.mod`: `go test ./...`
  - `Makefile` with test target: `make test`
- Execute test suite
- Report failures with details
- Categorize test failures by severity

### 2. Code Review

- Launch code-reviewer agent on changed files
- Check for:
  - Bugs and logic errors
  - Security vulnerabilities
  - Code quality issues
  - Missing error handling
  - Performance concerns
- Review against project conventions (from CLAUDE.md)
- Rate findings by criticality:
  - **Critical**: Security vulnerabilities, data loss risks
  - **Major**: Bugs, logic errors, significant quality issues
  - **Medium**: Code quality, maintainability concerns
  - **Low**: Style issues, minor improvements

### 3. Build Verification

- Detect build system from project files:
  - `package.json` with build script: `npm run build`
  - `Cargo.toml`: `cargo build`
  - `go.mod`: `go build ./...`
  - `Makefile` with build target: `make build`
  - `pyproject.toml`: `uv build` or `python -m build`
- Execute build process
- Report build errors with details

### 4. Plan Compliance (if --plan provided)

- Read and parse the plan file
- Extract requirements and tasks
- Verify each requirement is implemented:
  - Check for expected files/components
  - Verify functionality matches requirements
  - Check validation criteria from plan
- Generate compliance report:
  - Completed requirements
  - Missing or incomplete items
  - Deviations from plan

## Output Guidance

Generate a comprehensive validation report:

```markdown
# Validation Report

## Summary
- Tests: PASS/FAIL (X passed, Y failed)
- Build: PASS/FAIL
- Code Review: X critical, Y major, Z medium, W low
- Plan Compliance: X% complete (if plan provided)

## Test Results
[Details of any failures]

## Build Results
[Details of any errors]

## Code Review Findings

### Critical
[Critical issues found]

### Major
[Major issues found]

### Medium
[Medium issues found]

### Low
[Low issues found]

## Plan Compliance (if applicable)
[Compliance details]

## Recommendations
[Next steps to address issues]
```

## Auto-Fix Behavior

When `--autofix` is specified:

1. Parse the comma-separated severity levels
2. After completing all validation, identify fixable issues
3. For each fixable issue at the specified severity levels:
   - Describe the fix to be applied
   - Apply the fix
   - Mark as fixed in the report
4. Re-run affected validations to confirm fixes

Example:
```bash
--autofix critical,major  # Auto-fix critical and major issues
--autofix critical        # Auto-fix only critical issues
```

## Test Framework Detection

| File | Framework | Command |
|------|-----------|---------|
| `package.json` (test script) | npm | `npm test` |
| `pytest.ini` or `pyproject.toml` (pytest) | pytest | `pytest` |
| `Cargo.toml` | Rust | `cargo test` |
| `go.mod` | Go | `go test ./...` |
| `Makefile` (test target) | Make | `make test` |

## Build System Detection

| File | System | Command |
|------|--------|---------|
| `package.json` (build script) | npm | `npm run build` |
| `Cargo.toml` | Cargo | `cargo build` |
| `go.mod` | Go | `go build ./...` |
| `Makefile` (build target) | Make | `make build` |
| `pyproject.toml` | Python | `uv build` |

## Important Notes

- Run all validation checks unless there's a specific reason to skip - they catch critical issues
- Fix failed tests before proceeding
- Understand what will be changed before using auto-fix
- Verify each requirement explicitly - never assume plan compliance
- Resolve all critical and major issues before deployment
