---
name: analyse-security
description: Scan for security vulnerabilities, unsafe patterns, and dependency issues
argument-hint: "[context]"
---

# Analyse Security

Scan for security vulnerabilities, unsafe patterns, and dependency issues.

## Parameters

- **`[context]`** (optional): Specific areas or concerns to focus on

## Objective

Scan for security vulnerabilities, unsafe patterns, and dependency issues by checking for injection flaws, authentication issues, data exposure, and configuration problems.

## Core Principles

- Only report REAL issues - security false positives waste time
- Verify exploitability before reporting critical/high severity
- Be specific with exact vulnerability type and exploitation scenario
- Prioritize correctly - not everything is critical
- This complements but doesn't replace SAST tools and security audits

## Instructions

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

## Output Guidance

Present a summary and save the report:

```
Security analysis complete. Report saved to /analysis/security.md

## Summary
| Risk Level | Issues |
|------------|--------|
| Critical | X |
| High | Y |
| Medium | Z |
| Low | W |

[If critical/high found:]
⚠️ Critical and high-risk issues require immediate attention.

Review the report and address issues by priority.
```

## Templates

### Report Structure

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

## Don't

- Don't report false positives - verify exploitability before flagging critical/high
- Don't make vague reports - include exact file, line, and exploitation scenario
- Don't mark everything as critical - consider defense in depth
- Don't skip checking if framework mitigates the issue
- Don't use this as replacement for SAST tools, dependency scanners, or security audits
