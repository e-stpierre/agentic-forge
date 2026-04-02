# Plan: Agentic Forge - Distribution Overhaul

## Goal

Transform agentic-forge from a Claude Code marketplace/plugin into a standalone Python package that dynamically loads skills via `--add-dir` when spawning Claude sessions. The package becomes agent-agnostic in distribution (no marketplace dependency) while retaining Claude Code as the current execution backend.

---

## Architecture Overview

### Current State

```
agentic-forge (marketplace repo)
├── .claude-plugin/marketplace.json    # Claude marketplace config
├── plugins/agentic-sdlc/             # Plugin directory structure
│   ├── skills/*/SKILL.md             # 13 skills (discovered by plugin system)
│   ├── agents/*.md                   # 2 agents (discovered by plugin system)
│   ├── prompts/agentic-system.md     # System prompt
│   ├── src/agentic_sdlc/            # Python package
│   └── pyproject.toml               # Builds "agentic-sdlc" package
└── docs/                            # Templates, guides
```

Installation: clone repo -> install marketplace -> install Python tool separately.
Skills loaded by Claude's plugin discovery system at marketplace install time.

### Target State

```
agentic-forge (Python package repo)
├── src/agentic_forge/                # Python package (renamed)
│   ├── cli.py                       # Entry point: "agentic-forge" command
│   ├── commands/                    # CLI subcommands
│   ├── steps/                       # Step executors
│   ├── orchestrator.py              # Workflow orchestration
│   ├── runner.py                    # Claude session spawning (uses --add-dir)
│   ├── ...                          # All other modules
│   ├── prompts/                     # Bundled system prompts (package data)
│   ├── workflows/                   # Bundled workflow YAML files (package data)
│   ├── agents/                      # Bundled agent definitions (package data)
│   │   ├── explorer.md
│   │   └── reviewer.md
│   └── claude/                      # Bundled Claude resources (package data)
│       └── .claude/
│           └── skills/              # Skills in --add-dir format
│               ├── add-improvement/SKILL.md
│               ├── analyze/SKILL.md + references/
│               ├── create-checkpoint/SKILL.md
│               ├── create-log/SKILL.md
│               ├── create-skill/SKILL.md + template.md
│               ├── fix-analyze/SKILL.md
│               ├── git-branch/SKILL.md
│               ├── git-commit/SKILL.md
│               ├── git-pr/SKILL.md
│               ├── orchestrate/SKILL.md
│               ├── sdlc-plan/SKILL.md + references/
│               ├── sdlc-review/SKILL.md
│               └── workflow-builder/SKILL.md + references/
├── tests/                           # Tests
├── pyproject.toml                   # Builds "agentic-forge" package
└── README.md
```

Installation: `uv tool install agentic-forge` (or `pip install agentic-forge`).
Skills loaded dynamically via `--add-dir` at session spawn time. No marketplace needed.

---

## Implementation Steps

### Phase 1: Restructure Repository

#### 1.1 Flatten the plugin directory

Move the Python source out of `plugins/agentic-sdlc/` to the repo root.

- Move `plugins/agentic-sdlc/src/agentic_sdlc/` to `src/agentic_forge/`
- Move `plugins/agentic-sdlc/tests/` to `tests/`

**Rename the Python package** from `agentic_sdlc` to `agentic_forge` throughout:
- All `import agentic_sdlc` -> `import agentic_forge`
- All `from agentic_sdlc` -> `from agentic_forge`
- Entry point: `agentic-sdlc` CLI -> `agentic-forge` CLI

#### 1.2 Bundle skills as package data

Create `src/agentic_forge/claude/.claude/skills/` with the `--add-dir` compatible structure.

Move all 13 skill directories from `plugins/agentic-sdlc/skills/` into this structure, preserving each skill's reference files and subdirectories.

#### 1.3 Bundle prompts and workflows as package data

- Move `plugins/agentic-sdlc/prompts/` -> `src/agentic_forge/prompts/`
- Workflows are already at `src/agentic_sdlc/workflows/` -> stays at `src/agentic_forge/workflows/`

#### 1.4 Bundle agents as package data

**Constraint**: `--add-dir` only discovers skills, not agents. Agents are currently loaded by `prompt_step.py` which reads the agent `.md` file and prepends it to the prompt (line 41-44).

**Solution**: Bundle agents inside the package at `src/agentic_forge/agents/`. Update agent path resolution in `prompt_step.py` to fall back to the package directory when the agent file is not found relative to the repo root.

```python
# New resolution order:
# 1. Relative to repo root (user overrides)
# 2. Relative to package installation (bundled agents)
agent_path = context.repo_root / step.agent
if not agent_path.exists():
    agent_path = Path(__file__).parent.parent / "agents" / Path(step.agent).name
```

#### 1.5 Delete marketplace artifacts

Remove:
- `.claude-plugin/` directory (marketplace.json)
- `plugins/` directory (after everything is moved)
- Any marketplace-specific references in docs

---

### Phase 2: Update Python Package Configuration

#### 2.1 New root pyproject.toml

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

#### 2.2 Ensure non-Python files are included

