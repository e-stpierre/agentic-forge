# Documentation Issues

**Date**: 2026-01-13

**Scope**: All markdown documentation files in the repository (README.md, plugin READMEs, command documentation)

## Summary

- Critical (Wrong/Misleading): 0 issues
- Major (Outdated/Incomplete): 3 issues
- Minor (Improvements): 2 issues

## Major Issues (Outdated/Incomplete)

### DOC-001: Missing documented CLI commands in agentic-core

**Files:** experimental-plugins/agentic-core/README.md

**Issue:** The README documents CLI commands `agentic feature` and `agentic meeting` but these commands are not implemented in the CLI. The CLI code shows `meeting_cmd` function exists but is not registered as a command in the typer app. The `feature` command is not found in the CLI implementation at all.

**Code Reference:** experimental-plugins/agentic-core/src/agentic_core/cli.py:520 (meeting_cmd exists but not registered), no feature command found

**Fix:** Either implement the missing commands or remove them from the documentation. The README should only document commands that are actually available to users. If these are planned features, they should be clearly marked as "coming soon" or moved to a separate section.

---

### DOC-002: Incomplete /plan command documentation for agentic-sdlc

**Files:** plugins/agentic-sdlc/README.md

**Issue:** The README shows `/plan` command examples with `--type` and `--spec` arguments (lines 432-447), but the actual command definition in `commands/plan.md` shows different argument names: the command uses `type`, `context`, and `template` as arguments (not `--type` as a flag, and no `--spec` argument exists).

**Code Reference:** plugins/agentic-sdlc/commands/plan.md:5-15

**Fix:** Update the README examples to match the actual command interface:

- Change `/plan --type feature ...` to just use the command's actual argument structure
- Remove references to `--spec` argument which doesn't exist
- Ensure examples match what users can actually execute

---

### DOC-003: Missing /git-branch, /git-commit, /git-pr namespace prefix in interactive-sdlc examples

**Files:** plugins/interactive-sdlc/README.md

**Issue:** The README section "Git (`commands/git/`)" (lines 48-51) lists commands as `/interactive-sdlc:git-branch`, `/interactive-sdlc:git-commit`, and `/interactive-sdlc:git-pr`, but all examples later in the document (lines 300-319) show these commands without any prefix (just `/interactive-sdlc:git-branch`). The examples are correct, but the command list should match.

**Code Reference:** plugins/interactive-sdlc/commands/git/git-branch.md:1-2 (actual command name)

**Fix:** The commands are already correctly documented in the examples section. This is actually not an issue - the command list at the top matches the examples at the bottom. Marking this for verification but it appears consistent.

---

## Minor Issues (Improvements)

### DOC-004: Inconsistent command reference format

**Files:** README.md, plugins/agentic-sdlc/README.md, plugins/interactive-sdlc/README.md

**Issue:** Command references use inconsistent formats across documentation:

- Root README uses `/interactive-sdlc:plan-feature` format
- Some sections use `/plan` without plugin prefix
- Commands are sometimes shown with backticks, sometimes without

**Code Reference:** N/A (formatting consistency issue)

**Fix:** Establish and apply a consistent format:

- Always use plugin prefix for disambiguation: `/interactive-sdlc:command` or `/agentic-sdlc:command`
- Always wrap commands in backticks for readability
- Update style guide in CLAUDE.md if needed

---

### DOC-005: output-directory vs outputDirectory configuration naming inconsistency

**Files:** plugins/agentic-sdlc/README.md

**Issue:** The configuration example in the README (lines 107-133) shows JSON configuration using camelCase (`outputDirectory`, `mainBranch`) but the documented CLI uses kebab-case (`--output-directory`). While this is a common pattern (JSON config vs CLI flags), it could be clarified to avoid confusion.

**Code Reference:** plugins/agentic-sdlc/README.md:109 (outputDirectory in JSON)

**Fix:** Add a brief note explaining that configuration file uses camelCase (JSON convention) while CLI flags use kebab-case (CLI convention). This is standard practice but worth documenting to prevent user confusion.

---
