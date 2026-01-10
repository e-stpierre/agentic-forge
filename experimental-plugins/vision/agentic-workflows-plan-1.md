# Agentic Workflows - Implementation Plan 1

## Core Infrastructure & Basic Workflow Engine

### Overview

This plan establishes the foundational Python infrastructure for the agentic-workflows plugin. It delivers the ability to run simple linear workflows with prompt and command steps, progress tracking, structured logging, and configuration management.

### Prerequisites

- Python 3.10+
- `uv` for package management
- Claude Code CLI installed and available in PATH

### Deliverable

A working plugin that can:

- Parse and validate YAML workflow files
- Execute linear workflows with `prompt` and `command` step types
- Track progress in `progress.json`
- Log workflow events to NDJSON format
- Manage git worktrees (create, remove, list)
- Render Jinja2 templates

---

## Directory Structure

```
experimental-plugins/agentic-workflows/
├── pyproject.toml
├── workflows/
│   └── (empty, populated in Plan 3)
├── templates/
│   └── progress.json.j2
├── commands/
│   └── (empty, populated in Plan 2-3)
├── agents/
│   └── (empty, populated in Plan 3)
├── skills/
│   └── (empty, populated in Plan 2)
├── schemas/
│   ├── workflow.schema.json
│   ├── config.schema.json
│   ├── progress.schema.json
│   └── step-output.schema.json
└── src/agentic_workflows/
    ├── __init__.py
    ├── cli.py
    ├── runner.py
    ├── parser.py
    ├── executor.py
    ├── config.py
    ├── progress.py
    ├── git/
    │   ├── __init__.py
    │   └── worktree.py
    ├── logging/
    │   ├── __init__.py
    │   └── logger.py
    └── templates/
        ├── __init__.py
        └── renderer.py
```

---

## Implementation Tasks

### Task 1: Package Setup

**File: `pyproject.toml`**

```toml
[project]
name = "agentic-workflows"
version = "0.1.0"
description = "Agentic workflow orchestration for Claude Code"
readme = "README.md"
requires-python = ">=3.10"
dependencies = [
    "pyyaml>=6.0",
    "jinja2>=3.1",
    "filelock>=3.12",
]

[project.scripts]
agentic-workflow = "agentic_workflows.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/agentic_workflows"]
```

**File: `src/agentic_workflows/__init__.py`**

```python
"""Agentic Workflows - Orchestration framework for Claude Code."""

__version__ = "0.1.0"

from agentic_workflows.runner import run_claude, ClaudeResult
from agentic_workflows.parser import WorkflowParser, WorkflowParseError
from agentic_workflows.executor import WorkflowExecutor
from agentic_workflows.config import load_config, save_config, get_default_config

__all__ = [
    "run_claude",
    "ClaudeResult",
    "WorkflowParser",
    "WorkflowParseError",
    "WorkflowExecutor",
    "load_config",
    "save_config",
    "get_default_config",
]
```

---

### Task 2: CLI Entry Point

**File: `src/agentic_workflows/cli.py`**

Implement the main CLI using `argparse` (no external dependencies).

```python
"""CLI entry point for agentic-workflow command."""

import argparse
import json
import sys
from pathlib import Path

def main() -> None:
    parser = argparse.ArgumentParser(
        prog="agentic-workflow",
        description="Agentic workflow orchestration for Claude Code",
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # run command
    run_parser = subparsers.add_parser("run", help="Run a workflow")
    run_parser.add_argument("workflow", type=Path, help="Path to workflow YAML file")
    run_parser.add_argument("--var", action="append", dest="vars", metavar="KEY=VALUE",
                           help="Set workflow variable (can be used multiple times)")
    run_parser.add_argument("--from-step", help="Resume from a specific step")
    run_parser.add_argument("--terminal-output", choices=["base", "all"], default="base",
                           help="Terminal output granularity")
    run_parser.add_argument("--dry-run", action="store_true", help="Validate without executing")

    # status command
    status_parser = subparsers.add_parser("status", help="Show workflow status")
    status_parser.add_argument("workflow_id", help="Workflow ID")

    # list command
    list_parser = subparsers.add_parser("list", help="List workflows")
    list_parser.add_argument("--status", choices=["running", "completed", "failed", "paused"],
                            help="Filter by status")

    # configure command
    subparsers.add_parser("configure", help="Configure plugin settings")

    # config get/set commands
    config_parser = subparsers.add_parser("config", help="Get or set configuration")
    config_subparsers = config_parser.add_subparsers(dest="config_command")
    config_get = config_subparsers.add_parser("get", help="Get config value")
    config_get.add_argument("key", help="Configuration key (dot notation)")
    config_set = config_subparsers.add_parser("set", help="Set config value")
    config_set.add_argument("key", help="Configuration key (dot notation)")
    config_set.add_argument("value", help="Value to set")

    args = parser.parse_args()

    if args.command == "run":
        cmd_run(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "configure":
        cmd_configure(args)
    elif args.command == "config":
        cmd_config(args)
    else:
        parser.print_help()
        sys.exit(1)
```

**CLI Command Implementations:**

- `cmd_run`: Parse workflow, create executor, run workflow
- `cmd_status`: Read progress.json for workflow ID, display status
- `cmd_list`: Scan `agentic/workflows/` for progress files, list by status
- `cmd_configure`: Interactive configuration wizard
- `cmd_config`: Get/set configuration values

---

### Task 3: Claude Runner

**File: `src/agentic_workflows/runner.py`**

