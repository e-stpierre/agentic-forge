# Commands Prompt Reference

This document defines the structure and requirements for creating Claude Code command prompts.

## Frontmatter

Commands require YAML frontmatter with the following fields:

```yaml
---
name: command-name
description: Brief description of what the command does
argument-hint: <required-arg> [optional-arg]
---
```

| Field           | Required | Description                              |
| --------------- | -------- | ---------------------------------------- |
| `name`          | Yes      | Kebab-case identifier for the command    |
| `description`   | Yes      | One-line description shown in help menus |
| `argument-hint` | Yes      | Usage pattern showing arguments          |

## Prompt Structure

### Definition

A brief 1-3 sentence description of what the command accomplishes and when to use it.

### Parameters

A bullet-point list defining each parameter:

- **`parameter-name`** (required/optional): Description of the parameter and its expected format
- **`another-param`** (optional): Description with default value if applicable

### Objective

A clear, single statement defining the primary goal the command must achieve.

### Core Principles

Key guidelines that govern the command's behavior:

- Principle statements as bullet points
- Focus on constraints, quality standards, and behavioral expectations
- Include security considerations where relevant

### Instructions

Numbered step-by-step instructions for execution:

1. First action to take
2. Second action to take
3. Continue with logical sequence
4. Final verification or output step

### Output Guidance

Define the expected output format and content:

- Specify output structure (markdown, JSON, plain text)
- Define what information must be included
- Note any formatting requirements

## Optional Sections

The following sections are optional and should be included for complex commands that require additional detail.

### Templates (optional)

Embedded templates for structured outputs the command generates:

- Use code blocks to show template structure
- Include placeholders with clear naming (e.g., `[Feature Name]`)
- Document each section of the template

### Examples (optional)

Usage scenarios demonstrating the command in action:

- Show simple and complex usage patterns
- Include expected inputs and outputs
- Illustrate edge cases when relevant

### Configuration (optional)

Settings, defaults, and tunables for the command:

- List configurable parameters with defaults
- Explain when to adjust settings
- Group related settings together

### Best Practices (optional)

Guidelines beyond core principles for optimal usage:

- Organize by topic or phase of execution
- Provide actionable recommendations
- Explain rationale when helpful
