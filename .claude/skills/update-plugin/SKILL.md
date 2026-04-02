---
name: update-plugin
description: Update agentic-forge version based on changes from main branch
---

# Update Version

## Overview

Analyze changes in the current branch compared to main and update the agentic-forge package version accordingly. Detects the nature of changes, updates the CHANGELOG, and updates the version number in `pyproject.toml` following semantic versioning.

## Core Principles

- Follow semantic versioning (MAJOR.MINOR.PATCH)
- MAJOR: Breaking changes, API changes, removed features
- MINOR: New commands, new functions, new capabilities
- PATCH: Bug fixes, documentation updates, minor improvements
- Update CHANGELOG before updating version numbers

## Instructions

1. **Analyze Changes**

   Run `git diff main...HEAD --name-only` to get all changed files.

   Examine the diff to determine the change type:
   - **MAJOR** (breaking changes): API changes, removed features, incompatible changes
   - **MINOR** (new features): New commands, new skills, new capabilities
   - **PATCH** (bug fixes): Bug fixes, documentation updates, minor improvements

   Use `git diff main...HEAD -- src/` to see the specific changes.

2. **Version Update Rules**

   Current version format: `MAJOR.MINOR.PATCH`
   - MAJOR: Increment first number, reset others to 0 (e.g., 1.2.3 -> 2.0.0)
   - MINOR: Increment second number, reset patch to 0 (e.g., 1.2.3 -> 1.3.0)
   - PATCH: Increment third number (e.g., 1.2.3 -> 1.2.4)

3. **Update CHANGELOG**

   Update `CHANGELOG.md` at the repo root with the new version entry:

   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### Added

   - New feature or command (if applicable)

   ### Changed

   - Modified behavior or updated functionality (if applicable)

   ### Fixed

   - Bug fix description (if applicable)

   ### Removed

   - Removed feature or command (if applicable)
   ```

   Guidelines:
   - Use today's date in YYYY-MM-DD format
   - Only include relevant sections (Added, Changed, Fixed, Removed)
   - Keep entries concise using bullet points
   - Place new version entry at the top, below the header

4. **Update Version in pyproject.toml**

   Update the `version` field in `pyproject.toml` at the repo root:

   ```toml
   [project]
   version = "X.Y.Z"
   ```

5. **Commit Version Updates**

   Use the /git-commit command to commit with message format:

   ```
   Bump agentic-forge version to X.Y.Z (<change-type>)
   ```

## Output Guidance

Report the analysis and version changes:

```
## Version Update

### Changes Detected
- Change type: [MAJOR|MINOR|PATCH]
- Files changed: X

### CHANGELOG Update
- Added entry for vX.Y.Z

### Version Update Applied
| Location | Old Version | New Version |
|----------|-------------|-------------|
| pyproject.toml | 1.0.0 | 1.1.0 |

### Commit
[Commit hash and message]
```