Hatch includes package data by default when it's inside the package directory. Verify that `.md`, `.yaml`, and other non-Python files in `claude/`, `prompts/`, `workflows/`, and `agents/` are included in the built wheel.

If needed, add explicit inclusion rules in pyproject.toml.

---

### Phase 3: Update Runner to Use --add-dir

#### 3.1 Modify `runner.py` to pass `--add-dir`

In the `run_claude()` function, add `--add-dir` pointing to the bundled skills directory:

```python
SKILLS_DIR = Path(__file__).parent / "claude"

def run_claude(...):
    cmd = [claude_path, "--print"]
    cmd.extend(["--add-dir", str(SKILLS_DIR)])
    ...
```

Every Claude session spawned by the workflow engine will have access to all bundled skills.

#### 3.2 Update system prompt path resolution

Current (`runner.py:216`):
```python
AGENTIC_SYSTEM_PROMPT_FILE = Path(__file__).parent.parent.parent / "prompts" / "agentic-system.md"
```

New (resolve from within package):
```python
AGENTIC_SYSTEM_PROMPT_FILE = Path(__file__).parent / "prompts" / "agentic-system.md"
```

---

### Phase 4: Update Internal References

#### 4.1 Rename all imports

Global find-and-replace across all Python files:
- `agentic_sdlc` -> `agentic_forge` (module name)
- `agentic-sdlc` -> `agentic-forge` (CLI name in strings and docs)

#### 4.2 Update workflow YAML files

Skills loaded via `--add-dir` appear without a plugin prefix. Update all workflow references:
- `/agentic-sdlc:sdlc-plan` -> `/sdlc-plan`
- `/agentic-sdlc:analyze` -> `/analyze`
- etc. for all 13 skills

Audit all bundled `.yaml` workflow files for these references.

#### 4.3 Update `update` command

Rewrite to use `uv tool upgrade agentic-forge` or `pip install --upgrade agentic-forge` instead of marketplace-based update.

#### 4.4 Update `init` command

Update workflow copy path resolution from old plugin-relative path to package-relative path (should already work since workflows are at `src/agentic_forge/workflows/`).

---

### Phase 5: Provide User Access to Bundled Skills

#### 5.1 Add a `skills-dir` command

Add a CLI command that prints the path to the bundled skills directory:

```bash
$ agentic-forge skills-dir
/home/user/.local/lib/python3.12/site-packages/agentic_forge/claude
```

Users can then either:
- Launch Claude with skills: `claude --add-dir $(agentic-forge skills-dir)`
- Make it permanent in `~/.claude/settings.json`:
  ```json
  { "additionalDirectories": ["<output of skills-dir>"] }
  ```

---

### Phase 6: Update Documentation

#### 6.1 README.md

Rewrite to reflect new distribution:
- Installation: `uv tool install agentic-forge`
- No marketplace setup required
- How to use `skills-dir` for interactive sessions

#### 6.2 CLAUDE.md

Update project instructions:
- Remove marketplace/plugin references
- Update paths for skills, agents, prompts
- Update build/install commands

#### 6.3 CHANGELOG.md

Document the 1.0.0 breaking change.

---

### Phase 7: Clean Up and Validate

#### 7.1 Remove old files
- Delete `plugins/` directory
- Delete `.claude-plugin/` directory
- Remove `package.json` if only used for marketplace tooling
- Remove old `docs/templates/` if no longer applicable

#### 7.2 Update CI/CD
- Update lint/test/build commands for new paths
- Ensure `uv build` produces valid wheel with all package data

#### 7.3 End-to-end validation
- `uv tool install .` from repo root
- `agentic-forge run plan-build-review --var "task=test"` - workflow runs
- Skills available in spawned Claude sessions (via `--add-dir`)
- Agent loading works from bundled package path
- `agentic-forge skills-dir` prints correct path
- `claude --add-dir $(agentic-forge skills-dir)` makes skills available interactively

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Package name | `agentic-forge` | Broader than SDLC, matches repo name |
| Skill loading | `--add-dir` flag | Native Claude Code feature, live reload, no marketplace needed |
| Agent loading | Bundled as package data, injected via prompt prepend | `--add-dir` doesn't discover agents; current prompt injection already works |
| Breaking changes | Yes (v1.0.0) | Clean break, no backward compat needed |
| Skill prefix | Drop `agentic-sdlc:` prefix | Skills via `--add-dir` don't have plugin prefix |

## Constraints and Risks

- **`--add-dir` only loads skills**: Agents, hooks, and commands are NOT discovered. Agents handled by prompt prepend (already works).
- **Skill name collisions**: Without plugin prefix, names like `analyze` could collide with user skills. Consider prefixing (e.g., `forge-analyze/`) if this becomes an issue.
- **Package data paths**: Resolved path depends on install method. Must test `uv tool install`, `pip install`, and editable installs.
- **Windows paths**: `--add-dir` must handle Windows backslash paths correctly.

## Out of Scope (Future)

- Supporting non-Claude agents (Codex, Aider, etc.)
- Publishing to PyPI (repo structure supports it, separate step)
- Custom user skill discovery from project directories
