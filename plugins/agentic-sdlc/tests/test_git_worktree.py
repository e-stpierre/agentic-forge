"""Tests for git worktree management."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from agentic_sdlc.git.worktree import (
    Worktree,
    _generate_suffix,
    _run_git,
    _sanitize_name,
    _truncate,
    checkout_branch,
    commit_changes,
    create_branch,
    create_worktree,
    get_current_branch,
    get_default_branch,
    get_executable,
    get_repo_root,
    list_agentic_worktrees,
    list_worktrees,
    prune_orphaned,
    push_branch,
    remove_worktree,
)


class TestGetExecutable:
    """Tests for get_executable function."""

    def test_get_executable_git(self) -> None:
        """Test getting git executable."""
        # Git should be available in most test environments
        try:
            path = get_executable("git")
            assert path is not None
            assert len(path) > 0
        except FileNotFoundError:
            pytest.skip("Git not available in test environment")

    def test_get_executable_not_found(self) -> None:
        """Test getting nonexistent executable."""
        with pytest.raises(FileNotFoundError, match="Executable not found"):
            get_executable("nonexistent_git_12345")


class TestWorktreeDataclass:
    """Tests for Worktree dataclass."""

    def test_worktree_creation(self, temp_dir: Path) -> None:
        """Test creating Worktree instance."""
        worktree = Worktree(
            path=temp_dir / "test-worktree",
            branch="feature/test",
            base_branch="main",
        )

        assert worktree.path == temp_dir / "test-worktree"
        assert worktree.branch == "feature/test"
        assert worktree.base_branch == "main"

    def test_worktree_exists_true(self, temp_dir: Path) -> None:
        """Test exists() returns True when directory exists."""
        worktree_dir = temp_dir / "existing-worktree"
        worktree_dir.mkdir()

        worktree = Worktree(
            path=worktree_dir,
            branch="test",
            base_branch="main",
        )

        assert worktree.exists() is True

    def test_worktree_exists_false(self, temp_dir: Path) -> None:
        """Test exists() returns False when directory doesn't exist."""
        worktree = Worktree(
            path=temp_dir / "nonexistent",
            branch="test",
            base_branch="main",
        )

        assert worktree.exists() is False


class TestTruncate:
    """Tests for _truncate helper."""

    def test_truncate_short_name(self) -> None:
        """Test truncate doesn't affect short names."""
        assert _truncate("short", 30) == "short"

    def test_truncate_long_name(self) -> None:
        """Test truncate limits long names."""
        long_name = "a" * 50
        result = _truncate(long_name, 30)
        assert len(result) == 30

    def test_truncate_default_length(self) -> None:
        """Test truncate with default max length."""
        name = "a" * 40
        result = _truncate(name)
        assert len(result) == 30


class TestGenerateSuffix:
    """Tests for _generate_suffix helper."""

    def test_generate_suffix_length(self) -> None:
        """Test suffix has correct length."""
        suffix = _generate_suffix()
        assert len(suffix) == 6

    def test_generate_suffix_unique(self) -> None:
        """Test suffixes are unique."""
        suffixes = [_generate_suffix() for _ in range(10)]
        assert len(set(suffixes)) == 10

    def test_generate_suffix_hex(self) -> None:
        """Test suffix is valid hex."""
        suffix = _generate_suffix()
        int(suffix, 16)  # Should not raise


class TestSanitizeName:
    """Tests for _sanitize_name helper."""

    def test_sanitize_name_lowercase(self) -> None:
        """Test name is lowercased."""
        assert _sanitize_name("MyName") == "myname"

    def test_sanitize_name_slashes(self) -> None:
        """Test slashes are replaced."""
        assert _sanitize_name("feature/test") == "feature-test"

    def test_sanitize_name_spaces(self) -> None:
        """Test spaces are replaced."""
        assert _sanitize_name("my name") == "my-name"

    def test_sanitize_name_underscores(self) -> None:
        """Test underscores are replaced."""
        assert _sanitize_name("my_name") == "my-name"

    def test_sanitize_name_combined(self) -> None:
        """Test combined transformations."""
        assert _sanitize_name("Feature/My_Test Name") == "feature-my-test-name"


class TestRunGit:
    """Tests for _run_git helper."""

    @patch("agentic_sdlc.git.worktree.subprocess.run")
    @patch("agentic_sdlc.git.worktree.get_executable")
    def test_run_git_success(self, mock_get_exe, mock_run) -> None:
        """Test successful git command."""
        mock_get_exe.return_value = "/usr/bin/git"
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="output",
            stderr="",
        )

        result = _run_git(["status"])

        assert result.returncode == 0
        mock_run.assert_called_once()

    @patch("agentic_sdlc.git.worktree.subprocess.run")
    @patch("agentic_sdlc.git.worktree.get_executable")
    def test_run_git_failure_raises(self, mock_get_exe, mock_run) -> None:
        """Test failed git command raises error."""
        mock_get_exe.return_value = "/usr/bin/git"
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="error message",
        )

        with pytest.raises(RuntimeError, match="Git command failed"):
            _run_git(["status"])

    @patch("agentic_sdlc.git.worktree.subprocess.run")
    @patch("agentic_sdlc.git.worktree.get_executable")
    def test_run_git_failure_no_check(self, mock_get_exe, mock_run) -> None:
        """Test failed git command without check doesn't raise."""
        mock_get_exe.return_value = "/usr/bin/git"
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="error message",
        )

        result = _run_git(["status"], check=False)

        assert result.returncode == 1


