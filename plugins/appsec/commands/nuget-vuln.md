# NuGet Vulnerability Scan Command

You are being invoked to perform a comprehensive NuGet package vulnerability assessment for .NET solutions. Your task is to identify both direct and transitive dependency vulnerabilities and provide actionable remediation guidance.

## Objective

Scan .NET projects and solutions for vulnerable NuGet packages, including:

- Direct dependencies with known CVEs
- Transitive (indirect) dependencies with security issues
- Outdated packages with available security patches
- Severity assessment and remediation recommendations

## Execution Steps

### 1. Discover .NET Projects

First, identify all .NET projects and solutions in the codebase:

- Search for `.sln` (solution) files
- Search for `.csproj`, `.fsproj`, `.vbproj` (project) files
- If the user specified a particular solution or project, focus on that
- If no scope specified, analyze all discovered .NET projects

### 2. Verify .NET CLI Availability

Check that the `dotnet` CLI is available:

```bash
dotnet --version
```

If `dotnet` is not available:

- Inform the user that .NET SDK is required
- Provide installation instructions for their platform
- Offer to continue with manual NuGet package analysis if possible

### 3. Scan for Vulnerable Packages

For each discovered solution or project, run the vulnerability scan:

#### Scan All Vulnerabilities (Direct and Transitive)

```bash
dotnet list [solution-or-project] package --vulnerable --include-transitive
```

This command:

- Identifies packages with known CVEs
- Shows both direct and transitive dependencies
- Displays severity levels (Critical, High, Moderate, Low)
- Provides advisory URLs for more information

#### Additional Useful Scans

Also run these complementary commands for comprehensive analysis:

```bash
# Check for deprecated packages
dotnet list [solution-or-project] package --deprecated

# Check for outdated packages
dotnet list [solution-or-project] package --outdated
```

### 4. Analyze Results

Parse and analyze the output to identify:

**Vulnerability Severity Breakdown**:

- Critical vulnerabilities requiring immediate action
- High severity issues needing urgent remediation
- Moderate and Low severity issues for planned updates

**Dependency Type**:

- Direct dependencies (explicitly referenced in project files)
- Transitive dependencies (pulled in by other packages)

**Impact Assessment**:

- Number of projects affected by each vulnerability
- Common vulnerability patterns across the solution
- Supply chain risk factors

### 5. Generate Remediation Plan

For each vulnerability found:

1. **Identify the Issue**

   - Package name and vulnerable version
   - CVE identifier(s)
   - Severity rating
   - Advisory URL for detailed information

2. **Determine Root Cause**

   - For direct dependencies: which project references it
   - For transitive dependencies: the dependency chain leading to it

3. **Provide Fix Recommendations**

   - Specific version to upgrade to
   - Command to update the package
   - Breaking change warnings if applicable
   - Alternative packages if update isn't feasible

4. **Assess Remediation Complexity**
   - Simple update (no breaking changes)
   - Major version update (may require code changes)
   - Transitive dependency (requires updating parent package)
   - No fix available (mitigation strategies needed)

### 6. Present Findings

Structure the output as follows:

````markdown
## NuGet Vulnerability Assessment

**Solution/Project**: [name]
**Scan Date**: [date]
**Total Vulnerabilities**: [count]

---

### Executive Summary

- **Critical**: [count] vulnerabilities
- **High**: [count] vulnerabilities
- **Moderate**: [count] vulnerabilities
- **Low**: [count] vulnerabilities

### Critical & High Severity Findings

#### [Package Name] [Vulnerable Version]

**Severity**: Critical/High
**CVE**: [CVE-ID]
**Type**: Direct/Transitive dependency
**Affected Projects**: [list]

**Description**:
[Brief description of the vulnerability]

**Remediation**:

```bash
# For direct dependencies
dotnet add package [PackageName] --version [SafeVersion]

# For transitive dependencies (update parent package)
dotnet add package [ParentPackage] --version [SafeVersion]
```
````

**Advisory**: [URL]

---

### Moderate & Low Severity Findings

[Similar structure for lower severity issues]

---

### Deprecated Packages

[List of deprecated packages if any were found]

---

### Outdated Packages

[List of outdated packages that should be updated for best practices]

---

## Remediation Priority Matrix

**Immediate Action Required** (Critical):

- [ ] [Package] in [Project]: Update to version [X]
- [ ] [Package] in [Project]: Update to version [X]

**Urgent** (High - within 1 week):

- [ ] [Package] in [Project]: Update to version [X]

**Planned** (Moderate - within 1 month):

- [ ] [Package] in [Project]: Update to version [X]

**Track** (Low - address when convenient):

- [ ] [Package] in [Project]: Update to version [X]

---

## Update Strategy

### Recommended Approach:

1. **Test Environment Setup**

   - Create a feature branch for package updates
   - Ensure comprehensive test coverage

2. **Critical Updates First**

   - Update critical vulnerabilities one at a time
   - Run full test suite after each update
   - Verify application functionality

3. **Batch Lower Severity Updates**

   - Group moderate/low severity updates
   - Test thoroughly before merging

4. **Continuous Monitoring**
   - Integrate `dotnet list package --vulnerable` into CI/CD
   - Set up automated dependency update PRs (Dependabot/Renovate)
   - Schedule regular vulnerability scans

### Bulk Update Commands

```bash
# Update all packages in a project (use with caution)
dotnet outdated --upgrade

# Update specific package across solution
dotnet add package [PackageName] --version [Version]
```

---

## Additional Recommendations

