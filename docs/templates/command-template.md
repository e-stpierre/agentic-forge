<!--
COMMAND PROMPT TEMPLATE

This template defines the exact structure for Claude Code command prompts.

REQUIRED FRONTMATTER FIELDS:
- name: Kebab-case identifier for the command
- description: One-line description shown in help menus (recommended: under 100 characters)
- argument-hint: Usage pattern showing arguments (can be empty string)

REQUIRED SECTIONS:
- Arguments (if command takes arguments)
- Objective
- Core Principles
- Instructions
- Output Guidance

OPTIONAL SECTIONS:
- Templates (for commands that generate structured outputs)
- Configuration (for commands with configurable settings)
- Don't (for commands that need explicit anti-patterns)

ARGUMENT DESIGN PRINCIPLES:
- If present, the [context] argument should always come last
- Commands should NOT support arguments that can be configured in settings.json
- Instead, provide defaults and read settings.json to override them
- Example: Plan commands should not have --output argument; use default /specs or read interactive-sdlc.planDirectory from settings
-->

---
name: {{command-name}}
description: {{command-description}}
argument-hint: {{argument-pattern}}
---

# {{command_title}}

{{command_definition}}

<!--
Instructions:
- Replace {{command_definition}} with a brief 1-3 sentence description
- Explain what the command accomplishes and when to use it
-->

## Arguments

{{arguments}}

<!--
Instructions:
- Replace {{arguments}} with a bullet-point list defining each argument
- Format: **`argument-name`** (required/optional): Description and expected format
- Include default values where applicable
- If present, the [context] argument should always come last
- Do NOT add arguments for values that can be configured in settings.json
- Omit this section entirely if the command takes no arguments
-->

## Objective

{{objective}}

<!--
Instructions:
- Replace {{objective}} with a clear, single statement
- Define the primary goal the command must achieve
-->

## Core Principles

{{principles}}

<!--
Instructions:
- Replace {{principles}} with bullet points of key guidelines
- Focus on constraints, quality standards, and behavioral expectations
- Include security considerations where relevant
- Example principles:
  - Validate input before processing
  - Preserve existing functionality
  - Report errors clearly
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
- Suggested elements (include others as needed):
  - Output formats and structure
  - Required content and detail level
  - Examples of expected output
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

## Configuration (optional)

{{configuration}}

<!--
Instructions:
- Replace {{configuration}} with settings, defaults, and tunables
- List configurable parameters with their default values
- Explain when to adjust settings
- Group related settings together
-->

## Don't (optional)

{{anti_patterns}}

<!--
Instructions:
- Replace {{anti_patterns}} with bullet points of things to avoid
- List elements that the command should not do
- Clarify common mistakes or misuses
- Example items:
  - Don't modify files without user confirmation
  - Don't skip validation steps
-->
