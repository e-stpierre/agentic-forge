<!--
SKILL PROMPT TEMPLATE

This template defines the exact structure for Claude Code skill prompts.

REQUIRED FRONTMATTER FIELDS:
- name: Kebab-case identifier for the skill (or use directory name)
- description: One-line description shown in help menus (recommended: under 100 characters)
- argument-hint: Usage pattern hint (only if skill takes arguments)

ARGUMENT-HINT CONVENTIONS:
- Use `<arg>` for required arguments (angle brackets)
- Use `[arg]` for optional arguments (square brackets)
- Use `--flag` for boolean flags
- Use `[arg...]` for variadic arguments (accepts multiple values)
- The `[context]` argument must ALWAYS come last when present
- Examples:
  - `<context>` - required context only
  - `[type] <context>` - optional type, required context
  - `[paths...] [context]` - optional paths, optional context
  - `<context> [--verbose]` - required context with optional flag

OPTIONAL FRONTMATTER FIELDS:
- disable-model-invocation: Set `true` to prevent Claude auto-loading (default: false)
- user-invocable: Set `false` to hide from / menu (default: true)
- allowed-tools: Tools Claude can use without permission
- model: Model to use when skill is active
- context: Set to `fork` for isolated subagent execution
- agent: Subagent type when context: fork is set
- hooks: Hooks scoped to this skill's lifecycle

REQUIRED SECTIONS (in order):
1. Overview - Skill purpose and objective (combines definition + goal)
2. Arguments - Only if skill takes arguments
3. Core Principles - Key guidelines, constraints, and important notes
4. Instructions - Step-by-step execution guide
5. Output Guidance - Expected output format and content

OPTIONAL SECTIONS (insert in order shown):
- Configuration - After Arguments, for skills with configurable settings
- Skill-Specific Guidelines - After Core Principles, for domain-specific guidance
- Templates - After Output Guidance, for structured output templates
- Additional Resources - At the end, for links to supporting files

SECTION ORDER MUST BE RESPECTED - Follow the order defined above.

VALIDATION RULES:
- Arguments section and argument-hint frontmatter are REQUIRED only when the skill takes arguments
- Arguments section and argument-hint should be OMITTED when the skill takes no arguments
-->

---

name: {{skill-name}}
description: {{skill-description}}
argument-hint: {{argument-pattern}}

---

# {{skill_title}}

## Overview

{{overview}}

<!--
Instructions:
- Replace {{overview}} with 2-4 sentences describing:
  - What the skill does
  - When to use it
  - The primary goal it achieves
- This section combines the skill definition and objective
-->

## Arguments

{{arguments}}

<!--
Instructions:
- Replace {{arguments}} with a bullet-point list defining each argument
- Format: **`<argument-name>`** (required): Description
- Format: **`[argument-name]`** (optional): Description. Defaults to `value`.
- Include default values where applicable
- The [context] argument should always come last
- Omit this section entirely if the skill takes no arguments
-->

## Configuration (optional)

{{configuration}}

<!--
Instructions:
- Replace {{configuration}} with settings, defaults, and tunables
- List configurable parameters with their default values
- Explain when to adjust settings
- Group related settings together
- Omit this section if not needed
-->

## Core Principles

{{principles}}

<!--
Instructions:
- Replace {{principles}} with bullet points of key guidelines
- Include constraints, quality standards, and behavioral expectations
- Include security considerations where relevant
- Include critical warnings and important notes
- Use positive format where possible ("Do X" instead of "Don't do X")
- Reserve "Don't" for critical warnings where violation would cause serious issues
-->

## Skill-Specific Guidelines (optional)

{{skill_specific_guidelines}}

<!--
Instructions:
- Replace {{skill_specific_guidelines}} with domain-specific behavioral guidance
- Each guideline must be in a sub-section (###) with a clear, descriptive title
- Use for specialized context that doesn't fit standard sections
- Include examples, conventions, or patterns specific to this skill's domain
- Omit this section if not needed
-->

## Instructions

{{instructions}}

<!--
Instructions:
- Replace {{instructions}} with numbered step-by-step execution instructions
- Use format: 1. First action, 2. Second action, etc.
- Provide logical sequence from start to completion
- Include verification or validation steps
-->

## Output Guidance

{{output}}

<!--
Instructions:
- Replace {{output}} with expected output format and content definition
- Specify output structure (markdown, JSON, plain text, etc.)
- Define what information must be included
- Note any formatting requirements
-->

## Templates (optional)

{{templates}}

<!--
Instructions:
- Replace {{templates}} with embedded templates for structured outputs
- Use code blocks to show template structure
- Include placeholders with clear naming (e.g., [Feature Name], {{variable}})
- Document each section of the template
- This section is recommended for skills that generate files or structured output
-->

## Additional Resources (optional)

{{additional_resources}}

<!--
Instructions:
- Replace {{additional_resources}} with links to supporting files
- Format: - For <purpose>, see [filename.md](filename.md)
- Use for reference docs, examples, or scripts in the skill directory
- Omit this section if skill has no supporting files
-->