class TestGetRepoRoot:
    """Tests for get_repo_root function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_get_repo_root(self, mock_run) -> None:
        """Test getting repository root."""
        mock_run.return_value = MagicMock(stdout="/path/to/repo\n")

        root = get_repo_root()

        assert root == Path("/path/to/repo")
        mock_run.assert_called_with(["rev-parse", "--show-toplevel"], cwd=None)


class TestGetDefaultBranch:
    """Tests for get_default_branch function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_get_default_branch_from_origin(self, mock_run) -> None:
        """Test getting default branch from origin HEAD."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="refs/remotes/origin/main\n",
        )

        branch = get_default_branch()

        assert branch == "main"

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_get_default_branch_fallback_main(self, mock_run) -> None:
        """Test fallback to main branch."""

        def side_effect(args, **kwargs):
            if args[0] == "symbolic-ref":
                result = MagicMock(returncode=1)
                return result
            elif args[0] == "rev-parse" and "main" in args:
                return MagicMock(returncode=0)
            return MagicMock(returncode=1)

        mock_run.side_effect = side_effect

        branch = get_default_branch()

        assert branch == "main"


class TestGetCurrentBranch:
    """Tests for get_current_branch function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_get_current_branch(self, mock_run) -> None:
        """Test getting current branch."""
        mock_run.return_value = MagicMock(stdout="feature/my-branch\n")

        branch = get_current_branch()

        assert branch == "feature/my-branch"


class TestCreateWorktree:
    """Tests for create_worktree function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    @patch("agentic_sdlc.git.worktree.get_repo_root")
    @patch("agentic_sdlc.git.worktree.get_default_branch")
    def test_create_worktree(self, mock_default, mock_root, mock_run, temp_dir: Path) -> None:
        """Test creating a worktree."""
        mock_root.return_value = temp_dir
        mock_default.return_value = "main"

        worktree = create_worktree(
            workflow_name="test-workflow",
            step_name="analyze-bugs",
            repo_root=temp_dir,
        )

        assert worktree.base_branch == "main"
        assert "test-workflow" in worktree.path.name.lower()
        assert "analyze-bugs" in worktree.path.name.lower()
        assert worktree.branch.startswith("agentic/")

    @patch("agentic_sdlc.git.worktree._run_git")
    @patch("agentic_sdlc.git.worktree.get_repo_root")
    def test_create_worktree_custom_base(self, mock_root, mock_run, temp_dir: Path) -> None:
        """Test creating worktree with custom base branch."""
        mock_root.return_value = temp_dir

        worktree = create_worktree(
            workflow_name="test",
            step_name="step",
            base_branch="develop",
            repo_root=temp_dir,
        )

        assert worktree.base_branch == "develop"


class TestRemoveWorktree:
    """Tests for remove_worktree function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    @patch("agentic_sdlc.git.worktree.get_repo_root")
    def test_remove_worktree(self, mock_root, mock_run, temp_dir: Path) -> None:
        """Test removing a worktree."""
        mock_root.return_value = temp_dir
        mock_run.return_value = MagicMock(returncode=0)

        worktree = Worktree(
            path=temp_dir / ".worktrees" / "test",
            branch="agentic/test",
            base_branch="main",
        )

        remove_worktree(worktree, repo_root=temp_dir)

        # Should have called git worktree remove and branch delete
        assert mock_run.call_count >= 1

    @patch("agentic_sdlc.git.worktree._run_git")
    @patch("agentic_sdlc.git.worktree.get_repo_root")
    def test_remove_worktree_keep_branch(self, mock_root, mock_run, temp_dir: Path) -> None:
        """Test removing worktree while keeping branch."""
        mock_root.return_value = temp_dir
        mock_run.return_value = MagicMock(returncode=0)

        worktree = Worktree(
            path=temp_dir / ".worktrees" / "test",
            branch="agentic/test",
            base_branch="main",
        )

        remove_worktree(worktree, repo_root=temp_dir, delete_branch=False)

        # Should not call branch delete
        calls = [str(c) for c in mock_run.call_args_list]
        assert not any("branch" in c and "-D" in c for c in calls)


