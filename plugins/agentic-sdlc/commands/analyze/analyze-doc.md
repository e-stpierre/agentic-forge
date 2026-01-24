---
name: analyze-doc
description: Analyze documentation quality, accuracy, and completeness
argument-hint: [paths...]
---

# analyze Doc

## Overview

Analyze documentation quality, accuracy, and completeness. Compares documentation against actual code implementation to identify outdated, incorrect, or missing information. Returns structured JSON for workflow integration and generates a markdown report.

## Arguments

- **`[paths...]`** (optional): Space-separated list of files or directories to analyze. When provided, only these paths are analyzed. Otherwise, all documentation in the codebase is analyzed.

## Core Principles

- Only report REAL issues - good documentation is a success
- Verify claims against code before marking as incorrect
- Provide actionable fixes with correct information
- Consider documentation might be ahead of code
- Different documentation types have different standards
- Only report UNFIXED issues - if the issue has been resolved, do not include it
- Apply appropriate standards based on documentation type (user guides vs API references vs internal docs)
- Consider that documentation may be ahead of code (planned features)
- If no issues found, return success with zero counts

## Instructions

1. **Determine Scope**
   - If `[paths]` are provided, focus only on those files/directories
   - Otherwise, find all documentation files (README, docs/, \*.md)
   - Identify inline documentation (JSDoc, docstrings, comments)

2. **Analyze for Issues**
   Check documentation for:
   - **Outdated information**: Does not match current code
   - **Incorrect content**: Factually wrong statements
   - **Missing documentation**: Undocumented APIs, features
   - **Broken references**: Dead links, invalid paths
   - **Inconsistencies**: Contradictory information
   - **Incomplete examples**: Non-working code samples

3. **Verify Against Code**
   - Compare API documentation with actual implementations
   - Check if documented features exist
   - Verify code examples compile/run
   - Ensure types match documented signatures

4. **Categorize Findings**
   - **Critical**: Wrong or misleading - will confuse/mislead users
   - **Major**: Outdated or incomplete - significant gaps
   - **Minor**: Improvements - typos, clarity, organization

5. **Generate Report**
   - Save to `agentic/analysis/doc.md`
   - Include date in report header

6. **Return JSON Output**

## Output Guidance

Return a JSON object AND save a detailed markdown report.

### JSON Output

```json
{
  "success": true,
  "analysis_type": "doc",
  "findings_count": {
    "critical": 0,
    "major": 0,
    "minor": 0,
    "total": 0
  },
  "findings": [
    {
      "id": "DOC-001",
      "severity": "critical",
      "title": "Brief title",
      "files": ["docs/api.md", "README.md"],
      "issue": "What is wrong or misleading",
      "code_reference": "src/api/routes.ts:120",
      "fix": "How to correct the documentation"
    }
  ],
  "document_path": "agentic/analysis/doc.md"
}
```

## Templates

### Markdown Report Structure

Save to `agentic/analysis/doc.md`:

```markdown
# Documentation Issues

**Date**: YYYY-MM-DD
**Scope**: All documentation | Specified paths

## Summary

- Critical (Wrong/Misleading): X issues
- Major (Outdated/Incomplete): Y issues
- Minor (Improvements): Z issues

## Critical Issues (Wrong/Misleading)

### DOC-001: Brief title

**Files:** affected documentation files
**Issue:** What is wrong or misleading
**Code Reference:** related code location (if applicable)
**Fix:** How to correct the documentation

---

## Major Issues (Outdated/Incomplete)

[Same format as Critical]

## Minor Issues (Improvements)

[Same format as Critical]
```

### Issue Categories

**Critical (Wrong/Misleading):**
- Documents non-existent features
- Wrong API signatures
- Incorrect behavior descriptions
- Security-related misinformation

**Major (Outdated/Incomplete):**
- Features added but not documented
- Deprecated features still documented
- Missing important sections
- Outdated examples

**Minor (Improvements):**
- Typos and grammar issues
- Unclear explanations
- Missing examples
- Better organization suggestions
