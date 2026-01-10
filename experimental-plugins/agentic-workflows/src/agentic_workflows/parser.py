"""YAML workflow parser."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import yaml


class StepType(Enum):
    """Types of workflow steps."""

    PROMPT = "prompt"
    COMMAND = "command"
    PARALLEL = "parallel"
    CONDITIONAL = "conditional"
    RECURRING = "recurring"
    WAIT_FOR_HUMAN = "wait-for-human"


@dataclass
class Variable:
    """Workflow variable definition."""

    name: str
    type: str
    required: bool = True
    default: Any = None
    description: str = ""


@dataclass
class GitSettings:
    """Git configuration for a workflow."""

    enabled: bool = False
    worktree: bool = False
    auto_commit: bool = True
    auto_pr: bool = True
    branch_prefix: str = "agentic"


@dataclass
class WorkflowSettings:
    """Workflow-level settings."""

    max_retry: int = 3
    timeout_minutes: int = 60
    track_progress: bool = True
    autofix: str = "none"
    terminal_output: str = "base"
    bypass_permissions: bool = False
    git: GitSettings = field(default_factory=GitSettings)


@dataclass
class StepDefinition:
    """Definition of a workflow step."""

    name: str
    type: StepType
    prompt: str | None = None
    agent: str | None = None
    command: str | None = None
    args: dict[str, Any] = field(default_factory=dict)
    steps: list["StepDefinition"] = field(default_factory=list)
    merge_strategy: str = "wait-all"
    merge_mode: str = "independent"
    condition: str | None = None
    then_steps: list["StepDefinition"] = field(default_factory=list)
    else_steps: list["StepDefinition"] = field(default_factory=list)
    max_iterations: int = 3
    until: str | None = None
    message: str | None = None
    polling_interval: int = 15
    on_timeout: str = "abort"
    model: str = "sonnet"
    step_timeout_minutes: int | None = None
    step_max_retry: int | None = None
    on_error: str = "retry"
    checkpoint: bool = False
    depends_on: str | None = None


@dataclass
class OutputDefinition:
    """Definition of a workflow output."""

    name: str
    template: str
    path: str
    when: str = "completed"


@dataclass
class WorkflowDefinition:
    """Complete workflow definition."""

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
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            raise WorkflowParseError(f"Invalid YAML: {e}") from e

        self.base_path = path.parent
        return self._parse_dict(data)

    def parse_string(self, content: str) -> WorkflowDefinition:
        """Parse workflow from YAML string."""
        try:
            data = yaml.safe_load(content)
        except yaml.YAMLError as e:
            raise WorkflowParseError(f"Invalid YAML: {e}") from e
        return self._parse_dict(data)

    def _parse_dict(self, data: Any) -> WorkflowDefinition:
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

    def _required(self, data: dict[str, Any], key: str) -> Any:
        """Get required field or raise error."""
        if key not in data:
            raise WorkflowParseError(f"Missing required field: {key}")
        return data[key]

    def _parse_settings(self, data: dict[str, Any]) -> WorkflowSettings:
        """Parse workflow settings."""
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

    def _parse_variable(self, data: dict[str, Any]) -> Variable:
        """Parse a variable definition."""
        return Variable(
            name=self._required(data, "name"),
            type=data.get("type", "string"),
            required=data.get("required", True),
            default=data.get("default"),
            description=data.get("description", ""),
        )

    def _parse_step(self, data: dict[str, Any]) -> StepDefinition:
        """Parse a step definition."""
        name = self._required(data, "name")
        type_str = self._required(data, "type")

        try:
            step_type = StepType(type_str)
        except ValueError:
            valid = [t.value for t in StepType]
            raise WorkflowParseError(
                f"Invalid step type: {type_str}. Valid types: {valid}"
            ) from None

        step = StepDefinition(name=name, type=step_type)

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

        step.model = data.get("model", "sonnet")
        step.step_timeout_minutes = data.get("timeout-minutes", step.step_timeout_minutes)
        step.step_max_retry = data.get("max-retry")
        step.on_error = data.get("on-error", "retry")
        step.checkpoint = data.get("checkpoint", False)
        step.depends_on = data.get("depends-on")

        return step

    def _parse_output(self, data: dict[str, Any]) -> OutputDefinition:
        """Parse an output definition."""
        return OutputDefinition(
            name=self._required(data, "name"),
            template=self._required(data, "template"),
            path=self._required(data, "path"),
            when=data.get("when", "completed"),
        )
