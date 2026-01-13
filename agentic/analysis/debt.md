# Tech Debt

**Date**: 2026-01-13

**Scope**: Entire agentic-forge repository (plugins/ and experimental-plugins/)

## Summary

| Category     | Issues | Total Effort |
| ------------ | ------ | ------------ |
| Architecture | 7      | High         |
| Code Quality | 8      | High         |
| Performance  | 3      | Medium       |

## Architecture

### DEBT-001: Missing test coverage for agentic-sdlc plugin

**Severity:** Critical

**Location:** plugins/agentic-sdlc/

**Issue:** The agentic-sdlc plugin has 4,692 lines of Python code across 20 modules with 0 test files. This is a critical gap for a workflow orchestration system that handles complex state management, parallel execution, file I/O, and error recovery.

**Improvement:** Establish comprehensive test suites covering:

- YAML parser edge cases (invalid syntax, missing required fields, type validation)
- Workflow executor error scenarios (step failures, timeouts, retries)
- Configuration merge logic (deep merge with overrides)
- Memory search functionality (keyword matching, categorization)
- Git worktree operations (creation, cleanup, orphan pruning)
- Progress tracking with file locks (concurrent access, race conditions)
- Ralph loop completion detection (JSON parsing, max iterations)
- Template rendering with Jinja2 (variable interpolation, missing variables)

**Benefit:** Prevents regressions during refactoring and ensures reliable behavior in production workflows. Testing is especially critical for error recovery paths that are hard to manually verify.

**Effort:** High

---

### DEBT-002: Monolithic executor and orchestrator classes

**Severity:** Major

**Location:**

- plugins/agentic-sdlc/src/agentic_sdlc/executor.py (827 lines)
- plugins/agentic-sdlc/src/agentic_sdlc/orchestrator.py (752 lines)
- plugins/agentic-sdlc/src/agentic_sdlc/cli.py (630 lines)

**Issue:** Large classes with multiple responsibilities violate Single Responsibility Principle. The executor handles parallel execution, conditional logic, step execution, and error recovery all in one class. The orchestrator combines decision loop management, signal handling, and progress updates. The CLI module handles argument parsing, subcommand routing, and I/O coordination.

**Improvement:** Extract concerns into focused classes:

- `ParallelStepExecutor` - Manages git worktrees and parallel step execution
- `ConditionalStepEvaluator` - Handles Jinja2 condition evaluation
- `StepErrorHandler` - Centralized retry and error recovery logic
- `SignalManager` - Graceful shutdown handling
- `CliArgumentValidator` - Input validation and type coercion
- `SubcommandRouter` - Dispatch to appropriate handlers

**Benefit:** Improves testability (each class can be unit tested in isolation), reduces cognitive load when reading code, and makes it easier to add new step types or error recovery strategies without touching unrelated code.

**Effort:** High

---

### DEBT-003: Error recovery complexity with overlapping mechanisms

**Severity:** Major

**Location:** plugins/agentic-sdlc/ (executor, orchestrator, progress, ralph_loop modules)

**Issue:** Multiple overlapping recovery mechanisms make behavior unpredictable:

- Step-level retry logic (max_retry setting)
- Checkpoint recovery system (save/load progress state)
- Ralph loop iteration tracking (separate state file)
- File-based progress tracking with FileLock
- Process signal handlers for graceful shutdown

The interaction between these systems is not well-documented. For example, what happens if a checkpoint is triggered during parallel execution with a ralph-loop step that fails on iteration 3?

**Improvement:**

- Centralize recovery logic in a dedicated `RecoveryManager` class
- Document interaction between retry, checkpoint, and parallel execution
- Add state machine diagram to architecture docs showing all possible states and transitions
- Implement integration tests that verify recovery scenarios

**Benefit:** Predictable behavior in edge cases, easier debugging of workflow failures, and clearer mental model for developers adding new features.

**Effort:** High

---

### DEBT-004: Hardcoded step type extensibility

**Severity:** Major

**Location:** plugins/agentic-sdlc/src/agentic_sdlc/parser.py

**Issue:** Step types are hardcoded in an enum:

```python
class StepType(Enum):
    PROMPT = "prompt"
    COMMAND = "command"
    PARALLEL = "parallel"
    SERIAL = "serial"
    CONDITIONAL = "conditional"
    RALPH_LOOP = "ralph-loop"
    WAIT_FOR_HUMAN = "wait-for-human"
```