Adapt from `experimental-plugins/core/src/claude_core/runner.py` with these modifications:

1. Add `model` parameter support (`sonnet`, `haiku`, `opus`)
2. Support both streaming (`print_output=True`) and capture modes
3. Return structured `ClaudeResult` with success/failure status

```python
"""Claude CLI runner for workflow orchestration."""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing import Any

# Model mapping to Claude CLI format
MODEL_MAP = {
    "sonnet": "sonnet",
    "haiku": "haiku",
    "opus": "opus",
}

@dataclass
class ClaudeResult:
    """Result from a Claude CLI invocation."""
    returncode: int
    stdout: str
    stderr: str
    prompt: str
    cwd: Path | None
    model: str | None = None

    @property
    def success(self) -> bool:
        return self.returncode == 0


def run_claude(
    prompt: str,
    cwd: Path | None = None,
    model: str = "sonnet",
    timeout: int | None = 300,
    print_output: bool = False,
    skip_permissions: bool = True,
) -> ClaudeResult:
    """Run claude with the given prompt.

    Args:
        prompt: The prompt to send to Claude
        cwd: Working directory for the Claude session
        model: Model to use (sonnet, haiku, opus)
        timeout: Timeout in seconds (default 5 minutes)
        print_output: Whether to stream output in real-time
        skip_permissions: Whether to skip permission prompts

    Returns:
        ClaudeResult with captured output
    """
    cmd = ["claude", "--print"]

    if model and model in MODEL_MAP:
        cmd.extend(["--model", MODEL_MAP[model]])

    if skip_permissions:
        cmd.append("--dangerously-skip-permissions")

    cwd_str = str(cwd) if cwd else None

    if print_output:
        # Stream output using Popen
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd_str,
            shell=True,
        )

        if process.stdin:
            process.stdin.write(prompt)
            process.stdin.close()

        stdout_lines: list[str] = []
        if process.stdout:
            for line in process.stdout:
                print(line, end="", flush=True)
                stdout_lines.append(line)

        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

        stderr = process.stderr.read() if process.stderr else ""

        return ClaudeResult(
            returncode=process.returncode if process.returncode is not None else 1,
            stdout="".join(stdout_lines),
            stderr=stderr,
            prompt=prompt,
            cwd=cwd,
            model=model,
        )
    else:
        # Capture output using run
        try:
            result = subprocess.run(
                cmd,
                input=prompt,
                capture_output=True,
                text=True,
                cwd=cwd_str,
                timeout=timeout,
                shell=True,
            )
            return ClaudeResult(
                returncode=result.returncode,
                stdout=result.stdout,
                stderr=result.stderr,
                prompt=prompt,
                cwd=cwd,
                model=model,
            )
        except subprocess.TimeoutExpired:
            return ClaudeResult(
                returncode=1,
                stdout="",
                stderr=f"Command timed out after {timeout} seconds",
                prompt=prompt,
                cwd=cwd,
                model=model,
            )


def run_claude_with_command(
    command: str,
    args: dict[str, Any] | None = None,
    cwd: Path | None = None,
    **kwargs: Any,
) -> ClaudeResult:
    """Run a Claude slash command with arguments.

    Args:
        command: The slash command name (without /)
        args: Command arguments as key-value pairs
        cwd: Working directory
        **kwargs: Additional arguments passed to run_claude
    """
    prompt = f"/{command}"
    if args:
        args_str = " ".join(f"--{k} {v}" for k, v in args.items())
        prompt = f"{prompt} {args_str}"

    return run_claude(prompt, cwd=cwd, **kwargs)
```

---

### Task 4: Configuration Management

**File: `src/agentic_workflows/config.py`**

Handle global configuration in `agentic/config.json`.

```python
"""Configuration management for agentic-workflows."""

import json
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = {
    "outputDirectory": "agentic",
    "logging": {
        "enabled": True,
        "level": "Error"
    },
    "git": {
        "mainBranch": "main",
        "autoCommit": True,
        "autoPr": True
    },
    "memory": {
        "enabled": True,
        "directory": "agentic/memory",
        "template": "default"
    },
    "checkpoint": {
        "directory": "agentic/workflows"
    },
    "defaults": {
        "maxRetry": 3,
        "timeoutMinutes": 60,
        "trackProgress": True,
        "terminalOutput": "base"
    },
    "execution": {
        "maxWorkers": 4,
        "pollingIntervalSeconds": 5
    }
}


def get_config_path(repo_root: Path | None = None) -> Path:
    """Get path to config file."""
    if repo_root is None:
        repo_root = Path.cwd()
    return repo_root / "agentic" / "config.json"


def get_default_config() -> dict[str, Any]:
    """Return default configuration."""
    return DEFAULT_CONFIG.copy()


def load_config(repo_root: Path | None = None) -> dict[str, Any]:
    """Load configuration, creating default if not exists."""
    config_path = get_config_path(repo_root)

    if config_path.exists():
        with open(config_path) as f:
            user_config = json.load(f)
        # Merge with defaults
        return _deep_merge(get_default_config(), user_config)

    return get_default_config()


def save_config(config: dict[str, Any], repo_root: Path | None = None) -> None:
    """Save configuration to file."""
    config_path = get_config_path(repo_root)
    config_path.parent.mkdir(parents=True, exist_ok=True)

    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)


def get_config_value(key: str, repo_root: Path | None = None) -> Any:
    """Get configuration value by dot-notation key."""
    config = load_config(repo_root)
    parts = key.split(".")
    value = config
    for part in parts:
        if isinstance(value, dict) and part in value:
            value = value[part]
        else:
            return None
    return value


def set_config_value(key: str, value: Any, repo_root: Path | None = None) -> None:
    """Set configuration value by dot-notation key."""
    config = load_config(repo_root)
    parts = key.split(".")
    target = config
    for part in parts[:-1]:
        if part not in target:
            target[part] = {}
        target = target[part]

    # Type coercion
    if value.lower() == "true":
        value = True
    elif value.lower() == "false":
        value = False
    elif value.isdigit():
        value = int(value)

    target[parts[-1]] = value
    save_config(config, repo_root)


def _deep_merge(base: dict, override: dict) -> dict:
    """Deep merge two dictionaries."""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result
```