- Enable NuGet package vulnerability scanning in your CI/CD pipeline
- Configure Visual Studio or Rider to show vulnerability warnings
- Consider using tools like:
  - **Dependabot** for automated PRs
  - **Snyk** for advanced vulnerability scanning
  - **OWASP Dependency-Check** for comprehensive analysis
- Establish a package update policy (e.g., monthly updates)
- Subscribe to security advisories for critical packages

---

## References

- [NuGet Package Vulnerabilities Documentation](https://learn.microsoft.com/en-us/nuget/concepts/security-best-practices)
- [.NET Security Advisories](https://github.com/dotnet/announcements/labels/Security)
- [National Vulnerability Database](https://nvd.nist.gov/)

```

## Usage Examples

### Basic Usage - Scan Current Directory
```

/nuget-vuln

```
Scans all .NET solutions and projects in the current directory.

### Scan Specific Solution
```

/nuget-vuln MySolution.sln

```
Scans only the specified solution file.

### Scan Specific Project
```

/nuget-vuln src/MyProject/MyProject.csproj

```
Scans only the specified project file.

### Quick Scan (Critical/High Only)
```

/nuget-vuln --critical-only

````
Focus only on critical and high severity vulnerabilities.

## Error Handling

Handle common scenarios gracefully:

1. **.NET SDK Not Installed**
   - Detect the error from `dotnet --version`
   - Provide platform-specific installation instructions
   - Offer alternative manual analysis approach

2. **No .NET Projects Found**
   - Clearly inform the user
   - Suggest checking if they're in the right directory
   - Offer to search subdirectories

3. **Network Issues**
   - NuGet vulnerability data requires internet connection
   - Suggest checking connectivity
   - Explain that local scans may be limited

4. **Restore Required**
   - If packages aren't restored, vulnerability scan may fail
   - Suggest running `dotnet restore` first
   - Offer to run restore automatically

## Implementation Notes

### Command Execution Pattern

```bash
# Discover solutions
find . -name "*.sln" -type f

# Discover projects
find . -name "*.*proj" -type f

# For each solution/project
dotnet list [path] package --vulnerable --include-transitive
dotnet list [path] package --deprecated
dotnet list [path] package --outdated

# Parse output and generate report
````

### Output Parsing

The `dotnet list package --vulnerable` output format:

```
Project 'MyProject' has the following vulnerable packages
   [net6.0]:
   Top-level Package      Requested   Resolved   Severity   Advisory URL
   > PackageName          1.0.0       1.0.0      Critical   https://...

   Transitive Package     Resolved    Severity   Advisory URL
   > TransitivePkg        2.0.0       High       https://...
```

Parse this to extract:

- Package names
- Versions (requested vs resolved)
- Severity levels
- Advisory URLs
- Dependency type (top-level vs transitive)

### Best Practices

1. **Always Include Transitive Dependencies**

   - Use `--include-transitive` flag
   - Many vulnerabilities hide in indirect dependencies
   - Full visibility is critical for security

2. **Cross-Reference Multiple Sources**

   - Combine dotnet CLI results with other tools
   - Check NuGet.org for additional security info
   - Verify CVE details in National Vulnerability Database

3. **Provide Context**

   - Explain what each vulnerability means
   - Assess actual risk based on usage
   - Not all vulnerabilities are exploitable in every context

4. **Make It Actionable**

   - Provide exact commands to fix issues
   - Prioritize remediation efforts
   - Offer migration guides for breaking changes

5. **Automate Follow-Up**
   - Suggest CI/CD integration
   - Recommend automated dependency updates
   - Encourage regular scanning schedule

## Post-Scan Actions

After completing the vulnerability scan:

1. **Offer Next Steps**

   - Would you like me to update critical packages now?
   - Should I create GitHub issues for tracking remediation?
   - Want me to set up automated vulnerability scanning in CI/CD?

2. **Provide Learning Resources**

   - Link to .NET security best practices
   - Share dependency management guidelines
   - Recommend security training materials

3. **Long-Term Security Posture**
   - Suggest establishing a vulnerability management process
   - Recommend security champions within the team
   - Propose regular security review schedule

## Integration with CI/CD

Example GitHub Actions workflow:

```yaml
name: NuGet Vulnerability Scan

on:
  push:
    branches: [main, develop]
  pull_request:
  schedule:
    - cron: "0 0 * * 1" # Weekly on Mondays

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup .NET
        uses: actions/setup-dotnet@v3
        with:
          dotnet-version: "8.0.x"

      - name: Restore dependencies
        run: dotnet restore

      - name: Scan for vulnerabilities
        run: |
          dotnet list package --vulnerable --include-transitive 2>&1 | tee vulnerability-report.txt

      - name: Check for critical vulnerabilities
        run: |
          if grep -q "Critical" vulnerability-report.txt; then
            echo "Critical vulnerabilities found!"
            exit 1
          fi

      - name: Upload report
        uses: actions/upload-artifact@v3
        with:
          name: vulnerability-report
          path: vulnerability-report.txt
```

## Notes

- **Be Thorough**: Check all projects in a multi-project solution
- **Be Practical**: Prioritize based on severity and exploitability
- **Be Clear**: Explain vulnerabilities in business terms when possible
- **Be Helpful**: Provide exact remediation steps, not just warnings
- **Be Proactive**: Suggest preventive measures for the future

## References

- [NuGet Security Best Practices](https://learn.microsoft.com/en-us/nuget/concepts/security-best-practices)
- [dotnet list package Command](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-list-package)
- [.NET Dependency Management](https://learn.microsoft.com/en-us/dotnet/core/tools/dependencies)
- [CVE Database](https://cve.mitre.org/)
- [NVD - National Vulnerability Database](https://nvd.nist.gov/)
