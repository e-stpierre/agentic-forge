#!/usr/bin/env python3
"""
CLI entry points for Claude Workflows.

This module provides command-line entry points that can be invoked
directly after installing the package with pip.

Available commands:
    claude-hello      - Basic hello world demo
    claude-parallel   - Parallel editing in git worktrees
    claude-plan       - Plan then implement workflow
    claude-workflows  - Main CLI with subcommands
"""

from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from claude_workflows.runner import (
    run_claude,
    run_claude_with_command,
    check_claude_available,
)
from claude_workflows.worktree import (
    Worktree,
    create_worktree,
    remove_worktree,
    get_repo_root,
    get_worktree_base_path,
    get_default_branch,
    branch_exists,
    _run_git,
)


def hello() -> int:
    """
    POC 1: Basic hello world demo.

    Invokes Claude with a simple command and captures output.
    """
    print("=" * 50)
    print("Claude Workflows: Hello Demo")
    print("=" * 50)
    print()

    # Check if Claude is available
    print("Checking Claude CLI availability...")
    if not check_claude_available():
        print("ERROR: Claude CLI is not available.")
        print("Please ensure 'claude' is installed and in your PATH.")
        return 1

    print("Claude CLI is available.")
    print()

    # Run the demo-hello command
    prompt = "/demo-hello"
    print(f"Running: claude -p \"{prompt}\"")
    print("-" * 50)

    result = run_claude(prompt, print_output=True)

    print("-" * 50)
    print()

    # Report results
    print("Results:")
    print(f"  Return code: {result.returncode}")
    print(f"  Success: {result.success}")

    if result.stderr:
        print(f"  Stderr: {result.stderr}")

    print()
    print("=" * 50)

    if result.success:
        print("SUCCESS: Claude invocation completed")
    else:
        print("FAILED: Claude invocation failed")

    return 0 if result.success else 1


def _edit_readme_task(
    worktree_path: Path,
    branch_name: str,
    edit_instruction: str,
) -> dict[str, Any]:
    """Task to edit README.md in a worktree."""
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


def parallel() -> int:
    """
    POC 2: Parallel editing with git worktrees.

    Creates two worktrees, runs Claude in parallel to edit README.md
    in each branch, then commits the changes.
    """
    print("=" * 60)
    print("Claude Workflows: Parallel Edit Demo")
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
    print("Cleaning up any existing test branches...")
    for i in [1, 2]:
        branch_name = f"poc/parallel-edit-{i}"
        if branch_exists(branch_name, cwd=repo_root):
            try:
                _run_git(["branch", "-D", branch_name], cwd=repo_root, check=False)
                print(f"  Deleted branch: {branch_name}")
            except Exception:
                pass
    print()

    # Define the parallel tasks
    tasks = [
        {"branch": "poc/parallel-edit-1", "instruction": "Feature Alpha Documentation"},
        {"branch": "poc/parallel-edit-2", "instruction": "Feature Beta Documentation"},
    ]

    print(f"Creating {len(tasks)} worktrees for parallel editing...")
    print()

    results: list[dict[str, Any]] = []
    worktrees: list[Worktree] = []

    # Create worktrees first
    import shutil
    for task in tasks:
        branch_name = task["branch"]
        safe_name = branch_name.replace("/", "-")
        worktree_path = worktree_base / safe_name

        # Clean up if exists
        if worktree_path.exists():
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
                _edit_readme_task,
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
        print("SUCCESS: Parallel edits completed in worktrees")
        print()
        print("Note: The following branches were created:")
        for task in tasks:
            print(f"  - {task['branch']}")
        print()
        print("Inspect them with: git log <branch-name>")
    else:
        print("FAILED: Some parallel edits failed")

    return 0 if successful == len(results) else 1


