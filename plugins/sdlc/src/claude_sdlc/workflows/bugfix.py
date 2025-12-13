"""
Bugfix workflow - Complete bug fix lifecycle.

Orchestrates: Worktree -> Diagnose -> Fix -> Test -> PR

Supports parallelism by running each bugfix in an isolated git worktree.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path

from claude_core import (
    check_claude_available,
    configure_logging,
    get_logger,
    get_repo_root,
    run_claude_with_command,
)
from claude_core.worktree import (
    Worktree,
    _run_git,
    branch_exists,
    create_worktree,
    get_default_branch,
    get_worktree_base_path,
    remove_worktree,
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
    use_worktree: bool = True  # Create isolated worktree for parallel work
    cleanup_worktree: bool = False  # Remove worktree after completion
    base_branch: str | None = None  # Base branch for worktree (default: main/master)


@dataclass
class WorkflowState:
    """Tracks workflow progress and results."""

    plan_path: Path | None = None
    branch_name: str | None = None
    pr_url: str | None = None
    worktree: Worktree | None = None  # Worktree used for this workflow
    worktree_path: Path | None = None  # Path to worktree (working directory)
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


def _setup_worktree(
    config: BugfixWorkflowConfig,
    state: WorkflowState,
    repo_root: Path,
    branch_name: str,
) -> Path | None:
    """
    Create a worktree for isolated bugfix development.

    Returns the working directory (worktree path or repo root).
    """
    logger = get_logger()

    if not config.use_worktree:
        return repo_root

    print()
    print("-" * 60)
    print("Setting up worktree for parallel development...")
    print("-" * 60)

    # Determine base branch
    base_branch = config.base_branch or get_default_branch(repo_root)
    print(f"  Base branch: {base_branch}")

    # Create worktree path
    worktree_base = get_worktree_base_path(repo_root)
    safe_name = branch_name.replace("/", "-").replace("\\", "-")
    worktree_path = worktree_base / safe_name

    # Clean up if exists from previous run
    if worktree_path.exists():
        import shutil

        print(f"  Cleaning up existing worktree: {worktree_path}")
        shutil.rmtree(worktree_path, ignore_errors=True)
        _run_git(["worktree", "prune"], cwd=repo_root, check=False)

    # Clean up branch if it exists and we're recreating
    if branch_exists(branch_name, cwd=repo_root):
        print(f"  Deleting existing branch: {branch_name}")
        _run_git(["branch", "-D", branch_name], cwd=repo_root, check=False)

    try:
        worktree = create_worktree(
            branch_name=branch_name,
            worktree_path=worktree_path,
            base_branch=base_branch,
            cwd=repo_root,
        )
        state.worktree = worktree
        state.worktree_path = worktree_path
        print(f"  Created worktree: {worktree}")
        logger.info("Worktree created", branch=branch_name, path=str(worktree_path))
        return worktree_path
    except Exception as e:
        error_msg = f"Failed to create worktree: {e}"
        state.errors.append(error_msg)
        print(f"  ERROR: {error_msg}")
        logger.error("Worktree creation failed", error=str(e))
        return None


def _cleanup_worktree(
    config: BugfixWorkflowConfig,
    state: WorkflowState,
    repo_root: Path,
) -> None:
    """Clean up the worktree if configured to do so."""
    if not config.cleanup_worktree or not state.worktree:
        return

    logger = get_logger()
    print()
    print("-" * 60)
    print("Cleaning up worktree...")
    print("-" * 60)

    try:
        remove_worktree(
            state.worktree,
            cwd=repo_root,
            force=True,
            delete_branch=False,  # Keep the branch for the PR
        )
        print(f"  Removed worktree: {state.worktree.path}")
        logger.info("Worktree cleaned up", branch=state.worktree.branch)
    except Exception as e:
        print(f"  Warning: Failed to clean up worktree: {e}")
        logger.warning("Worktree cleanup failed", error=str(e))


def bugfix_workflow(config: BugfixWorkflowConfig) -> WorkflowState:
    """
    Execute the complete bugfix workflow.

    Steps:
    1. Create worktree for isolated development (enables parallelism)
    2. Read issue (if issue_number provided)
    3. Diagnose and plan fix (plan-bug)
    4. Implement fix with milestone commits (implement)
    5. Run tests (test) [optional]
    6. Final commit and push (git-commit)
    7. Create PR (git-pr) [optional]
    8. Cleanup worktree [optional]

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
    print(f"Worktree: enabled={config.use_worktree}, cleanup={config.cleanup_worktree}")
    print()

    # Check prerequisites
    print("Checking prerequisites...")
    if not check_claude_available():
        state.errors.append("Claude CLI is not available")
        print("ERROR: Claude CLI is not available")
        return state
    print("  Claude CLI: OK")

    try:
        repo_root = get_repo_root()
        print(f"  Repository: {repo_root}")
    except RuntimeError as e:
        state.errors.append(str(e))
        print(f"ERROR: {e}")
        return state

    # Generate branch name early (needed for worktree)
    slug = config.bug_description.lower().replace(" ", "-")[:30]
    if config.issue_number:
        branch_name = f"fix/{slug}-{config.issue_number}"
    else:
        branch_name = f"fix/{slug}"
    state.branch_name = branch_name

    if config.dry_run:
        print()
        print("DRY RUN - Would execute the following steps:")
        if config.use_worktree:
            print("  1. Create worktree for isolated development")
        if config.issue_number:
            print("  2. Read GitHub issue")
        print("  3. Diagnose bug and create fix plan")
        print("  4. Implement the fix (commit after each milestone)")
        if not config.skip_test:
            print("  5. Run tests")
        print("  6. Final commit and push changes")
        if not config.skip_pr:
            print("  7. Create pull request")
        if config.cleanup_worktree:
            print("  8. Clean up worktree")
        return state

    # Step 1: Create worktree for isolated development
    cwd = _setup_worktree(config, state, repo_root, branch_name)
    if cwd is None:
        return state

    # If not using worktree, we still need to create the branch
    if not config.use_worktree:
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

    # Step 2: Read issue if provided
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

    # Step 3: Diagnose and plan
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
        _cleanup_worktree(config, state, repo_root)
        return state

    # Find the plan file
    plans_dir = cwd / "docs" / "plans"
    if plans_dir.exists():
        plan_files = sorted(plans_dir.glob("bugfix*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        if plan_files:
            state.plan_path = plan_files[0]
            print(f"Fix plan created: {state.plan_path}")

    # Step 4: Implement fix with milestone commits
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
            _cleanup_worktree(config, state, repo_root)
            return state
    else:
        state.errors.append("No fix plan found to implement")
        _cleanup_worktree(config, state, repo_root)
        return state

    # Step 5: Run tests (optional)
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

    # Step 6: Final commit and push (for any remaining changes)
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
    # Don't fail if no changes to commit (milestones may have committed everything)
    if not success and "nothing to commit" not in output.lower():
        _cleanup_worktree(config, state, repo_root)
        return state
    elif not success:
        # Remove error if it was just "nothing to commit"
        state.errors.pop()

    # Step 7: Create PR (optional)
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

    # Step 8: Cleanup worktree (optional)
    _cleanup_worktree(config, state, repo_root)

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
    if state.worktree_path:
        print(f"Worktree: {state.worktree_path}")
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
        description="Complete bugfix workflow with worktree isolation for parallelism",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    claude-bugfix "Login button not responding on Safari"
    claude-bugfix --issue 123 "Fix auth timeout"
    claude-bugfix --interactive "Users can't upload files > 10MB"
    claude-bugfix --skip-test "Quick typo fix"
    claude-bugfix --no-worktree "Simple fix in main repo"
    claude-bugfix --cleanup "Fix with automatic cleanup"

Parallelism:
    By default, each bugfix runs in an isolated git worktree, enabling
    multiple fixes to be developed in parallel without conflicts.
    Use --no-worktree to work directly in the main repository.
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
    parser.add_argument(
        "--no-worktree",
        action="store_true",
        help="Work directly in main repository instead of creating a worktree",
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Remove worktree after workflow completes (keeps branch for PR)",
    )
    parser.add_argument(
        "--base-branch",
        help="Base branch for the fix (default: main/master)",
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
        use_worktree=not args.no_worktree,
        cleanup_worktree=args.cleanup,
        base_branch=args.base_branch,
    )

    state = bugfix_workflow(config)
    return 0 if state.success else 1


if __name__ == "__main__":
    import sys

    sys.exit(main())