Adding new step types requires modifying parser.py, executor.py, and orchestrator.py. This creates tight coupling and makes it difficult for users to add custom step types without forking the plugin.

**Improvement:** Implement plugin-based step type registration:

- Define a `StepHandler` interface with `parse()`, `execute()`, and `validate()` methods
- Allow registration of custom step handlers via configuration or Python entry points
- Use factory pattern to instantiate handlers based on step type string
- Maintain backward compatibility with built-in step types

**Benefit:** Enables users to extend workflow capabilities without modifying plugin code. Makes the system more modular and testable.

**Effort:** High

---

### DEBT-005: Python version inconsistency between plugins

**Severity:** Minor

**Location:**

- plugins/agentic-sdlc/pyproject.toml (requires-python = ">=3.10")
- experimental-plugins/agentic-core/pyproject.toml (requires-python = ">=3.12")

**Issue:** Different Python version requirements may cause compatibility issues when users install both plugins in the same environment. Agentic-core uses Python 3.12+ features while agentic-sdlc supports 3.10+.

**Improvement:** Standardize on a single minimum Python version across all plugins. Either:

- Upgrade agentic-sdlc to require Python 3.12+ (aligns with latest stable)
- Downgrade agentic-core to support Python 3.10+ (broader compatibility)

Document the decision in CLAUDE.md as a project-wide guideline.

**Benefit:** Prevents user confusion and installation errors. Simplifies CI/CD testing matrices.

**Effort:** Low

---

### DEBT-006: Dependency version conflicts between plugins

**Severity:** Minor

**Location:**

- plugins/agentic-sdlc/pyproject.toml
- experimental-plugins/agentic-core/pyproject.toml

**Issue:** Different dependency strategies with no shared version management:

- agentic-sdlc: Minimal dependencies (PyYAML, Jinja2, filelock)
- agentic-core: Extensive dependencies (asyncpg, confluent-kafka, transformers, pydantic)

Both use Jinja2 but specify different version constraints. No compatibility matrix or version pinning strategy documented.

**Improvement:**

- Consider monorepo dependency management (single pyproject.toml with workspace support)
- Document explicit compatibility matrix in root README
- Use version ranges that allow overlap (e.g., jinja2>=3.1,<4.0)
- Add CI tests that install all plugins together to catch conflicts

**Benefit:** Prevents installation failures when multiple plugins are used together.

**Effort:** Medium

---

### DEBT-007: Experimental plugin maturity and migration path

**Severity:** Minor

**Location:** experimental-plugins/agentic-core/

**Issue:** Agentic-core has significant infrastructure dependencies (PostgreSQL + Kafka via Docker Compose) but lacks:

- CHANGELOG.md (per project policy, only added when moving to /plugins/)
- Stability timeline (when will it move from experimental to official?)
- Migration guide for projects using earlier versions
- Upgrade path from agentic-sdlc's keyword-based memory to agentic-core's semantic memory

**Improvement:**

- Create docs/vision/agentic-core-roadmap.md with timeline and milestone criteria
- Document breaking changes expected before v1.0.0
- Add migration guide covering: data migration (memory format), configuration changes, API breaking changes
- Provide scripts for migrating agentic-sdlc workflows to agentic-core

**Benefit:** Sets clear expectations for users evaluating the plugin. Reduces friction when promoting to official status.

**Effort:** Medium

---

## Code Quality

### DEBT-008: Inconsistent data validation approaches

**Severity:** Major

**Location:**

- plugins/agentic-sdlc/src/agentic_sdlc/parser.py (dict-based validation)
- plugins/agentic-sdlc/src/agentic_sdlc/config.py (string parsing with isdigit())
- experimental-plugins/agentic-core/ (Pydantic models)

**Issue:** Mixed validation approaches create inconsistent error handling:

agentic-sdlc uses manual dict validation:

```python
if "name" not in data:
    raise WorkflowParseError("Missing required field: name")
```

agentic-sdlc config uses string parsing:

```python
if value.lower() == "true":
    parsed_value = True
elif value.isdigit():
    parsed_value = int(value)
```

