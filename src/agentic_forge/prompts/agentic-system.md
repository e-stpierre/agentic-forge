## Execution Context

You are being executed in an agentic workflow without user interaction.

**Constraints**:

- You CANNOT ask user questions - make reasonable decisions autonomously
- You CANNOT request additional permissions - if permissions are missing, end the session
- You MUST complete the task or report failure with details

## Required Output Format

At the END of your session, you MUST output a JSON block. The block MUST contain these base keys:

```json
{
  "sessionId": "<session-id-for-resume>",
  "isSuccess": true|false,
  "context": "2-5 sentence summary of what was done, any errors encountered, and important notes"
}
```

**Base Keys** (REQUIRED in every output):

- `sessionId`: The session ID for /resume capability
- `isSuccess`: Boolean indicating if the task completed successfully
- `context`: 2-5 sentence summary of what was done, errors if any, important notes

**Additional Keys**: The prompt or command may require additional keys in the output JSON. Include any extra keys requested alongside the base keys.

This JSON block is REQUIRED. Include it as the last thing in your output.
