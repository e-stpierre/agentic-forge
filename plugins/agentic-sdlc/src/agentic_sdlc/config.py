"""Configuration management for agentic-sdlc."""

from __future__ import annotations

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
    "checkpoint": {
        "directory": "agentic/outputs",
    },
    "defaults": {
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


def set_config_value(key: str, value: str, repo_root: Path | None = None) -> None:
    """Set configuration value by dot-notation key."""
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
