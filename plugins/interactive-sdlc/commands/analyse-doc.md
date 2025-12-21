---
name: analyse-doc
description: Analyze documentation quality, accuracy, and completeness
argument-hint: "[context]"
---

# Analyse Doc

Analyze documentation quality, accuracy, and completeness.

## Parameters

- **`[context]`** (optional): Specific documentation files or areas to focus on

## Objective

Analyze documentation quality, accuracy, and completeness by comparing against actual code implementation and identifying outdated, incorrect, or missing information.

## Core Principles

- Only report REAL issues - good documentation is a success
- Verify claims against code before marking as incorrect
- Provide actionable fixes with correct information
- Consider documentation might be ahead of code
- Different documentation types have different standards

## Instructions

1. **Read Configuration**
   - Read `.claude/settings.json` for `interactive-sdlc.analysisDirectory` (default: `/analysis`)

2. **Identify Documentation**
   - Find all documentation files (README, docs/, *.md)
   - Identify inline documentation (JSDoc, docstrings, comments)
   - Check for documentation templates or standards

3. **Analyze for Issues**
   Check documentation for:
   - **Outdated information**: Does not match current code
   - **Incorrect content**: Factually wrong statements
   - **Missing documentation**: Undocumented APIs, features
   - **Broken references**: Dead links, invalid paths
   - **Inconsistencies**: Contradictory information
   - **Incomplete examples**: Non-working code samples

4. **Verify Against Code**
   - Compare API documentation with actual implementations
   - Check if documented features exist
   - Verify code examples compile/run
   - Ensure types match documented signatures

5. **Generate Report**
   - Save to `{analysisDirectory}/doc.md`
   - Include date in report header

## Output Guidance

Present a summary and save the report:

```
Documentation analysis complete. Report saved to /analysis/doc.md

## Summary
- Critical (Wrong/Misleading): X issues
- Major (Outdated/Incomplete): Y issues
- Minor (Improvements): Z issues

[If no issues found:]
Documentation is accurate and up-to-date.

[If issues found:]
Review the report and prioritize fixes - critical issues first.
```

## Templates

### Report Structure

```markdown
# Documentation Issues

**Date**: YYYY-MM-DD
**Scope**: [Description of analyzed scope]

## Summary

- Critical (Wrong/Misleading): X issues
- Major (Outdated/Incomplete): X issues
- Minor (Improvements): X issues

## Critical Issues (Completely Wrong/Misleading)

### DOC-001: [Title]

**Files:** List of affected documentation files

**Issue:** What is wrong or misleading

**Code Reference:** Related code location if applicable

**Fix:** How to correct it

---

## Major Issues (Outdated/Incomplete)

[Same format]

## Minor Issues (Improvements)

[Same format]
```

## Example Usage

```bash
# Analyze all documentation
/interactive-sdlc:analyse-doc

# Focus on API documentation
/interactive-sdlc:analyse-doc Check API documentation accuracy

# Analyze specific files
/interactive-sdlc:analyse-doc docs/api.md README.md

# Check for broken links
/interactive-sdlc:analyse-doc Verify all links and references are valid
```

## Issue Categories

### Critical (Wrong/Misleading)

- Documents non-existent features
- Wrong API signatures
- Incorrect behavior descriptions
- Security-related misinformation

### Major (Outdated/Incomplete)

- Features added but not documented
- Deprecated features still documented
- Missing important sections
- Outdated examples

### Minor (Improvements)

- Typos and grammar issues
- Unclear explanations
- Missing examples
- Better organization suggestions

## Don't

- Don't nitpick working documentation - good docs are a success
- Don't assume documentation is wrong without verifying against code
- Don't report issues without providing correct information
- Don't apply same standards to all documentation types
- Don't flag documentation that is ahead of code as incorrect
