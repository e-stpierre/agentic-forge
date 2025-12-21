# Document

Generate or update project documentation with mermaid diagrams.

## Arguments

- `--output <path>`: Specify output file path
- `[context]`: Description of what to document

## Behavior

1. **Parse Request**
   - Analyze the `[context]` to understand documentation needs
   - Determine documentation type:
     - API documentation
     - Architecture documentation
     - Feature documentation
     - Setup/installation guides
     - Troubleshooting guides
     - Component documentation

2. **Analyze Existing Documentation**
   - Check for existing docs directory structure
   - Identify related documentation files
   - Understand current documentation conventions
   - Check for documentation templates

3. **Explore Codebase**
   - Launch explore agents to understand relevant code
   - For API docs: find API routes, handlers, types
   - For architecture: understand component relationships
   - For features: trace feature implementation

4. **Generate Documentation**
   - Create markdown documentation
   - Include mermaid diagrams where appropriate:
     - Architecture diagrams (C4, component diagrams)
     - Sequence diagrams (for flows and interactions)
     - Flowcharts (for decision logic)
     - Class diagrams (for object models)
     - State diagrams (for state machines)
   - Follow existing documentation style if present

5. **Format Output**
   - Run `npx markdownlint-cli2 --fix <file>` to format
   - Handle formatting errors gracefully
   - Report any issues that couldn't be auto-fixed

6. **Save Documentation**
   - Save to `--output` path if specified
   - Otherwise suggest appropriate location based on content type
   - Inform user of saved file path

## Mermaid Diagram Types

### Architecture Diagrams

```mermaid
graph TB
    subgraph Frontend
        UI[User Interface]
        State[State Management]
    end
    subgraph Backend
        API[API Layer]
        Service[Business Logic]
        DB[(Database)]
    end
    UI --> API
    API --> Service
    Service --> DB
```

### Sequence Diagrams

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API
    participant Database

    User->>Frontend: Submit form
    Frontend->>API: POST /data
    API->>Database: INSERT
    Database-->>API: Success
    API-->>Frontend: 200 OK
    Frontend-->>User: Show confirmation
```

### Flowcharts

```mermaid
flowchart TD
    A[Start] --> B{Is authenticated?}
    B -->|Yes| C[Show dashboard]
    B -->|No| D[Redirect to login]
    D --> E[User logs in]
    E --> B
```

### Class Diagrams

```mermaid
classDiagram
    class User {
        +string id
        +string email
        +login()
        +logout()
    }
    class Session {
        +string token
        +Date expiry
        +refresh()
    }
    User "1" --> "0..*" Session
```

### State Diagrams

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Loading: fetch
    Loading --> Success: data received
    Loading --> Error: request failed
    Success --> Idle: reset
    Error --> Loading: retry
```

## Example Usage

```bash
# Document REST API endpoints
/interactive-sdlc:document --output docs/api.md Document the REST API endpoints with request/response examples

# Create architecture overview
/interactive-sdlc:document --output docs/architecture.md Create architecture diagram showing the plugin system

# Document a feature
/interactive-sdlc:document Document the authentication flow including OAuth providers

# Create setup guide
/interactive-sdlc:document --output docs/setup.md Create a developer setup guide for the project

# Document component
/interactive-sdlc:document --output docs/components/button.md Document the Button component API and usage examples
```

## Output Format

Generated documentation follows this structure:

```markdown
# [Title]

## Overview
Brief description of what this document covers.

## [Main Sections]
Detailed content with code examples and diagrams.

### Diagrams
```mermaid
[Appropriate diagram type]
```

## Examples
Practical usage examples.

## Related
Links to related documentation.
```

## Important Notes

- Always validate mermaid syntax before saving
- Use appropriate diagram types for the content
- Include practical examples with code snippets
- Link to related documentation when available
- Run markdownlint-cli2 to ensure proper formatting
- Follow existing project documentation conventions
