---
name: test
description: Run tests and analyze results
argument-hint: [test-path] [--fix] [--dry-run]
---

# Test Command

Runs tests, analyzes failures, and optionally fixes failing tests.

## Parameters

- **`test-path`** (optional): Specific test file or directory to run. If omitted, runs all tests.
- **`--fix`** (optional): Attempt to automatically fix failing tests
- **`--dry-run`** (optional): Show which tests would run without executing

## Objective

Run tests, provide clear analysis of failures, and optionally fix issues.

## Core Principles

- Detect the test framework automatically
- Provide clear, actionable failure analysis
- When fixing, preserve test intent - fix the code or update expectations appropriately
- Never skip or delete failing tests as a "fix"
- Group related failures for efficient debugging

## Instructions

1. Parse the input for test path and flags

2. **If `--dry-run`**, show what would run and exit:
   - Detect test framework and configuration
   - List test files that would be executed
   - Report estimated test count

3. Detect the test framework:
   - Check for `jest.config.*`, `vitest.config.*`, `pytest.ini`, `pyproject.toml`
   - Look at `package.json` scripts for test commands
   - Check for common test directories: `tests/`, `__tests__/`, `test/`, `spec/`

4. Run the tests:

   ```bash
   # JavaScript/TypeScript
   npm test [-- path] 2>&1
   # or
   npx jest [path] 2>&1
   # or
   npx vitest run [path] 2>&1

   # Python
   pytest [path] -v 2>&1
   ```

5. Parse the test output:
   - Count passed, failed, skipped tests
   - Extract failure details (file, test name, error message, stack trace)
   - Identify patterns in failures (same root cause, related tests)

6. Analyze failures:
   - For each failure, determine:
     - Is it a test bug or implementation bug?
     - What is the root cause?
     - What would fix it?

7. **If `--fix` flag is present**:
   - For each failure, determine the appropriate fix:
     - **Implementation bug**: Fix the source code
     - **Test bug**: Fix the test expectations
     - **Missing implementation**: Report as not auto-fixable
   - Apply fixes using the Edit tool
   - Re-run tests to verify fixes

8. Generate the test report

## Output Guidance

### Basic test run:

```markdown
## Test Results

**Framework**: Jest **Command**: `npm test`

### Summary

| Status  | Count |
| ------- | ----- |
| Passed  | 45    |
| Failed  | 3     |
| Skipped | 2     |
| Total   | 50    |

### Failed Tests

#### 1. UserService.test.ts > createUser > should hash password

**Error**: `Expected "hashed_password" but received "password123"`

**Location**: `src/services/__tests__/UserService.test.ts:45`

**Analysis**: The password hashing function is not being called. Check `UserService.createUser()` implementation.

**Stack Trace**:
```

at Object.<anonymous> (src/services/**tests**/UserService.test.ts:45:12)

```

#### 2. AuthController.test.ts > login > should return token

...

### Failure Patterns

- 2 failures related to password hashing (likely same root cause)
- 1 unrelated failure in auth flow

### Recommendations

1. Check `hashPassword()` function in `src/utils/crypto.ts`
2. Verify AuthController is using the updated UserService
```

### With `--fix`:

````markdown
## Test Results (with auto-fix)

### Initial Run

- Passed: 45
- Failed: 3

### Fixes Applied

#### Fix 1: UserService.createUser password hashing

**File**: `src/services/UserService.ts:23`

**Issue**: Missing `await` on async hash function

**Fix Applied**:

```diff
- const hashedPassword = hashPassword(password);
+ const hashedPassword = await hashPassword(password);
```
````

#### Fix 2: Test expectation update

**File**: `src/services/__tests__/UserService.test.ts:45`

**Issue**: Test expected wrong error message format

**Fix Applied**:

```diff
- expect(error.message).toBe("Invalid");
+ expect(error.message).toBe("Invalid input");
```

### Verification Run

- Passed: 48
- Failed: 0

### Summary

Fixed 2 issues automatically. All tests now passing.

````

### With `--dry-run`:

```markdown
## Test Dry Run

**Framework**: Jest
**Configuration**: `jest.config.js`

### Tests to Run

| File | Test Count |
|------|------------|
| `src/services/__tests__/UserService.test.ts` | 12 |
| `src/services/__tests__/AuthService.test.ts` | 8 |
| `src/controllers/__tests__/AuthController.test.ts` | 15 |

**Total**: 35 tests in 3 files

**Command that would run**:
```bash
npx jest src/services
````

```

```
