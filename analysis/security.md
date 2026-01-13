# Security Analysis

**Date**: 2026-01-13

**Scope**: Entire codebase (plugins/agentic-sdlc, experimental-plugins/agentic-core, .claude scripts)

## Summary

| Risk Level | Issues |
|------------|--------|
| Critical   | 0      |
| High       | 3      |
| Medium     | 1      |
| Low        | 2      |

⚠️ High-risk issues require immediate attention.

## High Risk

### SEC-001: Command Injection via shell=True

**Location:**
- `.claude/update-plugins.py:137`
- `plugins/agentic-sdlc/src/agentic_sdlc/runner.py:91,132,186`
- `plugins/agentic-sdlc/src/agentic_sdlc/git/worktree.py:37`
- `experimental-plugins/agentic-core/src/agentic_core/git/worktree.py:58`
- `experimental-plugins/agentic-core/src/agentic_core/runner.py:76,117,174`
- `experimental-plugins/agentic-core/src/agentic_core/providers/base.py:149,198`
- `experimental-plugins/agentic-core/src/agentic_core/providers/claude.py:158`

**Vulnerability:** Command Injection (CWE-78)

Multiple instances of `subprocess.run()` and `subprocess.Popen()` using `shell=True` with dynamically constructed command strings. When `shell=True` is used, the command is passed through the shell, making it vulnerable to command injection if any part of the command contains user-controlled input.

**Risk:** If any input (prompts, file paths, branch names, etc.) is not properly sanitized, an attacker could inject shell commands that would be executed with the privileges of the running process. This could lead to arbitrary code execution, data exfiltration, or system compromise.

**Remediation:**

1. **Remove `shell=True`**: Pass commands as list arguments instead of strings
2. **Sanitize inputs**: If shell=True is required for Windows PATH resolution, ensure all inputs are properly validated

Example fix for `runner.py`:

```python
# BEFORE (vulnerable):
process = subprocess.Popen(
    cmd,  # ["claude", "--print", ...]
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    cwd=cwd_str,
    shell=True,  # VULNERABLE
)

# AFTER (secure):
process = subprocess.Popen(
    cmd,  # Already a list
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    cwd=cwd_str,
    shell=False,  # Safe
)
```

**References:**
- CWE-78: https://cwe.mitre.org/data/definitions/78.html
- OWASP A03:2021 Injection

---

### SEC-002: Jinja2 Template Injection - Disabled Autoescaping

**Location:**
- `experimental-plugins/agentic-core/src/agentic_core/workflow/templates.py:15`

**Vulnerability:** Server-Side Template Injection (CWE-1336)

The Jinja2 template environment is configured with `autoescape=False`, which disables automatic HTML escaping. While the templates are used for generating prompts (not HTML), the template resolver accepts arbitrary template strings via `from_string()` and renders them with user-provided context data.

```python
self.env = Environment(
    undefined=StrictUndefined,
    autoescape=False,  # DANGEROUS
    trim_blocks=True,
    lstrip_blocks=True,
)
```

**Risk:** If an attacker can control any part of the template string (via workflow files, configuration, or other inputs), they could inject malicious Jinja2 code that executes arbitrary Python code during template rendering. This could lead to remote code execution, file system access, or data exfiltration.

**Remediation:**

1. **Enable autoescape** unless there's a specific reason not to
2. **Validate template sources**: Only load templates from trusted sources
3. **Use sandboxed environment**: Consider using `jinja2.sandbox.SandboxedEnvironment` for untrusted templates

```python
from jinja2 import Environment, StrictUndefined, select_autoescape

self.env = Environment(
    undefined=StrictUndefined,
    autoescape=select_autoescape(default=True),
    trim_blocks=True,
    lstrip_blocks=True,
)
```

**References:**
- CWE-1336: https://cwe.mitre.org/data/definitions/1336.html
- OWASP A03:2021 Injection

---

### SEC-003: Insecure Default Database Credentials

**Location:** `experimental-plugins/agentic-core/src/agentic_core/storage/database.py:62-64`

**Vulnerability:** Use of Hard-coded Credentials (CWE-798)

The database client falls back to a hardcoded connection string with default credentials if the environment variable is not set:

```python
self.connection_url = connection_url or os.environ.get(
    "AGENTIC_DATABASE_URL",
    "postgresql://agentic:agentic@localhost:5432/agentic",  # INSECURE DEFAULT
)
```

**Risk:** Default credentials (`agentic:agentic`) are predictable and could be exploited if the database is exposed on a network or if an attacker gains local access. This violates the principle of secure defaults and could lead to unauthorized database access.

**Remediation:**