---

### Task 5: YAML Workflow Parser

**File: `src/agentic_workflows/parser.py`**

Parse YAML workflow files into data models. Adapt from `agentic-core/workflow/parser.py` but simplified.

```python
"""YAML workflow parser."""

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import yaml


class StepType(Enum):
    PROMPT = "prompt"
    COMMAND = "command"
    PARALLEL = "parallel"
    CONDITIONAL = "conditional"
    RECURRING = "recurring"
    WAIT_FOR_HUMAN = "wait-for-human"


@dataclass
class Variable:
    name: str
    type: str
    required: bool = True
    default: Any = None
    description: str = ""


@dataclass
class GitSettings:
    enabled: bool = False
    worktree: bool = False
    auto_commit: bool = True
    auto_pr: bool = True
    branch_prefix: str = "agentic"


@dataclass
class WorkflowSettings:
    max_retry: int = 3
    timeout_minutes: int = 60
    track_progress: bool = True
    autofix: str = "none"
    terminal_output: str = "base"
    bypass_permissions: bool = False
    git: GitSettings = field(default_factory=GitSettings)


@dataclass
class StepDefinition:
    name: str
    type: StepType
    # For prompt type
    prompt: str | None = None
    agent: str | None = None
    # For command type
    command: str | None = None
    args: dict[str, Any] = field(default_factory=dict)
    # For parallel type
    steps: list["StepDefinition"] = field(default_factory=list)
    merge_strategy: str = "wait-all"
    merge_mode: str = "independent"
    # For conditional type
    condition: str | None = None
    then_steps: list["StepDefinition"] = field(default_factory=list)
    else_steps: list["StepDefinition"] = field(default_factory=list)
    # For recurring type
    max_iterations: int = 3
    until: str | None = None
    # For wait-for-human type
    message: str | None = None
    polling_interval: int = 15
    on_timeout: str = "abort"
    # Common options
    model: str = "sonnet"
    step_timeout_minutes: int | None = None
    step_max_retry: int | None = None
    on_error: str = "retry"
    checkpoint: bool = False
    depends_on: str | None = None


@dataclass
class OutputDefinition:
    name: str
    template: str
    path: str
    when: str = "completed"


@dataclass
class WorkflowDefinition:
    name: str
    version: str
    description: str
    settings: WorkflowSettings
    variables: list[Variable]
    steps: list[StepDefinition]
    outputs: list[OutputDefinition]


class WorkflowParseError(Exception):
    """Error parsing workflow YAML."""
    pass


class WorkflowParser:
    """Parser for YAML workflow definitions."""

    def __init__(self, base_path: Path | None = None):
        self.base_path = base_path or Path.cwd()

    def parse_file(self, path: Path) -> WorkflowDefinition:
        """Parse workflow from YAML file."""
        if not path.exists():
            raise WorkflowParseError(f"Workflow file not found: {path}")

        try:
            with open(path) as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            raise WorkflowParseError(f"Invalid YAML: {e}")

        self.base_path = path.parent
        return self._parse_dict(data)

    def parse_string(self, content: str) -> WorkflowDefinition:
        """Parse workflow from YAML string."""
        try:
            data = yaml.safe_load(content)
        except yaml.YAMLError as e:
            raise WorkflowParseError(f"Invalid YAML: {e}")
        return self._parse_dict(data)

    def _parse_dict(self, data: dict) -> WorkflowDefinition:
        """Parse workflow from dictionary."""
        if not isinstance(data, dict):
            raise WorkflowParseError("Workflow must be a dictionary")

        name = self._required(data, "name")
        version = data.get("version", "1.0")
        description = data.get("description", "")

        settings = self._parse_settings(data.get("settings", {}))
        variables = [self._parse_variable(v) for v in data.get("variables", [])]
        steps = [self._parse_step(s) for s in data.get("steps", [])]
        outputs = [self._parse_output(o) for o in data.get("outputs", [])]

        return WorkflowDefinition(
            name=name,
            version=version,
            description=description,
            settings=settings,
            variables=variables,
            steps=steps,
            outputs=outputs,
        )

    def _required(self, data: dict, key: str) -> Any:
        if key not in data:
            raise WorkflowParseError(f"Missing required field: {key}")
        return data[key]

    def _parse_settings(self, data: dict) -> WorkflowSettings:
        git_data = data.get("git", {})
        git = GitSettings(
            enabled=git_data.get("enabled", False),
            worktree=git_data.get("worktree", False),
            auto_commit=git_data.get("auto-commit", True),
            auto_pr=git_data.get("auto-pr", True),
            branch_prefix=git_data.get("branch-prefix", "agentic"),
        )
        return WorkflowSettings(
            max_retry=data.get("max-retry", 3),
            timeout_minutes=data.get("timeout-minutes", 60),
            track_progress=data.get("track-progress", True),
            autofix=data.get("autofix", "none"),
            terminal_output=data.get("terminal-output", "base"),
            bypass_permissions=data.get("bypass-permissions", False),
            git=git,
        )

    def _parse_variable(self, data: dict) -> Variable:
        return Variable(
            name=self._required(data, "name"),
            type=data.get("type", "string"),
            required=data.get("required", True),
            default=data.get("default"),
            description=data.get("description", ""),
        )

    def _parse_step(self, data: dict) -> StepDefinition:
        name = self._required(data, "name")
        type_str = self._required(data, "type")

        try:
            step_type = StepType(type_str)
        except ValueError:
            valid = [t.value for t in StepType]
            raise WorkflowParseError(f"Invalid step type: {type_str}. Valid: {valid}")

        step = StepDefinition(name=name, type=step_type)

        # Type-specific fields
        if step_type == StepType.PROMPT:
            step.prompt = data.get("prompt")
            step.agent = data.get("agent")
        elif step_type == StepType.COMMAND:
            step.command = data.get("command")
            step.args = data.get("args", {})
        elif step_type == StepType.PARALLEL:
            step.steps = [self._parse_step(s) for s in data.get("steps", [])]
            step.merge_strategy = data.get("merge-strategy", "wait-all")
            step.merge_mode = data.get("merge-mode", "independent")
        elif step_type == StepType.CONDITIONAL:
            step.condition = data.get("condition")
            step.then_steps = [self._parse_step(s) for s in data.get("then", [])]
            step.else_steps = [self._parse_step(s) for s in data.get("else", [])]
        elif step_type == StepType.RECURRING:
            step.max_iterations = data.get("max-iterations", 3)
            step.until = data.get("until")
            step.steps = [self._parse_step(s) for s in data.get("steps", [])]
        elif step_type == StepType.WAIT_FOR_HUMAN:
            step.message = data.get("message")
            step.polling_interval = data.get("polling-interval", 15)
            step.on_timeout = data.get("on-timeout", "abort")
            step.step_timeout_minutes = data.get("timeout-minutes", 5)

        # Common options
        step.model = data.get("model", "sonnet")
        step.step_timeout_minutes = data.get("timeout-minutes", step.step_timeout_minutes)
        step.step_max_retry = data.get("max-retry")
        step.on_error = data.get("on-error", "retry")
        step.checkpoint = data.get("checkpoint", False)
        step.depends_on = data.get("depends-on")

        return step

    def _parse_output(self, data: dict) -> OutputDefinition:
        return OutputDefinition(
            name=self._required(data, "name"),
            template=self._required(data, "template"),
            path=self._required(data, "path"),
            when=data.get("when", "completed"),
        )
```

