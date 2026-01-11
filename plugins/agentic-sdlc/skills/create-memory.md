---
name: create-memory
description: Create a memory document for future reference
argument-hint: "--category <category> --tags <tags> <content>"
---

# Create Memory

## Definition

Persist a learning, pattern, or discovery that should be remembered for future sessions. Use this skill when you discover unexpected patterns, workarounds, solutions, conventions, or architectural decisions.

## Arguments

- **`--category`** (required): Memory category - pattern | lesson | error | decision | context
- **`--tags`** (required): Comma-separated list of searchable keywords
- **`<content>`** (required): The learning content in markdown format

## Objective

Create a persistent memory document that can be searched and referenced in future sessions.

## Core Principles

- Check if similar memory exists before creating (use `/search-memory`)
- Content must be specific and actionable
- Include code examples when relevant
- Keep content concise but complete
- Single responsibility - each memory covers one learning

## Instructions

1. Check if a similar memory already exists using `/search-memory`
2. Validate the category is one of: pattern, lesson, error, decision, context
3. Parse the tags into a list of keywords
4. Create the memory document with frontmatter and content
5. Save to `agentic/memory/{category}/{slug}.md`
6. Return confirmation with memory ID and path

## Output Guidance

Return JSON confirmation:

```json
{
  "success": true,
  "memory_id": "mem-YYYY-MM-DD-slug",
  "path": "agentic/memory/category/filename.md"
}
```

### Example

```
/create-memory --category pattern --tags "error,exception,typescript,middleware"
This codebase uses a centralized error handling pattern where all errors
extend BaseError and are caught by the global error middleware.
```
