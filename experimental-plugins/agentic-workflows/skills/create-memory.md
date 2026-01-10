---
name: create-memory
description: Create a memory document for future reference
output: json
---

# Create Memory

Use this skill to persist a learning, pattern, or discovery that should be remembered for future sessions.

## When to Use

Create memories when you:

- Discover an unexpected pattern in the codebase
- Find a workaround for a framework limitation
- Encounter an error and find the solution
- Learn something about the project's conventions
- Make an architectural decision with rationale

## How to Use

Invoke this skill with the following information:

1. **Category** (required): pattern | lesson | error | decision | context
2. **Title** (required): Brief descriptive title
3. **Tags** (required): List of searchable keywords
4. **Content** (required): The learning in markdown format

## Guidelines

Before creating a memory:

1. Check if a similar memory already exists using `/search-memory`
2. Ensure the content is specific and actionable
3. Include code examples when relevant
4. Keep content concise but complete

## Output Format

After creating the memory, respond with:

```json
{
  "success": true,
  "memory_id": "mem-YYYY-MM-DD-slug",
  "path": "agentic/memory/category/filename.md"
}
```

## Example

```
/create-memory
Category: pattern
Title: Error Handling Convention
Tags: error, exception, typescript, middleware
Content:
This codebase uses a centralized error handling pattern where all errors
extend BaseError and are caught by the global error middleware.

## Pattern
- Define error classes in src/errors/
- Extend BaseError with appropriate status code
- Throw errors, let middleware handle response

## Code Example
\`\`\`typescript
class ValidationError extends BaseError {
  constructor(message: string) {
    super(message, 400);
  }
}
\`\`\`
```