---

### Task 6: Progress Tracking

**File: `src/agentic_workflows/progress.py`**

Manage workflow progress in `progress.json`.

```python
"""Workflow progress tracking."""

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from filelock import FileLock


class WorkflowStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"
    CANCELLED = "cancelled"


class StepStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class StepProgress:
    name: str
    status: str
    started_at: str | None = None
    completed_at: str | None = None
    retry_count: int = 0
    output_summary: str = ""
    error: str | None = None
    human_input: str | None = None


@dataclass
class ParallelBranch:
    branch_id: str
    status: str
    worktree_path: str
    progress_file: str


@dataclass
class WorkflowProgress:
    schema_version: str = "1.0"
    workflow_id: str = ""
    workflow_name: str = ""
    status: str = "pending"
    started_at: str | None = None
    completed_at: str | None = None
    current_step: dict | None = None
    completed_steps: list[StepProgress] = field(default_factory=list)
    pending_steps: list[str] = field(default_factory=list)
    running_steps: list[str] = field(default_factory=list)
    parallel_branches: list[ParallelBranch] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    variables: dict[str, Any] = field(default_factory=dict)
    step_outputs: dict[str, Any] = field(default_factory=dict)


def get_progress_path(workflow_id: str, repo_root: Path | None = None) -> Path:
    """Get path to progress file for a workflow."""
    if repo_root is None:
        repo_root = Path.cwd()
    return repo_root / "agentic" / "workflows" / workflow_id / "progress.json"


def load_progress(workflow_id: str, repo_root: Path | None = None) -> WorkflowProgress | None:
    """Load workflow progress from file."""
    progress_path = get_progress_path(workflow_id, repo_root)
    if not progress_path.exists():
        return None

    with open(progress_path) as f:
        data = json.load(f)

    return _dict_to_progress(data)


def save_progress(progress: WorkflowProgress, repo_root: Path | None = None) -> None:
    """Save workflow progress to file with file locking."""
    progress_path = get_progress_path(progress.workflow_id, repo_root)
    progress_path.parent.mkdir(parents=True, exist_ok=True)

    lock_path = progress_path.with_suffix(".lock")
    lock = FileLock(lock_path)

    with lock:
        with open(progress_path, "w") as f:
            json.dump(_progress_to_dict(progress), f, indent=2)


def create_progress(
    workflow_id: str,
    workflow_name: str,
    step_names: list[str],
    variables: dict[str, Any],
) -> WorkflowProgress:
    """Create initial progress document."""
    return WorkflowProgress(
        workflow_id=workflow_id,
        workflow_name=workflow_name,
        status=WorkflowStatus.RUNNING.value,
        started_at=datetime.now(timezone.utc).isoformat(),
        pending_steps=step_names,
        variables=variables,
    )


def update_step_started(progress: WorkflowProgress, step_name: str) -> None:
    """Mark a step as started."""
    if step_name in progress.pending_steps:
        progress.pending_steps.remove(step_name)
    progress.running_steps.append(step_name)
    progress.current_step = {
        "name": step_name,
        "retry_count": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }


def update_step_completed(
    progress: WorkflowProgress,
    step_name: str,
    output_summary: str = "",
    output: Any = None,
) -> None:
    """Mark a step as completed."""
    if step_name in progress.running_steps:
        progress.running_steps.remove(step_name)

    step = StepProgress(
        name=step_name,
        status=StepStatus.COMPLETED.value,
        started_at=progress.current_step.get("started_at") if progress.current_step else None,
        completed_at=datetime.now(timezone.utc).isoformat(),
        retry_count=progress.current_step.get("retry_count", 0) if progress.current_step else 0,
        output_summary=output_summary,
    )
    progress.completed_steps.append(step)

    if output is not None:
        progress.step_outputs[step_name] = output

    progress.current_step = None


def update_step_failed(
    progress: WorkflowProgress,
    step_name: str,
    error: str,
) -> None:
    """Mark a step as failed."""
    if step_name in progress.running_steps:
        progress.running_steps.remove(step_name)

    step = StepProgress(
        name=step_name,
        status=StepStatus.FAILED.value,
        started_at=progress.current_step.get("started_at") if progress.current_step else None,
        completed_at=datetime.now(timezone.utc).isoformat(),
        retry_count=progress.current_step.get("retry_count", 0) if progress.current_step else 0,
        error=error,
    )
    progress.completed_steps.append(step)
    progress.errors.append({"step": step_name, "error": error})
    progress.current_step = None


def _progress_to_dict(progress: WorkflowProgress) -> dict:
    """Convert progress to dictionary for JSON serialization."""
    data = asdict(progress)
    data["completed_steps"] = [asdict(s) if isinstance(s, StepProgress) else s
                               for s in progress.completed_steps]
    data["parallel_branches"] = [asdict(b) if isinstance(b, ParallelBranch) else b
                                  for b in progress.parallel_branches]
    return data


def _dict_to_progress(data: dict) -> WorkflowProgress:
    """Convert dictionary to WorkflowProgress."""
    completed = [StepProgress(**s) if isinstance(s, dict) else s
                 for s in data.get("completed_steps", [])]
    branches = [ParallelBranch(**b) if isinstance(b, dict) else b
                for b in data.get("parallel_branches", [])]

    return WorkflowProgress(
        schema_version=data.get("schema_version", "1.0"),
        workflow_id=data.get("workflow_id", ""),
        workflow_name=data.get("workflow_name", ""),
        status=data.get("status", "pending"),
        started_at=data.get("started_at"),
        completed_at=data.get("completed_at"),
        current_step=data.get("current_step"),
        completed_steps=completed,
        pending_steps=data.get("pending_steps", []),
        running_steps=data.get("running_steps", []),
        parallel_branches=branches,
        errors=data.get("errors", []),
        variables=data.get("variables", {}),
        step_outputs=data.get("step_outputs", {}),
    )
```

