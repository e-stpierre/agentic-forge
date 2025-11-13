# Scope Security Analysis Command

You are being invoked to perform a focused, rapid security analysis of a single file and its direct dependencies. This command is designed for quick security reviews during development when you need fast feedback without a comprehensive codebase scan.

## Objective

Analyze a specific file and its immediate dependencies for security vulnerabilities, providing actionable results quickly. This is ideal for:
- Pre-commit security checks on modified files
- Quick validation during code review
- Targeted analysis of security-critical components
- Rapid feedback during active development

## Execution Steps

### 1. Determine Target File

Identify which file to analyze:
- If the user specified a file path, use that
- If no file specified, ask the user which file to analyze
- Validate that the file exists

### 2. Identify Direct Dependencies

Quickly identify the file's immediate dependencies:

**For JavaScript/TypeScript**:
- Look for `import` or `require` statements
- Focus on local file imports (not node_modules)
- Identify any direct module dependencies

**For Python**:
- Look for `import` or `from ... import` statements
- Focus on local module imports
- Identify any direct dependencies from requirements

**For C#/.NET**:
- Look for `using` statements
- Identify direct class dependencies
- Check for direct NuGet package usage

**For other languages**:
- Identify include/import statements
- Focus on local dependencies
- Note any external library usage

Limit the scope to:
- The target file itself
- Up to 5 most critical direct dependencies (based on security relevance)
- This ensures the analysis completes quickly

### 3. Launch Focused Security Analysis

Use the Task tool to launch the appsec-specialist agent with a narrow scope:

```
I need you to perform a focused security analysis on a specific file and its direct dependencies.

**Target File**: [file path]

**Direct Dependencies** (limit to top 5 security-relevant):
1. [dependency 1 path]
2. [dependency 2 path]
3. [dependency 3 path]
4. [dependency 4 path]
5. [dependency 5 path]

**Focus Areas** (prioritize for speed):
1. **Input Validation**: Check if the target file handles user input
   - SQL injection risks
   - Command injection vulnerabilities
   - XSS vulnerabilities
2. **Authentication & Authorization**: If applicable
   - Broken authentication patterns
   - Missing authorization checks
   - Session management issues
3. **Data Exposure**: Critical security issues only
   - Hardcoded secrets or credentials
   - Sensitive data logging
   - Insecure data storage
4. **Dependency Risks**: Quick check only
   - Known vulnerable patterns in dependencies
   - Insecure function usage
5. **Cryptography**: If relevant
   - Weak algorithms
   - Hardcoded keys
   - Insecure random number generation

**Analysis Constraints**:
- **Speed Priority**: Focus on high-confidence, critical findings
- **Depth**: Scan target file thoroughly, dependencies at high level only
- **Time Limit**: Aim to complete analysis in under 2 minutes
- **False Positives**: Prefer high-confidence findings over exhaustive checks

**Deliverables**:
- List of critical and high-severity findings only
- Specific line numbers and code references
- Quick remediation suggestions (1-2 sentences each)
- Skip low-severity issues for speed
- No dependency version audits (unless obvious vulnerability)

**Output Format**:
Keep the report concise and actionable:
- Summary: Total findings and severity breakdown
- Critical/High findings with file:line references
- Quick fix recommendations
- Skip lengthy explanations unless critical

Think efficiency: What are the most likely security issues in this specific file?
```

### 4. Present Results

