# Run Workflow Examples

## Improvements

```
agentic-sdlc run ralph-loop.yaml --var "max_iterations=20" --var "completion_promise=COMPLETED" --var "task=Follow the improvement plan agentic\improvements.md. Each iteration: read the plan, select the next uncompleted task from ## Progress Tracking, implement it, mark as completed, commit with /git-commit (title starting with task id like [IMP-001]), then STOP. Do NOT continue to the next task - just stop working and the loop will start a new iteration. If a task cannot be completed, mark it with a reason and STOP. The completion promise should ONLY be returned when EVERY task in the plan is marked [x] completed - not after a single task."
```