---

### Task 7: Structured Logging

**File: `src/agentic_workflows/logging/logger.py`**

NDJSON structured logging for workflows.

```python
"""NDJSON structured logging for workflows."""

import json
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any


class LogLevel(Enum):
    CRITICAL = "Critical"
    ERROR = "Error"
    WARNING = "Warning"
    INFORMATION = "Information"


@dataclass
class LogEntry:
    timestamp: str
    level: str
    step: str
    message: str
    context: dict[str, Any] | None = None


class WorkflowLogger:
    """NDJSON logger for workflow execution."""

    def __init__(self, workflow_id: str, repo_root: Path | None = None):
        self.workflow_id = workflow_id
        if repo_root is None:
            repo_root = Path.cwd()
        self.log_path = repo_root / "agentic" / "workflows" / workflow_id / "logs.ndjson"
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def log(
        self,
        level: LogLevel,
        step: str,
        message: str,
        context: dict[str, Any] | None = None,
    ) -> None:
        """Write a log entry."""
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=level.value,
            step=step,
            message=message,
            context=context,
        )

        with open(self.log_path, "a") as f:
            f.write(json.dumps(asdict(entry)) + "\n")

    def critical(self, step: str, message: str, **context: Any) -> None:
        self.log(LogLevel.CRITICAL, step, message, context or None)

    def error(self, step: str, message: str, **context: Any) -> None:
        self.log(LogLevel.ERROR, step, message, context or None)

    def warning(self, step: str, message: str, **context: Any) -> None:
        self.log(LogLevel.WARNING, step, message, context or None)

    def info(self, step: str, message: str, **context: Any) -> None:
        self.log(LogLevel.INFORMATION, step, message, context or None)


def read_logs(workflow_id: str, repo_root: Path | None = None) -> list[LogEntry]:
    """Read all log entries for a workflow."""
    if repo_root is None:
        repo_root = Path.cwd()
    log_path = repo_root / "agentic" / "workflows" / workflow_id / "logs.ndjson"

    if not log_path.exists():
        return []

    entries = []
    with open(log_path) as f:
        for line in f:
            if line.strip():
                data = json.loads(line)
                entries.append(LogEntry(**data))
    return entries
```

---

### Task 8: Git Worktree Management

**File: `src/agentic_workflows/git/worktree.py`**

Adapt from `core/src/claude_core/worktree.py` with naming convention changes.

Key modifications:

