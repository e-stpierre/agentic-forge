---
name: analyse
description: Analyze codebase for issues
output: json
arguments:
  - name: type
    description: Analysis type (bug, debt, doc, security, style, all)
    required: true
  - name: path
    description: Path to analyze (default: entire codebase)
    required: false
  - name: template
    description: Custom output template path
    required: false
---

# Analyse Command

Analyze the codebase for specific types of issues. Returns a structured report with findings.

## Analysis Types

- **bug**: Potential bugs, logic errors, null pointer risks
- **debt**: Technical debt, code smells, complexity issues
- **doc**: Documentation gaps, outdated comments, missing docstrings
- **security**: Security vulnerabilities, OWASP top 10, secrets exposure
- **style**: Style violations, inconsistent patterns, naming issues
- **all**: Run all analysis types

## Output Format

```json
{
  "success": true,
  "analysis_type": "security",
  "findings": [
    {
      "id": "SEC-001",
      "severity": "critical",
      "category": "injection",
      "title": "SQL Injection vulnerability",
      "description": "User input directly concatenated into SQL query",
      "file": "src/db/queries.ts",
      "line": 42,
      "recommendation": "Use parameterized queries",
      "cwe": "CWE-89"
    }
  ],
  "summary": {
    "critical": 1,
    "major": 3,
    "minor": 8,
    "total": 12
  },
  "document_path": "agentic/analysis/security.md"
}
```

## Process

1. Determine analysis scope (path or full codebase)
2. Run analysis using explorer agent
3. Categorize and prioritize findings
4. Generate report using template
5. Return JSON summary

## Analysis Guidelines

### Bug Analysis

- Null/undefined access patterns
- Off-by-one errors
- Race conditions
- Resource leaks
- Exception handling issues

### Debt Analysis

- Code duplication
- High complexity functions
- Long parameter lists
- Magic numbers/strings
- Outdated patterns

### Documentation Analysis

- Missing function/class documentation
- Outdated README content
- Missing API documentation
- Incorrect/misleading comments

### Security Analysis

- OWASP Top 10 vulnerabilities
- Hardcoded credentials
- Unsafe data handling
- Authentication/authorization issues
- Dependency vulnerabilities

### Style Analysis

- Naming conventions
- Code formatting
- Import organization
- Consistent patterns

---

Analysis Type: {{ type }}
{% if path %}
Scope: {{ path }}
{% endif %}

---

Perform the analysis and return JSON output.
