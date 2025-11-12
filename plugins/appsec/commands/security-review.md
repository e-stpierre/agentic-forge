# Security Review Command

You are being invoked to perform a comprehensive security review of the current codebase. Your task is to launch the AppSec Specialist agent to conduct a thorough security assessment.

## Objective

Analyze the codebase for security vulnerabilities, risks, and dependency issues at an expert level, providing actionable remediation guidance.

## Execution Steps

### 1. Understand the Scope

First, determine the scope of the security review:
- If the user specified particular directories, files, or components, focus on those
- If no scope was specified, analyze the entire codebase
- Identify the primary language(s) and framework(s) in use

### 2. Launch the AppSec Specialist Agent

Use the Task tool to launch the appsec-specialist agent with a comprehensive prompt:

```
I need you to perform a comprehensive security assessment of this codebase.

**Scope**: [Specify the scope based on user input or default to entire codebase]

**Focus Areas**:
1. OWASP Top 10 vulnerabilities (injection, XSS, broken auth, etc.)
2. Dependency security (outdated packages, known CVEs)
3. Hardcoded secrets and sensitive data exposure
4. Authentication and authorization mechanisms
5. Input validation and output encoding
6. Cryptographic implementations
7. API security
8. Security misconfigurations
9. Business logic flaws

**Deliverables**:
- Detailed findings report with severity ratings
- Specific file and line number references
- Proof of concept or exploitation scenarios (where safe)
- Actionable remediation recommendations with code examples
- Prioritization matrix (Critical/High/Medium/Low)
- Dependency audit results
- Compliance considerations (OWASP ASVS, CWE, etc.)

Please be thorough and systematic in your analysis. Think like an attacker trying to compromise this application.
```

### 3. Present Results

Once the agent completes its analysis:
- Summarize the key findings
- Highlight critical and high-severity issues
- Provide a quick action checklist for immediate remediation
- Offer to deep-dive into any specific finding

## Usage Examples

### Basic Usage
```
/security-review
```
Performs a comprehensive security review of the entire codebase.

### Focused Review
```
/security-review src/auth/
```
Reviews only the authentication module.

### Dependency Audit Focus
```
/security-review --dependencies
```
Focuses specifically on dependency vulnerabilities.

### Quick Scan
```
/security-review --quick
```
Performs a high-level scan focusing on critical issues only.

## Agent Configuration

**Agent Type**: appsec-specialist
**Model**: Use Opus for complex codebases, Sonnet for standard reviews
**Autonomy Level**: High - agent should work independently and report back
**Tools Available**: All (Read, Grep, Glob, Bash, WebFetch, etc.)

## Implementation

Invoke the AppSec Specialist agent using the Task tool:

```
Task(
  subagent_type="appsec-specialist",
  description="Comprehensive security review",
  prompt="[Detailed security assessment prompt as outlined above]",
  model="sonnet" // or "opus" for complex cases
)
```

## Post-Review Actions

After the agent completes its work:

1. **Summarize Findings**
   - Total vulnerabilities by severity
   - Most critical issues requiring immediate attention
   - Key dependency concerns

2. **Provide Next Steps**
   - Suggest creating issues for each critical/high finding
   - Recommend security tools to integrate (ESLint security, Snyk, etc.)
   - Offer to help implement specific remediations

3. **Educational Component**
   - Highlight common patterns found
   - Suggest security training resources
   - Recommend secure coding guidelines

## Example Invocation

When a user types `/security-review`, this is what should happen:

```markdown
I'll perform a comprehensive security assessment of your codebase using the AppSec Specialist agent.

**Initiating Security Review...**

[Launch Task with appsec-specialist agent]

---

## Security Assessment Complete

### Summary
- **Critical Issues**: 2
- **High Severity**: 5
- **Medium Severity**: 12
- **Low Severity**: 8

### Critical Findings Requiring Immediate Attention:

1. **SQL Injection in Authentication** (src/auth/login.js:45)
   - CVSS Score: 9.8
   - Immediate remediation required

2. **Exposed API Keys in Config** (config/production.js:12)
   - CVSS Score: 9.1
   - Rotate keys immediately

### Dependency Alerts:
- 3 packages with known CVEs
- 12 outdated dependencies
- 2 packages with critical security updates available

### Quick Action Checklist:
- [ ] Fix SQL injection in authentication
- [ ] Rotate exposed API keys
- [ ] Update express to latest version (CVE-2022-24999)
- [ ] Implement parameterized queries across all DB operations
- [ ] Add input validation middleware

Would you like me to:
- Deep-dive into any specific finding?
- Help implement remediations?
- Set up automated security scanning?
- Create GitHub issues for tracking these items?
```

## Notes

- **Be Thorough**: Security reviews should be comprehensive, not superficial
- **Be Practical**: Provide actionable advice, not just theoretical risks
- **Be Clear**: Use plain language to explain security concepts
- **Be Prioritized**: Help teams focus on what matters most
- **Be Educational**: Help developers learn to write more secure code

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [SANS Top 25](https://www.sans.org/top25-software-errors/)
