# Implementation Plan: Agentic Forge Distribution Overhaul

**Objective**: Transform agentic-forge from a Claude Code marketplace plugin into a standalone Python package that dynamically loads skills via `--add-dir`.

**Type**: Feature (Major Restructuring)  
**Complexity**: High  
**Status**: Not Started

---

## Progress

### Implementation

- [ ] Milestone 1: Repository Structure Overhaul
  - [ ] Task 1.1: Move Python source to repo root
  - [ ] Task 1.2: Rename package from agentic_sdlc to agentic_forge
  - [ ] Task 1.3: Update all Python imports
  - [ ] Task 1.4: Bundle skills as package data
- [ ] Milestone 2: Bundle Prompts, Workflows, and Agents
  - [ ] Task 2.1: Move prompts directory
  - [ ] Task 2.2: Move workflows directory
  - [ ] Task 2.3: Add agent path resolution fallback
  - [ ] Task 2.4: Remove marketplace artifacts
- [ ] Milestone 3: Update Python Package Configuration
  - [ ] Task 3.1: Create new root pyproject.toml
  - [ ] Task 3.2: Verify package data inclusion
  - [ ] Task 3.3: Test build output
- [ ] Milestone 4: Update Runner and CLI
  - [ ] Task 4.1: Modify runner.py to use --add-dir
  - [ ] Task 4.2: Update system prompt path resolution
  - [ ] Task 4.3: Create skills-dir CLI command
  - [ ] Task 4.4: Update update and init commands
- [ ] Milestone 5: Update Workflow References
  - [ ] Task 5.1: Remove agentic-sdlc: prefix from all skill references
  - [ ] Task 5.2: Audit and update all workflow YAML files
  - [ ] Task 5.3: Update any documentation examples
- [ ] Milestone 6: Documentation Update
  - [ ] Task 6.1: Rewrite README.md for new distribution
  - [ ] Task 6.2: Update CLAUDE.md project instructions
  - [ ] Task 6.3: Update CHANGELOG.md with v1.0.0 notes
- [ ] Milestone 7: Final Validation and Cleanup
  - [ ] Task 7.1: Update CI/CD pipelines
  - [ ] Task 7.2: End-to-end validation
  - [ ] Task 7.3: Final cleanup and verification

### Validation

- [ ] Package builds successfully with `uv build`
- [ ] `uv tool install .` works from repo root
- [ ] `agentic-forge run plan-build-review` executes workflows
- [ ] Skills are available in spawned Claude sessions
- [ ] Agent loading works from bundled package path
- [ ] `agentic-forge skills-dir` outputs correct path
- [ ] `claude --add-dir $(agentic-forge skills-dir)` makes skills available
- [ ] All tests pass
- [ ] No import errors or runtime issues

---

## Milestones

### Milestone 1: Repository Structure Overhaul

**Goal**: Flatten the plugin directory structure and rename the Python package.

**Context**: Currently, code is nested in `plugins/agentic-sdlc/src/agentic_sdlc/`. We need to move it to `src/agentic_forge/` at the repo root and update all internal references.

#### Task 1.1: Move Python source to repo root

Move the Python package from nested plugin structure to repo root:
- Move `plugins/agentic-sdlc/src/agentic_sdlc/` → `src/agentic_forge/`
- Move `plugins/agentic-sdlc/tests/` → `tests/`
- Preserve all subdirectories and files under agentic_sdlc (rename to agentic_forge)

**Acceptance**: Both directories exist at new locations with all files intact.

#### Task 1.2: Rename package from agentic_sdlc to agentic_forge

Rename the Python package directory and all its internal structure:
- Rename `src/agentic_forge/` internal module references if any
- Update `__init__.py` and package metadata

**Acceptance**: Package can be imported as `import agentic_forge`

#### Task 1.3: Update all Python imports

Perform global find-and-replace across all Python files in `src/` and `tests/`:
- `import agentic_sdlc` → `import agentic_forge`
- `from agentic_sdlc` → `from agentic_forge`
- CLI entry point: `agentic-sdlc` → `agentic-forge`

**Acceptance**: All Python files compile without import errors.

#### Task 1.4: Bundle skills as package data

Create `src/agentic_forge/claude/.claude/skills/` directory structure:
- Copy all 13 skill directories from `plugins/agentic-sdlc/skills/` to the new location
- Preserve each skill's subdirectories (references/, templates/, etc.)

**Acceptance**: All skills exist in the new bundled location with identical structure.

---

### Milestone 2: Bundle Prompts, Workflows, and Agents

**Goal**: Bundle system prompts, workflows, and agents as package data with proper path resolution.

**Context**: These resources are currently loaded relative to the repo root or plugin directory. We need to move them into the package and update path resolution.

#### Task 2.1: Move prompts directory

