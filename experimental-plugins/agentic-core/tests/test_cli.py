"""Tests for CLI commands."""

from typer.testing import CliRunner

from agentic_core.cli import app

runner = CliRunner()


def test_version():
    """Test version option outputs version string."""
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "agentic-core" in result.stdout
    assert "0.1.0" in result.stdout


def test_help():
    """Test help option shows usage."""
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "agentic" in result.stdout.lower()
