# Python Orchestration System for Claude Code Workflows

## Overview

This plan describes a Python-based orchestration system that enables developers to create reusable, composable workflows for Claude Code on Windows. The system leverages commands, agents, and skills as building blocks, with Python scripts
orchestrating complex SDLC workflows via `claude -p`.

## Goals

1. **Standalone CLI Tools**: Python scripts run independently, invoking Claude via `claude -p`
2. **Git Worktree Support**: Enable parallel work on different branches
3. **Parallel Agent Execution**: Two modes - fully independent and orchestrator-coordinated
4. **Templated Planning**: Markdown plans with placeholder variables
5. **SDLC Coverage**: Planning → Implementation → Testing → Review → PR
6. **Marketplace Distribution**: Scripts accessible to users who install via the plugin marketplace

## Architecture

```
plugins/development/
├── README.md
├── docs/
│   └── python-orchestration-plan.md  (this file)
├── commands/
│   ├── plan-dev.md                   (existing)
│   ├── demo-hello.md                 (POC - simple response)
│   └── implement-from-plan.md        (new - executes plan)
├── workflows/
│   ├── __init__.py
│   ├── cli.py                        (entry point)
│   ├── config.py                     (workflows.json loader)
│   ├── worktree.py                   (git worktree management)
│   ├── runner.py                     (claude -p executor)
│   ├── orchestrator.py               (parallel agent coordination)
│   └── templates/
│       ├── plan-template.md
│       └── feature-template.md
├── workflows.json                    (workflow definitions)
└── examples/
    ├── hello_demo.py                 (POC 1)
    ├── parallel_edit_demo.py         (POC 2)
    └── plan_then_implement_demo.py   (POC 3)
```

## Dependencies

- Python 3.10+
- `subprocess` (stdlib) - for running `claude -p`
- `json` (stdlib) - for configuration
- `pathlib` (stdlib) - for path handling
- `concurrent.futures` (stdlib) - for parallel execution
- `string.Template` or `jinja2` - for template rendering

---

# Milestone 1: Proof of Concept

Three focused POCs to validate the core mechanics before building the full system.

## POC 1: Hello World via Claude CLI

**Objective**: Validate that Python can invoke `claude -p` and capture output.

### Tasks

#### 1.1 Create demo-hello command

Create a minimal command that makes Claude respond with "Hello".

**File**: `plugins/development/commands/demo-hello.md`

```markdown
---
name: demo-hello
description: Demo command that responds with Hello
argument-hint:
---

# Demo Hello Command

Respond with exactly: "Hello from Claude!"

Do not add any other text or explanation.
```

#### 1.2 Create hello_demo.py script

**File**: `plugins/development/examples/hello_demo.py`

```python
#!/usr/bin/env python3
"""
POC 1: Invoke Claude with a command and capture output.

Usage:
    python hello_demo.py
"""

import subprocess
import sys
from pathlib import Path


def run_claude_command(prompt: str, cwd: Path | None = None) -> tuple[int, str, str]:
    """
    Run claude -p with the given prompt.

    Returns:
        tuple of (return_code, stdout, stderr)
    """
    cmd = ["claude", "-p", prompt]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=cwd,
        shell=True  # Required on Windows for PATH resolution
    )

    return result.returncode, result.stdout, result.stderr


def main():
    print("POC 1: Hello World via Claude CLI")
    print("=" * 40)

    # Use the demo-hello command
    prompt = "/demo-hello"

    print(f"Running: claude -p \"{prompt}\"")
    print("-" * 40)

    returncode, stdout, stderr = run_claude_command(prompt)

    print("Output:")
    print(stdout)

    if stderr:
        print("Stderr:")
        print(stderr)

    print("-" * 40)
    print(f"Return code: {returncode}")

    return returncode


if __name__ == "__main__":
    sys.exit(main())
```

#### 1.3 Validation Criteria

