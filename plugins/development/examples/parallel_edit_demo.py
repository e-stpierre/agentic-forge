#!/usr/bin/env python3
"""
POC 2: Parallel editing with git worktrees.

Creates two worktrees, runs Claude in parallel to edit README.md
in each branch, then commits the changes using core plugin git commands.

Usage:
    python parallel_edit_demo.py

Requirements:
    - Claude Code CLI must be installed and available in PATH
    - Core plugin with git-commit command must be installed
    - Must be run from within a git repository
"""

from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

# Add workflows to path for imports
workflows_path = Path(__file__).parent.parent / "workflows"
sys.path.insert(0, str(workflows_path.parent))

from workflows.runner import run_claude, check_claude_available
from workflows.worktree import (
    Worktree,
    create_worktree,
    remove_worktree,
    get_repo_root,
    get_worktree_base_path,
    get_default_branch,
    branch_exists,
    _run_git,
)


def edit_readme_task(
    worktree_path: Path,
    branch_name: str,
    edit_instruction: str,
) -> dict[str, Any]:
    """
    Task to edit README.md in a worktree.

    Args:
        worktree_path: Path to the worktree
        branch_name: Name of the branch (for reporting)
        edit_instruction: What to add/change in the README

    Returns:
        dict with task results
    """
    result: dict[str, Any] = {
        "branch": branch_name,
        "worktree": str(worktree_path),
        "success": False,
        "edit_output": "",
        "commit_output": "",
        "error": None,
    }

    try:
        print(f"\n[{branch_name}] Starting edit task...")

        # Step 1: Edit the README
        edit_prompt = f"""
Edit the README.md file in this repository.

Add the following section at the end of the file:

## {edit_instruction}

This section was added by the parallel edit demo.
Branch: {branch_name}

Use the Edit tool to make this change. If README.md doesn't exist, create it.
"""
        print(f"[{branch_name}] Editing README.md...")
        edit_result = run_claude(edit_prompt, cwd=worktree_path, timeout=120)
        result["edit_output"] = edit_result.stdout

        if not edit_result.success:
            result["error"] = f"Edit failed: {edit_result.stderr}"
            return result

        print(f"[{branch_name}] Edit complete, committing...")

        # Step 2: Commit using direct git commands
        try:
            _run_git(["add", "README.md"], cwd=worktree_path)
            commit_output = _run_git(
                ["commit", "-m", f"Add {edit_instruction} section to README"],
                cwd=worktree_path,
            )
            result["commit_output"] = str(commit_output)
            print(f"[{branch_name}] Commit successful")
        except RuntimeError as e:
            result["error"] = f"Commit failed: {e}"
            print(f"[{branch_name}] Commit failed: {e}")
            return result

        result["success"] = True
        print(f"[{branch_name}] Task completed successfully!")

    except Exception as e:
        result["error"] = str(e)
        print(f"[{branch_name}] Task failed: {e}")

    return result


def cleanup_test_branches(repo_root: Path, branch_prefix: str = "poc/parallel-edit") -> None:
    """Clean up any existing test branches from previous runs."""
    print("Cleaning up any existing test branches...")

    # Delete local branches
    for i in [1, 2]:
        branch_name = f"{branch_prefix}-{i}"
        if branch_exists(branch_name, cwd=repo_root):
            try:
                _run_git(["branch", "-D", branch_name], cwd=repo_root, check=False)
                print(f"  Deleted branch: {branch_name}")
            except Exception:
                pass


def main() -> int:
    """Run the parallel edit demo."""
    print("=" * 60)
    print("POC 2: Parallel Git Worktree Editing")
    print("=" * 60)
    print()

    # Check prerequisites
    print("Checking prerequisites...")

    if not check_claude_available():
        print("ERROR: Claude CLI is not available.")
        return 1
    print("  Claude CLI: OK")

    try:
        repo_root = get_repo_root()
        print(f"  Repository root: {repo_root}")
    except RuntimeError as e:
        print(f"ERROR: Not in a git repository: {e}")
        return 1

    default_branch = get_default_branch(repo_root)
    print(f"  Default branch: {default_branch}")

    worktree_base = get_worktree_base_path(repo_root)
    print(f"  Worktree base: {worktree_base}")
    print()

    # Clean up from previous runs
    cleanup_test_branches(repo_root)
    print()

    # Define the parallel tasks
    tasks = [
        {
            "branch": "poc/parallel-edit-1",
            "instruction": "Feature Alpha Documentation",
        },
        {
            "branch": "poc/parallel-edit-2",
            "instruction": "Feature Beta Documentation",
        },
    ]

    print(f"Creating {len(tasks)} worktrees for parallel editing...")
    print()

    results: list[dict[str, Any]] = []
    worktrees: list[Worktree] = []

    # Create worktrees first
    for task in tasks:
        branch_name = task["branch"]
        safe_name = branch_name.replace("/", "-")
        worktree_path = worktree_base / safe_name

        # Clean up if exists
        if worktree_path.exists():
            import shutil
            shutil.rmtree(worktree_path, ignore_errors=True)
            _run_git(["worktree", "prune"], cwd=repo_root, check=False)

        try:
            print(f"Creating worktree for {branch_name}...")
            worktree = create_worktree(
                branch_name=branch_name,
                worktree_path=worktree_path,
                base_branch=default_branch,
                cwd=repo_root,
            )
            worktrees.append(worktree)
            print(f"  Created: {worktree}")
        except Exception as e:
            print(f"  Failed to create worktree: {e}")

    if len(worktrees) < 2:
        print("\nERROR: Could not create all worktrees")
        return 1

    print()
    print("Starting parallel edit tasks...")
    print("-" * 60)

    # Execute tasks in parallel
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {}

        for i, worktree in enumerate(worktrees):
            task = tasks[i]
            future = executor.submit(
                edit_readme_task,
                worktree.path,
                task["branch"],
                task["instruction"],
            )
            futures[future] = task["branch"]

        # Collect results as they complete
        for future in as_completed(futures):
            branch = futures[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                print(f"\n[ERROR] Branch {branch}: {e}")
                results.append({
                    "branch": branch,
                    "success": False,
                    "error": str(e),
                })

    print()
    print("-" * 60)
    print("Cleaning up worktrees...")

    for worktree in worktrees:
        try:
            remove_worktree(worktree, cwd=repo_root, force=True, delete_branch=False)
            print(f"  Removed worktree: {worktree.branch}")
        except Exception as e:
            print(f"  Failed to remove {worktree.branch}: {e}")

    # Summary
    print()
    print("=" * 60)
    print("Summary")
    print("=" * 60)

    successful = sum(1 for r in results if r.get("success", False))
    print(f"Successful: {successful}/{len(results)}")
    print()

    for result in results:
        status = "PASS" if result.get("success") else "FAIL"
        branch = result.get("branch", "unknown")
        print(f"  [{status}] {branch}")
        if result.get("error"):
            print(f"         Error: {result['error']}")

    print()

    if successful == len(results):
        print("POC 2 PASSED: Successfully executed parallel edits in worktrees")
        print()
        print("Note: The following branches were created and contain the edits:")
        for task in tasks:
            print(f"  - {task['branch']}")
        print()
        print("You can inspect them with: git log <branch-name>")
    else:
        print("POC 2 FAILED: Some parallel edits failed")

    return 0 if successful == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
