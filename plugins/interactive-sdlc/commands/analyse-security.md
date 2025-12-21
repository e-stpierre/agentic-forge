# Analyse Security

Scan for security vulnerabilities, unsafe patterns, and dependency issues.

## Arguments

- `[context]`: Specific areas or concerns to focus on

## Behavior

1. **Read Configuration**
   - Read `.claude/settings.json` for `interactive-sdlc.analysisDirectory` (default: `/analysis`)

2. **Scan for Vulnerabilities**
   Check for common security issues:

   **Injection:**
   - SQL injection
   - Command injection
   - XSS (Cross-Site Scripting)
   - Template injection
   - Path traversal

   **Authentication/Authorization:**
   - Hardcoded credentials
   - Weak authentication
   - Missing authorization checks
   - Session management issues
   - Insecure token storage

   **Data Exposure:**
   - Sensitive data in logs
   - Secrets in code/config
   - Insecure data transmission
   - Improper error messages

   **Dependencies:**
   - Known vulnerable packages
   - Outdated dependencies
   - Unused but risky dependencies

   **Configuration:**
   - Debug mode in production
   - Insecure defaults
   - Missing security headers
   - CORS misconfigurations

3. **Categorize Findings**
   Rate by risk level:
   - **Critical**: Actively exploitable, high impact
   - **High**: Exploitable with some conditions
   - **Medium**: Potential risk, limited impact
   - **Low**: Best practice violation, minimal risk

4. **Generate Report**
   - Save to `{analysisDirectory}/security.md`
   - Include remediation steps

## Report Template

```markdown
# Security Analysis

**Date**: YYYY-MM-DD
**Scope**: [Description of analyzed scope]

## Summary

| Risk Level | Issues |
|------------|--------|
| Critical | X |
| High | X |
| Medium | X |
| Low | X |

## Critical Vulnerabilities

### SEC-001: [Title]

**Location:** Code location or dependency

**Vulnerability:** Type and description

**Risk:** Potential impact if exploited

**Remediation:** Specific fix approach

**References:** CWE/OWASP links if applicable

---

## High Risk

[Same format]

## Medium Risk

[Same format]

## Low Risk

[Same format]
```

## Example Usage

```bash
# Full security scan
/interactive-sdlc:analyse-security

# Focus on authentication
/interactive-sdlc:analyse-security Focus on authentication and session management

# Check for injection
/interactive-sdlc:analyse-security Check for SQL and command injection vulnerabilities

# Analyze specific area
/interactive-sdlc:analyse-security src/api/ src/auth/
```

## OWASP Top 10 Coverage

| Category | What to Check |
|----------|---------------|
| A01:2021 Broken Access Control | Missing auth checks, IDOR, path traversal |
| A02:2021 Cryptographic Failures | Weak crypto, hardcoded secrets, insecure storage |
| A03:2021 Injection | SQL, command, XSS, template injection |
| A04:2021 Insecure Design | Logic flaws, missing security requirements |
| A05:2021 Security Misconfiguration | Debug mode, default creds, exposed configs |
| A06:2021 Vulnerable Components | Outdated deps, known CVEs |
| A07:2021 Auth Failures | Weak auth, session issues, credential stuffing |
| A08:2021 Data Integrity Failures | Insecure deserialization, unsigned data |
| A09:2021 Logging Failures | Missing logs, sensitive data in logs |
| A10:2021 SSRF | Server-side request forgery |

## Important Principles

1. **Only report REAL issues**: Security false positives waste time
   - Verify exploitability before reporting critical/high
   - Consider context and controls
   - Check if framework mitigates the issue

2. **Be specific**: Vague security reports are not actionable
   - Exact file and line numbers
   - Specific vulnerability type
   - Clear exploitation scenario
   - Concrete remediation steps

3. **Prioritize correctly**: Not everything is critical
   - Critical = actively exploitable + high impact
   - Consider defense in depth
   - Account for network controls

4. **Complement other tools**: This is not a replacement for
   - Dependency scanners (npm audit, safety)
   - SAST tools (semgrep, bandit)
   - Penetration testing
   - Security audits