- [ ] Script runs without errors
- [ ] Claude output is captured and printed
- [ ] Return code is 0 on success

---

## POC 2: Parallel Git Worktree Editing

**Objective**: Validate parallel Claude instances editing different branches via worktrees.

### Tasks

#### 2.1 Create worktree management module

**File**: `plugins/development/workflows/worktree.py`

```python
#!/usr/bin/env python3
"""
Git worktree management for parallel Claude workflows.
"""

import subprocess
import shutil
from pathlib import Path
from dataclasses import dataclass
from typing import Generator
from contextlib import contextmanager


@dataclass
class Worktree:
    """Represents a git worktree."""
    path: Path
    branch: str
    base_branch: str

    def exists(self) -> bool:
        return self.path.exists()


def get_repo_root(cwd: Path | None = None) -> Path:
    """Get the root of the current git repository."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        cwd=cwd,
        shell=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"Not in a git repository: {result.stderr}")
    return Path(result.stdout.strip())


def create_worktree(
    branch_name: str,
    worktree_path: Path,
    base_branch: str = "main",
    cwd: Path | None = None
) -> Worktree:
    """
    Create a new git worktree with a new branch.

    Args:
        branch_name: Name for the new branch
        worktree_path: Path where the worktree will be created
        base_branch: Branch to base the new branch on
        cwd: Working directory (repository root)

    Returns:
        Worktree object
    """
    # Ensure worktree path doesn't exist
    if worktree_path.exists():
        raise RuntimeError(f"Worktree path already exists: {worktree_path}")

    # Create worktree with new branch
    cmd = [
        "git", "worktree", "add",
        "-b", branch_name,
        str(worktree_path),
        base_branch
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=cwd,
        shell=True
    )

    if result.returncode != 0:
        raise RuntimeError(f"Failed to create worktree: {result.stderr}")

    return Worktree(
        path=worktree_path,
        branch=branch_name,
        base_branch=base_branch
    )


def remove_worktree(worktree: Worktree, cwd: Path | None = None, force: bool = False) -> None:
    """
    Remove a git worktree and optionally delete the branch.

    Args:
        worktree: Worktree to remove
        cwd: Working directory (main repository)
        force: Force removal even with uncommitted changes
    """
    # Remove the worktree
    cmd = ["git", "worktree", "remove"]
    if force:
        cmd.append("--force")
    cmd.append(str(worktree.path))

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=cwd,
        shell=True
    )

    if result.returncode != 0:
        # Fallback: manually remove directory and prune
        if worktree.path.exists():
            shutil.rmtree(worktree.path)
        subprocess.run(
            ["git", "worktree", "prune"],
            cwd=cwd,
            shell=True
        )


@contextmanager
def temporary_worktree(
    branch_name: str,
    base_branch: str = "main",
    cwd: Path | None = None
) -> Generator[Worktree, None, None]:
    """
    Context manager for temporary worktrees.

    Creates a worktree on entry, removes it on exit.

    Usage:
        with temporary_worktree("feature/my-branch") as wt:
            # Work in wt.path
            pass
        # Worktree is automatically cleaned up
    """
    repo_root = get_repo_root(cwd)
    worktree_base = repo_root.parent / ".worktrees"
    worktree_base.mkdir(exist_ok=True)

    worktree_path = worktree_base / branch_name.replace("/", "-")

    worktree = create_worktree(
        branch_name=branch_name,
        worktree_path=worktree_path,
        base_branch=base_branch,
        cwd=repo_root
    )

    try:
        yield worktree
    finally:
        remove_worktree(worktree, cwd=repo_root, force=True)
```

#### 2.2 Create runner module

**File**: `plugins/development/workflows/runner.py`

