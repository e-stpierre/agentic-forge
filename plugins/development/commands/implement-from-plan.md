---
name: implement-from-plan
description: Implement changes based on a plan file
argument-hint: <plan-file-path>
---

# Implement From Plan Command

Reads a plan file and executes the implementation steps described within it.

## Parameters

- **`plan-file-path`** (required): Path to the markdown plan file

## Objective

Execute all implementation steps defined in the plan file to complete the described changes.

## Core Principles

- Follow the plan exactly as written
- Do not make changes beyond what the plan specifies
- Report any deviations or issues encountered
- Verify against the validation criteria in the plan
- Use the Edit tool for file modifications

## Instructions

1. Read the plan file at the specified path using the Read tool
2. Parse the plan structure to identify:
   - What changes need to be made (from "Content to Add" section)
   - Which files to modify (typically README.md)
   - The exact content to add
   - Where to add it (from "Location" section)
3. Read the target file (README.md) to understand its current structure
4. Execute the implementation steps in order:
   - Find the insertion point as specified in the plan
   - Add the content exactly as specified in "Content to Add"
5. Verify the changes against the validation criteria in the plan
6. Report completion status

## Output Guidance

Report the following:

- Steps completed (numbered list)
- Files modified (with paths)
- Validation results (checklist from plan)
- Any issues encountered

Example output format:

```
## Implementation Complete

### Steps Completed
1. Read plan file at docs/plans/readme-feature-plan.md
2. Read current README.md
3. Found insertion point: end of file
4. Added "Feature" section with 3 key points

### Files Modified
- README.md

### Validation
- [x] Section "Feature" appears in README.md
- [x] Section contains all three key points
- [x] Markdown renders correctly
- [x] Content matches plan exactly

### Status
Implementation successful. All validation criteria met.
```
