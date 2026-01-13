"""Configuration management for agentic-sdlc."""

from __future__ import annotations

import difflib
import json
from pathlib import Path
from typing import Any

DEFAULT_CONFIG: dict[str, Any] = {
    "outputDirectory": "agentic",
    "logging": {
        "enabled": True,
        "level": "Error",
    },
    "git": {
        "mainBranch": "main",
        "autoCommit": True,
        "autoPr": True,
    },
    "memory": {
        "enabled": True,
        "directory": "agentic/memory",
        "template": "default",
    },
    "defaults": {
        "model": "sonnet",
        "maxRetry": 3,
        "timeoutMinutes": 60,
        "trackProgress": True,
        "terminalOutput": "base",
    },
    "execution": {
        "maxWorkers": 4,
        "pollingIntervalSeconds": 5,
    },
}


def get_config_path(repo_root: Path | None = None) -> Path:
    """Get path to config file."""
    if repo_root is None:
        repo_root = Path.cwd()
    return repo_root / "agentic" / "config.json"


def get_default_config() -> dict[str, Any]:
    """Return default configuration."""
    return _deep_copy(DEFAULT_CONFIG)


def load_config(repo_root: Path | None = None) -> dict[str, Any]:
    """Load configuration, creating default if not exists."""
    config_path = get_config_path(repo_root)

    if config_path.exists():
        with open(config_path, encoding="utf-8") as f:
            user_config = json.load(f)
        return _deep_merge(get_default_config(), user_config)

    return get_default_config()


def save_config(config: dict[str, Any], repo_root: Path | None = None) -> None:
    """Save configuration to file."""
    config_path = get_config_path(repo_root)
    config_path.parent.mkdir(parents=True, exist_ok=True)

    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


def get_config_value(key: str, repo_root: Path | None = None) -> Any:
    """Get configuration value by dot-notation key."""
    config = load_config(repo_root)
    parts = key.split(".")
    value: Any = config
    for part in parts:
        if isinstance(value, dict) and part in value:
            value = value[part]
        else:
            return None
    return value


def _get_all_valid_keys(config: dict[str, Any], prefix: str = "") -> list[str]:
    """Recursively get all valid configuration keys in dot notation.

    Args:
        config: Configuration dictionary to traverse
        prefix: Current key prefix for recursion

    Returns:
        List of all valid configuration keys in dot notation
    """
    keys = []
    for key, value in config.items():
        full_key = f"{prefix}.{key}" if prefix else key
        keys.append(full_key)
        if isinstance(value, dict):
            keys.extend(_get_all_valid_keys(value, full_key))
    return keys


def _validate_config_key(key: str, repo_root: Path | None = None, force: bool = False) -> None:
    """Validate that a configuration key exists in the schema.

    Args:
        key: Dot-notation configuration key to validate
        repo_root: Repository root path
        force: If True, skip validation and allow creating new keys

    Raises:
        ValueError: If key is not valid and force is False
    """
    if force:
        return

    default_config = get_default_config()
    valid_keys = _get_all_valid_keys(default_config)

    if key not in valid_keys:
        # Find closest matches
        close_matches = difflib.get_close_matches(key, valid_keys, n=3, cutoff=0.6)
        error_msg = f"Invalid configuration key: '{key}'"
        if close_matches:
            suggestions = "', '".join(close_matches)
            error_msg += f"\n\nDid you mean one of these?\n  '{suggestions}'"
        error_msg += "\n\nUse --force flag to create a custom configuration key."
        raise ValueError(error_msg)


def set_config_value(
    key: str, value: str, repo_root: Path | None = None, force: bool = False
) -> None:
    """Set configuration value by dot-notation key.

    Args:
        key: Dot-notation key (e.g., 'defaults.maxRetry')
        value: String value to set (auto-converted to bool/int if applicable)
        repo_root: Repository root path
        force: If True, allow creating new keys not in default schema

    Raises:
        ValueError: If key is invalid and force is False
    """
    _validate_config_key(key, repo_root, force)

    config = load_config(repo_root)
    parts = key.split(".")
    target = config
    for part in parts[:-1]:
        if part not in target:
            target[part] = {}
        target = target[part]

    parsed_value: Any = value
    if value.lower() == "true":
        parsed_value = True
    elif value.lower() == "false":
        parsed_value = False
    elif value.isdigit():
        parsed_value = int(value)

    target[parts[-1]] = parsed_value
    save_config(config, repo_root)


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Deep merge two dictionaries."""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _deep_copy(obj: dict[str, Any]) -> dict[str, Any]:
    """Deep copy a dictionary."""
    return json.loads(json.dumps(obj))
