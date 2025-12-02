---
name: create-readme-plan
description: Create a simple plan for README modifications
argument-hint: <feature-name>
---

# Create README Plan Command

Creates a simple implementation plan for adding a new section to the README.

## Parameters

- **`feature-name`** (required): Name of the feature/section to add

## Objective

Generate a markdown plan file that describes how to modify the README to add a new section.

## Core Principles

- Create actionable, specific plans
- Use the exact template structure provided
- Save to the docs/plans directory
- Replace placeholders with actual feature name

## Instructions

1. Parse the feature name from the argument
2. Create the docs/plans directory if it doesn't exist using Bash: `mkdir -p docs/plans`
3. Generate the plan content using the template below, replacing `{{feature-name}}` with the actual feature name
4. Save the plan to `docs/plans/readme-[feature-name-kebab-case]-plan.md`
5. Confirm the plan location and summarize contents

## Plan Template

Generate exactly this structure (replace `{{feature-name}}` with the actual name):

```markdown
# README Modification Plan: {{feature-name}}

## Overview

Add a new section called "{{feature-name}}" to the README.md file.

## Content to Add

### {{feature-name}}

This section describes {{feature-name}} functionality.

Key points:

- Point 1 about {{feature-name}}
- Point 2 about {{feature-name}}
- Point 3 about {{feature-name}}

## Location

Add this section before the "License" section, or at the end if no License section exists.

## Implementation Steps

1. Read the current README.md file
2. Find the appropriate insertion point (before License or at end)
3. Add the new section content exactly as specified above
4. Verify the markdown is valid

## Validation

- [ ] Section "{{feature-name}}" appears in README.md
- [ ] Section contains all three key points
- [ ] Markdown renders correctly
- [ ] Content matches this plan exactly
```

## Output Guidance

After creating the plan file, output:

- The full path to the created plan file
- A brief summary confirming the plan was created
- The feature name that was used
