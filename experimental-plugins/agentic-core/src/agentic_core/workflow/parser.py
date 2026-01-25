"""YAML workflow parser."""

from pathlib import Path
from typing import Any, Optional

from ruamel.yaml import YAML

from agentic_core.workflow.models import (
    AgentDefinition,
    GitSettings,
    InputDefinition,
    MeetingConfig,
    OutputDefinition,
    StepConditions,
    StepDefinition,
    TaskDefinition,
    WorkflowDefinition,
    WorkflowSettings,
    WorkflowType,
)


class WorkflowParseError(Exception):
    """Error parsing workflow YAML."""

    pass


class WorkflowParser:
    """Parser for YAML workflow definitions."""

    def __init__(self, base_path: Optional[Path] = None):
        """Initialize parser.

        Args:
            base_path: Base path for resolving file references
        """
        self.base_path = base_path or Path.cwd()
        self.yaml = YAML()
        self.yaml.preserve_quotes = True

    def parse_file(self, path: Path) -> WorkflowDefinition:
        """Parse workflow from YAML file.

        Args:
            path: Path to YAML file

        Returns:
            Parsed WorkflowDefinition

        Raises:
            WorkflowParseError: If parsing fails
        """
        if not path.exists():
            raise WorkflowParseError(f"Workflow file not found: {path}")

        try:
            with open(path, "r") as f:
                data = self.yaml.load(f)
        except Exception as e:
            raise WorkflowParseError(f"Failed to parse YAML: {e}")

        # Update base path to workflow file's directory
        self.base_path = path.parent

        return self.parse_dict(data)

    def parse_string(self, content: str) -> WorkflowDefinition:
        """Parse workflow from YAML string.

        Args:
            content: YAML content string

        Returns:
            Parsed WorkflowDefinition
        """
        try:
            data = self.yaml.load(content)
        except Exception as e:
            raise WorkflowParseError(f"Failed to parse YAML: {e}")

        return self.parse_dict(data)

    def parse_dict(self, data: dict) -> WorkflowDefinition:
        """Parse workflow from dictionary.

        Args:
            data: Workflow data dictionary

        Returns:
            Parsed WorkflowDefinition
        """
        if not isinstance(data, dict):
            raise WorkflowParseError("Workflow must be a dictionary")

        # Required fields
        name = self._get_required(data, "name")
        workflow_type = self._parse_workflow_type(data.get("type", "custom"))

        # Optional fields
        version = data.get("version", "1.0")
        description = data.get("description", "")

        # Settings
        settings = self._parse_settings(data.get("settings", {}))

        # Agents
        agents = [self._parse_agent(a) for a in data.get("agents", [])]

        # Inputs
        inputs = [self._parse_input(i) for i in data.get("inputs", [])]

        # Steps
        steps = [self._parse_step(s) for s in data.get("steps", [])]

        # Outputs
        outputs = [self._parse_output(o) for o in data.get("outputs", [])]

        # Meeting config
        meeting = None
        if data.get("meeting"):
            meeting = self._parse_meeting(data["meeting"])

        return WorkflowDefinition(
            name=name,
            type=workflow_type,
            version=version,
            description=description,
            settings=settings,
            agents=agents,
            inputs=inputs,
            steps=steps,
            outputs=outputs,
            meeting=meeting,
        )

    def _get_required(self, data: dict, key: str) -> Any:
        """Get required field from dictionary."""
        if key not in data:
            raise WorkflowParseError(f"Missing required field: {key}")
        return data[key]

    def _parse_workflow_type(self, type_str: str) -> WorkflowType:
        """Parse workflow type string."""
        try:
            return WorkflowType(type_str)
        except ValueError:
            valid = [t.value for t in WorkflowType]
            raise WorkflowParseError(f"Invalid workflow type: {type_str}. Valid: {valid}")

    def _parse_settings(self, data: dict) -> WorkflowSettings:
        """Parse workflow settings."""
        git_data = data.get("git", {})
        git = GitSettings(
            enabled=git_data.get("enabled", False),
            auto_branch=git_data.get("auto_branch", True),
            branch_prefix=git_data.get("branch_prefix", "agentic"),
            auto_commit=git_data.get("auto_commit", True),
            auto_pr=git_data.get("auto_pr", False),
            pr_draft=git_data.get("pr_draft", True),
        )

        return WorkflowSettings(
            human_in_loop=data.get("human_in_loop", False),
            max_retries=data.get("max_retries", 3),
            timeout_minutes=data.get("timeout_minutes", 60),
            working_dir=data.get("working_dir"),
            git=git,
            extract_learnings=data.get("extract_learnings", False),
        )

    def _parse_agent(self, data: dict) -> AgentDefinition:
        """Parse agent definition."""
        if isinstance(data, str):
            # Simple format: just the name
            return AgentDefinition(name=data)

        name = self._get_required(data, "name")

        return AgentDefinition(
            name=name,
            provider=data.get("provider", "claude"),
            model=data.get("model", "sonnet"),
            persona=data.get("persona"),
            persona_file=data.get("persona_file"),
            tools=data.get("tools", []),
        )

    def _parse_input(self, data: dict) -> InputDefinition:
        """Parse input definition."""
        name = self._get_required(data, "name")
        input_type = self._get_required(data, "type")
        source = self._get_required(data, "source")

        return InputDefinition(
            name=name,
            type=input_type,
            source=source,
            glob=data.get("glob"),
            required=data.get("required", True),
        )

    def _parse_output(self, data: dict) -> OutputDefinition:
        """Parse output definition."""
        name = self._get_required(data, "name")
        output_type = self._get_required(data, "type")

        return OutputDefinition(
            name=name,
            type=output_type,
            path=data.get("path"),
            template=data.get("template"),
        )

    def _parse_task(self, data: dict) -> TaskDefinition:
        """Parse task definition."""
        description = self._get_required(data, "description")

        return TaskDefinition(
            description=description,
            prompt=data.get("prompt"),
            prompt_file=data.get("prompt_file"),
            context=data.get("context", []),
        )

    def _parse_step(self, data: dict) -> StepDefinition:
        """Parse step definition."""
        name = self._get_required(data, "name")
        agent = self._get_required(data, "agent")
        task_data = self._get_required(data, "task")

        task = self._parse_task(task_data)

        # Parse conditions
        conditions = None
        if data.get("conditions"):
            cond_data = data["conditions"]
            conditions = StepConditions(
                requires=cond_data.get("requires", []),
                unless=cond_data.get("unless"),
                when=cond_data.get("when"),
            )

        return StepDefinition(
            name=name,
            agent=agent,
            task=task,
            conditions=conditions,
            checkpoint=data.get("checkpoint", False),
            human_approval=data.get("human_approval", False),
            on_failure=data.get("on_failure", "pause"),
            timeout_minutes=data.get("timeout_minutes"),
            max_retries=data.get("max_retries"),
        )

    def _parse_meeting(self, data: dict) -> MeetingConfig:
        """Parse meeting configuration."""
        topic = self._get_required(data, "topic")
        agents = self._get_required(data, "agents")

        return MeetingConfig(
            topic=topic,
            agents=agents,
            facilitator=data.get("facilitator", "facilitator"),
            max_rounds=data.get("max_rounds", 5),
            interactive=data.get("interactive", False),
            outputs=data.get("outputs", ["summary", "decisions"]),
        )

    def resolve_file_reference(self, ref: str) -> str:
        """Resolve a file reference and return its contents.

        Args:
            ref: File path (relative to base_path)

        Returns:
            File contents
        """
        path = self.base_path / ref
        if not path.exists():
            raise WorkflowParseError(f"Referenced file not found: {ref}")

        return path.read_text()
