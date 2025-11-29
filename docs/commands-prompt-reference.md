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
