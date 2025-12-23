---
name: test
description: Run tests and analyze results (autonomous, JSON I/O)
argument-hint: --json-input <test.json> | --json-stdin
---

# Test Command (Autonomous)

Runs tests and analyzes results. Operates autonomously without user interaction.

## Input Schema

```json
{
  "test_command": "npm test",
  "coverage": true,
  "files": ["src/auth.ts"],
  "test_pattern": "auth.*.test.ts",
  "fix_failures": false
}
```

## Output Schema

```json
{
  "success": true,
  "passed": 42,
  "failed": 2,
  "skipped": 3,
  "total": 47,
  "coverage": {
    "lines": 85.5,
    "branches": 78.2,
    "functions": 90.1,
    "statements": 84.3
  },
  "failures": [
    {
      "test": "auth.test.ts > OAuth > should handle callback",
      "error": "Expected redirect to dashboard",
      "file": "src/auth.test.ts",
      "line": 45,
      "stack_trace": "..."
    }
  ],
  "duration_ms": 12500
}
```

## Behavior

1. **Parse Input**: Get test configuration
2. **Detect Framework**: Find test command if not provided
   - `package.json` (test script) -> `npm test`
   - `pytest.ini`, `pyproject.toml` -> `pytest`
   - `Cargo.toml` -> `cargo test`
   - `go.mod` -> `go test ./...`
3. **Run Tests**: Execute test suite
4. **Parse Results**: Extract pass/fail counts
5. **Collect Coverage**: If coverage enabled
6. **Fix Failures (optional)**: If fix_failures true
7. **Output JSON**: Return structured results

## Error Handling

```json
{
  "success": false,
  "error": "No test framework detected",
  "error_code": "NO_TEST_FRAMEWORK"
}
```

## Test Framework Detection

| File | Framework | Command |
|------|-----------|---------|
| `package.json` (test script) | npm | `npm test` |
| `pytest.ini`, `pyproject.toml` | pytest | `pytest` |
| `Cargo.toml` | Rust | `cargo test` |
| `go.mod` | Go | `go test ./...` |
| `Makefile` (test target) | Make | `make test` |

## Usage

```bash
/agentic-sdlc:test --json-input /specs/test-input.json

# Simple test run
echo '{"coverage":true}' | /agentic-sdlc:test --json-stdin
```

## Python Integration

```python
result = run_claude("/agentic-sdlc:test", json_input={
    "coverage": True,
    "files": ["src/auth.ts"]
})

if result["failed"] > 0:
    print(f"Tests failed: {result['failed']}")
    for failure in result["failures"]:
        print(f"  - {failure['test']}: {failure['error']}")
```