def _create_plan(feature_name: str, cwd: Path) -> tuple[bool, Path | None]:
    """Create a plan for the feature."""
    print()
    print("=" * 60)
    print("PHASE 1: Creating Plan")
    print("=" * 60)
    print()

    print(f"Feature: {feature_name}")
    print(f"Running: /create-readme-plan {feature_name}")
    print("-" * 60)

    result = run_claude_with_command(
        "create-readme-plan",
        args=feature_name,
        cwd=cwd,
        print_output=True,
        timeout=120,
    )

    print("-" * 60)

    if not result.success:
        print(f"Failed to create plan: {result.stderr}")
        return False, None

    # Derive the expected plan path
    safe_name = feature_name.lower().replace(" ", "-").replace("_", "-")
    plan_path = cwd / "docs" / "plans" / f"readme-{safe_name}-plan.md"

    # Check if plan was created
    if plan_path.exists():
        print(f"\nPlan created at: {plan_path}")
        return True, plan_path

    # Try to find the plan if naming differs
    plans_dir = cwd / "docs" / "plans"
    if plans_dir.exists():
        for plan_file in sorted(plans_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
            if safe_name in plan_file.name.lower() or "readme" in plan_file.name.lower():
                print(f"\nPlan found at: {plan_file}")
                return True, plan_file

        plan_files = list(plans_dir.glob("*.md"))
        if plan_files:
            most_recent = max(plan_files, key=lambda p: p.stat().st_mtime)
            print(f"\nPlan found at: {most_recent}")
            return True, most_recent

    print("\nWarning: Plan file not found at expected location")
    print(f"Expected: {plan_path}")
    return False, None


def _implement_plan(plan_path: Path, cwd: Path) -> bool:
    """Implement the plan."""
    print()
    print("=" * 60)
    print("PHASE 2: Implementing Plan")
    print("=" * 60)
    print()

    print(f"Plan file: {plan_path}")
    print(f"Running: /implement-from-plan {plan_path}")
    print("-" * 60)

    result = run_claude_with_command(
        "implement-from-plan",
        args=str(plan_path),
        cwd=cwd,
        print_output=True,
        timeout=120,
    )

    print("-" * 60)

    if not result.success:
        print(f"Failed to implement plan: {result.stderr}")
        return False

    print("\nImplementation phase complete")
    return True


def _commit_changes(message: str, cwd: Path) -> bool:
    """Commit the changes."""
    print()
    print("=" * 60)
    print("PHASE 3: Committing Changes")
    print("=" * 60)
    print()

    print(f"Running: /git-commit {message}")
    print("-" * 60)

    result = run_claude_with_command(
        "git-commit",
        args=message,
        cwd=cwd,
        print_output=True,
        timeout=60,
    )

    print("-" * 60)

    if result.success:
        print("\nChanges committed successfully")
    else:
        print(f"\nCommit failed: {result.stderr}")

    return result.success


def plan() -> int:
    """
    POC 3: Plan then implement workflow.

    Demonstrates orchestrated workflow:
    1. First Claude instance creates a plan
    2. Second Claude instance implements the plan
    """
    parser = argparse.ArgumentParser(
        description="Plan then implement workflow",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    claude-plan "API Documentation"
    claude-plan --no-commit "Test Feature"
    claude-plan --skip-implement "Draft Feature"
        """,
    )
    parser.add_argument(
        "feature_name",
        nargs="?",
        default="Demo Feature",
        help="Name of the feature to add to README",
    )
    parser.add_argument(
        "--no-commit",
        action="store_true",
        help="Skip the commit step",
    )
    parser.add_argument(
        "--skip-implement",
        action="store_true",
        help="Only create the plan, skip implementation",
    )

    args = parser.parse_args()

    print("=" * 60)
    print("Claude Workflows: Plan Then Implement")
    print("=" * 60)
    print()
    print(f"Feature: {args.feature_name}")
    print(f"Options: commit={not args.no_commit}, implement={not args.skip_implement}")

    # Check prerequisites
    print()
    print("Checking prerequisites...")

    if not check_claude_available():
        print("ERROR: Claude CLI is not available.")
        return 1
    print("  Claude CLI: OK")

    try:
        cwd = get_repo_root()
        print(f"  Repository: {cwd}")
    except RuntimeError as e:
        print(f"ERROR: {e}")
        return 1

    # Phase 1: Create the plan
    success, plan_path = _create_plan(args.feature_name, cwd)
    if not success:
        print("\nFailed at planning phase")
        return 1

    if args.skip_implement:
        print()
        print("=" * 60)
        print("Workflow stopped after planning (--skip-implement)")
        print("=" * 60)
        print(f"\nPlan saved to: {plan_path}")
        return 0

    # Phase 2: Implement the plan
    if plan_path and plan_path.exists():
        success = _implement_plan(plan_path, cwd)
        if not success:
            print("\nFailed at implementation phase")
            return 1
    else:
        print("\nSkipping implementation: plan file not found")
        return 1

    # Phase 3: Commit (optional)
    if not args.no_commit:
        success = _commit_changes(
            f"Add {args.feature_name} section to README",
            cwd,
        )
        if not success:
            print("\nWarning: Commit failed (changes are still saved)")

    # Final summary
    print()
    print("=" * 60)
    print("Workflow Complete!")
    print("=" * 60)
    print()
    print("Summary:")
    print(f"  Feature: {args.feature_name}")
    print(f"  Plan: {plan_path}")
    print(f"  Implementation: {'Completed' if not args.skip_implement else 'Skipped'}")
    print(f"  Commit: {'Completed' if not args.no_commit else 'Skipped'}")
    print()
    print("SUCCESS: Sequential orchestration workflow completed")

    return 0


def main() -> int:
    """
    Main CLI entry point with subcommands.

    Usage:
        claude-workflows hello
        claude-workflows parallel
        claude-workflows plan "Feature Name"
    """
    parser = argparse.ArgumentParser(
        prog="claude-workflows",
        description="Python orchestration toolkit for Claude Code CLI workflows",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
    hello       Basic hello world demo
    parallel    Parallel editing in git worktrees
    plan        Plan then implement workflow

Examples:
    claude-workflows hello
    claude-workflows parallel
    claude-workflows plan "Add authentication"

Or use the direct commands:
    claude-hello
    claude-parallel
    claude-plan "Feature Name"
        """,
    )
    parser.add_argument(
        "--version",
        action="version",
        version="claude-workflows 1.0.0",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Hello subcommand
    subparsers.add_parser("hello", help="Basic hello world demo")

    # Parallel subcommand
    subparsers.add_parser("parallel", help="Parallel editing in git worktrees")

    # Plan subcommand
    plan_parser = subparsers.add_parser("plan", help="Plan then implement workflow")
    plan_parser.add_argument(
        "feature_name",
        nargs="?",
        default="Demo Feature",
        help="Name of the feature",
    )
    plan_parser.add_argument("--no-commit", action="store_true")
    plan_parser.add_argument("--skip-implement", action="store_true")

    args = parser.parse_args()

    if args.command == "hello":
        return hello()
    elif args.command == "parallel":
        return parallel()
    elif args.command == "plan":
        # Re-parse with plan's parser
        sys.argv = ["claude-plan"] + sys.argv[2:]
        return plan()
    else:
        parser.print_help()
        return 0


if __name__ == "__main__":
    sys.exit(main())