1. **Require explicit configuration**: Raise an error if credentials are not provided
2. **Remove default credentials**: Don't provide a fallback with hardcoded credentials
3. **Use environment-specific defaults**: Only provide defaults for development/testing

```python
self.connection_url = connection_url or os.environ.get("AGENTIC_DATABASE_URL")
if not self.connection_url:
    raise ValueError(
        "Database connection URL required. Set AGENTIC_DATABASE_URL environment variable "
        "or pass connection_url parameter."
    )
```

**References:**
- CWE-798: https://cwe.mitre.org/data/definitions/798.html
- OWASP A02:2021 Cryptographic Failures

---

## Medium Risk

### SEC-004: Path Traversal Risk in Worktree Operations

**Location:**
- `plugins/agentic-sdlc/src/agentic_sdlc/git/worktree.py:54-56`
- `experimental-plugins/agentic-core/src/agentic_core/git/worktree.py:339`

**Vulnerability:** Improper Limitation of a Pathname to a Restricted Directory (CWE-22)

The `_sanitize_name()` function replaces some characters but doesn't fully protect against path traversal:

```python
def _sanitize_name(name: str) -> str:
    """Sanitize a name for use in file paths and branch names."""
    return name.replace("/", "-").replace(" ", "-").replace("_", "-").lower()
```

The function doesn't check for:
- `..` sequences that could traverse directories
- Absolute paths
- Other special characters that might cause issues on different filesystems

**Risk:** If workflow or step names contain path traversal sequences like `../../etc/passwd`, they could potentially create worktrees outside the intended `.worktrees` directory, though the risk is mitigated by the directory structure enforcement.

**Remediation:**

Add comprehensive path validation:

```python
def _sanitize_name(name: str) -> str:
    """Sanitize a name for use in file paths and branch names."""
    # Remove path separators and special characters
    sanitized = name.replace("/", "-").replace("\\", "-").replace(" ", "-").replace("_", "-")
    # Remove dots to prevent traversal
    sanitized = sanitized.replace(".", "-")
    # Remove any remaining non-alphanumeric characters except hyphens
    sanitized = "".join(c if c.isalnum() or c == "-" else "-" for c in sanitized)
    # Remove leading/trailing hyphens and collapse multiple hyphens
    sanitized = "-".join(filter(None, sanitized.split("-")))
    return sanitized.lower()
```

**References:**
- CWE-22: https://cwe.mitre.org/data/definitions/22.html
- OWASP A01:2021 Broken Access Control

---

## Low Risk

### SEC-005: SQL Injection Protection Verified

**Location:** `experimental-plugins/agentic-core/src/agentic_core/storage/database.py`

**Status:** NOT VULNERABLE - Good Practice Confirmed

All database operations use parameterized queries with `$1`, `$2` placeholders, which properly prevents SQL injection:

```python
row = await conn.fetchrow(
    "SELECT * FROM workflows WHERE id = $1",
    workflow_id,
)
```

**Note:** This is a positive finding demonstrating proper SQL injection protection via asyncpg parameterized queries.

---

### SEC-006: Dependency Security Review Required

**Location:**
- `experimental-plugins/agentic-core/pyproject.toml`
- `plugins/agentic-sdlc/pyproject.toml`

**Vulnerability:** Use of potentially outdated dependencies

**Current dependencies to review:**
- `jinja2>=3.1.0` (agentic-core)
- `jinja2>=3.1` (agentic-sdlc)
- `pyyaml>=6.0` (agentic-sdlc)
- `asyncpg>=0.29.0` (agentic-core)

**Risk:** Some dependencies may have known vulnerabilities. Regular security audits should be performed.

**Remediation:**

1. Run regular dependency scans:
```bash
uv pip install pip-audit
uv run pip-audit
```

2. Pin specific versions instead of using `>=` for security-critical dependencies
3. Set up automated dependency scanning in CI/CD pipeline

**References:**
- OWASP A06:2021 Vulnerable and Outdated Components

---

## Recommendations

1. **Immediate Actions (High Priority)**:
   - Fix command injection vulnerabilities by removing `shell=True` where possible
   - Review and secure Jinja2 template handling
   - Remove hardcoded database credentials

2. **Short-term Actions**:
   - Enhance path sanitization in worktree operations
   - Implement dependency scanning in CI/CD

3. **Best Practices**:
   - Add security testing to CI/CD pipeline
   - Implement input validation framework
   - Regular security audits of dependencies
   - Consider using static analysis tools (Bandit, Semgrep)

4. **Defense in Depth**:
   - Run with least privileges
   - Use environment variables for all sensitive configuration
   - Implement logging for security-relevant events
   - Consider adding rate limiting for API endpoints (if applicable)
