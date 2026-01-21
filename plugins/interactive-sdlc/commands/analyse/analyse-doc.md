---
name: analyse-doc
description: Analyze documentation quality, accuracy, and completeness
argument-hint: "[context]"
arguments:
  - name: context
    description: Specific documentation files or areas to focus on
    required: false
---

# Analyse Doc

Analyze documentation quality, accuracy, and completeness.

## Arguments

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
   - Read `.claude/settings.json` for `interactive-sdlc.analysisDirectory` (default: `analysis`)

2. **Identify Documentation**
   - Find all documentation files (README, docs/, `*.md`)
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
Documentation analysis complete. Report saved to analysis/doc.md

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

**Date**: {{date}}

<!--
Instructions:
- Replace {{date}} with the analysis date in YYYY-MM-DD format
-->

**Scope**: {{scope}}

<!--
Instructions:
- Replace {{scope}} with description of what documentation was analyzed
- Example: "All markdown files in docs/" or "API documentation"
-->

## Summary

- Critical (Wrong/Misleading): {{critical_count}} issues
- Major (Outdated/Incomplete): {{major_count}} issues
- Minor (Improvements): {{minor_count}} issues

<!--
Instructions:
- Replace {{critical_count}}, {{major_count}}, {{minor_count}} with actual counts
- If count is 0, you can say "0 issues" or omit the category
-->

## Critical Issues (Completely Wrong/Misleading)

### DOC-{{issue_number}}: {{issue_title}}

<!--
Instructions:
- Replace {{issue_number}} with sequential number (001, 002, etc.)
- Replace {{issue_title}} with concise issue title
- Use this format for each critical documentation issue found
-->

**Files:** {{affected_files}}

<!--
Instructions:
- Replace {{affected_files}} with list of affected documentation files
- Example: "docs/api.md, README.md"
-->

**Issue:** {{issue_description}}

<!--
Instructions:
- Replace {{issue_description}} with what is wrong or misleading
- Be specific about the incorrect information
-->

**Code Reference:** {{code_location}}

<!--
Instructions:
- Replace {{code_location}} with related code location if applicable
- Format: file:line (e.g., "src/api/routes.ts:120")
- Use "N/A" if not applicable
-->

**Fix:** {{fix_suggestion}}

<!--
Instructions:
- Replace {{fix_suggestion}} with how to correct the documentation
- Include the correct information
-->

---

## Major Issues (Outdated/Incomplete)

<!--
Instructions:
- Use same format as Critical Issues section
- Include all major severity documentation issues
-->

## Minor Issues (Improvements)

<!--
Instructions:
- Use same format as Critical Issues section
- Include all minor documentation improvements
-->
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

## Important Notes

- Focus on real issues - good documentation is a success, not a failure
- Verify documentation against code before marking it as incorrect
- Provide correct information when reporting issues
- Apply appropriate standards based on documentation type (user guides vs API references vs internal docs)
- Consider that documentation may be ahead of code (planned features)