- Move `plugins/agentic-sdlc/prompts/` → `src/agentic_forge/prompts/`
- Verify `agentic-system.md` and any other prompts are included

**Acceptance**: Prompts exist at new location.

#### Task 2.2: Move workflows directory

- Workflows already exist at `src/agentic_sdlc/workflows/`
- Rename/verify they're at `src/agentic_forge/workflows/`

**Acceptance**: Workflows accessible from new package location.

#### Task 2.3: Add agent path resolution fallback

Update `src/agentic_forge/*/prompt_step.py` (or similar agent-loading code):
- Add fallback resolution: if agent file not found relative to repo root, check package directory
- Implementation:
  ```python
  agent_path = context.repo_root / step.agent
  if not agent_path.exists():
      agent_path = Path(__file__).parent / "agents" / Path(step.agent).name
  ```
- Move agent `.md` files from `plugins/agentic-sdlc/agents/` → `src/agentic_forge/agents/`

**Acceptance**: Agents resolve correctly from both user-provided and bundled locations.

#### Task 2.4: Remove marketplace artifacts

- Delete `.claude-plugin/` directory
- Delete `plugins/` directory (after all migrations complete)
- Remove marketplace references from README and docs

**Acceptance**: No marketplace artifacts remain; repo is clean.

---

### Milestone 3: Update Python Package Configuration

**Goal**: Create a proper Python package configuration for standalone distribution.

**Context**: Currently there's a pyproject.toml in `plugins/agentic-sdlc/`. We need a new root-level pyproject.toml.

#### Task 3.1: Create new root pyproject.toml

Create `/pyproject.toml` with:
```toml
[project]
name = "agentic-forge"
version = "1.0.0"
description = "Workflow orchestration engine with bundled skills for Claude Code"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
    "pyyaml>=6.0",
    "jinja2>=3.1",
    "filelock>=3.12",
]

[project.scripts]
agentic-forge = "agentic_forge.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/agentic_forge"]
```

**Acceptance**: File exists and is valid TOML.

#### Task 3.2: Verify package data inclusion

- Ensure Hatch includes `.md`, `.yaml`, and other non-Python files
- Add explicit inclusion rules in pyproject.toml if needed:
  ```toml
  [tool.hatch.build.targets.wheel.force-include]
  "src/agentic_forge/claude" = "agentic_forge/claude"
  "src/agentic_forge/prompts" = "agentic_forge/prompts"
  "src/agentic_forge/workflows" = "agentic_forge/workflows"
  "src/agentic_forge/agents" = "agentic_forge/agents"
  ```

**Acceptance**: Configuration includes all package data.

#### Task 3.3: Test build output

- Run `uv build` and verify wheel is created
- Extract wheel and verify all bundled files are present (skills, prompts, workflows, agents)

**Acceptance**: Build succeeds; wheel contains all expected files.

---

### Milestone 4: Update Runner and CLI

**Goal**: Modify runner to use `--add-dir` and provide user access to bundled skills.

**Context**: The runner currently doesn't pass `--add-dir` to Claude sessions. We need to update it and create a CLI command for accessing the skills directory.

#### Task 4.1: Modify runner.py to use --add-dir

In `src/agentic_forge/runner.py` (or equivalent):
- Add `SKILLS_DIR = Path(__file__).parent / "claude"`
- In `run_claude()` function, add `--add-dir` flag:
  ```python
  cmd = [claude_path, "--print"]
  cmd.extend(["--add-dir", str(SKILLS_DIR)])
  ```

**Acceptance**: All Claude sessions spawned include `--add-dir` pointing to bundled skills.

#### Task 4.2: Update system prompt path resolution

In `runner.py` (line ~216):
- Old: `AGENTIC_SYSTEM_PROMPT_FILE = Path(__file__).parent.parent.parent / "prompts" / "agentic-system.md"`
- New: `AGENTIC_SYSTEM_PROMPT_FILE = Path(__file__).parent / "prompts" / "agentic-system.md"`

**Acceptance**: System prompt loads from bundled location.

#### Task 4.3: Create skills-dir CLI command

Add a new command to `src/agentic_forge/cli.py` (or appropriate CLI module):
```bash
$ agentic-forge skills-dir
/path/to/agentic_forge/claude
```

Implementation:
```python
def skills_dir():
    skills_path = Path(__file__).parent / "claude"
    print(skills_path)
```

**Acceptance**: Command exists and returns correct path.

#### Task 4.4: Update update and init commands

- Update `update` command to use `uv tool upgrade agentic-forge` instead of marketplace update
- Update `init` command to resolve workflow paths from new package location (should work already since workflows are at `src/agentic_forge/workflows/`)

**Acceptance**: Both commands work with new package structure.

---

### Milestone 5: Update Workflow References

