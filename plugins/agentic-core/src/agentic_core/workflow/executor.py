"""Workflow executor for running workflows."""

import asyncio
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from agentic_core.providers import CLIProvider, get_provider
from agentic_core.workflow.models import (
    StepDefinition,
    StepOutput,
    StepStatus,
    WorkflowDefinition,
    WorkflowResult,
    WorkflowState,
    WorkflowStatus,
)
from agentic_core.workflow.templates import TemplateResolver


class WorkflowExecutor:
    """Executes workflow definitions."""

    def __init__(
        self,
        db=None,
        kafka=None,
        working_dir: Optional[Path] = None,
    ):
        """Initialize executor.

        Args:
            db: Database instance (optional)
            kafka: Kafka client instance (optional)
            working_dir: Default working directory
        """
        self.db = db
        self.kafka = kafka
        self.working_dir = working_dir or Path.cwd()
        self.template_resolver = TemplateResolver()
        self._providers: dict[str, CLIProvider] = {}

    async def run(
        self,
        workflow: WorkflowDefinition,
        variables: dict[str, Any] = None,
        from_step: Optional[str] = None,
        dry_run: bool = False,
    ) -> WorkflowResult:
        """Execute a workflow.

        Args:
            workflow: Workflow definition to execute
            variables: Variables to pass to templates
            from_step: Resume from a specific step (skip prior steps)
            dry_run: Validate without executing

        Returns:
            WorkflowResult with status and outputs
        """
        variables = variables or {}
        start_time = time.time()

        # Create workflow state
        state = WorkflowState(
            workflow_id=str(uuid4()),
            definition=workflow,
            status=WorkflowStatus.RUNNING,
            variables=variables,
        )

        # Store workflow in database
        if self.db:
            await self.db.create_workflow(
                name=workflow.name,
                workflow_type=workflow.type.value,
                config={"variables": variables},
                working_dir=str(self.working_dir),
            )

        # Publish workflow started event
        if self.kafka:
            self.kafka.publish_workflow_event(
                workflow_id=state.workflow_id,
                event_type="started",
                workflow_name=workflow.name,
            )

        # Dry run - just validate
        if dry_run:
            return self._dry_run_result(state, workflow)

        # Process inputs
        inputs = await self._process_inputs(workflow, state)

        # Build providers for agents
        await self._init_providers(workflow)

        # Execute steps
        try:
            should_skip = from_step is not None
            for step in workflow.steps:
                # Skip steps until we reach from_step
                if should_skip:
                    if step.name == from_step:
                        should_skip = False
                    else:
                        state.completed_steps.append(step.name)
                        continue

                # Check conditions
                if not self._check_conditions(step, state):
                    continue

                # Execute step
                state.current_step = step.name
                output = await self._execute_step(step, state, inputs)

                if output is None:
                    # Step failed
                    state.status = WorkflowStatus.FAILED
                    break

                state.step_outputs[step.name] = output
                state.completed_steps.append(step.name)

                # Checkpoint if configured
                if step.checkpoint and self.db:
                    await self._create_checkpoint(state)

            # All steps completed
            if state.status == WorkflowStatus.RUNNING:
                state.status = WorkflowStatus.COMPLETED

        except Exception as e:
            state.status = WorkflowStatus.FAILED
            state.error = str(e)

        # Calculate duration
        duration_ms = int((time.time() - start_time) * 1000)

        # Publish completion event
        if self.kafka:
            self.kafka.publish_workflow_event(
                workflow_id=state.workflow_id,
                event_type="completed" if state.status == WorkflowStatus.COMPLETED else "failed",
                workflow_name=workflow.name,
                status=state.status.value,
                error=state.error,
            )
            self.kafka.flush()

        return WorkflowResult(
            workflow_id=state.workflow_id,
            status=state.status,
            outputs=self._collect_outputs(workflow, state),
            step_outputs=state.step_outputs,
            error=state.error,
            duration_ms=duration_ms,
        )

    def _dry_run_result(
        self,
        state: WorkflowState,
        workflow: WorkflowDefinition,
    ) -> WorkflowResult:
        """Generate dry run result."""
        # Just return a successful validation result
        return WorkflowResult(
            workflow_id=state.workflow_id,
            status=WorkflowStatus.COMPLETED,
            outputs={
                "dry_run": True,
                "steps": [s.name for s in workflow.steps],
                "agents": [a.name for a in workflow.agents],
            },
            duration_ms=0,
        )

    async def _process_inputs(
        self,
        workflow: WorkflowDefinition,
        state: WorkflowState,
    ) -> dict[str, Any]:
        """Process workflow inputs."""
        inputs = {}

        for input_def in workflow.inputs:
            # Placeholder - actual input processing in Milestone 5
            inputs[input_def.name] = {
                "type": input_def.type,
                "source": input_def.source,
                "content": f"[Input: {input_def.name}]",
            }

        return inputs

    async def _init_providers(self, workflow: WorkflowDefinition) -> None:
        """Initialize providers for workflow agents."""
        for agent in workflow.agents:
            if agent.provider not in self._providers:
                self._providers[agent.provider] = get_provider(agent.provider)

    def _check_conditions(
        self,
        step: StepDefinition,
        state: WorkflowState,
    ) -> bool:
        """Check if step conditions are met."""
        if not step.conditions:
            return True

        # Check required steps completed
        for req in step.conditions.requires:
            if req not in state.completed_steps:
                return False

        # TODO: Implement 'when' and 'unless' expressions

        return True

    async def _execute_step(
        self,
        step: StepDefinition,
        state: WorkflowState,
        inputs: dict[str, Any],
    ) -> Optional[StepOutput]:
        """Execute a single step.

        Returns:
            StepOutput if successful, None if failed
        """
        # Find agent configuration
        agent_config = next(
            (a for a in state.definition.agents if a.name == step.agent),
            None,
        )
        if not agent_config:
            # Use default configuration
            agent_config = type("Agent", (), {
                "name": step.agent,
                "provider": "claude",
                "model": "sonnet",
                "persona": None,
                "tools": [],
            })()

        # Get provider
        provider = self._providers.get(agent_config.provider)
        if not provider:
            provider = get_provider(agent_config.provider)
            self._providers[agent_config.provider] = provider

        # Build prompt context
        context = self.template_resolver.build_step_context(
            variables=state.variables,
            step_outputs={k: v.content for k, v in state.step_outputs.items()},
            inputs=inputs,
        )

        # Resolve prompt template
        prompt = step.task.prompt or step.task.description
        if self.template_resolver.has_variables(prompt):
            prompt = self.template_resolver.resolve(prompt, context)

        # Build system prompt from persona
        system_prompt = None
        if agent_config.persona:
            system_prompt = agent_config.persona

        # Invoke provider
        timeout = (step.timeout_minutes or state.definition.settings.timeout_minutes) * 60

        result = provider.invoke(
            prompt=prompt,
            system_prompt=system_prompt,
            model=agent_config.model if hasattr(agent_config, "model") else None,
            tools=agent_config.tools if hasattr(agent_config, "tools") else None,
            working_dir=self.working_dir,
            timeout=timeout,
        )

        if result.is_error:
            state.error = result.error_message
            # Publish failure event
            if self.kafka:
                self.kafka.publish_workflow_event(
                    workflow_id=state.workflow_id,
                    event_type="step_failed",
                    workflow_name=state.definition.name,
                    step_name=step.name,
                    error=result.error_message,
                )
            return None

        # Publish success event
        if self.kafka:
            self.kafka.publish_workflow_event(
                workflow_id=state.workflow_id,
                event_type="step_completed",
                workflow_name=state.definition.name,
                step_name=step.name,
                status="completed",
            )

        return StepOutput(
            step_name=step.name,
            content=result.content,
            metadata={
                "tokens_in": result.tokens_in,
                "tokens_out": result.tokens_out,
                "duration_ms": result.duration_ms,
                "session_id": result.session_id,
            },
        )

    async def _create_checkpoint(self, state: WorkflowState) -> None:
        """Create a checkpoint for crash recovery."""
        if self.db:
            await self.db.create_checkpoint(
                workflow_id=state.workflow_id,
                step_name=state.current_step,
                status=state.status.value,
                state={
                    "completed_steps": state.completed_steps,
                    "variables": state.variables,
                },
            )

    def _collect_outputs(
        self,
        workflow: WorkflowDefinition,
        state: WorkflowState,
    ) -> dict[str, Any]:
        """Collect workflow outputs."""
        outputs = {}

        for output_def in workflow.outputs:
            # Simple output collection - just get step output if name matches
            if output_def.name in state.step_outputs:
                outputs[output_def.name] = state.step_outputs[output_def.name].content

        return outputs
