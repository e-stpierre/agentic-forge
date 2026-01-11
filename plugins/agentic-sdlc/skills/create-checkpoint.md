---
name: create-checkpoint
description: Create a checkpoint to track progress and share context
argument-hint: "--step <name> --status <status> <context>"
---

# Create Checkpoint

## Definition

Record progress and provide context for future sessions or other agents. Use this skill when completing milestones, handing off work, encountering issues, or reaching natural pause points.

## Arguments

- **`--step`** (required): Current step name (e.g., build, validate)
- **`--status`** (required): Checkpoint status - in_progress | completed
- **`<context>`** (required): Summary of current situation and progress

## Objective

Create a checkpoint entry that captures the current workflow state for resumption or handoff.

## Core Principles

- Checkpoints are append-only within a workflow
- Include enough context for seamless resumption
- Note any blockers or issues discovered
- Track progress with markdown checklists

## Instructions

1. Identify the current workflow ID from context
2. Parse the step name and status
3. Generate checkpoint ID (chk-NNN)
4. Create checkpoint entry with:
   - Context summary
   - Progress checklist
   - Notes for next session
   - Issues discovered
5. Save to `agentic/outputs/{workflow-id}/checkpoint.md`
6. Return confirmation with checkpoint ID

## Output Guidance

Return JSON confirmation:

```json
{
  "success": true,
  "checkpoint_id": "chk-001",
  "workflow_id": "abc123"
}
```

### Checkpoint File Format

Checkpoints are stored in `agentic/outputs/{workflow-id}/checkpoint.md`:

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
