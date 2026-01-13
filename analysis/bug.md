# Bug Report

**Date**: 2026-01-13

**Scope**: Entire codebase (Python source files in experimental-plugins/agentic-core and plugins/agentic-sdlc)

## Summary

- Critical: 0 issues
- Major: 3 issues
- Medium: 2 issues
- Low: 1 issue

## Critical

No critical issues found.

---

## Major

### BUG-001: Potential null reference error in retry logic

**Location:** experimental-plugins/agentic-core/src/agentic_core/checkpoints/recovery.py:71

**Issue:** In the `RetryStrategy.execute_with_retry` method, if all retry attempts fail, `last_error` is raised on line 71. However, if `max_retries` is set to -1 or the loop doesn't execute, `last_error` could theoretically be `None`, resulting in `raise None` which would cause a TypeError.

**Impact:** While unlikely in normal usage (max_retries defaults to 3), this edge case could cause confusing error messages or unexpected behavior if misconfigured. A TypeError "exceptions must derive from BaseException" would be raised instead of the actual error.

**Fix:** Initialize `last_error` to a default exception or add a check before raising:
```python
if last_error is None:
    raise RuntimeError("All retries exhausted without capturing error")
raise last_error
```

---

### BUG-002: Race condition in database connection pool initialization

**Location:** experimental-plugins/agentic-core/src/agentic_core/storage/database.py:86-88

**Issue:** The `acquire()` method checks `if self._pool is None` and then calls `await self.connect()`. In concurrent scenarios, multiple coroutines could pass the None check simultaneously before `connect()` sets `_pool`, leading to multiple pool creation attempts. The asyncpg library may handle this gracefully, but it could still result in resource leaks or connection errors.

**Impact:** In high-concurrency scenarios with multiple agents starting simultaneously, this could cause connection pool creation failures, resource leaks, or connection exhaustion.

**Fix:** Use an asyncio.Lock to ensure thread-safe initialization:
```python
async def acquire(self):
    if self._pool is None:
        async with self._init_lock:  # Add _init_lock in __init__
            if self._pool is None:  # Double-check pattern
                await self.connect()
    async with self._pool.acquire() as conn:
        yield conn
```

---

### BUG-003: Unclosed file handles in worktree context manager error path

**Location:** experimental-plugins/agentic-core/src/agentic_core/git/worktree.py:343-346

**Issue:** In the `temporary_worktree` context manager, if `worktree_path.exists()` is True, the code uses `shutil.rmtree(worktree_path, ignore_errors=True)`. The `ignore_errors=True` flag silently suppresses all errors, including permission errors or locked file handles. If the cleanup fails silently, subsequent `create_worktree` may fail or create corrupted worktrees.

**Impact:** If worktree cleanup fails (e.g., due to locked files from a still-running process), the next worktree creation could fail with cryptic errors or create a corrupt worktree state. This is especially problematic in parallel execution scenarios where multiple worktrees are created/destroyed rapidly.

**Fix:** Remove `ignore_errors=True` and handle errors explicitly, or at minimum log when cleanup fails:
```python
try:
    shutil.rmtree(worktree_path)
except Exception as e:
    # Log error or raise with context
    logger.warning(f"Failed to clean up worktree {worktree_path}: {e}")
```

---

## Medium

### BUG-004: Incomplete parsing of worktree list output

**Location:** experimental-plugins/agentic-core/src/agentic_core/git/worktree.py:167-192

**Issue:** The `list_worktrees` function parses `git worktree list --porcelain` output by splitting on `---` separators. The parsing logic assumes entries are separated by empty lines, but the loop logic has a potential off-by-one error. When processing the last worktree entry (lines 185-192), it checks `if current_path` but doesn't validate that `current_branch` was set. For bare worktrees or detached HEAD states, the branch line might be missing, leading to incomplete Worktree objects with empty branch names.

**Impact:** In repositories with detached HEAD worktrees or bare worktrees, the function may return Worktree objects with empty branch names, causing downstream logic to fail or behave unexpectedly.

**Fix:** Add validation for both `current_path` and `current_branch` before appending, or handle the detached HEAD case explicitly by parsing the HEAD line from porcelain output.

---

### BUG-005: Missing null check in checkpoint recovery

**Location:** experimental-plugins/agentic-core/src/agentic_core/checkpoints/recovery.py:219-221

**Issue:** In `recover_workflow`, the code accesses `event.get("step_name")` and checks if it's truthy, but then uses it directly in the append without ensuring it's a valid string. If `step_name` is an unexpected type (e.g., integer 0, empty string, or None), it could be appended to the list incorrectly or cause issues downstream.

**Impact:** Edge case where malformed Kafka messages could corrupt the recovered state with invalid step names (None, 0, etc.), leading to workflow state corruption or validation failures later.

**Fix:** Add explicit type checking:
```python
step = event.get("step_name")
if step and isinstance(step, str) and step not in state.get("completed_steps", []):
    state.setdefault("completed_steps", []).append(step)
```

---

## Low

### BUG-006: Inconsistent error handling in YAML parsing

**Location:** plugins/agentic-sdlc/src/agentic_sdlc/checkpoints/manager.py:130-136

**Issue:** The `read_checkpoints` function silently catches `yaml.YAMLError` exceptions and skips malformed checkpoint entries (line 135-136). While this prevents crashes, it means corrupted checkpoint data is silently ignored without logging or notifying the user. This could lead to confusion when expected checkpoints are missing.

**Impact:** Users may be unaware that some checkpoints failed to parse, leading to incomplete recovery data. In debugging scenarios, this silent failure makes it harder to identify data corruption issues.

**Fix:** Add logging when YAML parsing fails:
```python
except yaml.YAMLError as e:
    logger.warning(f"Failed to parse checkpoint frontmatter: {e}")
    pass
```

---
