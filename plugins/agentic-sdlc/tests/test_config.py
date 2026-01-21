"""Tests for configuration management."""

from __future__ import annotations

import json
from pathlib import Path

from agentic_sdlc.config import (
    _deep_merge,
    get_config_path,
    get_config_value,
    get_default_config,
    load_config,
    save_config,
    set_config_value,
)


class TestConfigDefaults:
    """Tests for default configuration."""

    def test_get_default_config_returns_copy(self) -> None:
        """Test that get_default_config returns a copy."""
        config1 = get_default_config()
        config2 = get_default_config()

        config1["outputDirectory"] = "modified"

        assert config2["outputDirectory"] == "agentic"
        assert config1 is not config2

    def test_default_config_structure(self) -> None:
        """Test default configuration structure."""
        config = get_default_config()

        assert "outputDirectory" in config
        assert "logging" in config
        assert "git" in config
        assert "defaults" in config
        assert "execution" in config

    def test_default_model_is_sonnet(self) -> None:
        """Test default model is sonnet."""
        config = get_default_config()
        assert config["defaults"]["model"] == "sonnet"


class TestConfigPath:
    """Tests for configuration path handling."""

    def test_get_config_path_default(self, temp_dir: Path) -> None:
        """Test default config path."""
        path = get_config_path(temp_dir)
        assert path == temp_dir / "agentic" / "config.json"

    def test_get_config_path_uses_cwd_when_none(self, monkeypatch) -> None:
        """Test config path uses current directory when no root specified."""
        monkeypatch.chdir(Path.cwd())
        path = get_config_path()
        assert path.name == "config.json"
        assert path.parent.name == "agentic"


class TestLoadConfig:
    """Tests for loading configuration."""

    def test_load_default_config_when_no_file(self, temp_dir: Path) -> None:
        """Test loading default configuration when no file exists."""
        config = load_config(temp_dir)

        assert config["outputDirectory"] == "agentic"
        assert config["defaults"]["model"] == "sonnet"

    def test_load_existing_config(self, temp_dir: Path) -> None:
        """Test loading existing configuration file."""
        config_dir = temp_dir / "agentic"
        config_dir.mkdir()
        config_file = config_dir / "config.json"
        config_file.write_text(
            json.dumps(
                {
                    "outputDirectory": "custom-output",
                    "defaults": {"model": "opus"},
                }
            )
        )

        config = load_config(temp_dir)

        assert config["outputDirectory"] == "custom-output"
        assert config["defaults"]["model"] == "opus"
        # Other defaults should still be present
        assert config["defaults"]["maxRetry"] == 3

    def test_load_config_merges_with_defaults(self, temp_dir: Path) -> None:
        """Test that loaded config is merged with defaults."""
        config_dir = temp_dir / "agentic"
        config_dir.mkdir()
        config_file = config_dir / "config.json"
        config_file.write_text(json.dumps({"logging": {"level": "Debug"}}))

        config = load_config(temp_dir)

        assert config["logging"]["level"] == "Debug"
        assert config["logging"]["enabled"] is True  # From defaults


class TestSaveConfig:
    """Tests for saving configuration."""

    def test_save_config_creates_directory(self, temp_dir: Path) -> None:
        """Test that save_config creates directory if needed."""
        config = {"test": "value"}
        save_config(config, temp_dir)

        config_path = get_config_path(temp_dir)
        assert config_path.exists()
        assert config_path.parent.exists()

    def test_save_config_writes_json(self, temp_dir: Path) -> None:
        """Test that save_config writes valid JSON."""
        config = {"test": "value", "nested": {"key": 123}}
        save_config(config, temp_dir)

        config_path = get_config_path(temp_dir)
        with open(config_path) as f:
            loaded = json.load(f)

        assert loaded == config


class TestConfigValues:
    """Tests for get/set config values."""

    def test_get_config_value_simple_key(self, temp_dir: Path) -> None:
        """Test getting simple config value."""
        value = get_config_value("outputDirectory", temp_dir)
        assert value == "agentic"

    def test_get_config_value_nested_key(self, temp_dir: Path) -> None:
        """Test getting nested config value."""
        value = get_config_value("defaults.model", temp_dir)
        assert value == "sonnet"

    def test_get_config_value_missing_returns_none(self, temp_dir: Path) -> None:
        """Test getting missing config value returns None."""
        value = get_config_value("nonexistent.key", temp_dir)
        assert value is None

    def test_set_config_value_simple(self, temp_dir: Path) -> None:
        """Test setting simple config value."""
        set_config_value("outputDirectory", "new-output", temp_dir)

        value = get_config_value("outputDirectory", temp_dir)
        assert value == "new-output"

    def test_set_config_value_nested(self, temp_dir: Path) -> None:
        """Test setting nested config value."""
        set_config_value("defaults.model", "opus", temp_dir)

        value = get_config_value("defaults.model", temp_dir)
        assert value == "opus"

    def test_set_config_value_creates_nested_structure(self, temp_dir: Path) -> None:
        """Test setting value creates nested structure if needed."""
        set_config_value("new.nested.key", "value", temp_dir)

        value = get_config_value("new.nested.key", temp_dir)
        assert value == "value"

    def test_set_config_value_parses_boolean_true(self, temp_dir: Path) -> None:
        """Test setting boolean true value."""
        set_config_value("logging.enabled", "true", temp_dir)

        value = get_config_value("logging.enabled", temp_dir)
        assert value is True

    def test_set_config_value_parses_boolean_false(self, temp_dir: Path) -> None:
        """Test setting boolean false value."""
        set_config_value("logging.enabled", "false", temp_dir)

        value = get_config_value("logging.enabled", temp_dir)
        assert value is False

    def test_set_config_value_parses_integer(self, temp_dir: Path) -> None:
        """Test setting integer value."""
        set_config_value("defaults.maxRetry", "10", temp_dir)

        value = get_config_value("defaults.maxRetry", temp_dir)
        assert value == 10


class TestDeepMerge:
    """Tests for deep merge utility."""

    def test_deep_merge_simple(self) -> None:
        """Test simple merge."""
        base = {"a": 1, "b": 2}
        override = {"b": 3, "c": 4}

        result = _deep_merge(base, override)

        assert result == {"a": 1, "b": 3, "c": 4}

    def test_deep_merge_nested(self) -> None:
        """Test nested merge."""
        base = {"a": {"x": 1, "y": 2}, "b": 3}
        override = {"a": {"y": 99, "z": 100}}

        result = _deep_merge(base, override)

        assert result == {"a": {"x": 1, "y": 99, "z": 100}, "b": 3}

    def test_deep_merge_does_not_mutate_base(self) -> None:
        """Test that deep merge does not mutate base dictionary."""
        base = {"a": {"x": 1}}
        override = {"a": {"y": 2}}

        _deep_merge(base, override)

        assert base == {"a": {"x": 1}}
