"""Workflow data models."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class WorkflowType(Enum):
    """Types of workflows."""

    ONE_SHOT = "one-shot"
    FEATURE = "feature"
    EPIC = "epic"
    MEETING = "meeting"
    ANALYSIS = "analysis"
    CUSTOM = "custom"


class WorkflowStatus(Enum):
    """Workflow execution status."""

    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class StepStatus(Enum):
    """Step execution status."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class GitSettings:
    """Git integration settings."""

    enabled: bool = False
    auto_branch: bool = True
    branch_prefix: str = "agentic"
    auto_commit: bool = True
    auto_pr: bool = False
    pr_draft: bool = True


@dataclass
class WorkflowSettings:
    """Global workflow settings."""

    human_in_loop: bool = False
    max_retries: int = 3
    timeout_minutes: int = 60
    working_dir: Optional[str] = None
    git: GitSettings = field(default_factory=GitSettings)
    extract_learnings: bool = False


@dataclass
class AgentDefinition:
    """Agent configuration for a workflow."""

    name: str
    provider: str = "claude"
    model: str = "sonnet"
    persona: Optional[str] = None
    persona_file: Optional[str] = None
    tools: list[str] = field(default_factory=list)


@dataclass
class InputDefinition:
    """Input source definition."""

    name: str
    type: str  # file, codebase, url, github_issue
    source: str
    glob: Optional[str] = None
    required: bool = True


@dataclass
class OutputDefinition:
    """Output definition."""

    name: str
    type: str  # file, message, artifact
    path: Optional[str] = None
    template: Optional[str] = None


@dataclass
class TaskDefinition:
    """Task definition for a step."""

    description: str
    prompt: Optional[str] = None
    prompt_file: Optional[str] = None
    context: list[str] = field(default_factory=list)


@dataclass
class StepConditions:
    """Conditions for step execution."""

    requires: list[str] = field(default_factory=list)
    unless: Optional[str] = None
    when: Optional[str] = None


@dataclass
class StepDefinition:
    """Step definition in a workflow."""

    name: str
    agent: str
    task: TaskDefinition
    conditions: Optional[StepConditions] = None
    checkpoint: bool = False
    human_approval: bool = False
    on_failure: str = "pause"  # retry, skip, abort, pause
    timeout_minutes: Optional[int] = None
    max_retries: Optional[int] = None


@dataclass
class MeetingConfig:
    """Configuration for meeting-type workflows."""

    topic: str
    agents: list[str]
    facilitator: str = "facilitator"
    max_rounds: int = 5
    interactive: bool = False
    outputs: list[str] = field(default_factory=lambda: ["summary", "decisions"])


@dataclass
class WorkflowDefinition:
    """Complete workflow definition."""

    name: str
    type: WorkflowType
    version: str = "1.0"
    description: str = ""
    settings: WorkflowSettings = field(default_factory=WorkflowSettings)
    agents: list[AgentDefinition] = field(default_factory=list)
    inputs: list[InputDefinition] = field(default_factory=list)
    steps: list[StepDefinition] = field(default_factory=list)
    outputs: list[OutputDefinition] = field(default_factory=list)
    meeting: Optional[MeetingConfig] = None


@dataclass
class StepOutput:
    """Output from a completed step."""

    step_name: str
    content: str
    file_path: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkflowState:
    """Runtime state of a workflow execution."""

    workflow_id: str
    definition: WorkflowDefinition
    status: WorkflowStatus = WorkflowStatus.PENDING
    current_step: Optional[str] = None
    completed_steps: list[str] = field(default_factory=list)
    step_outputs: dict[str, StepOutput] = field(default_factory=dict)
    variables: dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


@dataclass
class WorkflowResult:
    """Result of workflow execution."""

    workflow_id: str
    status: WorkflowStatus
    outputs: dict[str, Any] = field(default_factory=dict)
    step_outputs: dict[str, StepOutput] = field(default_factory=dict)
    error: Optional[str] = None
    duration_ms: int = 0
