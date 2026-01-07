# Agentic SDLC Plugin

Fully autonomous SDLC toolkit for zero-interaction workflows. Designed for CI/CD integration and Python-orchestrated development with no developer interaction during execution.

## Purpose

Agentic SDLC provides autonomous software development lifecycle commands that operate with JSON input/output, suitable for CI/CD pipelines and programmatic orchestration. All commands complete without user prompts.

## Philosophy

- No developer interaction during execution
- JSON I/O for agent-to-agent communication
- Suitable for CI/CD integration
- Leverages Claude prompts (commands) and Python scripts

## Design Principles

| Principle          | Description                                 |
| ------------------ | ------------------------------------------- |
| Autonomous         | No user prompts, no AskUserQuestion         |
| JSON I/O           | Structured input/output for automation      |
| CI/CD Ready        | Designed for pipeline integration           |
| Ambiguity Handling | Makes assumptions, documents them in output |
| File-Based State   | Plans and checkpoints in markdown files     |

## Dependencies

Requires `agentic-forge-core` for runner and orchestrator utilities.

## Package Structure

```
experimental-plugins/agentic-sdlc/
  pyproject.toml          # Python 3.10+, depends on agentic-forge-core
  commands/
    configure.md          # Plugin configuration
    design.md             # Technical design (JSON I/O)
    plan.md               # Meta-command auto-selects plan type
    plan-feature.md       # Feature planning (JSON I/O)
    plan-bug.md           # Bug fix planning (JSON I/O)
    plan-chore.md         # Chore planning (JSON I/O)
    plan-build.md         # All-in-one workflow
    implement.md          # Implementation from plan (JSON I/O)
    implement-from-plan.md # Legacy implementation
    review.md             # Code review (JSON I/O)
    test.md               # Test execution (JSON I/O)
  schemas/                # JSON schema definitions
  src/claude_sdlc/
    __init__.py
    cli.py                # CLI entry points
    orchestrator.py       # Agentic workflow coordination
    workflows/
      feature.py          # Feature workflow
      bugfix.py           # Bugfix workflow
```

## Commands (Claude Prompts)

All commands use `/agentic-sdlc:` namespace and accept JSON input.

### Planning Commands

| Command                      | Input                        | Output                              |
| ---------------------------- | ---------------------------- | ----------------------------------- |
| `/agentic-sdlc:plan`         | `{type, title, description}` | Auto-selects plan-feature/bug/chore |
| `/agentic-sdlc:plan-feature` | Feature spec JSON            | `{plan_file, plan_data, summary}`   |
| `/agentic-sdlc:plan-bug`     | Bug spec JSON                | `{plan_file, plan_data, summary}`   |
| `/agentic-sdlc:plan-chore`   | Chore spec JSON              | `{plan_file, plan_data, summary}`   |
| `/agentic-sdlc:design`       | Design spec JSON             | Technical design output             |
| `/agentic-sdlc:plan-build`   | Spec JSON                    | All-in-one: plan -> build           |

### Implementation Commands

| Command                   | Input                                            | Output                                             |
| ------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| `/agentic-sdlc:implement` | `{plan_file, plan_data, checkpoint, git_commit}` | `{completed_tasks, changes, commits, ambiguities}` |

### Validation Commands

| Command                | Input                | Output         |
| ---------------------- | -------------------- | -------------- |
| `/agentic-sdlc:review` | `{files, plan_file}` | Review results |
| `/agentic-sdlc:test`   | `{coverage}`         | Test results   |

## JSON Schemas

### Input: Feature Spec

```json
{
  "type": "feature",
  "title": "User authentication",
  "description": "Add OAuth support",
  "requirements": ["Google OAuth", "GitHub OAuth"],
  "constraints": ["No external auth services"],
  "explore_agents": 3
}
```

### Output: Plan Result

```json
{
  "success": true,
  "plan_file": "/specs/feature-auth.md",
  "plan_data": {
    "type": "feature",
    "title": "User Authentication",
    "milestones": [
      {
        "id": "m1",
        "title": "Setup OAuth",
        "commit_message": "feat: add OAuth configuration",
        "tasks": [
          {
            "id": "t1.1",
            "title": "Add dependencies",
            "files": ["package.json"]
          }
        ]
      }
    ],
    "validation_criteria": ["All tests pass"]
  },
  "summary": { "milestones": 4, "tasks": 12, "complexity": "medium" }
}
```

### Output: Implementation Result

```json
{
  "success": true,
  "completed_tasks": ["t1.1", "t1.2", "t2.1"],
  "changes": [
    { "file": "src/auth.ts", "action": "created", "lines_added": 150 }
  ],
  "commits": [{ "hash": "abc123", "message": "feat: add OAuth configuration" }],
  "ambiguities": [
    {
      "task": "t2.1",
      "issue": "Unclear error handling strategy",
      "assumption": "Following pattern from src/utils/errors.ts",
      "action_taken": "Used ErrorBoundary pattern"
    }
  ]
}
```

## Python CLI

### Entry Points

| Command            | Description                       |
| ------------------ | --------------------------------- |
| `agentic-sdlc`     | Main CLI with subcommands         |
| `agentic-workflow` | Full end-to-end workflow          |
| `agentic-plan`     | Planning agent invocation         |
| `agentic-build`    | Build agent invocation            |
| `agentic-validate` | Validation agents (review + test) |

