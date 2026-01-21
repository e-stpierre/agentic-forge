---
name: search-memory
description: Search memories for relevant context
argument-hint: "[--category <category>] [--tags <tags>] <query>"
---

# Search Memory

## Definition

Search the memory system for relevant learnings, patterns, and context. Use this skill when starting complex tasks, encountering errors, understanding conventions, or making architectural decisions.

## Arguments

- **`<query>`** (required): Keywords to search for
- **`--category`** (optional): Filter by category - pattern | lesson | error | decision | context
- **`--tags`** (optional): Comma-separated list of tags to filter by

## Objective

Find and return relevant memories that can inform the current task or decision.

## Core Principles

- Search is keyword-based (no semantic/vector search)
- Return most relevant results first
- Include enough context to assess relevance
- Support filtering by category and tags

## Instructions

1. Parse the search query and optional filters
2. Search memory files in `agentic/memory/` directory
3. Match against title, tags, and content
4. Rank results by relevance (keyword matches)
5. Return structured results with summaries

## Output Guidance

Return matching memories as JSON:

```json
{
  "results": [
    {
      "id": "mem-2024-01-15-auth-pattern",
      "title": "Authentication Middleware Pattern",
      "category": "pattern",
      "relevance": "high",
      "summary": "First 200 chars of content..."
    }
  ],
  "count": 1
}
```

### Alternative: Direct Lookup

You can also read the memory index directly:

1. Read `agentic/memory/index.md` for an overview
2. Use grep for specific keywords in memory files
3. Read relevant files from `agentic/memory/{category}/`
