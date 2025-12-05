---
name: update-plugin
description: Update plugin versions based on changes from main branch
argument-hint:
---

# Update Plugin Version Command

Analyze changes in the current branch compared to main and update plugin versions accordingly.

## Instructions

1. **Detect Changed Plugins**

   Run `git diff main...HEAD --name-only` to get all changed files.

   Identify which plugins have changes by looking for files under `plugins/*/` directories.

2. **Analyze Changes for Each Plugin**

   For each changed plugin, examine the diff to determine the change type:
   - **MAJOR** (breaking changes): API changes, removed features, incompatible changes
   - **MINOR** (new features): New commands, new functions, new capabilities
   - **PATCH** (bug fixes): Bug fixes, documentation updates, minor improvements

   Use `git diff main...HEAD -- plugins/<plugin-name>/` to see the specific changes.

3. **Version Update Rules**

   Current version format: `MAJOR.MINOR.PATCH`
   - MAJOR: Increment first number, reset others to 0 (e.g., 1.2.3 -> 2.0.0)
   - MINOR: Increment second number, reset patch to 0 (e.g., 1.2.3 -> 1.3.0)
   - PATCH: Increment third number (e.g., 1.2.3 -> 1.2.4)

4. **Files to Update**

   For each changed plugin, update the version in:
   - `.claude-plugin/marketplace.json` - Find the plugin entry and update its `version` field
   - `plugins/<plugin-name>/pyproject.toml` (if exists) - Update the `version` field in `[project]` section

   If the marketplace itself has structural changes (not just plugin updates), also update the root `version` in marketplace.json.

5. **Update Description/README (Optional)**

   Only update the plugin description in marketplace.json if:
   - New major features warrant a description change
   - The current description is inaccurate

   Do NOT update descriptions for patch-level changes.

6. **Commit the Version Updates**

   After updating all versions, commit with message:

   ```
   Bump <plugin-name> version to X.Y.Z (<change-type>)
   ```

   If multiple plugins changed:

   ```
   Bump plugin versions

   - <plugin1>: X.Y.Z (minor)
   - <plugin2>: A.B.C (patch)
   ```

## Execution

Proceed with the analysis and updates now. Report your findings and the version changes made.
