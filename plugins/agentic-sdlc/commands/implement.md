---
name: implement
description: Implement changes from a plan (autonomous, JSON I/O)
argument-hint: --json-input <plan.json> | --json-stdin
---

# Implement Command (Autonomous)

Implements changes from a plan file. Operates autonomously without user interaction.

## Input Schema

```json
{
  "plan_file": "/specs/feature-auth.md",
  "plan_data": {
    "milestones": [...],
    "tasks": [...]
  },
  "checkpoint": "Milestone 2",
  "git_commit": true
}
```

## Output Schema

```json
{
  "success": true,
  "completed_tasks": ["t1.1", "t1.2", "t2.1", "t2.2"],
  "changes": [
    {"file": "src/auth.ts", "action": "created", "lines_added": 150},
    {"file": "src/config.ts", "action": "modified", "lines_changed": 25}
  ],
  "commits": [
    {"hash": "abc123", "message": "feat: add OAuth configuration"},
    {"hash": "def456", "message": "feat: implement OAuth handlers"}
  ],
  "ambiguities": [],
  "errors": []
}
```

## Behavior

1. **Parse Input**
   - Read plan file or plan data from JSON
   - Parse milestone/task structure
   - Handle checkpoint to resume from specific point

2. **Create Todo List**
   - Use TodoWrite tool for progress tracking
   - Mark checkpoint-completed tasks if resuming

3. **Implement Tasks**
   - Work through tasks sequentially
   - Make required code changes
   - If ambiguity found, log in output (don't ask user)
   - Mark tasks complete

4. **Git Commits (if git_commit: true)**
   - Commit after each milestone
   - Use conventional commit messages from plan

5. **Output JSON**
   - Return completion status
   - List all changes made
   - Include any ambiguities found

## Ambiguity Handling

When implementation is ambiguous, don't ask user. Instead:

1. Log the ambiguity in output JSON
2. Make reasonable assumption based on codebase patterns
3. Document assumption in code comment
4. Continue with next task

```json
{
  "ambiguities": [
    {
      "task": "t2.1",
      "issue": "Unclear error handling strategy",
      "assumption": "Following existing pattern from src/utils/errors.ts",
      "action_taken": "Used ErrorBoundary pattern"
    }
  ]
}
```

## Error Handling

```json
{
  "success": false,
  "error": "Failed to implement task t1.2",
  "error_code": "IMPLEMENTATION_FAILED",
  "completed_tasks": ["t1.1"],
  "failed_task": "t1.2"
}
```

## Usage

```bash
/agentic-sdlc:implement --json-input /specs/build-input.json
```

## Python Integration

```python
result = run_claude("/agentic-sdlc:implement", json_input={
    "plan_file": "/specs/feature-auth.md",
    "git_commit": True
})

for commit in result["commits"]:
    print(f"{commit['hash']}: {commit['message']}")
```
