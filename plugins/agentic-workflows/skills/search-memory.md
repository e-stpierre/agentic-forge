---
name: search-memory
description: Search memories for relevant context
output: json
---

# Search Memory

Search the memory system for relevant learnings, patterns, and context.

## When to Use

Search memories when you:

- Start working on a complex task
- Encounter an error or unexpected behavior
- Need to understand project conventions
- Are about to make architectural decisions

## How to Use

Provide a search query and optionally filter by category or tags.

## Parameters

- **query** (required): Keywords to search for
- **category** (optional): pattern | lesson | error | decision | context
- **tags** (optional): List of tags to filter by

## Output Format

Return matching memories:

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

## Example

```
/search-memory authentication middleware
```

## Alternative: Direct Lookup

You can also read the memory index directly:

1. Read `agentic/memory/index.md` for an overview
2. Use grep for specific keywords in memory files
3. Read relevant files from `agentic/memory/{category}s/`