**Goal**: Remove `agentic-sdlc:` plugin prefix from all skill references in workflows.

**Context**: Skills loaded via `--add-dir` don't have a plugin prefix. All workflow YAML files need to be updated.

#### Task 5.1: Remove agentic-sdlc: prefix from skill references

Find all files in `src/agentic_forge/workflows/` that reference `/agentic-sdlc:skill-name`:
- Replace `/agentic-sdlc:sdlc-plan` → `/sdlc-plan`
- Replace `/agentic-sdlc:analyze` → `/analyze`
- Replace for all 13 skills:
  - add-improvement, analyze, create-checkpoint, create-log, create-skill, fix-analyze, git-branch, git-commit, git-pr, orchestrate, sdlc-plan, sdlc-review, workflow-builder

**Acceptance**: No `/agentic-sdlc:` references remain in workflow YAML files.

#### Task 5.2: Audit and update all workflow YAML files

- Systematically check each `.yaml` workflow file for skill references
- Update any documentation or example workflows

**Acceptance**: All workflow files use unprefixed skill references.

#### Task 5.3: Update any documentation examples

- Check README.md, docs/, and CLAUDE.md for workflow examples
- Update any examples showing old skill reference format

**Acceptance**: All examples use new unprefixed format.

---

### Milestone 6: Documentation Update

**Goal**: Rewrite documentation to reflect new standalone package distribution.

**Context**: Documentation currently references marketplace installation and plugin structure.

#### Task 6.1: Rewrite README.md

Update README.md with:
- Installation: `uv tool install agentic-forge` (or `pip install agentic-forge`)
- No marketplace setup required
- How to use `skills-dir` for interactive sessions
- Quick examples of running workflows

**Acceptance**: README is clear and up-to-date.

#### Task 6.2: Update CLAUDE.md project instructions

Update project instructions:
- Remove marketplace/plugin references
- Update paths: `plugins/agentic-sdlc/` → `src/agentic_forge/`
- Update build/install commands: reference new pyproject.toml location
- Update skill/agent/prompt paths for new structure

**Acceptance**: CLAUDE.md reflects new architecture.

#### Task 6.3: Update CHANGELOG.md

Document the 1.0.0 breaking change:
- Summarize distribution change
- Note: marketplace installation no longer supported
- Note: skill prefix removal (`agentic-sdlc:` → unprefixed)
- Migration guide for existing users

**Acceptance**: CHANGELOG documents v1.0.0 changes.

---

### Milestone 7: Final Validation and Cleanup

**Goal**: Complete cleanup, validation, and ensure everything works end-to-end.

**Context**: After all changes, we need to verify the package works correctly and clean up temporary files.

#### Task 7.1: Update CI/CD pipelines

- Update GitHub Actions or CI scripts to reference new paths
- Update test commands to use new package structure
- Ensure `uv build` is the build command
- Verify `uv run pytest` works for new `tests/` location

**Acceptance**: CI/CD pipelines pass and reference correct paths.

#### Task 7.2: End-to-end validation

Execute these commands in order:

1. `uv build` - Should create a valid wheel
2. `uv tool install .` - Should install the package
3. `agentic-forge run plan-build-review --var "task=test"` - Workflow should execute
4. `agentic-forge skills-dir` - Should print skills directory path
5. In a new Claude session: `claude --add-dir $(agentic-forge skills-dir)` - Skills should be available
6. Agent loading: Verify agents are found and loaded correctly
7. All tests pass: `uv run pytest`

**Acceptance**: All validation steps succeed without errors.

#### Task 7.3: Final cleanup and verification

- Delete any remaining references to old structure
- Verify no broken imports or dead code
- Check for any remaining `agentic-sdlc` references that should be `agentic-forge`
- Commit all changes with a clear message documenting the restructuring

**Acceptance**: Repository is clean; git status is empty.

---

## Key Implementation Notes

### Order of Execution

Milestones must be completed in order. Each milestone depends on the previous one:
1. Structure first (Milestone 1-2)
2. Configuration (Milestone 3)
3. Runtime updates (Milestone 4)
4. Workflow updates (Milestone 5)
5. Documentation (Milestone 6)
6. Validation (Milestone 7)

### Testing Strategy

- Unit tests should work after Milestone 1 (Python imports fixed)
- Integration tests should work after Milestone 4 (runner updated)
- End-to-end validation in Milestone 7

### Risk Mitigation

- Keep the old `plugins/agentic-sdlc/` directory until Milestone 2 is complete
- Test builds locally before deleting old structure
- Verify `uv tool install` works with editable installs before cleanup

### Out of Scope

- Publishing to PyPI (can be separate step)
- Supporting non-Claude agents (Codex, Aider, etc.)
- Custom user skill discovery from project directories

---

## References

See the original `plan.md` for detailed phase descriptions and decision rationale.
