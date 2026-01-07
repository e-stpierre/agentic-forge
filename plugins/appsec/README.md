# AppSec Plugin

Comprehensive application security toolkit for Claude Code that enables expert-level security analysis, vulnerability detection, and risk assessment. Combines automated OWASP Top 10 pattern matching with expert security analysis to identify injection flaws, authentication issues, data exposure, and dependency vulnerabilities.

## Overview

The AppSec plugin provides security analysis tools for identifying vulnerabilities and assessing risk in your codebase. It includes an expert security agent and commands for both comprehensive and focused security reviews.

- `/appsec:security-review` - Comprehensive security assessment of your codebase
- `/appsec:scope-security src/auth/login.js` - Quick security check of a single file
- `/appsec:security-review src/auth/` - Focused review of specific directories
- `/appsec:security-review --dependencies` - Dependency vulnerability audit

## Commands

| Command | Description |
|---------|-------------|
| `/appsec:security-review` | Comprehensive security assessment using the AppSec Specialist agent |
| `/appsec:scope-security` | Focused, rapid security analysis of a single file and direct dependencies |

## Agents

| Agent | Description |
|-------|-------------|
| `appsec:appsec-specialist` | Expert security analyst for vulnerability detection and risk assessment |

## Limitations

- Performs static analysis (SAST) only - cannot test running applications
- Cannot perform dynamic testing (DAST) of APIs or user flows
- Cannot verify runtime configurations not in code
- May produce false positives requiring manual validation

## Complete Examples

### /appsec:security-review

**Arguments:**
- `[scope]` - Specific directories, files, or components to review (default: entire codebase)
- `--dependencies` - Focus on dependency vulnerabilities
- `--quick` - Rapid scan for critical issues only

**Examples:**

```bash
# Full codebase review
/appsec:security-review

# Review specific directory
/appsec:security-review src/auth/

# Dependency audit only
/appsec:security-review --dependencies

# Quick scan for critical issues
/appsec:security-review --quick

# Combined scope and focus
/appsec:security-review src/api/ --quick
```

### /appsec:scope-security

**Arguments:**
- `<file-path>` - Path to the file to analyze (prompts if not provided)

**Examples:**

```bash
# Analyze specific file
/appsec:scope-security src/auth/login.js

# Analyze authentication middleware
/appsec:scope-security src/middleware/auth.ts

# Pre-commit check on payment code
/appsec:scope-security src/api/payment.py

# Interactive mode (prompts for file)
/appsec:scope-security
```

### appsec-specialist Agent

The agent is invoked automatically by the commands above. It analyzes code for:

- **OWASP Top 10**: Injection, XSS, broken auth, sensitive data exposure
- **Dependencies**: CVEs, outdated packages, supply chain risks
- **Configuration**: Security headers, CORS, secrets management
- **Cryptography**: Weak algorithms, key management issues

**Output includes:**
- Severity ratings (Critical/High/Medium/Low) with CVSS scores
- Exact file:line references for each finding
- Remediation guidance with code examples
- Dependency audit results with update recommendations
