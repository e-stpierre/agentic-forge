#!/usr/bin/env python3
"""
POC 3: Plan then implement workflow.

Demonstrates orchestrated workflow:
1. First Claude instance creates a plan
2. Second Claude instance implements the plan

Usage:
    python plan_then_implement_demo.py <feature-name>
    python plan_then_implement_demo.py "API Documentation"
    python plan_then_implement_demo.py --no-commit "Test Feature"

Requirements:
    - Claude Code CLI must be installed and available in PATH
    - Commands create-readme-plan and implement-from-plan must be available
    - Must be run from within a git repository
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add workflows to path for imports
workflows_path = Path(__file__).parent.parent / "workflows"
sys.path.insert(0, str(workflows_path.parent))

from workflows.runner import run_claude, run_claude_with_command, check_claude_available
from workflows.worktree import get_repo_root


def create_plan(feature_name: str, cwd: Path) -> tuple[bool, Path | None]:
    """
    Create a plan for the feature.

    Args:
        feature_name: Name of the feature to plan
        cwd: Working directory

    Returns:
        tuple of (success, plan_file_path)
    """
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
        # Look for any recently created plan file
        for plan_file in sorted(plans_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
            if safe_name in plan_file.name.lower() or "readme" in plan_file.name.lower():
                print(f"\nPlan found at: {plan_file}")
                return True, plan_file

        # Just take the most recent one
        plan_files = list(plans_dir.glob("*.md"))
        if plan_files:
            most_recent = max(plan_files, key=lambda p: p.stat().st_mtime)
            print(f"\nPlan found at: {most_recent}")
            return True, most_recent

    print("\nWarning: Plan file not found at expected location")
    print(f"Expected: {plan_path}")
    return False, None


def implement_plan(plan_path: Path, cwd: Path) -> bool:
    """
    Implement the plan.

    Args:
        plan_path: Path to the plan file
        cwd: Working directory

    Returns:
        True if successful
    """
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


def commit_changes(message: str, cwd: Path) -> bool:
    """
    Commit the changes using the core git-commit command.

    Args:
        message: Commit message
        cwd: Working directory

    Returns:
        True if successful
    """
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


def main() -> int:
    """Run the plan-then-implement demo."""
    parser = argparse.ArgumentParser(
        description="POC 3: Plan then implement workflow",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python plan_then_implement_demo.py "API Documentation"
    python plan_then_implement_demo.py --no-commit "Test Feature"
        """,
    )
    parser.add_argument(
        "feature_name",
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
    print("POC 3: Plan Then Implement Workflow")
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
    success, plan_path = create_plan(args.feature_name, cwd)
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
        success = implement_plan(plan_path, cwd)
        if not success:
            print("\nFailed at implementation phase")
            return 1
    else:
        print("\nSkipping implementation: plan file not found")
        return 1

    # Phase 3: Commit (optional)
    if not args.no_commit:
        success = commit_changes(
            f"Add {args.feature_name} section to README",
            cwd,
        )
        if not success:
            print("\nWarning: Commit failed (changes are still saved)")
            # Don't fail the whole workflow for commit issues

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
    print("POC 3 PASSED: Sequential orchestration workflow completed")

    return 0


if __name__ == "__main__":
    sys.exit(main())
