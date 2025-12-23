---
name: normalize
description: Validate files against prompt reference guidelines
argument-hint: [--autofix] [file-or-directory...]
---

# Normalize Command

Validate that prompt files (commands, agents, skills) conform to the exact structure defined in the template files:

- `docs/templates/command-template.md` for commands
- `docs/templates/agent-template.md` for agents
- `docs/templates/skill-template.md` for skills

**Template Convention:**

All templates use Mustache/Handlebars-style placeholders (`{{placeholder_name}}`) with HTML comment instructions. See `CLAUDE.md` section "Prompt Template Convention" for complete details.

## Arguments

- **`--autofix`** (optional): Automatically modify files to make them compliant with the templates. Without this flag, only reports issues.
- **`file-or-directory`** (optional): One or more paths to files or directories to validate. If omitted, validates all prompt files in the repository.

## Objective

Ensure all prompt files exactly match the structure, section names, and content requirements defined in the template files.

## Core Principles

- Validate against exact template structure (read the template file for the prompt type)
- Templates use `{{placeholder}}` format with HTML comment instructions
- Section names must match exactly (case-sensitive)
- Required sections must be present in the correct order
- Optional sections are marked as "(optional)" in the template
- Suggested elements in HTML comments are flexible - other elements can be included
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

2. **Classify Each File and Load Template**

   Determine the prompt type based on file location:
   - Files in `*/commands/` directories -> Command
     - Read `docs/templates/command-template.md`
   - Files in `*/agents/` directories -> Agent
     - Read `docs/templates/agent-template.md`
   - Files in `*/skills/` directories -> Skill
     - Read `docs/templates/skill-template.md`

   Skip files that cannot be classified (not in a recognized directory).

   **Understanding Template Structure:**
   - Templates use `{{placeholder}}` format for variable content
   - HTML comments (`<!-- Instructions: ... -->`) provide guidance
   - Required sections are listed in the template header comment
   - Optional sections are marked with "(optional)" in section headings

3. **Validate Frontmatter**

   Parse the YAML frontmatter and validate:

   For **Commands** and **Skills**:
   - `name` (required): Must be present, must be kebab-case
   - `description` (required): Must be present, must be a one-line description
   - `argument-hint` (required): Must be present (can be empty string)

   For **Agents**:
   - `name` (required): Must be present, must be kebab-case
   - `description` (required): Must be present, one-line description
   - `tools` (required): Must be present, must be array format
   - `model` (required): Must be present, must be one of `sonnet`, `opus`, `haiku`
   - `color` (required): Must be present

4. **Extract Section Structure from Template**

   Parse the template file to identify:
   - Required section names and their exact capitalization
   - Optional section names
   - Expected section order
   - Whether sections should have subsections