```python
#!/usr/bin/env python3
"""
Claude CLI runner for workflow orchestration.
"""

import subprocess
import json
from pathlib import Path
from dataclasses import dataclass
from typing import Any


@dataclass
class ClaudeResult:
    """Result from a Claude CLI invocation."""
    returncode: int
    stdout: str
    stderr: str
    prompt: str
    cwd: Path | None

    @property
    def success(self) -> bool:
        return self.returncode == 0


def run_claude(
    prompt: str,
    cwd: Path | None = None,
    timeout: int | None = 300,
    print_output: bool = False
) -> ClaudeResult:
    """
    Run claude -p with the given prompt.

    Args:
        prompt: The prompt to send to Claude (can be a slash command)
        cwd: Working directory for the Claude session
        timeout: Timeout in seconds (default 5 minutes)
        print_output: Whether to print output as it arrives

    Returns:
        ClaudeResult with captured output
    """
    cmd = ["claude", "-p", prompt]

    if print_output:
        # Stream output in real-time
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd,
            shell=True
        )

        stdout_lines = []
        stderr_lines = []

        # Read stdout
        for line in process.stdout:
            print(line, end="")
            stdout_lines.append(line)

        process.wait(timeout=timeout)
        stderr = process.stderr.read()

        return ClaudeResult(
            returncode=process.returncode,
            stdout="".join(stdout_lines),
            stderr=stderr,
            prompt=prompt,
            cwd=cwd
        )
    else:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=timeout,
            shell=True
        )

        return ClaudeResult(
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
            prompt=prompt,
            cwd=cwd
        )


def run_claude_with_command(
    command: str,
    args: str = "",
    cwd: Path | None = None,
    **kwargs
) -> ClaudeResult:
    """
    Run a Claude slash command.

    Args:
        command: The slash command name (without /)
        args: Arguments to pass to the command
        cwd: Working directory
        **kwargs: Additional arguments passed to run_claude

    Returns:
        ClaudeResult
    """
    prompt = f"/{command}"
    if args:
        prompt = f"{prompt} {args}"

    return run_claude(prompt, cwd=cwd, **kwargs)
```

#### 2.3 Create parallel edit demo script

**File**: `plugins/development/examples/parallel_edit_demo.py`

