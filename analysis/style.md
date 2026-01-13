# Style & Consistency Issues

**Date**: 2026-01-13

**Scope**: Entire codebase (Python code in plugins/agentic-sdlc and experimental-plugins/agentic-core, all markdown files for commands/agents/skills)

## Summary

- Major Inconsistencies: 2 issues
- Minor Issues: 3 issues

## Project Standards

Based on analysis, the established patterns are:

- **Naming**: snake_case for functions/variables, PascalCase for classes, UPPER_CASE for constants, kebab-case for markdown files
- **Error Handling**: try/except with specific exceptions first, sys.exit(1) for CLI errors, custom Exception classes with Error suffix
- **Async**: Not applicable (no async patterns in current codebase)
- **Imports**: `from __future__ import annotations` first, then stdlib, third-party, local imports with blank lines between groups
- **Type Hints**: Modern Python 3.10+ syntax (X | None, dict[str, Any]), all public functions annotated
- **Docstrings**: Module-level docstrings present, function docstrings with Args/Returns sections (variable coverage)
- **String Formatting**: f-strings used consistently throughout
- **File Naming**: Commands/agents/skills use kebab-case (.md files)

## Major Inconsistencies

### STYLE-001: Inconsistent YAML library usage

**Severity**: Major

**Location:**
- plugins/agentic-sdlc/src/agentic_sdlc/parser.py
- experimental-plugins/agentic-core/src/agentic_core/workflow/parser.py

**Issue:** Different YAML parsing libraries are used across plugins:
- `agentic-sdlc` uses the standard library `yaml` (PyYAML)
- `agentic-core` uses `ruamel.yaml`

This creates inconsistency in YAML parsing behavior, features available, and dependencies. While both libraries work, using different libraries for the same purpose creates maintenance burden and potential compatibility issues.

**Standard:** Use a single YAML library across all plugins. The project should standardize on one approach.

**Fix:**
1. Determine which library is preferred (ruamel.yaml offers better YAML 1.2 support and preserves formatting)
2. Update all plugins to use the same library
3. Add a comment in CLAUDE.md documenting the chosen library and rationale

---

### STYLE-002: Inconsistent CLI framework

**Severity**: Major

**Location:**
- plugins/agentic-sdlc/src/agentic_sdlc/cli.py (uses argparse)
- experimental-plugins/agentic-core/src/agentic_core/cli.py (uses typer)

**Issue:** Different command-line interface frameworks are used:
- `agentic-sdlc` uses `argparse` (Python standard library)
- `agentic-core` uses `typer` (third-party library with rich features)

This creates inconsistent user experience, different error handling patterns, and different API patterns for adding new commands.

**Standard:** Use a single CLI framework across all plugins for consistency.

**Fix:**
1. If this is intentional (experimental plugins testing new approaches), document it in CLAUDE.md
2. Otherwise, standardize on one framework:
   - Option A: Use `argparse` (stdlib, no deps, stable)
   - Option B: Use `typer` (better UX, auto-completion, type hints)
3. Update the non-conforming plugin

---

## Minor Issues

### STYLE-003: Inconsistent configuration file location

**Severity**: Minor

**Location:**
- plugins/agentic-sdlc (uses agentic/config.json in project root)
- interactive-sdlc references (uses .claude/settings.json)

**Issue:** Different configuration file locations and naming conventions:
- `agentic-sdlc` creates `agentic/config.json` at project root
- Other plugins reference `.claude/settings.json`

This creates confusion about where configuration lives and makes it harder for users to find settings.

**Standard:** Standardize configuration location. The `.claude/settings.json` approach appears to be the Claude Code standard.

**Fix:**
1. Document the configuration file standard in CLAUDE.md
2. Consider migrating `agentic-sdlc` to use `.claude/settings.json` with plugin-specific keys
3. Or document why `agentic/config.json` is needed and when to use each

---

### STYLE-004: Variable docstring coverage in CLI command functions

**Severity**: Minor

**Location:** plugins/agentic-sdlc/src/agentic_sdlc/cli.py

**Issue:** CLI command functions have inconsistent docstring coverage. Some command handler functions lack docstrings or have minimal documentation, while other parts of the codebase have thorough docstrings with Args/Returns sections.

Example in cli.py - command functions like `cmd_plan()`, `cmd_build()`, etc. have no or minimal docstrings.

**Standard:** All public functions should have docstrings with Args/Returns sections as seen in other modules like `providers/base.py` in agentic-core.

**Fix:**
1. Add docstrings to all CLI command functions
2. Include Args and Returns sections
3. Document what each command does and its parameters

---

### STYLE-005: Frontmatter field variations between commands and skills

**Severity**: Minor

**Location:**
- plugins/agentic-sdlc/commands/*.md (use `arguments` list)
- plugins/agentic-sdlc/skills/*.md (use `argument-hint` string)

**Issue:** Commands and skills use different frontmatter fields for documenting arguments:
- Commands use structured `arguments` array with name/description/required fields
- Skills use freeform `argument-hint` string

While this might be intentional based on usage patterns, it creates inconsistency in how arguments are documented.

**Standard:** If the difference is intentional (commands need structured parsing, skills need flexible hints), document this in the template files or CLAUDE.md.

**Fix:**
1. Review whether this difference is intentional and necessary
2. If intentional, add comments in `docs/templates/command-template.md` and `docs/templates/skill-template.md` explaining when to use each
3. If not intentional, standardize on one approach

---

## Positive Findings

The codebase demonstrates excellent style consistency in several areas:

1. **Perfect naming conventions**: Zero violations found - all Python code uses snake_case/PascalCase/UPPER_CASE correctly, all markdown files use kebab-case
2. **Modern Python syntax**: Consistent use of Python 3.10+ type hints (X | None instead of Optional[X])
3. **Import organization**: All 17 Python files use `from __future__ import annotations` and follow consistent import ordering
4. **Type annotations**: Excellent coverage with modern syntax throughout
5. **String formatting**: Consistent use of f-strings, no old-style formatting
6. **File organization**: Clear module boundaries and consistent directory structure
7. **Markdown structure**: Well-formatted with consistent section headings and code blocks

## Recommendations

### High Priority

1. **Document intentional differences**: Add a section to CLAUDE.md explaining:
   - Why different YAML libraries are used (if intentional)
   - Why different CLI frameworks are used (experimental vs stable plugin philosophy)
   - Configuration file location standards

2. **Standardize libraries**: If the differences are not intentional, standardize on:
   - Single YAML library (recommend ruamel.yaml for better YAML 1.2 support)
   - Single CLI framework (recommend typer for better UX, or argparse for zero deps)

### Medium Priority

3. **Improve docstring coverage**: Add comprehensive docstrings to CLI command functions with Args/Returns sections

4. **Document configuration patterns**: Create clear guidelines for where configuration files should live

### Low Priority

5. **Create STYLE.md guide**: Document the established patterns and conventions for contributors

## Conclusion

The agentic-forge codebase shows **excellent overall style consistency**. The major inconsistencies identified (STYLE-001 and STYLE-002) appear to be differences between experimental and stable plugins, which may be intentional architectural choices rather than style violations.

**Key strengths:**
- Zero naming convention violations across entire codebase
- Perfect adherence to modern Python type hints and syntax
- Consistent import organization and code structure
- Well-formatted markdown documentation

**Recommendation:** Document the intentional differences in CLAUDE.md, add docstrings to CLI functions, and consider creating a STYLE.md guide for contributors.
