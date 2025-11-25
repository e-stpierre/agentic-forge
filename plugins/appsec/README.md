# AppSec Plugin

Comprehensive application security toolkit for Claude Code that enables expert-level security analysis, vulnerability detection, and risk assessment of your codebase.

## Overview

The AppSec plugin provides specialized tools and agents for identifying security vulnerabilities, analyzing risks, and validating dependencies. It combines automated pattern matching with expert-level security analysis to help you build more secure applications.

## Features

### 🔍 Comprehensive Vulnerability Detection

- **OWASP Top 10**: Complete coverage of critical web application security risks
- **Injection Flaws**: SQL injection, command injection, XPath injection, LDAP injection
- **Cross-Site Scripting**: Reflected, stored, and DOM-based XSS
- **Authentication Issues**: Broken authentication, session management flaws
- **Access Control**: Authorization bypasses, IDOR, path traversal
- **Data Exposure**: Hardcoded secrets, insecure storage, encryption issues
- **Security Misconfiguration**: Default credentials, verbose errors
- **Known Vulnerabilities**: Outdated dependencies with CVEs

### 🛡️ Expert Security Analysis

- Threat modeling and attack surface analysis
- Secure code review with security-focused patterns
- Cryptographic implementation validation
- API security assessment (REST, GraphQL, etc.)
- Business logic flaw detection

### 📦 Dependency Security

- Identify outdated packages and libraries
- Check for known CVEs in dependencies
- Analyze transitive dependencies
- Supply chain risk assessment
- License compliance checking

### 📊 Risk Assessment & Reporting

- CVSS-based severity scoring
- Exploitability analysis
- Business impact assessment
- Prioritized remediation guidance
- Compliance mapping (OWASP ASVS, CWE, SANS)

## Components

### Agent: appsec-specialist

An expert security analyst agent with deep knowledge of:

- Application security best practices
- OWASP Top 10 vulnerabilities
- Threat modeling and risk assessment
- Secure coding patterns
- Cryptography and authentication
- Compliance standards (PCI-DSS, SOC 2, GDPR)

**Path**: `plugins/appsec/agents/appsec-specialist.md`

### Command: /security-review

Performs a comprehensive security assessment of your codebase using the AppSec Specialist agent.

**Path**: `plugins/appsec/commands/security-review.md`

### Command: /nuget-vuln

Scans .NET solutions and projects for vulnerable NuGet packages, including both direct and transitive dependencies. Provides detailed vulnerability reports with CVE information, severity ratings, and remediation guidance.

**Path**: `plugins/appsec/commands/nuget-vuln.md`

### Command: /scope-security

Performs a focused, rapid security analysis of a single file and its direct dependencies. Designed for quick security reviews during development when you need fast feedback without a comprehensive codebase scan. Ideal for pre-commit checks, code reviews, and iterative development.

**Path**: `plugins/appsec/commands/scope-security.md`

## Installation

### Marketplace Installation (Recommended)

Install via the Claude Code plugin marketplace:

1. Add the claude-plugins marketplace (if not already added):

```bash
/plugin marketplace add e-stpierre/claude-plugins
```

2. Install the AppSec plugin:

```bash
/plugin install appsec@e-stpierre/claude-plugins
```

Or use the interactive menu:

```bash
/plugin menu
```

**For private repositories**: Ensure you have proper Git authentication configured (SSH keys or GitHub personal access token).

### Manual Installation (Alternative)

If you prefer manual installation or want to customize the plugin:

1. Copy the agent definition to your project:

```bash
mkdir -p .claude/agents
cp plugins/appsec/agents/appsec-specialist.md .claude/agents/
```

2. Copy the command to your project:

```bash
mkdir -p .claude/commands
cp plugins/appsec/commands/security-review.md .claude/commands/
```

## Usage

### Basic Security Review

Perform a comprehensive security assessment of your entire codebase:

```
/security-review
```

This will:

1. Launch the AppSec Specialist agent
2. Analyze your codebase for vulnerabilities
3. Check dependencies for known CVEs
4. Generate a detailed security report
5. Provide prioritized remediation guidance

### Focused Security Review

Review specific directories or components:

```
/security-review src/auth/
```

### Dependency Audit

Focus specifically on dependency vulnerabilities:

```
/security-review --dependencies
```

