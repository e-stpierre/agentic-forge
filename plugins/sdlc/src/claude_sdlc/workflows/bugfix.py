"""
Bugfix workflow - Complete bug fix lifecycle.

Orchestrates: Diagnose -> Fix -> Test -> PR
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path

from claude_core import (
    run_claude_with_command,
    check_claude_available,
    get_repo_root,
    configure_logging,
    get_logger,
)


@dataclass
class BugfixWorkflowConfig:
    """Configuration for the bugfix workflow."""

    bug_description: str
    issue_number: int | None = None
    interactive: bool = False
    skip_test: bool = False
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


def bugfix_workflow(config: BugfixWorkflowConfig) -> WorkflowState:
    """
    Execute the complete bugfix workflow.

    Steps:
    1. Read issue (if issue_number provided)
    2. Create branch (git-branch)
    3. Diagnose and plan fix (plan-bug)
    4. Implement fix (implement)
    5. Run tests (test) [optional]
    6. Commit and push (git-commit)
    7. Create PR (git-pr) [optional]

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
    logger.info("Starting bugfix workflow", bug=config.bug_description)

    print("=" * 60)
    print("Bugfix Workflow")
    print("=" * 60)
    print()
    print(f"Bug: {config.bug_description}")
    if config.issue_number:
        print(f"Issue: #{config.issue_number}")
    print(f"Options: interactive={config.interactive}, test={not config.skip_test}, pr={not config.skip_pr}")
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
        if config.issue_number:
            print("  1. Read GitHub issue")
        print("  2. Create fix branch")
        print("  3. Diagnose bug and create fix plan")
        print("  4. Implement the fix")
        if not config.skip_test:
            print("  5. Run tests")
        print("  6. Commit and push changes")
        if not config.skip_pr:
            print("  7. Create pull request")
        return state

    # Step 0: Read issue if provided
    bug_description = config.bug_description
    if config.issue_number:
        success, output = _run_step(
            "Read Issue",
            "core:read-gh-issue",
            str(config.issue_number),
            cwd,
            state,
            timeout=60,
        )
        if success:
            # Combine issue content with description
            bug_description = f"{config.bug_description}\n\nFrom issue #{config.issue_number}:\n{output}"

    # Step 1: Create branch
    slug = config.bug_description.lower().replace(" ", "-")[:30]
    if config.issue_number:
        branch_args = f"fix {slug} {config.issue_number}"
    else:
        branch_args = f"fix {slug}"
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
    state.branch_name = f"fix/{slug}"

    # Step 2: Diagnose and plan
    plan_args = bug_description
    if config.interactive:
        plan_args += " --interactive"
    success, output = _run_step(
        "Diagnose Bug",
        "sdlc:plan-bug",
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
        plan_files = sorted(plans_dir.glob("bugfix*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        if plan_files:
            state.plan_path = plan_files[0]
            print(f"Fix plan created: {state.plan_path}")

    # Step 3: Implement fix
    if state.plan_path:
        success, output = _run_step(
            "Implement Fix",
            "sdlc:implement",
            str(state.plan_path),
            cwd,
            state,
            timeout=config.timeout,
        )
        if not success:
            return state
    else:
        state.errors.append("No fix plan found to implement")
        return state

    # Step 4: Run tests (optional)
    if not config.skip_test:
        success, output = _run_step(
            "Run Tests",
            "sdlc:test",
            "",
            cwd,
            state,
            timeout=config.timeout,
        )
        if not success:
            print("Warning: Tests failed - review before merging")
            # Don't fail the workflow, but keep the error recorded

    # Step 5: Commit and push
    commit_msg = f"Fix: {config.bug_description}"
    if config.issue_number:
        commit_msg += f" (#{config.issue_number})"
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
    print(f"Bug: {config.bug_description}")
    if config.issue_number:
        print(f"Issue: #{config.issue_number}")
    print(f"Branch: {state.branch_name}")
    print(f"Fix plan: {state.plan_path}")
    print(f"Steps completed: {len(state.steps_completed)}")
    if state.pr_url:
        print(f"PR: {state.pr_url}")
    print()

    logger.info("Bugfix workflow completed", success=state.success, steps=len(state.steps_completed))

    return state


def main() -> int:
    """CLI entry point for bugfix workflow."""
    parser = argparse.ArgumentParser(
        prog="claude-bugfix",
        description="Complete bugfix workflow: diagnose -> fix -> test -> PR",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    claude-bugfix "Login button not responding on Safari"
    claude-bugfix --issue 123 "Fix auth timeout"
    claude-bugfix --interactive "Users can't upload files > 10MB"
    claude-bugfix --skip-test "Quick typo fix"
        """,
    )
    parser.add_argument(
        "bug_description",
        help="Description of the bug to fix",
    )
    parser.add_argument(
        "--issue",
        type=int,
        dest="issue_number",
        help="GitHub issue number to read for context",
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Enable interactive mode with user prompts",
    )
    parser.add_argument(
        "--skip-test",
        action="store_true",
        help="Skip running tests",
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

    config = BugfixWorkflowConfig(
        bug_description=args.bug_description,
        issue_number=args.issue_number,
        interactive=args.interactive,
        skip_test=args.skip_test,
        skip_pr=args.skip_pr,
        dry_run=args.dry_run,
        log_file=args.log_file,
        timeout=args.timeout,
    )

    state = bugfix_workflow(config)
    return 0 if state.success else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
