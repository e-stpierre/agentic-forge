# Skills Prompt Reference

This document defines the structure and requirements for creating Claude Code skill prompts.

## Frontmatter

Skills require YAML frontmatter with the following fields:

```yaml
---
name: skill-name
description: Brief description of what the skill provides
argument-hint: <required-arg> [optional-arg]
---
```

| Field           | Required | Description                                        |
| --------------- | -------- | -------------------------------------------------- |
| `name`          | Yes      | Kebab-case identifier for the skill                |
| `description`   | Yes      | One-line description shown when skill is available |
| `argument-hint` | Yes      | Usage pattern showing expected inputs              |

## Prompt Structure

### Definition

A brief 1-3 sentence description of the skill's purpose and the capability it provides.

### Parameters

A bullet-point list defining each parameter:

- **`parameter-name`** (required/optional): Description of the parameter and its expected format
- **`another-param`** (optional): Description with default value if applicable

### Objective

A clear, single statement defining the primary capability the skill delivers.

### Core Principles

Key guidelines that govern the skill's behavior:

- Principle statements as bullet points
- Focus on modularity, composability, and reusability
- Define boundaries of what the skill does and does not do

### Instructions

Numbered step-by-step instructions for execution:

1. First action to take
2. Second action to take
3. Continue with logical sequence
4. Final verification or output step

### Output Guidance

Define the expected output format and content:

- Specify output structure (markdown, JSON, structured data)
- Define what information must be returned
- Note any formatting or integration requirements
