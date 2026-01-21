---
name: analyse-security
description: Scan for security vulnerabilities, unsafe patterns, and dependency issues
argument-hint: "[context]"
arguments:
  - name: context
    description: Specific areas or concerns to focus on
    required: false
---

# Analyse Security

Scan for security vulnerabilities, unsafe patterns, and dependency issues.

## Arguments

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
   - Read `.claude/settings.json` for `interactive-sdlc.analysisDirectory` (default: `analysis`)

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
Security analysis complete. Report saved to analysis/security.md

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

**Date**: {{date}}

<!--
Instructions:
- Replace {{date}} with the analysis date in YYYY-MM-DD format
-->

**Scope**: {{scope}}

<!--
Instructions:
- Replace {{scope}} with description of what was analyzed
- Example: "Entire codebase" or "Authentication and API modules"
-->

## Summary

| Risk Level | Issues             |
| ---------- | ------------------ |
| Critical   | {{critical_count}} |
| High       | {{high_count}}     |
| Medium     | {{medium_count}}   |
| Low        | {{low_count}}      |

<!--
Instructions:
- Replace {{critical_count}}, {{high_count}}, {{medium_count}}, {{low_count}} with actual counts
- If count is 0, you can say "0" or omit the category
-->

## Critical Vulnerabilities

### SEC-{{vuln_number}}: {{vuln_title}}

<!--
Instructions:
- Replace {{vuln_number}} with sequential number (001, 002, etc.)
- Replace {{vuln_title}} with concise vulnerability title
- Use this format for each critical vulnerability found
-->

**Location:** {{location}}

<!--
Instructions:
- Replace {{location}} with code location or dependency
- Format: file:line (e.g., "src/auth/login.ts:78") or "dependency: package@version"
-->

**Vulnerability:** {{vulnerability_description}}

<!--
Instructions:
- Replace {{vulnerability_description}} with vulnerability type and description
- Include CWE number if applicable (e.g., "SQL Injection (CWE-89)")
- Explain what makes this exploitable
-->

**Risk:** {{risk_impact}}

<!--
Instructions:
- Replace {{risk_impact}} with potential impact if exploited
- Focus on concrete consequences (data breach, unauthorized access, etc.)
-->

**Remediation:** {{remediation}}

<!--
Instructions:
- Replace {{remediation}} with specific fix approach
- Be actionable and include code examples if helpful
-->

**References:** {{references}}

<!--
Instructions:
- Replace {{references}} with CWE/OWASP links if applicable
- Example: "CWE-89: https://cwe.mitre.org/data/definitions/89.html"
- Use "N/A" if no specific references apply
-->

---

## High Risk

<!--
Instructions:
- Use same format as Critical Vulnerabilities section
- Include all high-risk security issues
-->

## Medium Risk

<!--
Instructions:
- Use same format as Critical Vulnerabilities section
- Include all medium-risk security issues
-->

## Low Risk

<!--
Instructions:
- Use same format as Critical Vulnerabilities section
- Include all low-risk security issues
-->
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