5. **Validate Section Presence and Names**

   For each file being validated:
   - Extract all heading sections (## level)
   - Compare section names against template (case-sensitive exact match)
   - Report missing required sections
   - Report misspelled or incorrectly capitalized section names
   - Report sections in wrong order

   **Required sections per template:**

   For **Commands** (from command-template.md):
   - Arguments (required if command has arguments)
   - Objective (required)
   - Core Principles (required)
   - Instructions (required)
   - Output Guidance (required)

   **Optional sections for Commands:**
   - Templates (optional - check reference for when this should be present)
   - Configuration (optional)
   - Don't (optional)

   For **Agents** (from agent-template.md):
   - Purpose (required)
   - Methodology (required)
   - Tools Available (required)
   - Capabilities (required)
   - Knowledge Base (required)
   - Output Guidance (required)

   For **Skills** (from skill-template.md):
   - Definition (required)
   - Arguments (required if skill has arguments)
   - Objective (required)
   - Core Principles (required)
   - Instructions (required)
   - Output Guidance (required)

6. **Validate Section Content**
   - **Instructions section**: Must contain numbered list (1. 2. 3. etc.)
   - **Core Principles section**: Should contain bullet points
   - **Arguments section**: Should contain bullet points with argument formatting
   - **Objective section**: Should be a clear, concise statement

7. **Validate Special Requirements**

   Based on file-specific context:
   - Plan commands (plan-feature, plan-bug, plan-chore) should have Templates section with plan structure
   - Analyse commands should have report template in Templates or Output Guidance section
   - Check for ASCII-only content (no special Unicode characters)

8. **Check Content Quality**
   - Verify kebab-case naming convention in `name` field
   - Ensure description is concise (under 100 characters recommended)
   - Validate that `{{placeholders}}` are replaced with actual values (not literal `{{text}}`)
   - Check that HTML comments from template are removed (they're for template guidance only)
   - Ensure "Suggested elements" lists from comments are replaced with actual content

9. **Apply Autofix (if `--autofix` flag is present)**

   When `--autofix` is specified in `$ARGUMENTS`, directly modify files to fix issues:

   **Frontmatter fixes:**
   - Add missing frontmatter block if absent
   - Add missing required fields with sensible defaults:
     - `name`: Derive from filename (convert to kebab-case)
     - `description`: Use first paragraph or heading as basis
     - `argument-hint`: Empty string if no arguments detected (commands/skills)
     - `tools`: `[Read, Glob, Grep]` for agents
     - `model`: `sonnet` for agents
     - `color`: `blue` for agents

   **Structure fixes:**
   - Add missing required sections by copying from the template
   - Insert sections in the correct order as defined in the template
   - Preserve existing content and add placeholders for new sections
   - Mark added sections with `<!-- TODO: Fill in this section -->` comments

   **Section name fixes:**
   - Rename incorrectly capitalized sections to match template exactly
   - For example: `## arguments` -> `## Arguments`
   - Preserve section content when renaming

   **Content fixes:**
   - Convert non-kebab-case names to kebab-case in frontmatter
   - Replace non-ASCII characters with ASCII equivalents
   - Ensure Instructions section uses numbered list format
   - Ensure Core Principles section uses bullet points

   **Autofix principles:**
   - Read both the file and the template before modifying
   - Preserve all existing content
   - Insert new sections in the correct order per the template
   - Report each modification made

10. **Generate Report**

    For each file, report:
    - File path and detected type
    - Template being validated against
    - List of issues found (if any):
      - Missing frontmatter fields
      - Missing required sections
      - Section name mismatches (wrong capitalization or spelling)
      - Sections in wrong order
      - Content format issues
    - Suggested fixes for each issue (in validate-only mode)
    - Modifications applied (in autofix mode)

    Summary at end:
    - Total files checked
    - Files passing validation (100% compliant with template)
    - Files with issues (by category: frontmatter, structure, content)
    - Files modified (if autofix enabled)

## Output Guidance

### Validate-only mode (default)

Present results in a structured format:

```markdown
## Validation Results

### path/to/file.md (Command)

Template: docs/templates/command-template.md

**Frontmatter:**

- [PASS] All required fields present
- [PASS] name is kebab-case: "example-command"

**Structure:**

- [FAIL] Missing required section: "Output Guidance"
  Expected: ## Output Guidance
  Suggestion: Add section after "Instructions" section
- [FAIL] Section name mismatch: "## arguments" should be "## Arguments"
  Location: Line 15
  Suggestion: Capitalize section name to match template exactly

**Content:**

- [PASS] Instructions section uses numbered list
- [WARN] Description is 105 characters (recommended: under 100)

### path/to/another.md (Agent)

Template: docs/templates/agent-template.md

**Frontmatter:**

- [FAIL] Missing required field: tools
  Suggestion: Add `tools: [Read, Write, Bash]` to frontmatter
- [FAIL] Missing required field: color
  Suggestion: Add `color: blue` to frontmatter

**Structure:**

- [PASS] All required sections present
- [PASS] Sections in correct order

## Summary

- Files checked: 10
- Passing (100% compliant): 7
- With issues: 3
  - Frontmatter issues: 1
  - Structure issues: 2
  - Content issues: 1
```

### Autofix mode (`--autofix`)

Report modifications as they are made:

```markdown
## Autofix Results

### path/to/file.md (Command)

Template: docs/templates/command-template.md

- [FIXED] Added missing frontmatter field: argument-hint (empty string)
- [FIXED] Added missing section: "Output Guidance" at line 85
- [FIXED] Renamed section: "## arguments" -> "## Arguments" at line 15
- [INFO] Preserved all existing content

### path/to/another.md (Agent)

Template: docs/templates/agent-template.md

- [FIXED] Added missing frontmatter field: tools -> [Read, Glob, Grep]
- [FIXED] Added missing frontmatter field: color -> blue
- [FIXED] Converted name: "MyAgent" -> "my-agent" (kebab-case)
- [INFO] Preserved all existing content

## Summary

- Files checked: 10
- Files modified: 2
- Issues auto-fixed: 6
  - Frontmatter fixes: 3
  - Structure fixes: 2
  - Content fixes: 1
- Files now passing: 9
- Files still with issues: 1 (requires manual review)
```

If all files pass validation, output:

```markdown
## Validation Results

All files pass validation! ✓

- Files checked: 10
- All files are 100% compliant with their templates
```
