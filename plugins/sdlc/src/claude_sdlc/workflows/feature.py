"""
Feature workflow - Complete feature development lifecycle.

Orchestrates: Plan -> Implement -> Review -> PR
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from claude_core import (
    run_claude_with_command,
    check_claude_available,
    get_repo_root,
    configure_logging,
    get_logger,
)


@dataclass
class FeatureWorkflowConfig:
    """Configuration for the feature workflow."""

    feature_description: str
    interactive: bool = False
    skip_review: bool = False
    skip_pr: bool = False
    dry_run: bool = False
    log_file: str | None = None
    timeout: int = 300  # 5 minutes per step


@dataclass
class WorkflowState:
    """Tracks workflow progress and results."""

    plan_path: Path | None = None
    branch_name: str | None = None
    pr_url: str | None = None
    steps_completed: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def success(self) -> bool:
        return len(self.errors) == 0


def _run_step(
    step_name: str,
    command: str,
    args: str,
    cwd: Path,
    state: WorkflowState,
    timeout: int = 300,
) -> tuple[bool, str]:
    """Run a workflow step and track its result."""
    logger = get_logger()

    print()
    print("=" * 60)
    print(f"Step: {step_name}")
    print("=" * 60)
    print()
    print(f"Running: /{command} {args}")
    print("-" * 60)

    logger.info(f"Starting step: {step_name}", command=command, args=args)

    result = run_claude_with_command(
        command,
        args=args,
        cwd=cwd,
        print_output=True,
        timeout=timeout,
    )

    print("-" * 60)

    if result.success:
        state.steps_completed.append(step_name)
        logger.info(f"Step completed: {step_name}")
        return True, result.stdout
    else:
        error_msg = f"{step_name} failed: {result.stderr}"
        state.errors.append(error_msg)
        logger.error(f"Step failed: {step_name}", error=result.stderr)
        return False, result.stderr


def feature_workflow(config: FeatureWorkflowConfig) -> WorkflowState:
    """
    Execute the complete feature development workflow.

    Steps:
    1. Create branch (git-branch)
    2. Create plan (plan-feature)
    3. Implement plan (implement)
    4. Review changes (review) [optional]
    5. Commit and push (git-commit)
    6. Create PR (git-pr) [optional]

    Args:
        config: Workflow configuration

    Returns:
        WorkflowState with results
    """
    state = WorkflowState()

    # Setup logging if configured
    if config.log_file:
        configure_logging(log_file=config.log_file)

    logger = get_logger()
    logger.info("Starting feature workflow", feature=config.feature_description)

    print("=" * 60)
    print("Feature Workflow")
    print("=" * 60)
    print()
    print(f"Feature: {config.feature_description}")
    print(f"Options: interactive={config.interactive}, review={not config.skip_review}, pr={not config.skip_pr}")
    print()

    # Check prerequisites
    print("Checking prerequisites...")
    if not check_claude_available():
        state.errors.append("Claude CLI is not available")
        print("ERROR: Claude CLI is not available")
        return state
    print("  Claude CLI: OK")

    try:
        cwd = get_repo_root()
        print(f"  Repository: {cwd}")
    except RuntimeError as e:
        state.errors.append(str(e))
        print(f"ERROR: {e}")
        return state

    if config.dry_run:
        print()
        print("DRY RUN - Would execute the following steps:")
        print("  1. Create feature branch")
        print("  2. Generate implementation plan")
        print("  3. Implement the plan")
        if not config.skip_review:
            print("  4. Review changes")
        print("  5. Commit and push changes")
        if not config.skip_pr:
            print("  6. Create pull request")
        return state

    # Step 1: Create branch
    slug = config.feature_description.lower().replace(" ", "-")[:30]
    branch_args = f"feature {slug}"
    success, output = _run_step(
        "Create Branch",
        "core:git-branch",
        branch_args,
        cwd,
        state,
        timeout=60,
    )
    if not success:
        return state
    state.branch_name = f"feature/{slug}"

    # Step 2: Create plan
    plan_args = config.feature_description
    if config.interactive:
        plan_args += " --interactive"
    success, output = _run_step(
        "Create Plan",
        "sdlc:plan-feature",
        plan_args,
        cwd,
        state,
        timeout=config.timeout,
    )
    if not success:
        return state

    # Find the plan file
    plans_dir = cwd / "docs" / "plans"
    if plans_dir.exists():
        plan_files = sorted(plans_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        if plan_files:
            state.plan_path = plan_files[0]
            print(f"Plan created: {state.plan_path}")

    # Step 3: Implement
    if state.plan_path:
        success, output = _run_step(
            "Implement Plan",
            "sdlc:implement",
            str(state.plan_path),
            cwd,
            state,
            timeout=config.timeout,
        )
        if not success:
            return state
    else:
        state.errors.append("No plan file found to implement")
        return state

    # Step 4: Review (optional)
    if not config.skip_review:
        success, output = _run_step(
            "Review Changes",
            "sdlc:review",
            "",
            cwd,
            state,
            timeout=config.timeout,
        )
        # Review failures are warnings, not blockers
        if not success:
            print("Warning: Review step encountered issues (continuing)")
            state.errors.pop()  # Remove from errors since it's not fatal

    # Step 5: Commit and push
    commit_msg = f"Implement: {config.feature_description}"
    success, output = _run_step(
        "Commit Changes",
        "core:git-commit",
        commit_msg,
        cwd,
        state,
        timeout=120,
    )
    if not success:
        return state

    # Step 6: Create PR (optional)
    if not config.skip_pr:
        success, output = _run_step(
            "Create Pull Request",
            "core:git-pr",
            "",
            cwd,
            state,
            timeout=120,
        )
        if success and "github.com" in output:
            # Try to extract PR URL
            for line in output.split("\n"):
                if "github.com" in line and "/pull/" in line:
                    state.pr_url = line.strip()
                    break

    # Final summary
    print()
    print("=" * 60)
    print("Workflow Complete!")
    print("=" * 60)
    print()
    print(f"Feature: {config.feature_description}")
    print(f"Branch: {state.branch_name}")
    print(f"Plan: {state.plan_path}")
    print(f"Steps completed: {len(state.steps_completed)}")
    if state.pr_url:
        print(f"PR: {state.pr_url}")
    print()

    logger.info("Feature workflow completed", success=state.success, steps=len(state.steps_completed))

    return state


def main() -> int:
    """CLI entry point for feature workflow."""
    parser = argparse.ArgumentParser(
        prog="claude-feature",
        description="Complete feature development workflow: plan -> implement -> review -> PR",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    claude-feature "Add user authentication"
    claude-feature --interactive "Add dark mode support"
    claude-feature --skip-review "Quick fix for button styling"
    claude-feature --dry-run "Test workflow"
        """,
    )
    parser.add_argument(
        "feature_description",
        help="Description of the feature to implement",
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Enable interactive mode with user prompts",
    )
    parser.add_argument(
        "--skip-review",
        action="store_true",
        help="Skip the code review step",
    )
    parser.add_argument(
        "--skip-pr",
        action="store_true",
        help="Skip creating a pull request",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without executing",
    )
    parser.add_argument(
        "--log-file",
        help="Path to JSON log file for structured logging",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Timeout per step in seconds (default: 300)",
    )

    args = parser.parse_args()

    config = FeatureWorkflowConfig(
        feature_description=args.feature_description,
        interactive=args.interactive,
        skip_review=args.skip_review,
        skip_pr=args.skip_pr,
        dry_run=args.dry_run,
        log_file=args.log_file,
        timeout=args.timeout,
    )

    state = feature_workflow(config)
    return 0 if state.success else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