1. Worktree path: `.worktrees/agentic-{workflow_name}-{step_name}-{random_6_char}`
2. Branch name: `agentic/{workflow_name}-{step_name}-{random_6_char}`
3. Truncate names to 30 chars each for Windows path length
4. Add `prune_orphaned()` function for cleanup

```python
"""Git worktree management for parallel workflow execution."""

import secrets
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Worktree:
    path: Path
    branch: str
    base_branch: str

    def exists(self) -> bool:
        return self.path.exists()


def _run_git(args: list[str], cwd: Path | None = None, check: bool = True):
    cmd = ["git"] + args
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=str(cwd) if cwd else None,
        shell=True,
    )
    if check and result.returncode != 0:
        raise RuntimeError(f"Git command failed: {' '.join(cmd)}\n{result.stderr}")
    return result


def _truncate(name: str, max_len: int = 30) -> str:
    """Truncate name to max length for Windows path safety."""
    return name[:max_len] if len(name) > max_len else name


def _generate_suffix() -> str:
    """Generate 6 character random suffix."""
    return secrets.token_hex(3)


def get_repo_root(cwd: Path | None = None) -> Path:
    result = _run_git(["rev-parse", "--show-toplevel"], cwd=cwd)
    return Path(result.stdout.strip())


def get_default_branch(cwd: Path | None = None) -> str:
    result = _run_git(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd=cwd, check=False)
    if result.returncode == 0:
        return result.stdout.strip().split("/")[-1]
    for branch in ["main", "master"]:
        result = _run_git(["rev-parse", "--verify", branch], cwd=cwd, check=False)
        if result.returncode == 0:
            return branch
    return "main"


def create_worktree(
    workflow_name: str,
    step_name: str,
    base_branch: str | None = None,
    repo_root: Path | None = None,
) -> Worktree:
    """Create a new worktree for a workflow step.

    Naming convention:
    - Path: .worktrees/agentic-{workflow}-{step}-{random}
    - Branch: agentic/{workflow}-{step}-{random}
    """
    if repo_root is None:
        repo_root = get_repo_root()

    if base_branch is None:
        base_branch = get_default_branch(repo_root)

    suffix = _generate_suffix()
    wf_name = _truncate(workflow_name.replace("/", "-").replace(" ", "-").lower())
    st_name = _truncate(step_name.replace("/", "-").replace(" ", "-").lower())

    dir_name = f"agentic-{wf_name}-{st_name}-{suffix}"
    branch_name = f"agentic/{wf_name}-{st_name}-{suffix}"

    worktree_path = repo_root / ".worktrees" / dir_name
    worktree_path.parent.mkdir(parents=True, exist_ok=True)

    if worktree_path.exists():
        shutil.rmtree(worktree_path, ignore_errors=True)
        _run_git(["worktree", "prune"], cwd=repo_root, check=False)

    _run_git(
        ["worktree", "add", "-b", branch_name, str(worktree_path), base_branch],
        cwd=repo_root,
    )

    return Worktree(path=worktree_path, branch=branch_name, base_branch=base_branch)


def remove_worktree(
    worktree: Worktree,
    repo_root: Path | None = None,
    delete_branch: bool = True,
) -> None:
    """Remove a worktree and optionally delete the branch."""
    if repo_root is None:
        repo_root = get_repo_root()

    result = _run_git(
        ["worktree", "remove", "--force", str(worktree.path)],
        cwd=repo_root,
        check=False,
    )

    if result.returncode != 0 and worktree.path.exists():
        shutil.rmtree(worktree.path, ignore_errors=True)
        _run_git(["worktree", "prune"], cwd=repo_root, check=False)

    if delete_branch and worktree.branch:
        _run_git(["branch", "-D", worktree.branch], cwd=repo_root, check=False)


def list_worktrees(repo_root: Path | None = None) -> list[Worktree]:
    """List all worktrees."""
    if repo_root is None:
        repo_root = get_repo_root()

    result = _run_git(["worktree", "list", "--porcelain"], cwd=repo_root)

    worktrees = []
    current_path = None
    current_branch = ""

    for line in result.stdout.strip().split("\n"):
        if line.startswith("worktree "):
            current_path = Path(line[9:])
        elif line.startswith("branch "):
            current_branch = line.replace("branch refs/heads/", "")
        elif line == "" and current_path:
            worktrees.append(Worktree(path=current_path, branch=current_branch, base_branch=""))
            current_path = None
            current_branch = ""

    if current_path:
        worktrees.append(Worktree(path=current_path, branch=current_branch, base_branch=""))

    return worktrees


def prune_orphaned(repo_root: Path | None = None) -> int:
    """Prune orphaned worktrees and stale agentic worktrees.

    Returns number of worktrees cleaned up.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    _run_git(["worktree", "prune"], cwd=repo_root, check=False)

    cleaned = 0
    worktrees_dir = repo_root / ".worktrees"
    if worktrees_dir.exists():
        for wt_dir in worktrees_dir.iterdir():
            if wt_dir.is_dir() and wt_dir.name.startswith("agentic-"):
                git_file = wt_dir / ".git"
                if not git_file.exists():
                    shutil.rmtree(wt_dir, ignore_errors=True)
                    cleaned += 1

    return cleaned
```

---

### Task 9: Jinja2 Template Renderer

**File: `src/agentic_workflows/templates/renderer.py`**

