"""Tests for init command."""

from __future__ import annotations

import json
from argparse import Namespace
from pathlib import Path

import pytest
from agentic_sdlc.commands.init import cmd_init


class TestCmdInit:
    """Tests for the init command."""

    def test_init_creates_config_json(self, temp_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that init creates config.json next to workflows."""
        monkeypatch.chdir(temp_dir)
        args = Namespace(force=False, list_only=False)

        cmd_init(args)

        config_path = temp_dir / "agentic" / "config.json"
        assert config_path.exists()

        with open(config_path) as f:
            config = json.load(f)

        assert "outputDirectory" in config
        assert "defaults" in config
        assert config["defaults"]["model"] == "sonnet"

    def test_init_copies_workflows(self, temp_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that init copies workflow files."""
        monkeypatch.chdir(temp_dir)
        args = Namespace(force=False, list_only=False)

        cmd_init(args)

        workflows_dir = temp_dir / "agentic" / "workflows"
        assert workflows_dir.exists()
        assert list(workflows_dir.glob("*.yaml"))

    def test_init_does_not_overwrite_config_without_force(self, temp_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that init does not overwrite existing config.json without --force."""
        monkeypatch.chdir(temp_dir)
        config_dir = temp_dir / "agentic"
        config_dir.mkdir(parents=True)
        config_path = config_dir / "config.json"
        custom_config = {"outputDirectory": "custom", "defaults": {"model": "opus"}}
        config_path.write_text(json.dumps(custom_config))

        args = Namespace(force=False, list_only=False)
        cmd_init(args)

        with open(config_path) as f:
            config = json.load(f)

        assert config["defaults"]["model"] == "opus"

    def test_init_overwrites_config_with_force(self, temp_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that init overwrites config.json with --force."""
        monkeypatch.chdir(temp_dir)
        config_dir = temp_dir / "agentic"
        config_dir.mkdir(parents=True)
        config_path = config_dir / "config.json"
        custom_config = {"outputDirectory": "custom", "defaults": {"model": "opus"}}
        config_path.write_text(json.dumps(custom_config))

        args = Namespace(force=True, list_only=False)
        cmd_init(args)

        with open(config_path) as f:
            config = json.load(f)

        assert config["defaults"]["model"] == "sonnet"

    def test_init_list_only_does_not_create_config(self, temp_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that --list does not create config.json."""
        monkeypatch.chdir(temp_dir)
        args = Namespace(force=False, list_only=True)

        cmd_init(args)

        config_path = temp_dir / "agentic" / "config.json"
        assert not config_path.exists()
