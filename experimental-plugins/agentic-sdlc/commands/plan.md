---
name: plan
description: Auto-select and execute appropriate planning command
argument-hint: <task-description> [--interactive]
---

# Plan Command

Meta-command that analyzes the task description and delegates to the appropriate planning command: `plan-feature`, `plan-bug`, or `plan-chore`.

## Arguments

- **`<task-description>`** (required): Description of the task to plan
- **`--interactive`** (optional): Pass through to the selected planning command

## Objective

Automatically select the most appropriate planning command based on task analysis and execute it.

## Core Principles

- Analyze the task description to determine the correct category
- Pass through all flags to the delegated command
- Be transparent about which command was selected and why
- When uncertain, prefer the more general category

## Instructions

1. Parse the input to extract the task description and check for `--interactive` flag

2. Analyze the task description to determine the category:

   **Bug indicators** (use `/sdlc:plan-bug`):
   - Words: "fix", "bug", "error", "crash", "broken", "failing", "issue", "not working"
   - Describes unexpected behavior or deviation from expected behavior
   - References error messages or exceptions
   - Mentions reproduction steps or specific failure scenarios

   **Chore indicators** (use `/sdlc:plan-chore`):
   - Words: "refactor", "update", "upgrade", "cleanup", "remove", "deprecate", "migrate"
   - Dependency or version updates
   - Code organization or restructuring
   - Technical debt or maintenance work
   - No new user-facing functionality

   **Feature indicators** (use `/sdlc:plan-feature`):
   - Words: "add", "implement", "create", "new", "feature", "support", "enable"
   - Describes new functionality for users
   - Enhances existing capabilities
   - Default when task doesn't clearly fit bug or chore

3. Report the selected command and rationale:

   ```
   Task Type: [Feature | Bug | Chore]
   Reason: [Brief explanation of why this category was selected]
   Executing: /sdlc:plan-[type] <description> [--interactive]
   ```

4. Execute the selected command using the SlashCommand tool:
   - `/sdlc:plan-feature <description>` for features
   - `/sdlc:plan-bug <description>` for bugs
   - `/sdlc:plan-chore <description>` for chores

   Include `--interactive` flag if it was provided in the original command.

5. The delegated command will handle the rest of the planning process.

## Output Guidance

Before delegating, output:

```
## Task Analysis

**Description**: [Original task description]

**Detected Type**: [Feature | Bug | Chore]

**Indicators Found**:
- [Indicator 1]
- [Indicator 2]

**Delegating to**: `/sdlc:plan-[type]`

---
```

Then the delegated command's output follows.

## Examples

| Input                      | Detected Type | Reason                    |
| -------------------------- | ------------- | ------------------------- |
| "Add dark mode support"    | Feature       | "Add" + new functionality |
| "Fix login timeout error"  | Bug           | "Fix" + "error"           |
| "Update React to v19"      | Chore         | "Update" + dependency     |
| "Users can't submit forms" | Bug           | Describes broken behavior |
| "Refactor auth module"     | Chore         | "Refactor"                |
| "Enable SSO integration"   | Feature       | "Enable" + new capability |
