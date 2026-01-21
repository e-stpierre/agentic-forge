---
name: create-gh-issue
description: Create a GitHub issue with title, body, and labels
argument-hint: "<title>" [--body <body>] [--labels <labels>] [--milestone <milestone>]
arguments:
  - name: title
    description: The issue title
    required: true
  - name: body
    description: The issue body/description
    required: false
  - name: labels
    description: Comma-separated list of labels to apply
    required: false
  - name: milestone
    description: Milestone to assign the issue to
    required: false
  - name: assignee
    description: GitHub username to assign (use @me for self)
    required: false
---

# Create GitHub Issue Command

Creates a GitHub issue in the current repository using the GitHub CLI.

## Arguments

- **`"<title>"`** (required): The issue title (in quotes if it contains spaces)
- **`--body <body>`** (optional): The issue body/description
- **`--labels <labels>`** (optional): Comma-separated list of labels to apply
- **`--milestone <milestone>`** (optional): Milestone to assign the issue to
- **`--assignee <assignee>`** (optional): GitHub username to assign (use `@me` for self)

## Objective

Create a well-formed GitHub issue using the `gh` CLI tool, returning the issue URL for reference.

## Core Principles

- Verify `gh` CLI is available and authenticated before attempting creation
- Validate required parameters before executing
- Use proper escaping for special characters in title and body
- Return the created issue URL for use in workflows

## Instructions

1. Verify the `gh` CLI is available by running `gh --version`

2. Parse the title and optional parameters from the command input

3. Build the `gh issue create` command with provided parameters:

   ```
   gh issue create --title "<title>" [--body "<body>"] [--label "<labels>"] [--milestone "<milestone>"] [--assignee "<assignee>"]
   ```

4. Execute the command and capture the output

5. If successful, extract and return the issue URL from the output

6. If creation fails, report the error and suggest fixes (authentication, permissions, etc.)

## Output Guidance

On success, output:

- Confirmation message with issue number
- Full URL to the created issue
- Applied labels and milestone (if any)

On failure, output:

- Clear error message
- Suggested remediation steps

## Examples

```bash
/interactive-sdlc:create-gh-issue "Fix login bug" --body "Users cannot login with Safari" --labels bug,priority-high

/interactive-sdlc:create-gh-issue "Add dark mode support" --labels enhancement,ui --milestone "v2.0"

/interactive-sdlc:create-gh-issue "Update documentation" --body "README needs examples" --assignee @me
```