```python
"""Jinja2 template rendering for workflows."""

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape


class TemplateRenderer:
    """Render Jinja2 templates with workflow context."""

    def __init__(self, template_dirs: list[Path] | None = None):
        if template_dirs is None:
            template_dirs = [Path(__file__).parent.parent.parent.parent / "templates"]

        self.env = Environment(
            loader=FileSystemLoader([str(d) for d in template_dirs]),
            autoescape=select_autoescape(default=False),
            undefined=StrictUndefined,
        )
        # Disable dangerous features
        self.env.globals = {}

    def render(self, template_name: str, context: dict[str, Any]) -> str:
        """Render a template file with context."""
        template = self.env.get_template(template_name)
        return template.render(**context)

    def render_string(self, template_str: str, context: dict[str, Any]) -> str:
        """Render a template string with context."""
        template = self.env.from_string(template_str)
        return template.render(**context)

    def has_variables(self, text: str) -> bool:
        """Check if text contains Jinja2 variables."""
        return "{{" in text or "{%" in text


def build_template_context(
    workflow_name: str,
    started_at: str,
    completed_at: str | None,
    step_outputs: dict[str, Any],
    files_changed: list[str],
    branches: list[str],
    pull_requests: list[dict],
    inputs: dict[str, Any],
) -> dict[str, Any]:
    """Build the template context object for output templates."""
    return {
        "workflow": {
            "name": workflow_name,
            "started_at": started_at,
            "completed_at": completed_at,
        },
        "steps": step_outputs,
        "files_changed": files_changed,
        "branches": branches,
        "pull_requests": pull_requests,
        "inputs": inputs,
    }
```

---

### Task 10: Basic Workflow Executor

**File: `src/agentic_workflows/executor.py`**

Execute workflows with `prompt` and `command` step types only. Plan 2 adds remaining step types.

```python
"""Workflow executor for running workflows."""

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agentic_workflows.config import load_config
from agentic_workflows.logging.logger import WorkflowLogger, LogLevel
from agentic_workflows.parser import WorkflowDefinition, StepDefinition, StepType
from agentic_workflows.progress import (
    WorkflowProgress, WorkflowStatus, create_progress, save_progress,
    update_step_started, update_step_completed, update_step_failed,
)
from agentic_workflows.runner import run_claude, run_claude_with_command
from agentic_workflows.templates.renderer import TemplateRenderer


class WorkflowExecutor:
    """Executes workflow definitions."""

    def __init__(self, repo_root: Path | None = None):
        self.repo_root = repo_root or Path.cwd()
        self.config = load_config(self.repo_root)
        self.renderer = TemplateRenderer()

    def run(
        self,
        workflow: WorkflowDefinition,
        variables: dict[str, Any] | None = None,
        from_step: str | None = None,
        terminal_output: str = "base",
        dry_run: bool = False,
    ) -> WorkflowProgress:
        """Execute a workflow.

        Args:
            workflow: Parsed workflow definition
            variables: Variables to pass to templates
            from_step: Resume from a specific step
            terminal_output: Output mode (base or all)
            dry_run: Validate without executing
        """
        variables = variables or {}
        workflow_id = str(uuid.uuid4())[:8]

        # Merge variables with defaults
        for var in workflow.variables:
            if var.name not in variables:
                if var.required and var.default is None:
                    raise ValueError(f"Missing required variable: {var.name}")
                variables[var.name] = var.default

        # Get step names for progress
        step_names = [s.name for s in workflow.steps]

        # Create progress document
        progress = create_progress(workflow_id, workflow.name, step_names, variables)
        save_progress(progress, self.repo_root)

        # Initialize logger
        logger = WorkflowLogger(workflow_id, self.repo_root)
        logger.info("workflow", f"Started workflow: {workflow.name}")

        if dry_run:
            progress.status = WorkflowStatus.COMPLETED.value
            progress.completed_at = datetime.now(timezone.utc).isoformat()
            save_progress(progress, self.repo_root)
            return progress

        # Execute steps
        skip_until = from_step
        print_output = terminal_output == "all"

        for step in workflow.steps:
            # Skip steps until from_step
            if skip_until:
                if step.name == skip_until:
                    skip_until = None
                else:
                    continue

            try:
                self._execute_step(step, progress, variables, logger, print_output)
                save_progress(progress, self.repo_root)

                if progress.status == WorkflowStatus.FAILED.value:
                    break

            except Exception as e:
                logger.error(step.name, f"Step failed: {e}")
                update_step_failed(progress, step.name, str(e))
                progress.status = WorkflowStatus.FAILED.value
                save_progress(progress, self.repo_root)
                break

        # Finalize
        if progress.status == WorkflowStatus.RUNNING.value:
            progress.status = WorkflowStatus.COMPLETED.value
        progress.completed_at = datetime.now(timezone.utc).isoformat()
        save_progress(progress, self.repo_root)

        logger.info("workflow", f"Workflow {progress.status}: {workflow.name}")
        return progress

    def _execute_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        variables: dict[str, Any],
        logger: WorkflowLogger,
        print_output: bool,
    ) -> None:
        """Execute a single step."""
        logger.info(step.name, f"Starting step: {step.name}")
        update_step_started(progress, step.name)
        save_progress(progress, self.repo_root)

        # Build context for template rendering
        context = {
            "variables": variables,
            "outputs": progress.step_outputs,
            **variables,
        }

        if step.type == StepType.PROMPT:
            self._execute_prompt_step(step, progress, context, logger, print_output)
        elif step.type == StepType.COMMAND:
            self._execute_command_step(step, progress, context, logger, print_output)
        else:
            # Plan 2 implements: parallel, conditional, recurring, wait-for-human
            raise NotImplementedError(f"Step type not yet implemented: {step.type.value}")

    def _execute_prompt_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        print_output: bool,
    ) -> None:
        """Execute a prompt step."""
        prompt = step.prompt or ""

        # Render template variables in prompt
        if self.renderer.has_variables(prompt):
            prompt = self.renderer.render_string(prompt, context)

        # Add agent context if specified
        if step.agent:
            agent_path = self.repo_root / step.agent
            if agent_path.exists():
                agent_content = agent_path.read_text()
                prompt = f"{agent_content}\n\n{prompt}"

        timeout = (step.step_timeout_minutes or 60) * 60
        max_retry = step.step_max_retry or self.config["defaults"]["maxRetry"]

        for attempt in range(max_retry + 1):
            result = run_claude(
                prompt=prompt,
                cwd=self.repo_root,
                model=step.model,
                timeout=timeout,
                print_output=print_output,
                skip_permissions=True,
            )

            if result.success:
                update_step_completed(progress, step.name, result.stdout[:200], result.stdout)
                logger.info(step.name, "Step completed successfully")
                return

            if attempt < max_retry:
                logger.warning(step.name, f"Attempt {attempt + 1} failed, retrying...")
                progress.current_step["retry_count"] = attempt + 1
            else:
                update_step_failed(progress, step.name, result.stderr or "Step failed")
                progress.status = WorkflowStatus.FAILED.value
                logger.error(step.name, f"Step failed after {max_retry + 1} attempts")

    def _execute_command_step(
        self,
        step: StepDefinition,
        progress: WorkflowProgress,
        context: dict[str, Any],
        logger: WorkflowLogger,
        print_output: bool,
    ) -> None:
        """Execute a command step."""
        command = step.command or ""
        args = step.args.copy()

        # Render template variables in args
        for key, value in args.items():
            if isinstance(value, str) and self.renderer.has_variables(value):
                args[key] = self.renderer.render_string(value, context)

        timeout = (step.step_timeout_minutes or 60) * 60
        max_retry = step.step_max_retry or self.config["defaults"]["maxRetry"]

        for attempt in range(max_retry + 1):
            result = run_claude_with_command(
                command=command,
                args=args,
                cwd=self.repo_root,
                model=step.model,
                timeout=timeout,
                print_output=print_output,
                skip_permissions=True,
            )

            if result.success:
                update_step_completed(progress, step.name, result.stdout[:200], result.stdout)
                logger.info(step.name, "Step completed successfully")
                return

            if attempt < max_retry:
                logger.warning(step.name, f"Attempt {attempt + 1} failed, retrying...")
                progress.current_step["retry_count"] = attempt + 1
            else:
                update_step_failed(progress, step.name, result.stderr or "Step failed")
                progress.status = WorkflowStatus.FAILED.value
                logger.error(step.name, f"Step failed after {max_retry + 1} attempts")
```