Once the agent completes its analysis:
- Provide a concise summary of findings
- Highlight any critical or high-severity issues found
- Give quick action items
- Mention if no issues were found (don't over-report)

## Usage Examples

### Basic Usage - Analyze Current File
```
/scope-security src/auth/login.js
```
Performs a focused security analysis of the login.js file and its direct dependencies.

### Interactive Mode
```
/scope-security
```
Prompts you to specify which file to analyze.

### Analyze Authentication Logic
```
/scope-security src/middleware/auth.ts
```
Quickly checks authentication middleware for common security issues.

### Pre-Commit Check
```
/scope-security src/api/payment.py
```
Fast security validation before committing payment processing code.

## Agent Configuration

**Agent Type**: appsec-specialist
**Model**: Haiku or Sonnet (prioritize speed)
**Autonomy Level**: High - agent should work independently
**Tools Available**: Read, Grep, Glob (minimal Bash usage for speed)
**Time Expectation**: 1-2 minutes for analysis

## Implementation

Invoke the AppSec Specialist agent using the Task tool:

```
Task(
  subagent_type="appsec-specialist",
  description="Focused security analysis of single file",
  prompt="[Focused security assessment prompt as outlined above]",
  model="haiku"  // Fast model for quick results
)
```

## Post-Analysis Actions

After the agent completes its work:

1. **Summarize Findings**
   - Total critical/high severity issues found
   - Most important security concern
   - Quick win fixes

2. **Provide Next Steps**
   - If issues found: Specific remediation guidance
   - If clean: Acknowledge good security practices
   - Suggest running full `/security-review` periodically

3. **Quick Action Items**
   - Provide a simple checklist for immediate fixes
   - Prioritize by severity and ease of fix

## Example Invocation

When a user types `/scope-security src/auth/login.js`, this is what should happen:

```markdown
I'll perform a focused security analysis of `src/auth/login.js` and its direct dependencies.

**Analyzing file and dependencies...**

[Launch Task with appsec-specialist agent]

---

## Focused Security Analysis Complete

**Target**: src/auth/login.js
**Dependencies Analyzed**: 3 files
**Analysis Time**: ~90 seconds

### Summary
- **Critical Issues**: 1
- **High Severity**: 2
- **Total Findings**: 3

### Critical Findings:

1. **SQL Injection in Authentication** (src/auth/login.js:45)
   - **Severity**: Critical (CVSS 9.8)
   - **Issue**: User input concatenated into SQL query
   - **Fix**: Use parameterized queries: `db.execute(query, [username])`

### High Severity Findings:

2. **Hardcoded Secret Key** (src/auth/login.js:12)
   - **Severity**: High (CVSS 7.5)
   - **Issue**: JWT secret hardcoded in source
   - **Fix**: Move to environment variable: `process.env.JWT_SECRET`

3. **Missing Rate Limiting** (src/auth/login.js:30)
   - **Severity**: High (CVSS 7.0)
   - **Issue**: No brute-force protection
   - **Fix**: Implement rate limiting middleware

### Quick Action Checklist:
- [ ] Fix SQL injection (URGENT - 15 min)
- [ ] Move secret to env var (URGENT - 5 min)
- [ ] Add rate limiting (HIGH - 30 min)

**Recommendation**: Address critical issue immediately before committing. Consider running `/security-review` for comprehensive analysis of entire auth module.
```

## Benefits Over Full Security Review

- ⚡ **Speed**: 1-2 minutes vs 10+ minutes for full review
- 🎯 **Focused**: Only the file you're working on
- 🔄 **Iterative**: Use during development, not just before release
- ✅ **Actionable**: Small, manageable list of fixes
- 🚀 **Developer-Friendly**: Fits into normal workflow

## When to Use Scope Security vs Full Security Review

**Use `/scope-security` when**:
- Working on a specific file and want quick feedback
- Pre-commit security validation
- Reviewing a PR for a single component
- Quick check during active development
- Time-sensitive security verification

**Use `/security-review` when**:
- Preparing for production release
- Comprehensive security audit needed
- Onboarding a new codebase
- After major architectural changes
- Compliance or audit requirements

## Notes

- **Be Fast**: Prioritize speed without sacrificing critical findings
- **Be Focused**: Don't scope creep beyond target file and direct deps
- **Be Practical**: Only report high-confidence, actionable issues
- **Be Clear**: Use exact file:line references for all findings
- **Be Helpful**: Provide quick fixes, not lengthy explanations

## Limitations

- Only analyzes specified file and direct dependencies
- Does not check transitive dependencies thoroughly
- Skips low-severity issues for speed
- May miss complex, multi-file vulnerabilities
- Not a replacement for comprehensive security reviews

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- For comprehensive analysis, use `/security-review`
