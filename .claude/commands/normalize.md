---
name: normalize
description: Validate files against prompt reference guidelines
argument-hint: [--autofix] [file-or-directory...]
---

# Normalize Command

Validate that prompt files (commands, agents, skills) conform to the reference guidelines defined in `docs/`.

## Parameters

- **`--autofix`** (optional): Automatically modify files to make them compliant with the documentation. Without this flag, only reports issues.
- **`file-or-directory`** (optional): One or more paths to files or directories to validate. If omitted, validates all prompt files in the repository.

## Objective

Ensure all prompt files follow the structural and content requirements defined in the prompt reference documentation.

## Core Principles

- Validate against the appropriate reference based on file location
- Report all issues with clear, actionable feedback
- Only modify files when `--autofix` flag is provided
- Skip non-prompt files (non-.md files, READMEs, etc.)
- Preserve existing content and style when autofixing

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

6. **Apply Autofix (if `--autofix` flag is present)**

   When `--autofix` is specified in `$ARGUMENTS`, directly modify files to fix issues:

   **Frontmatter fixes:**

   - Add missing frontmatter block if absent
   - Add missing required fields with sensible defaults:
     - `name`: Derive from filename (convert to kebab-case)
     - `description`: Use first paragraph or heading as basis
     - `argument-hint`: Empty string if no parameters detected
     - `tools`: `[Read, Glob, Grep]` for agents
     - `model`: `sonnet` for agents
     - `color`: `blue` for agents

   **Structure fixes:**

   - Add missing required sections with placeholder content
   - Use the reference documentation templates as guidance
   - Mark added sections with `<!-- TODO: Fill in this section -->` comments

   **Content fixes:**

   - Convert non-kebab-case names to kebab-case
   - Replace non-ASCII characters with ASCII equivalents
   - Ensure Instructions section uses numbered list format

   **Autofix principles:**

   - Read the file before modifying
   - Preserve all existing content
   - Insert new sections in the correct order per the reference
   - Report each modification made

7. **Generate Report**

   For each file, report:

   - File path and detected type
   - List of issues found (if any)
   - Suggested fixes for each issue (in validate-only mode)
   - Modifications applied (in autofix mode)

   Summary at end:

   - Total files checked
   - Files passing validation
   - Files with issues
   - Files modified (if autofix enabled)

## Output Guidance

### Validate-only mode (default)

Present results in a structured format:

```markdown
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

### Autofix mode (`--autofix`)

Report modifications as they are made:

```markdown
## Autofix Results

### path/to/file.md (Command)
- [FIXED] Added missing frontmatter field: argument-hint
- [FIXED] Added missing "Output Guidance" section
- [SKIP] Could not auto-generate: Objective section requires manual input

### path/to/another.md (Agent)
- [FIXED] Added missing frontmatter field: tools (defaulted to [Read, Glob, Grep])
- [FIXED] Converted name "MyAgent" to kebab-case "my-agent"

## Summary
- Files checked: 10
- Files modified: 2
- Issues auto-fixed: 4
- Issues requiring manual fix: 1
```

If all files pass validation, output a brief success message.