class TestListWorktrees:
    """Tests for list_worktrees function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    @patch("agentic_sdlc.git.worktree.get_repo_root")
    def test_list_worktrees(self, mock_root, mock_run, temp_dir: Path) -> None:
        """Test listing worktrees."""
        mock_root.return_value = temp_dir
        mock_run.return_value = MagicMock(
            stdout="""worktree /path/to/main
branch refs/heads/main

worktree /path/to/feature
branch refs/heads/feature/test

"""
        )

        worktrees = list_worktrees(temp_dir)

        assert len(worktrees) == 2
        assert worktrees[0].path == Path("/path/to/main")


class TestListAgenticWorktrees:
    """Tests for list_agentic_worktrees function."""

    @patch("agentic_sdlc.git.worktree.list_worktrees")
    def test_list_agentic_worktrees(self, mock_list) -> None:
        """Test listing only agentic worktrees."""
        mock_list.return_value = [
            Worktree(Path("/path/main"), "main", ""),
            Worktree(Path("/path/agentic-test"), "agentic/test", ""),
            Worktree(Path("/path/feature"), "feature/test", ""),
        ]

        worktrees = list_agentic_worktrees()

        assert len(worktrees) == 1
        assert worktrees[0].branch == "agentic/test"


class TestPruneOrphaned:
    """Tests for prune_orphaned function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    @patch("agentic_sdlc.git.worktree.get_repo_root")
    def test_prune_orphaned_empty(self, mock_root, mock_run, temp_dir: Path) -> None:
        """Test pruning when no orphans exist."""
        mock_root.return_value = temp_dir
        mock_run.return_value = MagicMock(returncode=0)

        cleaned = prune_orphaned(temp_dir)

        assert cleaned == 0

    @patch("agentic_sdlc.git.worktree._run_git")
    @patch("agentic_sdlc.git.worktree.get_repo_root")
    def test_prune_orphaned_cleans_stale(self, mock_root, mock_run, temp_dir: Path) -> None:
        """Test pruning removes stale agentic worktrees."""
        mock_root.return_value = temp_dir
        mock_run.return_value = MagicMock(returncode=0)

        # Create stale worktree directory without .git
        worktrees_dir = temp_dir / ".worktrees"
        worktrees_dir.mkdir()
        stale_dir = worktrees_dir / "agentic-stale-test"
        stale_dir.mkdir()

        cleaned = prune_orphaned(temp_dir)

        assert cleaned == 1
        assert not stale_dir.exists()


class TestCreateBranch:
    """Tests for create_branch function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    @patch("agentic_sdlc.git.worktree.get_default_branch")
    def test_create_branch(self, mock_default, mock_run) -> None:
        """Test creating a branch."""
        mock_default.return_value = "main"

        branch = create_branch("feature/new-branch")

        assert branch == "feature/new-branch"
        mock_run.assert_called()

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_create_branch_custom_base(self, mock_run) -> None:
        """Test creating branch with custom base."""
        branch = create_branch("feature/test", base_branch="develop")

        assert branch == "feature/test"
        call_args = mock_run.call_args[0][0]
        assert "develop" in call_args


class TestCheckoutBranch:
    """Tests for checkout_branch function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_checkout_branch(self, mock_run) -> None:
        """Test checking out a branch."""
        checkout_branch("feature/test")

        mock_run.assert_called_with(["checkout", "feature/test"], cwd=None)


class TestCommitChanges:
    """Tests for commit_changes function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_commit_changes_with_changes(self, mock_run) -> None:
        """Test committing when there are changes."""
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git add
            MagicMock(returncode=0, stdout="M file.txt\n"),  # git status
            MagicMock(returncode=0),  # git commit
        ]

        result = commit_changes("Test commit")

        assert result is True

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_commit_changes_no_changes(self, mock_run) -> None:
        """Test committing when there are no changes."""
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git add
            MagicMock(returncode=0, stdout=""),  # git status - no changes
        ]

        result = commit_changes("Test commit")

        assert result is False

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_commit_changes_without_add_all(self, mock_run) -> None:
        """Test committing without adding all files."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="M file.txt\n"),  # git status
            MagicMock(returncode=0),  # git commit
        ]

        commit_changes("Test commit", add_all=False)

        # Should not have called git add
        calls = [str(c) for c in mock_run.call_args_list]
        assert not any("add" in c and "-A" in c for c in calls)


class TestPushBranch:
    """Tests for push_branch function."""

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_push_branch_with_upstream(self, mock_run) -> None:
        """Test pushing branch with upstream set."""
        push_branch("feature/test")

        call_args = mock_run.call_args[0][0]
        assert "push" in call_args
        assert "-u" in call_args
        assert "origin" in call_args

    @patch("agentic_sdlc.git.worktree._run_git")
    def test_push_branch_without_upstream(self, mock_run) -> None:
        """Test pushing branch without setting upstream."""
        push_branch("feature/test", set_upstream=False)

        call_args = mock_run.call_args[0][0]
        assert "-u" not in call_args