agentic-core uses Pydantic for type safety and automatic validation.

**Improvement:** Migrate agentic-sdlc to use Pydantic for:

- WorkflowDefinition and nested dataclasses
- Configuration schema validation
- API input/output validation

This provides automatic type coercion, field validation, and better error messages.

**Benefit:** Catches errors earlier (at parse time vs runtime), provides better error messages, and reduces boilerplate validation code.

**Effort:** High

---

### DEBT-009: Configuration typos silently create new entries

**Severity:** Major

**Location:** plugins/agentic-sdlc/src/agentic_sdlc/config.py:85-104

**Issue:** The `set_config_value` function creates new config entries for any key without validation:

```python
def set_config_value(key: str, value: str, repo_root: Path | None = None) -> None:
    config = load_config(repo_root)
    parts = key.split(".")
    target = config
    for part in parts[:-1]:
        if part not in target:
            target[part] = {}  # Creates new entry for typos
        target = target[part]
```

Typing `agentic-sdlc config set defaults.maxRetry 5` works, but so does `agentic-sdlc config set defaults.maxRtry 5` (typo creates new key).

**Improvement:**

- Add JSON Schema validation for config structure
- Reject unknown configuration keys with helpful error message
- Suggest closest matching key when typo detected (e.g., "Did you mean 'maxRetry'?")
- Add `--force` flag to allow creating custom keys if needed

**Benefit:** Prevents silent misconfigurations that waste debugging time. Users get immediate feedback on typos.

**Effort:** Medium

---

### DEBT-010: Limited docstring coverage

**Severity:** Major

**Location:** All Python modules in plugins/agentic-sdlc/

**Issue:** Many functions lack docstrings. Based on sampling:

- executor.py: Class-level docstring present, but many methods undocumented
- orchestrator.py: Some functions have type hints but no docstrings explaining behavior
- Complex functions like `_execute_parallel_step` have no documentation of assumptions or side effects

**Improvement:** Add comprehensive docstrings following Google or NumPy style:

- Module-level docstrings explaining purpose
- Class-level docstrings with usage examples
- Function docstrings with Args, Returns, Raises sections
- Document non-obvious behavior (e.g., "Creates git worktree which must be cleaned up manually if function raises")

**Benefit:** Improves maintainability, helps onboarding new contributors, and enables better IDE autocomplete/hints.

**Effort:** High (4,692 lines to document)

---

### DEBT-011: Deep nesting in CLI argument parsing

**Severity:** Minor

**Location:** plugins/agentic-sdlc/src/agentic_sdlc/cli.py

**Issue:** The main() function has deep nesting due to multiple subcommands and argument parsing logic all in one function (630 lines total). This makes it hard to follow control flow.

**Improvement:** Extract each subcommand into a separate handler function:

- `handle_run(args: Namespace) -> None`
- `handle_resume(args: Namespace) -> None`
- `handle_status(args: Namespace) -> None`
- etc.

Keep CLI parsing logic flat in main(), dispatch to handlers.

**Benefit:** Easier to read and test individual subcommands.

**Effort:** Low

---

### DEBT-012: No Architecture Decision Records (ADRs)

**Severity:** Minor

**Location:** docs/

**Issue:** The project makes several non-trivial architectural decisions (Python + Claude hybrid model, file-based state, git worktrees for parallelism, new session per step) but doesn't document the reasoning or alternatives considered.

**Improvement:** Add docs/adr/ directory with decision records:

- ADR-001: Why hybrid Python + Claude orchestration?
- ADR-002: Why new session per workflow step?
- ADR-003: Why file-based progress instead of database?
- ADR-004: Why git worktrees for parallel execution?

Use lightweight format (date, status, context, decision, consequences).

**Benefit:** Helps new contributors understand design rationale. Prevents revisiting settled decisions. Documents trade-offs.

**Effort:** Low

---

### DEBT-013: Interactive-sdlc maintainability concerns

**Severity:** Minor

**Location:** plugins/interactive-sdlc/commands/ (21 Markdown files)

**Issue:** The interactive-sdlc plugin is entirely prompt-based (no code, just Markdown commands). While this is flexible, it's harder to maintain than code:

- No type checking or syntax validation
- Changes require manual testing across all commands
- No automated tests possible for prompt quality
- Version control diffs are less meaningful for prose

