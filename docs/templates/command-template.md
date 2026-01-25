<!--
COMMAND PROMPT TEMPLATE

This template defines the exact structure for Claude Code command prompts.

REQUIRED FRONTMATTER FIELDS:
- name: Kebab-case identifier for the command
- description: One-line description shown in help menus (recommended: under 100 characters)
- argument-hint: Usage pattern hint (only if command takes arguments)

ARGUMENT-HINT CONVENTIONS:
- Use `<arg>` for required arguments (angle brackets)
- Use `[arg]` for optional arguments (square brackets)
- Use `--flag` for boolean flags
- Use `[arg...]` for variadic arguments (accepts multiple values)
- The `[context]` argument must ALWAYS come last when present - this is the user-provided prompt context
- Examples:
  - `<context>` - required context only
  - `[type] <context>` - optional type, required context
  - `[paths...] [context]` - optional paths, optional context
  - `<context> [--verbose]` - required context with optional flag

REQUIRED SECTIONS (in order):
1. Overview - Command purpose and objective (combines definition + goal)
2. Arguments - Only if command takes arguments
3. Core Principles - Key guidelines, constraints, and important notes
4. Instructions - Step-by-step execution guide
5. Output Guidance - Expected output format and content

OPTIONAL SECTIONS (insert in order shown):
- Configuration - After Arguments, for commands with configurable settings
- Command-Specific Guidelines - After Core Principles, for domain-specific guidance
- Templates - After Output Guidance, for structured output templates

SECTION ORDER MUST BE RESPECTED - Follow the order defined above.

VALIDATION RULES:
- Arguments section and argument-hint frontmatter are REQUIRED only when the command takes arguments
- Arguments section and argument-hint should be OMITTED when the command takes no arguments
-->

---

name: {{command-name}}
description: {{command-description}}
argument-hint: {{argument-pattern}}

---

# {{command_title}}

## Overview

{{overview}}

<!--
Instructions:
- Replace {{overview}} with 2-4 sentences describing:
  - What the command does
  - When to use it
  - The primary goal it achieves
- This section combines the command definition and objective
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
- Omit this section entirely if the command takes no arguments
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

## Command-Specific Guidelines (optional)

{{command_specific_guidelines}}

<!--
Instructions:
- Replace {{command_specific_guidelines}} with domain-specific behavioral guidance
- Each guideline must be in a sub-section (###) with a clear, descriptive title
- Use for specialized context that doesn't fit standard sections
- Include examples, conventions, or patterns specific to this command's domain
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
- This section is recommended for commands that generate files or structured output
-->
