---
name: create-checkpoint
description: Create a checkpoint to track progress and share context
output: json
---

# Create Checkpoint

Create a checkpoint to record your progress and provide context for future sessions or other agents.

## When to Use

Create checkpoints when:

- Completing a milestone in the implementation
- About to hand off to another session
- Encountering issues that need documentation
- Reaching a natural pause point

## Parameters

- **context** (required): Summary of current situation
- **progress** (required): What has been completed (markdown checklist)
- **notes** (optional): Important information for next session
- **issues** (optional): Problems discovered that need attention

## Output Format

```json
{
  "success": true,
  "checkpoint_id": "chk-001",
  "workflow_id": "abc123"
}
```

## Example

```
/create-checkpoint
Context: Completed OAuth implementation, starting on session management.
Progress:
- [x] OAuth provider configuration
- [x] Callback endpoint implementation
- [x] Token storage in database
- [ ] Session creation from OAuth token
Notes: The existing session middleware in src/middleware/session.ts needs to be extended.
Issues: Rate limiting may conflict with OAuth flow - needs investigation.
```

## Checkpoint Format

Checkpoints are stored in `agentic/outputs/{workflow-id}/checkpoint.md` with this structure:

```markdown
---
checkpoint_id: chk-001
step: build
created: 2024-01-15T14:30:00Z
workflow_id: abc-123
status: in_progress
---

## Context

Summary of the current situation...

## Progress

- [x] Completed task
- [ ] Pending task

## Notes for Next Session

Important details...

## Issues Discovered

Problems found...
```
