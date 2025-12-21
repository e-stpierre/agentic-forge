---
name: normalize
description: Validate files against prompt reference guidelines
argument-hint: [file-or-directory...]
---

# Normalize Command

Validate that prompt files (commands, agents, skills) conform to the reference guidelines defined in `docs/`.

## Parameters

- **`file-or-directory`** (optional): One or more paths to files or directories to validate. If omitted, validates all prompt files in the repository.

## Objective

Ensure all prompt files follow the structural and content requirements defined in the prompt reference documentation.

## Core Principles

- Validate against the appropriate reference based on file location
- Report all issues with clear, actionable feedback
- Suggest fixes but do not auto-modify files unless explicitly requested
- Skip non-prompt files (non-.md files, READMEs, etc.)

## Instructions

1. **Determine Files to Validate**

   If paths are provided via `$ARGUMENTS`:
   - For each file path: validate that file directly
   - For each directory path: find all `.md` files within (excluding README.md)

   If no paths provided:
   - Scan `plugins/*/commands/*.md`, `plugins/*/agents/*.md`, `plugins/*/skills/*.md`
   - Also scan `.claude/commands/*.md` and `.claude/skills/*.md`

2. **Classify Each File**

   Determine the prompt type based on file location:
   - Files in `*/commands/` directories -> Command (use `docs/commands-prompt-reference.md`)
   - Files in `*/agents/` directories -> Agent (use `docs/agents-prompt-reference.md`)
   - Files in `*/skills/` directories -> Skill (use `docs/skills-prompt-reference.md`)

   Skip files that cannot be classified (not in a recognized directory).

3. **Validate Frontmatter**

   For **Commands** and **Skills**, check required frontmatter fields:
   - `name` (required): Must be kebab-case
   - `description` (required): Must be a one-line description
   - `argument-hint` (required): Can be empty but must be present

   For **Agents**, check required frontmatter fields:
   - `name` (required): Must be kebab-case
   - `description` (required): One-line description of domain expertise
   - `tools` (required): Array of tool names
   - `model` (required): Must be one of `sonnet`, `opus`, `haiku`
   - `color` (required): Display color for UI

4. **Validate Structure**

   For **Commands**, check for these sections:
   - Definition or clear description (required)
   - Parameters section if command takes arguments
   - Objective (required)
   - Core Principles (required)
   - Instructions (required, numbered steps)
   - Output Guidance (required)

   For **Agents**, check for these sections:
   - Purpose (required)
   - Methodology (required)
   - Tools Available (required)
   - Capabilities (required)
   - Knowledge Base (required)
   - Output Guidance (required)

   For **Skills**, check for these sections:
   - Definition (required)
   - Parameters section if skill takes arguments
   - Objective (required)
   - Core Principles (required)
   - Instructions (required, numbered steps)
   - Output Guidance (required)

5. **Check Content Quality**

   - Verify kebab-case naming convention in `name` field
   - Ensure description is concise (under 100 characters recommended)
   - Check that Instructions section contains numbered steps
   - Validate ASCII-only content (no special Unicode characters)

6. **Generate Report**

   For each file, report:
   - File path and detected type
   - List of issues found (if any)
   - Suggested fixes for each issue

   Summary at end:
   - Total files checked
   - Files passing validation
   - Files with issues

## Output Guidance

Present results in a structured format:

```
## Validation Results

### path/to/file.md (Command)
- [PASS] Frontmatter complete
- [FAIL] Missing "Output Guidance" section
  Suggestion: Add an "## Output Guidance" section defining expected output format

### path/to/another.md (Agent)
- [FAIL] Missing required frontmatter field: tools
  Suggestion: Add `tools: [Read, Write, Bash]` to frontmatter

## Summary
- Files checked: 10
- Passing: 8
- With issues: 2
```

If all files pass, output a brief success message.