### Quick Scan

Perform a rapid scan focusing only on critical issues:

```
/security-review --quick
```

### NuGet Vulnerability Scan (.NET Projects)

Scan .NET solutions and projects for vulnerable NuGet packages:

```
/nuget-vuln
```

Scan a specific solution:

```
/nuget-vuln MySolution.sln
```

Scan a specific project:

```
/nuget-vuln src/MyProject/MyProject.csproj
```

Focus on critical and high severity only:

```
/nuget-vuln --critical-only
```

### Focused Scope Security Analysis

Perform a quick, targeted security analysis of a single file and its direct dependencies:

```
/scope-security src/auth/login.js
```

This is ideal for:

- Pre-commit security checks on modified files
- Quick validation during code review
- Targeted analysis of security-critical components
- Rapid feedback during active development

Analyzes in 1-2 minutes focusing on critical and high-severity issues only.

## What Gets Checked

### Code-Level Security

- **Input Validation**: Ensuring all user inputs are properly validated and sanitized
- **Output Encoding**: Checking for proper encoding to prevent XSS
- **SQL Queries**: Identifying parameterization issues and injection risks
- **Authentication**: Reviewing login, session management, and password policies
- **Authorization**: Checking access control implementations
- **Cryptography**: Validating encryption algorithms and key management
- **Error Handling**: Ensuring errors don't leak sensitive information
- **API Security**: Reviewing REST/GraphQL endpoints for security issues

### Dependency Security

- **Outdated Packages**: Identifying dependencies that need updates
- **Known CVEs**: Checking for packages with published vulnerabilities
- **Transitive Dependencies**: Analyzing indirect dependency risks
- **License Issues**: Flagging problematic licenses
- **Supply Chain**: Assessing package source trustworthiness
- **NuGet Vulnerabilities** (.NET): Direct scanning of .NET packages using `dotnet list package --vulnerable`
- **Deprecated Packages**: Identification of packages no longer maintained

### Configuration Security

- **Security Headers**: HSTS, CSP, X-Frame-Options, etc.
- **CORS Settings**: Cross-origin resource sharing configurations
- **TLS/SSL**: Certificate and protocol configurations
- **Secrets Management**: Environment variables and configuration files
- **Logging & Monitoring**: Security event tracking

## Output Format

The security review produces a comprehensive report including:

### Summary

- Total vulnerabilities by severity (Critical, High, Medium, Low)
- Quick statistics and overview
- Executive summary of findings

### Detailed Findings

For each vulnerability:

- **Title**: Clear description of the issue
- **Location**: Exact file path and line number
- **Severity**: CVSS score and rating
- **Description**: What the vulnerability is and why it matters
- **Impact**: Potential consequences if exploited
- **Proof of Concept**: Example of how it could be exploited (if safe)
- **Remediation**: Step-by-step fix with code examples
- **References**: OWASP, CWE, and other standard references

### Dependency Report

- List of vulnerable dependencies
- CVE numbers and descriptions
- Update recommendations
- Breaking change warnings

### Action Plan

- Immediate actions (critical issues)
- Short-term improvements (high priority)
- Long-term strategy (security posture)
- Tool recommendations (linters, scanners, etc.)

## Example Output

````markdown
## Security Assessment Summary

**Codebase**: myapp
**Assessment Date**: 2025-01-15
**Severity Breakdown**: 2 Critical, 5 High, 12 Medium, 8 Low

---

### Critical Findings

#### 1. SQL Injection in User Authentication

**File**: `src/auth/login.js:45`
**Severity**: CVSS 9.8 (Critical)

User input is concatenated directly into SQL query without parameterization,
allowing attackers to bypass authentication or extract database contents.

**Vulnerable Code**:

```javascript
const query =
  "SELECT * FROM users WHERE username = '" + req.body.username + "'";
```
````

**Remediation**:

```javascript
const query = "SELECT * FROM users WHERE username = ?";
db.execute(query, [req.body.username]);
```

**References**: OWASP A03:2021, CWE-89

---

### Dependency Vulnerabilities

#### express@4.16.0 → 4.18.2

**CVE-2022-24999** (CVSS 7.5): Denial of Service via qs dependency

**Update Command**:

```bash
npm update express@^4.18.2
```

---

## Recommendations

**Immediate Actions**:

