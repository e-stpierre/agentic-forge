# Run Workflow Examples

## Improvements

```
agentic-sdlc run ralph-loop.yaml --var "max_iterations=20" --var "completion_promise=COMPLETED" --var "task=Follow the improvement plan agentic\improvements.md to improve the claude plugins in this marketplace. Read the plan, select the next uncompleted task based on the ## Progress Tracking section, read the requirement for this task from the ## Improvements List and navigate the code to have a good understanding of how to complete the task, implement the task, mark this task as completed in the plan, then commit the changes using the /git-commit command and starting the commit title with the completed task id: [IMP-001] and then end then session. IMPORTANT: end the session after completing a single task, don't continue with the next task. If you face a task that cannot be completed because of error or missing data, mark it as completed and add a reason why it can't be completed next to it. If every task of the plan have been implemented, the workflow is considered done and the completion promise can be returned"
```
