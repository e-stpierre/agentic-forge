---
name: analyse-security
description: Scan for security vulnerabilities, unsafe patterns, and dependency issues
argument-hint: [paths...]
---

# Analyse Security

Scan for security vulnerabilities, unsafe patterns, and dependency issues. Returns structured JSON for workflow integration and generates a markdown report.

## Arguments

- **`[paths]`** (optional): Space-separated list of files or directories to analyze. When provided, only these paths are analyzed. Otherwise, the entire codebase is analyzed.

## Objective

Scan for security vulnerabilities, unsafe patterns, and dependency issues by checking for injection flaws, authentication issues, data exposure, and configuration problems.

## Core Principles

- Only report REAL issues - security false positives waste time
- Verify exploitability before reporting critical/high severity
- Be specific with exact vulnerability type and exploitation scenario
- Prioritize correctly - not everything is critical
- This complements but doesn't replace SAST tools and security audits
- Only report UNFIXED issues - if the issue has been resolved, do not include it

## Instructions

1. **Determine Scope**
   - If `[paths]` are provided, focus only on those files/directories
   - Otherwise, analyze the entire codebase
   - Always check dependency files (package.json, pyproject.toml, etc.)

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
   - Save to `agentic/analysis/security.md`
   - Include remediation steps

5. **Return JSON Output**
   - Return structured JSON with findings summary

## Output Guidance

Return a JSON object AND save a detailed markdown report.

### JSON Output (Required)

```json
{
  "success": true,
  "analysis_type": "security",
  "findings_count": {
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0,
    "total": 0
  },
  "findings": [
    {
      "id": "SEC-001",
      "severity": "critical",
      "title": "Brief title",
      "file": "path/to/file.ts",
      "line": 42,
      "vulnerability": "SQL Injection (CWE-89)",
      "risk": "Data breach, unauthorized access",
      "remediation": "Use parameterized queries"
    }
  ],
  "document_path": "agentic/analysis/security.md"
}
```

### Markdown Report Structure

Save to `agentic/analysis/security.md`:

```markdown
# Security Analysis

**Date**: YYYY-MM-DD
**Scope**: Entire codebase | Specified paths

## Summary

| Risk Level | Issues |
| ---------- | ------ |
| Critical   | X      |
| High       | Y      |
| Medium     | Z      |
| Low        | W      |

## Critical Vulnerabilities

### SEC-001: Brief title

**Location:** file:line
**Vulnerability:** Type and description (include CWE if applicable)
**Risk:** Potential impact if exploited
**Remediation:** Specific fix approach
**References:** CWE/OWASP links

---

## High Risk

[Same format as Critical]

## Medium Risk

[Same format as Critical]

## Low Risk

[Same format as Critical]
```

## OWASP Top 10 Coverage

| Category                           | What to Check                                    |
| ---------------------------------- | ------------------------------------------------ |
| A01:2021 Broken Access Control     | Missing auth checks, IDOR, path traversal        |
| A02:2021 Cryptographic Failures    | Weak crypto, hardcoded secrets, insecure storage |
| A03:2021 Injection                 | SQL, command, XSS, template injection            |
| A04:2021 Insecure Design           | Logic flaws, missing security requirements       |
| A05:2021 Security Misconfiguration | Debug mode, default creds, exposed configs       |
| A06:2021 Vulnerable Components     | Outdated deps, known CVEs                        |
| A07:2021 Auth Failures             | Weak auth, session issues, credential stuffing   |
| A08:2021 Data Integrity Failures   | Insecure deserialization, unsigned data          |
| A09:2021 Logging Failures          | Missing logs, sensitive data in logs             |
| A10:2021 SSRF                      | Server-side request forgery                      |

## Important Notes

- Verify exploitability before flagging critical/high severity issues
- Include exact file location, line number, and exploitation scenario for each finding
- Prioritize correctly - consider defense in depth when assessing severity
- Check if framework features mitigate the issue before reporting
- This analysis complements but does not replace SAST tools, dependency scanners, or security audits
- Do NOT include issues that have already been fixed or resolved
- If no issues found, return success with zero counts
