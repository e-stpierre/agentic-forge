<!--
COMMAND PROMPT TEMPLATE

This template defines the exact structure for Claude Code command prompts.

REQUIRED FRONTMATTER FIELDS:
- name: Kebab-case identifier for the command
- description: One-line description shown in help menus (recommended: under 100 characters)
- arguments: List of argument definitions with name, description, required, and optional default

OPTIONAL FRONTMATTER FIELDS:
- argument-hint: Usage pattern hint for interactive commands (e.g., "<type> [context]"). Recommended for commands expected to be used manually in a Claude session, not agentic workflows.

REQUIRED SECTIONS:
- Arguments (if command takes arguments)
- Objective
- Core Principles
- Instructions
- Output Guidance

OPTIONAL SECTIONS:
- Command-Specific Guidelines (for domain-specific behavioral guidance unique to this command)
- Templates (for commands that generate structured outputs)
- Configuration (for commands with configurable settings)
- Important Notes (for critical reminders, constraints, and anti-patterns)

ARGUMENT DESIGN PRINCIPLES:
- If present, the [context] argument should always come last
- Commands should NOT support arguments that can be configured in settings.json
- Instead, provide defaults and read settings.json to override them
- Example: Plan commands should not have --output argument; use default /specs or read interactive-sdlc.planDirectory from settings
-->

---

name: {{command-name}}
description: {{command-description}}
argument-hint: {{argument-pattern}} # Optional: for interactive commands only
arguments:

- name: {{arg-name}}
  description: {{arg-description}}
  required: {{true|false}}
  default: {{default-value}} # Optional: only if required is false

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
- This section documents the arguments defined in the frontmatter for human readers
- Include default values where applicable
- If present, the [context] argument should always come last
- Do NOT add arguments for values that can be configured in settings.json
- Omit this section entirely if the command takes no arguments (frontmatter arguments can be empty list)
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

## Important Notes (optional)

{{important_notes}}

<!--
Instructions:
- Replace {{important_notes}} with bullet points of critical reminders, constraints, and warnings
- Use positive format where possible ("Do X" instead of "Don't do X")
- Reserve "Don't" for critical warnings where violation would cause serious issues
- Example items:
  - Plans are read-only - track progress via TodoWrite tool
  - Ask clarifying questions when requirements are unclear
  - Don't modify files without user confirmation (critical safety warning)
  - Run tests frequently to catch issues early
-->