- [ ] Fix SQL injection in authentication
- [ ] Update Express to patch CVE-2022-24999
- [ ] Rotate exposed API keys

**Short-term**:

- [ ] Add input validation middleware
- [ ] Implement security headers
- [ ] Enable rate limiting

**Long-term**:

- [ ] Integrate ESLint security plugin
- [ ] Set up automated dependency scanning
- [ ] Conduct security training for team

```

## Best Practices

### When to Run Security Reviews

- **Before Releases**: Always review before deploying to production
- **After Major Changes**: When adding new features or dependencies
- **Regular Audits**: Monthly or quarterly security assessments
- **Incident Response**: After any security incident or near-miss
- **Third-Party Code**: When integrating external libraries or code

### Interpreting Results

- **Critical/High**: Address immediately, block releases if needed
- **Medium**: Plan to fix in current sprint or next release
- **Low**: Track as technical debt, address when convenient
- **Informational**: Consider for long-term improvements

### Taking Action

1. **Triage**: Review all findings with your team
2. **Validate**: Confirm vulnerabilities are real (not false positives)
3. **Prioritize**: Focus on exploitable issues with business impact
4. **Remediate**: Fix issues using provided guidance
5. **Verify**: Re-run security review after fixes
6. **Document**: Track decisions and remediation timeline

## Advanced Usage

### Custom Security Policies

You can customize the agent's focus by modifying the agent definition or providing specific instructions:

```

/security-review

Please focus specifically on:

- Payment processing security
- PII data handling
- GDPR compliance

````

### Integration with CI/CD

Add security reviews to your pipeline:

```yaml
# .github/workflows/security.yml
name: Security Review
on: [pull_request]
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run Security Review
        run: claude-code --command "security-review --ci"
````

### Combining with Other Tools

The AppSec plugin works well alongside:

- **SAST Tools**: SonarQube, Semgrep, Bandit
- **Dependency Scanners**: Snyk, Dependabot, npm audit
- **DAST Tools**: OWASP ZAP, Burp Suite
- **Linters**: ESLint security plugins, Bandit, Brakeman

## Limitations

The AppSec plugin:

- ✅ Performs static analysis (SAST) of source code
- ✅ Checks dependencies for known vulnerabilities
- ✅ Reviews security configurations in code
- ❌ Cannot perform dynamic testing (DAST) of running applications
- ❌ Cannot test actual API endpoints or user flows
- ❌ Cannot verify runtime configurations not in code
- ❌ May produce false positives requiring manual validation

## Troubleshooting

### Agent Not Found

Ensure the agent file is in `.claude/agents/appsec-specialist.md`

### Command Not Working

Verify the command file is in `.claude/commands/security-review.md`

### Incomplete Analysis

For large codebases, consider:

- Breaking analysis into focused reviews
- Using `--quick` flag for initial scan
- Upgrading to Opus model for complex analysis

## Contributing

Found a new security pattern to detect? Want to improve the agent?

1. Fork the repository
2. Add your improvements to the agent or command
3. Test thoroughly with various codebases
4. Submit a pull request with examples

## Resources

### Security Standards

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [SANS Top 25](https://www.sans.org/top25-software-errors/)

### Learning Resources

- [OWASP Cheat Sheets](https://cheatsheetseries.owasp.org/)
- [PortSwigger Web Security Academy](https://portswigger.net/web-security)
- [Secure Coding Guidelines](https://www.securecoding.cert.org/)

### Tools

- [OWASP ZAP](https://www.zaproxy.org/) - Dynamic security testing
- [Semgrep](https://semgrep.dev/) - Static analysis
- [Snyk](https://snyk.io/) - Dependency scanning
- [npm audit](https://docs.npmjs.com/cli/v8/commands/npm-audit) - Node.js dependencies
- [dotnet list package](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-list-package) - .NET/NuGet vulnerabilities

## License

This plugin is part of the claude-plugins repository and is licensed under the MIT License.

## Support

For issues, questions, or contributions:

- Open an issue in the [claude-plugins repository](https://github.com/e-stpierre/claude-plugins)
- Join the community discussions
- Check the documentation in `/docs/`

---

**Security Note**: Always review findings carefully. Automated security tools can produce false positives. Use professional judgment and consider context when assessing vulnerabilities.