```python
#!/usr/bin/env python3
"""
POC 2: Parallel editing with git worktrees.

Creates two worktrees, runs Claude in parallel to edit README.md
in each branch, then commits the changes using core plugin git commands.

Usage:
    python parallel_edit_demo.py
"""

import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from workflows.worktree import temporary_worktree, get_repo_root
from workflows.runner import run_claude, run_claude_with_command


def edit_readme_task(worktree_path: Path, branch_name: str, edit_instruction: str) -> dict:
    """
    Task to edit README.md in a worktree.

    Args:
        worktree_path: Path to the worktree
        branch_name: Name of the branch (for reporting)
        edit_instruction: What to add/change in the README

    Returns:
        dict with task results
    """
    result = {
        "branch": branch_name,
        "worktree": str(worktree_path),
        "success": False,
        "edit_output": "",
        "commit_output": "",
        "error": None
    }

    try:
        # Step 1: Edit the README
        edit_prompt = f"""
Edit the README.md file in this repository.
Add the following section at the end of the file:

## {edit_instruction}

Added from branch: {branch_name}
Timestamp: [current timestamp]

Use the Edit tool to make this change.
"""
        edit_result = run_claude(edit_prompt, cwd=worktree_path, print_output=True)
        result["edit_output"] = edit_result.stdout

        if not edit_result.success:
            result["error"] = f"Edit failed: {edit_result.stderr}"
            return result

        # Step 2: Commit using core plugin command
        commit_result = run_claude_with_command(
            "git-commit",
            args=f"Add {edit_instruction} section",
            cwd=worktree_path,
            print_output=True
        )
        result["commit_output"] = commit_result.stdout

        if not commit_result.success:
            result["error"] = f"Commit failed: {commit_result.stderr}"
            return result

        result["success"] = True

    except Exception as e:
        result["error"] = str(e)

    return result


def main():
    print("POC 2: Parallel Git Worktree Editing")
    print("=" * 50)

    repo_root = get_repo_root()
    print(f"Repository root: {repo_root}")

    # Define the parallel tasks
    tasks = [
        {
            "branch": "poc/parallel-edit-1",
            "instruction": "Feature Alpha Documentation"
        },
        {
            "branch": "poc/parallel-edit-2",
            "instruction": "Feature Beta Documentation"
        }
    ]

    results = []

    # Execute tasks in parallel using worktrees
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {}
        worktrees = []

        # Create worktrees and submit tasks
        for task in tasks:
            # Create temporary worktree (we'll manage cleanup manually for demo)
            from workflows.worktree import create_worktree

            worktree_path = repo_root.parent / ".worktrees" / task["branch"].replace("/", "-")
            worktree_path.parent.mkdir(exist_ok=True)

            # Clean up if exists from previous run
            if worktree_path.exists():
                from workflows.worktree import remove_worktree, Worktree
                remove_worktree(
                    Worktree(worktree_path, task["branch"], "main"),
                    cwd=repo_root,
                    force=True
                )

            try:
                worktree = create_worktree(
                    branch_name=task["branch"],
                    worktree_path=worktree_path,
                    base_branch="main",
                    cwd=repo_root
                )
                worktrees.append(worktree)

                future = executor.submit(
                    edit_readme_task,
                    worktree.path,
                    task["branch"],
                    task["instruction"]
                )
                futures[future] = task["branch"]

            except Exception as e:
                print(f"Failed to create worktree for {task['branch']}: {e}")

        # Collect results as they complete
        for future in as_completed(futures):
            branch = futures[future]
            try:
                result = future.result()
                results.append(result)
                status = "SUCCESS" if result["success"] else "FAILED"
                print(f"\n[{status}] Branch: {branch}")
                if result["error"]:
                    print(f"  Error: {result['error']}")
            except Exception as e:
                print(f"\n[ERROR] Branch {branch}: {e}")

        # Cleanup worktrees
        print("\nCleaning up worktrees...")
        from workflows.worktree import remove_worktree
        for worktree in worktrees:
            try:
                remove_worktree(worktree, cwd=repo_root, force=True)
                print(f"  Removed: {worktree.branch}")
            except Exception as e:
                print(f"  Failed to remove {worktree.branch}: {e}")

    # Summary
    print("\n" + "=" * 50)
    print("Summary:")
    successful = sum(1 for r in results if r["success"])
    print(f"  Successful: {successful}/{len(results)}")

    return 0 if successful == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
```

#### 2.4 Validation Criteria

- [ ] Both worktrees are created successfully
- [ ] Claude edits README.md in each worktree
- [ ] Commits are created using `/git-commit` command
- [ ] Worktrees are cleaned up after execution
- [ ] Tasks execute in parallel (not sequentially)

---

## POC 3: Plan Then Implement

**Objective**: Validate orchestrated workflow where one Claude instance creates a plan, then another implements it.

### Tasks

#### 3.1 Create simple planning command

**File**: `plugins/development/commands/create-readme-plan.md`

````markdown
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

## Instructions

1. Accept the feature name from the argument
2. Create a plan file at `docs/plans/readme-{{feature-name}}-plan.md`
3. The plan should include:
   - Overview of the change
   - Exact content to add
   - Location in the README
   - Validation criteria

## Plan Template

Use this exact structure:

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

1. Read the current README.md
2. Find the appropriate insertion point
3. Add the new section content
4. Verify the markdown is valid

## Validation

- [ ] Section appears in README.md
- [ ] Markdown renders correctly
- [ ] Content matches the plan
```
````

## Output

Confirm the plan file location and summarize its contents.

````

#### 3.2 Create implement-from-plan command

**File**: `plugins/development/commands/implement-from-plan.md`

```markdown
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

## Instructions