**Improvement:**

- Establish prompt testing methodology (example: maintain a test suite of expected inputs/outputs)
- Use the /normalize command to validate prompt structure against templates
- Consider hybrid approach: complex logic in Python, simple tasks in prompts
- Document best practices for prompt maintainability in docs/

**Benefit:** Reduces risk of prompt regressions. Makes it easier to review changes.

**Effort:** Medium

---

### DEBT-014: Async/await pattern inconsistency

**Severity:** Minor

**Location:**

- plugins/agentic-sdlc/ (uses ThreadPoolExecutor, synchronous)
- experimental-plugins/agentic-core/ (uses asyncio, asynchronous)

**Issue:** Agentic-sdlc uses synchronous code with ThreadPoolExecutor for parallel execution, while agentic-core uses async/await patterns with asyncpg and asyncio. This makes it difficult to share code between plugins and creates different mental models.

**Improvement:** Consider async refactoring for agentic-sdlc to match agentic-core:

- Replace ThreadPoolExecutor with asyncio.gather() for parallel steps
- Use aiofiles for async file I/O
- Make run_claude() async
- Update progress tracking to use async file operations

This would enable better performance and consistency.

**Benefit:** Unified coding patterns across plugins, better resource utilization, easier code sharing.

**Effort:** High (requires touching most modules)

---

### DEBT-015: File-based locking contention under high concurrency

**Severity:** Minor

**Location:** plugins/agentic-sdlc/src/agentic_sdlc/progress.py

**Issue:** File-based locking with FileLock could contend under high concurrency (e.g., many parallel steps updating progress simultaneously). The current implementation uses a single lock file for the entire progress.json.

**Improvement:**

- Profile lock contention under realistic parallel workflow scenarios
- If contention is a problem, consider finer-grained locking (per-step locks)
- Alternative: Use atomic file operations (write to temp file, rename)
- For high-throughput scenarios, consider migrating to database storage (like agentic-core)

**Benefit:** Better performance in highly parallel workflows.

**Effort:** Medium

---

## Performance

### DEBT-016: Memory search uses linear keyword matching

**Severity:** Major

**Location:** plugins/agentic-sdlc/src/agentic_sdlc/memory/search.py

**Issue:** The memory search implementation uses linear search through all memory files with simple keyword matching:

- No semantic search capability
- No ranking or relevance scoring
- No vector embeddings
- Linear O(n) search through all files

As memory volume grows, search becomes less effective and requires exact keyword matches.

**Improvement:**

- Add optional semantic search with embeddings (like agentic-core's pgvector integration)
- Implement BM25-style ranking for keyword search to score relevance
- Add caching layer for frequently accessed memories
- Build inverted index for faster keyword lookup

Start with caching as low-effort win, then add ranking, then consider semantic search.

**Benefit:** Faster search as memory grows, better recall with semantic matching, more useful results.

**Effort:** High (semantic search requires new dependencies and infrastructure)

---

### DEBT-017: No caching for frequently accessed configuration

**Severity:** Minor

**Location:** plugins/agentic-sdlc/src/agentic_sdlc/config.py

**Issue:** `load_config()` reads and parses config.json from disk every time it's called. For workflows with many steps, this file I/O happens repeatedly.

**Improvement:**

- Add in-memory caching with cache invalidation on config changes
- Use functools.lru_cache with file modification time check
- Alternative: Load config once at executor initialization, pass config object to steps

**Benefit:** Reduces file I/O overhead, especially for workflows with many steps.

**Effort:** Low

---

### DEBT-018: Ralph loop state tracking creates many small files

**Severity:** Minor

**Location:** plugins/agentic-sdlc/src/agentic_sdlc/ralph_loop.py

**Issue:** Ralph loop creates a separate state file for each ralph-loop step (ralph-{step-name}.md). For workflows with multiple ralph-loops running many iterations, this creates many small files:

- File system overhead for many small files
- Slower to read/write many files vs one consolidated file
- Harder to clean up orphaned files

**Improvement:**

- Consolidate ralph loop state into progress.json as a nested structure
- Use single ralph-state.json file with all loop states
- Add cleanup command to remove orphaned ralph state files

**Benefit:** Reduces file system overhead, simplifies cleanup.

**Effort:** Low

---