### CLI Usage

```bash
# Full workflow
agentic-workflow --type feature --spec spec.json --auto-pr

# Individual phases
agentic-plan --type feature --json-file spec.json
agentic-build --plan-file /specs/feature-auth.md
agentic-validate --plan-file /specs/feature-auth.md

# With stdin
echo '{"type":"feature","title":"Auth"}' | agentic-plan --type feature --json-stdin
```

### CLI Options

| Flag                     | Description                    |
| ------------------------ | ------------------------------ |
| `--type`                 | Task type: feature, bug, chore |
| `--spec` / `--json-file` | JSON input file                |
| `--json-stdin`           | Read from stdin                |
| `--plan-file`            | Path to plan file              |
| `--checkpoint`           | Resume from checkpoint         |
| `--auto-pr`              | Create PR on completion        |
| `--cwd`                  | Working directory              |
| `--output` / `-o`        | Output JSON file               |

## Python API

### WorkflowState

```python
@dataclass
class WorkflowState:
    workflow_id: str
    status: str  # pending, running, completed, failed
    current_phase: str
    plan_file: str | None
    completed_tasks: list[str]
    commits: list[dict]
    errors: list[str]
    messages: list[AgentMessage]
```

### Orchestration Functions

```python
from claude_sdlc.orchestrator import (
    agentic_workflow,
    agentic_plan,
    agentic_build,
    agentic_validate,
    run_agentic_command,
)

# Full workflow
state = agentic_workflow(
    task_type="feature",
    spec={"title": "Auth", "description": "..."},
    auto_pr=True,
    cwd="/path/to/repo",
)

# Individual phases
plan_result = agentic_plan("feature", spec, cwd="/repo")
build_result = agentic_build(plan_file="/specs/feature-auth.md", git_commit=True)
validate_result = agentic_validate(plan_file="/specs/feature-auth.md")
```

## Workflow Phases

Full workflow execution: Plan -> Build -> Validate -> PR (optional)

### Phase 1: Planning

Explore codebase -> Design implementation -> Write plan file -> Output JSON

### Phase 2: Building

Parse plan -> Create todo list -> Implement tasks sequentially -> Commit per milestone -> Output results

### Phase 3: Validation

Run review agent -> Run test agent -> Combine results

### Phase 4: PR (if auto_pr=true)

Create pull request with plan summary

## Workflow Files

Default location: `/specs/<feature-name>/`

| File               | Purpose                      |
| ------------------ | ---------------------------- |
| `plan.md`          | Main implementation plan     |
| `checkpoint.md`    | Task completion tracking     |
| `orchestration.md` | Orchestrator monitoring plan |
| `communication.md` | Agent-to-agent messages      |
| `logs.md`          | Progress and error logs      |

## Ambiguity Handling

When implementation is ambiguous, the agent:

1. Logs the ambiguity in output JSON
2. Makes reasonable assumption based on codebase patterns
3. Documents assumption in code comment
4. Continues with next task

No user interaction - always proceeds autonomously.

## Configuration

`.claude/settings.json`:

```json
{
  "agentic-sdlc": {
    "planDirectory": "/specs"
  }
}
```

## Installation

```bash
# Install core first
uv tool install experimental-plugins/core

# Then agentic-sdlc
uv tool install experimental-plugins/agentic-sdlc
```

## Technical Decisions

| Decision            | Choice       | Rationale                     |
| ------------------- | ------------ | ----------------------------- |
| No User Interaction | Autonomous   | CI/CD compatibility           |
| JSON I/O            | Structured   | Agent communication           |
| File-Based State    | Markdown     | Human-readable, git-trackable |
| Milestone Commits   | Conventional | Clean history                 |
| Ambiguity Logging   | Output JSON  | Transparency without blocking |

## Migration from SDLC

Renamed from `sdlc` to `agentic-sdlc` in v2.0.0:

- Commands now use `/agentic-sdlc:` namespace
- Removed AskUserQuestion (no user interaction)
- All I/O is JSON-based
- For interactive workflows, use `interactive-sdlc` instead

## Pros & Cons

### Pros

- Fully autonomous - no human intervention needed
- JSON I/O for easy integration
- CI/CD pipeline ready
- File-based state for recovery
- Transparent ambiguity handling
- Commit per milestone for clean history

### Cons

- No human-in-the-loop for complex decisions
- Requires well-defined specifications
- Ambiguity handling may not match user intent
- No persistent database (file-only state)
- No real-time progress visibility
- Sequential task execution only

## Comparison with Other Plugins

| Feature            | agentic-sdlc  | interactive-sdlc      | agentic-core             |
| ------------------ | ------------- | --------------------- | ------------------------ |
| User Interaction   | None          | Yes (AskUserQuestion) | Optional (human_in_loop) |
| State Storage      | Files         | Files                 | PostgreSQL + Kafka       |
| Crash Recovery     | Checkpoints   | Manual                | Automatic replay         |
| Parallel Execution | Via worktrees | Via worktrees         | Built-in parallel steps  |
| CI/CD Ready        | Yes           | No                    | Configurable             |
| Provider Support   | Claude only   | Claude only           | Multi-provider           |