---

### Task 11: JSON Schemas

**File: `schemas/workflow.schema.json`**

Create JSON Schema for workflow validation (see requirements document for full schema).

**File: `schemas/config.schema.json`**

Schema for `agentic/config.json`.

**File: `schemas/progress.schema.json`**

Schema for `progress.json` document.

**File: `schemas/step-output.schema.json`**

Schema for step output format.

---

### Task 12: Progress Template

**File: `templates/progress.json.j2`**

```jinja2
{
  "schema_version": "1.0",
  "workflow_id": "{{ workflow_id }}",
  "workflow_name": "{{ workflow_name }}",
  "status": "{{ status }}",
  "started_at": "{{ started_at }}",
  "completed_at": {{ completed_at | tojson if completed_at else "null" }},
  "current_step": {{ current_step | tojson if current_step else "null" }},
  "completed_steps": {{ completed_steps | tojson }},
  "pending_steps": {{ pending_steps | tojson }},
  "running_steps": {{ running_steps | tojson }},
  "parallel_branches": {{ parallel_branches | tojson }},
  "errors": {{ errors | tojson }},
  "variables": {{ variables | tojson }}
}
```

---

## Acceptance Criteria

1. **Package Installation**: `uv tool install .` successfully installs `agentic-workflow` command
2. **CLI Commands**: `agentic-workflow run`, `status`, `list`, `configure`, `config get/set` work
3. **Workflow Parsing**: Valid YAML workflows parse without errors; invalid ones raise clear errors
4. **Prompt Execution**: Prompt steps execute Claude and capture output
5. **Command Execution**: Command steps invoke slash commands with arguments
6. **Progress Tracking**: `progress.json` is created and updated during execution
7. **Logging**: `logs.ndjson` captures workflow events
8. **Configuration**: `config.json` is read and respects defaults
9. **Git Worktrees**: Can create, list, and remove worktrees with naming convention
10. **Template Rendering**: Jinja2 variables in prompts are resolved

---

## Test Workflow

Create a simple test workflow to verify Plan 1 implementation:

```yaml
name: plan1-test
version: "1.0"
description: Test workflow for Plan 1 validation

variables:
  - name: task_description
    type: string
    required: true
    description: What to analyze

steps:
  - name: analyze
    type: prompt
    prompt: |
      Analyze the following task and provide a brief summary:
      {{ task_description }}

      Respond with only a 2-3 sentence summary.
    model: haiku

  - name: echo
    type: command
    command: echo
    args:
      message: "Analysis complete"
```

Run with: `agentic-workflow run plan1-test.yaml --var "task_description=Build a login page"`
