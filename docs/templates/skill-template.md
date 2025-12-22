<!--
SKILL PROMPT TEMPLATE

This template defines the exact structure for Claude Code skill prompts.

REQUIRED FRONTMATTER FIELDS:
- name: Kebab-case identifier for the skill
- description: One-line description shown when skill is available (recommended: under 100 characters)
- argument-hint: Usage pattern showing expected inputs (can be empty string)

REQUIRED SECTIONS:
- Definition
- Arguments (if skill takes arguments)
- Objective
- Core Principles
- Instructions
- Output Guidance
-->

---
name: {{skill-name}}
description: {{skill-description}}
argument-hint: {{argument-pattern}}
---

# {{skill_title}}

## Definition

{{definition}}

<!--
Instructions:
- Replace {{definition}} with a brief 1-3 sentence description
- Explain the skill's purpose and the capability it provides
- Clarify when and why to use this skill
-->

## Arguments

{{arguments}}

<!--
Instructions:
- Replace {{arguments}} with a bullet-point list defining each argument
- Format: **`argument-name`** (required/optional): Description and expected format
- Include default values where applicable
- Omit this section entirely if the skill takes no arguments
-->

## Objective

{{objective}}

<!--
Instructions:
- Replace {{objective}} with a clear, single statement
- Define the primary capability the skill delivers
-->

## Core Principles

{{principles}}

<!--
Instructions:
- Replace {{principles}} with bullet points of key guidelines
- Focus on modularity, composability, and reusability
- Define boundaries of what the skill does and does not do
- Suggested elements (include others as needed):
  - Single responsibility principle
  - Composability with other skills
  - State management approach
  - Error handling philosophy
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
- Suggested elements (include others as needed):
  - Output structure (markdown, JSON, structured data)
  - What information must be returned
  - Formatting or integration requirements
  - How output should be consumed by other skills/commands
-->
