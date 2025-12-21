# Agents Prompt Reference

This document defines the structure and requirements for creating Claude Code agent prompts.

## Frontmatter

Agents require YAML frontmatter with the following fields:

```yaml
---
name: agent-name
description: Brief description of the agent's expertise
tools: [Read, Write, Bash, Glob, Grep, WebFetch]
model: sonnet
color: blue
---
```

| Field         | Required | Description                                      |
| ------------- | -------- | ------------------------------------------------ |
| `name`        | Yes      | Kebab-case identifier for the agent              |
| `description` | Yes      | One-line description of agent's domain expertise |
| `tools`       | Yes      | Array of tool names the agent can access         |
| `model`       | Yes      | Model to use: `sonnet`, `opus`, or `haiku`       |
| `color`       | Yes      | Display color for the agent in UI                |

## Prompt Structure

### Purpose

A concise statement of the agent's role, domain expertise, and primary function. Define what problems this agent solves and when it should be invoked.

### Methodology

The approach and framework the agent follows to accomplish tasks:

- Analysis techniques and decision-making processes
- How the agent breaks down complex problems
- Quality standards and verification methods

### Tools Available

Description of each tool the agent can use and how it applies them:

- **Tool Name**: How the agent uses this tool in its workflow
- Include guidance on tool selection and sequencing

### Capabilities

Specific tasks and operations the agent can perform:

- List concrete capabilities as bullet points
- Define scope boundaries (what the agent can and cannot do)
- Note any limitations or prerequisites

### Knowledge Base

Domain knowledge and expertise the agent possesses:

- Technical domains and frameworks
- Best practices and standards it follows
- Reference materials it draws upon

### Output Guidance

Define expected outputs and deliverables:

- Output formats and structure
- Required content and detail level
- How results should be presented to the user