1. Read the plan file at the specified path
2. Parse the plan structure to understand:
   - What changes need to be made
   - Which files to modify
   - The exact content to add/change
3. Execute each implementation step in order
4. Verify against the validation criteria in the plan
5. Report completion status

## Core Principles

- Follow the plan exactly as written
- Do not make changes beyond what the plan specifies
- Report any deviations or issues encountered
- Verify each validation criterion

## Output

Report:
- Steps completed
- Files modified
- Validation results
- Any issues encountered
````

#### 3.3 Create plan-then-implement demo script

**File**: `plugins/development/examples/plan_then_implement_demo.py`

```python
#!/usr/bin/env python3
"""
POC 3: Plan then implement workflow.

Demonstrates orchestrated workflow:
1. First Claude instance creates a plan
2. Second Claude instance implements the plan

Usage:
    python plan_then_implement_demo.py <feature-name>
    python plan_then_implement_demo.py "API Documentation"
"""

import sys
import argparse
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from workflows.runner import run_claude, run_claude_with_command
from workflows.worktree import get_repo_root


def create_plan(feature_name: str, cwd: Path) -> tuple[bool, Path | None]:
    """
    Create a plan for the feature.

    Returns:
        tuple of (success, plan_file_path)
    """
    print(f"\n{'=' * 50}")
    print("PHASE 1: Creating Plan")
    print(f"{'=' * 50}")

    result = run_claude_with_command(
        "create-readme-plan",
        args=feature_name,
        cwd=cwd,
        print_output=True
    )

    if not result.success:
        print(f"Failed to create plan: {result.stderr}")
        return False, None

    # Derive the expected plan path
    safe_name = feature_name.lower().replace(" ", "-")
    plan_path = cwd / "docs" / "plans" / f"readme-{safe_name}-plan.md"

    if plan_path.exists():
        print(f"\nPlan created at: {plan_path}")
        return True, plan_path

    # Try to find the plan if naming differs
    plans_dir = cwd / "docs" / "plans"
    if plans_dir.exists():
        for plan_file in plans_dir.glob("*.md"):
            if safe_name in plan_file.name.lower():
                print(f"\nPlan created at: {plan_file}")
                return True, plan_file

    print("Warning: Plan file not found at expected location")
    return True, plan_path


def implement_plan(plan_path: Path, cwd: Path) -> bool:
    """
    Implement the plan.

    Returns:
        True if successful
    """
    print(f"\n{'=' * 50}")
    print("PHASE 2: Implementing Plan")
    print(f"{'=' * 50}")

    result = run_claude_with_command(
        "implement-from-plan",
        args=str(plan_path),
        cwd=cwd,
        print_output=True
    )

    if not result.success:
        print(f"Failed to implement plan: {result.stderr}")
        return False

    return True


def commit_changes(message: str, cwd: Path) -> bool:
    """
    Commit the changes using the core git-commit command.

    Returns:
        True if successful
    """
    print(f"\n{'=' * 50}")
    print("PHASE 3: Committing Changes")
    print(f"{'=' * 50}")

    result = run_claude_with_command(
        "git-commit",
        args=message,
        cwd=cwd,
        print_output=True
    )

    return result.success


def main():
    parser = argparse.ArgumentParser(
        description="POC 3: Plan then implement workflow"
    )
    parser.add_argument(
        "feature_name",
        help="Name of the feature to add to README"
    )
    parser.add_argument(
        "--no-commit",
        action="store_true",
        help="Skip the commit step"
    )

    args = parser.parse_args()

    print("POC 3: Plan Then Implement Workflow")
    print("=" * 50)
    print(f"Feature: {args.feature_name}")

    cwd = get_repo_root()
    print(f"Repository: {cwd}")

    # Phase 1: Create the plan
    success, plan_path = create_plan(args.feature_name, cwd)
    if not success:
        print("\nFailed at planning phase")
        return 1

    # Phase 2: Implement the plan
    if plan_path and plan_path.exists():
        success = implement_plan(plan_path, cwd)
        if not success:
            print("\nFailed at implementation phase")
            return 1
    else:
        print("\nSkipping implementation: plan file not found")
        return 1

    # Phase 3: Commit (optional)
    if not args.no-commit:
        success = commit_changes(
            f"Add {args.feature_name} section to README",
            cwd
        )
        if not success:
            print("\nWarning: Commit failed (changes are still saved)")

    print(f"\n{'=' * 50}")
    print("Workflow Complete!")
    print(f"{'=' * 50}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

#### 3.4 Validation Criteria

- [ ] Plan file is created with correct structure
- [ ] Implementation reads and follows the plan
- [ ] README.md is modified as specified
- [ ] Changes are committed via `/git-commit`
- [ ] Phases execute sequentially and depend on previous results

---

# Milestone 2: Core Workflow Library

Build the reusable library components based on validated POC patterns.

## Tasks

### 2.1 Create configuration module

**File**: `plugins/development/workflows/config.py`

Responsibilities:

- Load `workflows.json` configuration
- Validate workflow definitions
- Provide typed access to workflow settings

### 2.2 Create template engine

**File**: `plugins/development/workflows/templates.py`

Responsibilities:

- Load markdown templates with placeholders
- Support `{{variable}}` syntax
- Render templates with provided context

### 2.3 Create orchestrator module

**File**: `plugins/development/workflows/orchestrator.py`

Responsibilities:

- Coordinate multiple Claude instances
- Support two modes:
  - **Independent**: Agents work in parallel, no coordination
  - **Coordinated**: Orchestrator spawns agents, collects results
- Handle worktree lifecycle
- Aggregate results

### 2.4 Create CLI entry point

**File**: `plugins/development/workflows/cli.py`

Responsibilities:

- Provide `python -m workflows` interface
- Parse workflow commands
- Route to appropriate workflow handlers

---

# Milestone 3: SDLC Workflows

Implement complete development lifecycle workflows.

## Tasks

### 3.1 Planning workflow

**Workflow**: `plan`

Inputs:

- Feature description
- Template selection (optional)

Steps:

1. Invoke `/plan-dev` with feature description
2. Store plan at configured location
3. Return plan path for subsequent phases

### 3.2 Implementation workflow

**Workflow**: `implement`

Inputs:

- Plan file path
- Optional: use worktree

Steps:

1. Create worktree if requested
2. Read plan file
3. Invoke Claude to implement each milestone
4. Track progress and report status

### 3.3 Testing workflow

**Workflow**: `test`

Inputs:

- Test scope (all, changed, specific)
- Plan file (for context)

Steps:

1. Identify affected tests from plan
2. Run test commands
3. If failures, optionally invoke Claude to fix
4. Report results

### 3.4 Review workflow

**Workflow**: `review`

Inputs:

- Branch or commit range
- Review criteria

Steps:

1. Generate diff
2. Invoke Claude for code review
3. Output review comments
4. Optionally create GitHub review

### 3.5 PR workflow

**Workflow**: `pr`

Inputs:

- Branch name
- Plan file (for description)

Steps:

1. Use `/git-pr` command from core plugin
2. Include plan summary in PR description
3. Link related issues

---

# Milestone 4: Parallel Execution Modes

Implement both parallel execution strategies.

## Tasks

### 4.1 Independent parallel mode

For tasks that don't need coordination:

- Each agent runs in its own worktree
- No shared state
- Results collected after all complete

Example: Running different test suites in parallel

### 4.2 Coordinated parallel mode

For tasks requiring orchestration:

- Orchestrator maintains shared state
- Agents report progress to orchestrator
- Orchestrator can reassign or stop agents

Example: Implementing multiple milestones with dependencies

### 4.3 Result aggregation

Combine results from parallel executions:

- Merge git branches if needed
- Consolidate reports
- Handle conflicts

---

# Milestone 5: Templates and Configuration

## Tasks

### 5.1 Create plan template library

**Directory**: `plugins/development/workflows/templates/`

Templates:

- `feature-plan.md` - Standard feature implementation
- `bugfix-plan.md` - Bug investigation and fix
- `refactor-plan.md` - Code refactoring
- `migration-plan.md` - Data/schema migration

### 5.2 Create workflows.json schema

**File**: `plugins/development/workflows.json`

```json
{
  "$schema": "./workflows.schema.json",
  "version": "1.0.0",
  "defaults": {
    "planDirectory": "docs/plans",
    "worktreeBase": "../.worktrees",
    "parallelMode": "independent",
    "timeout": 300
  },
  "workflows": {
    "feature": {
      "description": "Full feature development workflow",
      "phases": ["plan", "implement", "test", "review", "pr"],
      "template": "feature-plan.md"
    },
    "hotfix": {
      "description": "Quick fix workflow",
      "phases": ["implement", "test", "pr"],
      "useWorktree": true
    }
  },
  "templates": {
    "feature-plan": {
      "path": "templates/feature-plan.md",
      "variables": ["featureName", "requirements", "scope"]
    }
  }
}
```

### 5.3 Document workflow configuration

Create comprehensive documentation for:

- Available workflows
- Configuration options
- Template variables
- Custom workflow creation

---

# Milestone 6: Marketplace Integration

Ensure the Python orchestration is accessible to marketplace users.

## Tasks

### 6.1 Update plugin structure

Ensure `workflows/` directory is included in plugin distribution.

### 6.2 Create setup script

**File**: `plugins/development/workflows/setup.py`

Or `pyproject.toml` for modern Python packaging.

### 6.3 Update marketplace.json

Add workflow scripts to the development plugin definition.

### 6.4 Create user documentation

**File**: `plugins/development/README.md` (update)

Add section on:

- Installing Python dependencies
- Running workflow scripts
- Configuring workflows
- Extending with custom workflows

---

# Validation Checklist

## POC Validation

- [ ] POC 1: Hello demo prints Claude output
- [ ] POC 2: Parallel edits create separate branches with commits
- [ ] POC 3: Plan → Implement workflow completes successfully

## Integration Validation

- [ ] All core plugin git commands work from Python
- [ ] Worktrees are created and cleaned up properly
- [ ] Parallel execution doesn't cause conflicts
- [ ] Template rendering produces valid markdown

## User Experience Validation

- [ ] Scripts work after marketplace installation
- [ ] Documentation is clear and complete
- [ ] Error messages are helpful
- [ ] Configuration is intuitive

---

# Notes

## Windows Considerations

- Use `shell=True` for subprocess calls to resolve PATH
- Use `pathlib.Path` for cross-platform path handling
- Handle Windows-style paths in git commands
- Test with both PowerShell and Command Prompt

## Claude CLI Integration

- The `claude -p` command runs a single prompt session
- Slash commands (e.g., `/git-commit`) are expanded by Claude Code
- Output includes Claude's responses and tool outputs
- Return code indicates success/failure

## Git Worktree Limitations

- Worktrees share the same `.git` directory
- Cannot have two worktrees on the same branch
- Worktree paths should be outside the main repository
- Always clean up worktrees to avoid orphaned directories

## Error Handling Strategy

- Fail fast on critical errors (worktree creation, claude command)
- Log warnings for non-critical issues
- Provide clear error messages with suggested fixes
- Support `--verbose` flag for debugging

---

# References

- [Claude Code CLI Documentation](https://docs.anthropic.com/claude-code/cli)
- [Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
- [Python subprocess Module](https://docs.python.org/3/library/subprocess.html)
- [Core Plugin Git Commands](../../../plugins/core/commands/)
- [Plan-Dev Command](../commands/plan-dev.md)
