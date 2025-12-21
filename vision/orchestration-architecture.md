# BMAD Orchestration Architecture & Implementation Guide

This document explains how BMAD Method orchestrates complex multi-workflow processes and provides guidance for implementing a fully automated orchestrator using Python and Claude Code CLI.

---

## Table of Contents

1. [How BMAD Orchestration Actually Works](#1-how-bmad-orchestration-actually-works)
2. [The Manual Nature of BMAD](#2-the-manual-nature-of-bmad)
3. [Building an Automated Orchestrator](#3-building-an-automated-orchestrator)
4. [Complete Implementation: Workflow Orchestrator](#4-complete-implementation-workflow-orchestrator)
5. [Example: Brainstorm-Plan-Build-Validate Flow](#5-example-brainstorm-plan-build-validate-flow)
6. [Handling Dependencies and Parallelism](#6-handling-dependencies-and-parallelism)
7. [Error Handling and Retry Logic](#7-error-handling-and-retry-logic)

---

## 1. How BMAD Orchestration Actually Works

### 1.1 The Truth: It's Mostly Manual

**BMAD is NOT an autonomous orchestration system**. Here's what actually happens:

```
┌─────────────────────────────────────────────────────────────┐
│                    BMAD Orchestration Reality                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐       ┌──────────┐       ┌──────────┐        │
│  │  Human   │       │  Agent   │       │  State   │        │
│  │  User    │──────▶│  (LLM)   │──────▶│  Files   │        │
│  │          │       │          │       │  (YAML)  │        │
│  └──────────┘       └──────────┘       └──────────┘        │
│       │                   │                   │             │
│       │                   │                   │             │
│       ▼                   ▼                   ▼             │
│  1. Load Agent       2. Run Workflow     3. Update State    │
│  2. Trigger *cmd     3. Execute steps    4. Save outputs    │
│  3. Review output    4. Prompt user      5. Mark complete   │
│  4. Load next agent  5. Wait for input                      │
│       │                                                      │
│       └─── REPEAT ────────────────────────────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Point:** The **USER is the orchestrator**. They:
1. Load different agents (PM, Architect, Developer)
2. Trigger workflows manually (`*workflow-status`, `*create-story`, `*dev-story`)
3. Review outputs
4. Move to the next agent/workflow based on guidance

### 1.2 The "Engine" Is Just Prompt Engineering

**`src/core/tasks/workflow.xml`** - This is NOT a script that executes autonomously.

It's a **system prompt template** that tells Claude how to interpret workflow instructions:

```xml
<task id="_bmad/core/tasks/workflow.xml" name="Execute Workflow">
  <objective>Execute given workflow by loading its configuration,
  following instructions, and producing output</objective>

  <execution-rules>
    - Steps execute in exact numerical order (1, 2, 3...)
    - Template-output creates checkpoint requiring user confirmation
    - Ask tags WAIT for user response
    - You stay in character as the agent
  </execution-rules>
```

**This is loaded into Claude's context** when an agent triggers a workflow. Claude then:
- Reads the workflow instructions
- Follows the step-by-step XML/Markdown
- Prompts the user when needed
- Updates state files
- Completes and waits

**There is NO external script running in a loop**.

### 1.3 State Management: File-Based

All progress tracking uses YAML files:

**sprint-status.yaml:**
```yaml
development_status:
  epic-1: in-progress
  1-1-user-auth: ready-for-dev
  1-2-session-mgmt: backlog
  epic-1-retrospective: optional
```

**workflow-status.yaml (BMGD):**
```yaml
workflow_status:
  brainstorm-game: /path/to/brainstorm.md
  game-brief: /path/to/game-brief.md
  gdd: /path/to/gdd.md
  game-architecture: pending
  sprint-planning: pending
```

**How Workflows Use State:**
1. Load state file (e.g., `sprint-status.yaml`)
2. Find next incomplete item
3. Execute workflow for that item
4. Update state file
5. Tell user what to do next

**Example from sprint-planning workflow:**

```
Bob (Scrum Master): "I've generated sprint-status.yaml.
I can see Epic 1 has 3 stories, all in backlog.

Next steps:
1. Run *create-story to prepare the first story
2. Load Developer agent and run *dev-story to implement it
3. Come back to me when you need the next story"
```

### 1.4 Agent Handoffs: Manual Context Switching

**Typical Flow:**

```
1. User loads Scrum Master agent
   > *sprint-planning

2. Scrum Master generates sprint-status.yaml, says:
   "Load Developer agent to run *dev-story for story 1-1"

3. User CLOSES Scrum Master session

4. User loads Developer agent (NEW Claude session)
   > *dev-story

5. Developer reads sprint-status.yaml, finds 1-1-user-auth
   Updates status: ready-for-dev → in-progress
   Implements the story
   Updates status: in-progress → review

6. Developer says:
   "Story complete. Run *code-review or load Scrum Master for next story"

7. User CLOSES Developer session

8. User loads Scrum Master again
   > *sprint-status

9. Scrum Master reads sprint-status.yaml
   "Story 1-1 is in review. Story 1-2 is backlog.
   Run *create-story for story 1-2 or get story 1-1 reviewed first"
```

**Each agent is a SEPARATE Claude Code session**. Context doesn't carry over automatically.

---

## 2. The Manual Nature of BMAD

### 2.1 What BMAD Does Well

BMAD excels at:
- **Rich context provision** - Workflows load extensive project context
- **Quality gates** - Validation workflows check output quality
- **State persistence** - YAML files survive session restarts
- **Guided workflows** - Step-by-step instructions for complex tasks
- **Agent specialization** - Each agent has focused expertise

### 2.2 What BMAD Doesn't Do

BMAD does NOT:
- ❌ **Automatically progress through workflows** - User triggers each one
- ❌ **Run workflows in parallel** - One agent, one workflow at a time
- ❌ **Retry on failure** - User must debug and re-run
- ❌ **Track dependencies automatically** - User decides sequencing
- ❌ **Manage multiple PRs** - Each story is manual
- ❌ **Handle build failures** - User must intervene

### 2.3 The User as Orchestrator

The user provides:
- **Decision-making** - Which workflow to run next
- **Error handling** - If workflow fails, user fixes and re-runs
- **Parallelization** - User could open multiple terminal sessions
- **Dependency resolution** - User knows Story 2 depends on Story 1
- **Quality assurance** - User reviews outputs before proceeding

---

## 3. Building an Automated Orchestrator

For your use case (brainstorm-plan-build-validate with multiple PRs, dependencies, parallel execution), you need a **Python orchestrator script** that:

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                  Automated Workflow Orchestrator                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Python Orchestrator (Main Loop)                           │ │
│  │  • Reads workflow DAG                                      │ │
│  │  • Tracks state in database/YAML                           │ │
│  │  • Spawns Claude CLI processes                             │ │
│  │  • Monitors completion/failure                             │ │
│  │  • Handles retries                                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│           │                    │                    │            │
│           ▼                    ▼                    ▼            │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Agent 1    │    │   Agent 2    │    │   Agent 3    │      │
│  │  (Analyst)   │    │ (Architect)  │    │ (Developer)  │      │
│  │              │    │              │    │              │      │
│  │ claude -p    │    │ claude -p    │    │ claude -p    │      │
│  │ --resume     │    │ --resume     │    │ --resume     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│           │                    │                    │            │
│           └────────────────────┴────────────────────┘            │
│                              │                                   │
│                              ▼                                   │
│                     ┌─────────────────┐                          │
│                     │  State Storage  │                          │
│                     │  • status.yaml  │                          │
│                     │  • outputs/     │                          │
│                     │  • sessions.db  │                          │
│                     └─────────────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Core Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| **Workflow Definition** | DAG of tasks with dependencies | YAML or Python dataclass |
| **State Manager** | Track task status (pending/running/done/failed) | SQLite or YAML |
| **Task Executor** | Spawn `claude -p` subprocess | Python subprocess |
| **Session Manager** | Track Claude session IDs for context | Dict/Database |
| **Dependency Resolver** | Determine which tasks can run | Topological sort |
| **Parallel Executor** | Run independent tasks concurrently | asyncio or threading |
| **Retry Handler** | Retry failed tasks with backoff | Configurable retry policy |
| **Output Collector** | Gather results from all tasks | File system + database |

### 3.3 Design Principles

1. **State is External** - Don't rely on Claude to remember state
2. **Each Task = One Claude Call** - `claude -p` with specific prompt
3. **Session Chaining** - Use `--resume` to maintain context within a workflow
4. **File-Based Handoffs** - Tasks communicate via output files
5. **Idempotency** - Tasks can be re-run without side effects
6. **Observable** - Log everything for debugging

---

## 4. Complete Implementation: Workflow Orchestrator

### 4.1 Workflow Definition Format

**`workflow_definition.yaml`:**

```yaml
name: "Feature Development Pipeline"
description: "Complete flow from brainstorming to validated PRs"

# Global configuration
config:
  max_retries: 3
  retry_delay_seconds: 5
  parallel_limit: 3
  state_file: "./orchestrator_state.yaml"
  output_dir: "./workflow_outputs"

# Define all tasks
tasks:
  brainstorm:
    agent: analyst
    description: "Brainstorm feature requirements"
    command: |
      You are a business analyst. Brainstorm requirements for: {{feature_name}}

      Generate:
      1. User stories
      2. Acceptance criteria
      3. Technical considerations

      Save output to: {{output_dir}}/brainstorm.md
    outputs:
      - brainstorm.md
    dependencies: []

  architecture:
    agent: architect
    description: "Design system architecture"
    command: |
      You are a system architect. Based on @{{output_dir}}/brainstorm.md,
      design the architecture for {{feature_name}}.

      Include:
      1. Component diagram
      2. Data flow
      3. Technology choices
      4. ADRs (Architecture Decision Records)

      Save output to: {{output_dir}}/architecture.md
    outputs:
      - architecture.md
    dependencies:
      - brainstorm

  plan_sprints:
    agent: pm
    description: "Break work into stories"
    command: |
      You are a product manager. Based on:
      - @{{output_dir}}/brainstorm.md
      - @{{output_dir}}/architecture.md

      Create a sprint plan for {{feature_name}}.

      Generate:
      1. Epic breakdown
      2. User stories with acceptance criteria
      3. Story dependencies

      Save as: {{output_dir}}/sprint_plan.yaml
    outputs:
      - sprint_plan.yaml
    dependencies:
      - brainstorm
      - architecture

  # Dynamic tasks generated from sprint_plan.yaml
  implement_story:
    template: true  # This will be instantiated per story
    agent: developer
    description: "Implement story {{story_id}}"
    command: |
      You are a senior developer. Implement story {{story_id}}.

      Context:
      - @{{output_dir}}/architecture.md
      - @{{output_dir}}/stories/{{story_id}}.md

      Steps:
      1. Read story acceptance criteria
      2. Implement code following TDD
      3. Write tests
      4. Run tests and verify
      5. Commit changes

      Output:
      - Changed files list
      - Test results

      Save to: {{output_dir}}/impl/{{story_id}}.md
    outputs:
      - "impl/{{story_id}}.md"
    dependencies:
      - plan_sprints

  create_pr:
    template: true
    agent: developer
    description: "Create PR for {{story_id}}"
    command: |
      Create a GitHub PR for story {{story_id}}.

      Context:
      - @{{output_dir}}/impl/{{story_id}}.md

      Generate:
      1. PR title and description
      2. Link to story
      3. Test coverage summary

      Use:
      - Bash(git status:*)
      - Bash(git add:*)
      - Bash(git commit:*)
      - Bash(gh pr create:*)

      Output PR URL to: {{output_dir}}/prs/{{story_id}}.txt
    outputs:
      - "prs/{{story_id}}.txt"
    dependencies:
      - "implement_story:{{story_id}}"

  validate_all:
    agent: qa
    description: "Run integration tests"
    command: |
      You are a QA engineer. Run full integration tests.

      Context:
      - All PRs in {{output_dir}}/prs/

      Steps:
      1. Checkout each PR branch
      2. Run integration tests
      3. Check for regressions

      Output test report to: {{output_dir}}/validation_report.md
    outputs:
      - validation_report.md
    dependencies:
      - create_pr  # All PRs must be created

# Execution order
execution:
  phases:
    - name: "Discovery"
      tasks:
        - brainstorm

    - name: "Planning"
      tasks:
        - architecture
        - plan_sprints
      wait_for_previous: true

    - name: "Implementation"
      tasks:
        - implement_story
        - create_pr
      parallel: true
      wait_for_previous: true

    - name: "Validation"
      tasks:
        - validate_all
      wait_for_previous: true
```

### 4.2 Python Orchestrator Implementation

**`orchestrator/main.py`:**

```python
#!/usr/bin/env python3
"""
Automated Workflow Orchestrator for Claude Code.
Runs complex multi-agent workflows with dependencies, parallelism, and retry.
"""

import asyncio
import subprocess
import json
import yaml
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Set
from dataclasses import dataclass, field
from enum import Enum
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class TaskResult:
    task_id: str
    status: TaskStatus
    session_id: Optional[str] = None
    output: str = ""
    error: Optional[str] = None
    duration_seconds: float = 0
    retry_count: int = 0


@dataclass
class WorkflowState:
    workflow_name: str
    started_at: datetime = field(default_factory=datetime.now)
    tasks: Dict[str, TaskResult] = field(default_factory=dict)
    completed_tasks: Set[str] = field(default_factory=set)
    failed_tasks: Set[str] = field(default_factory=set)

    def to_dict(self):
        return {
            'workflow_name': self.workflow_name,
            'started_at': self.started_at.isoformat(),
            'tasks': {
                tid: {
                    'status': t.status.value,
                    'session_id': t.session_id,
                    'error': t.error,
                    'duration_seconds': t.duration_seconds,
                    'retry_count': t.retry_count
                }
                for tid, t in self.tasks.items()
            },
            'completed_tasks': list(self.completed_tasks),
            'failed_tasks': list(self.failed_tasks)
        }

    def save(self, path: Path):
        with open(path, 'w') as f:
            yaml.dump(self.to_dict(), f, default_flow_style=False)


class ClaudeExecutor:
    """Executes tasks via Claude Code CLI."""

    def __init__(self, working_dir: Path):
        self.working_dir = working_dir
        self.session_cache: Dict[str, str] = {}

    async def execute_task(
        self,
        task_id: str,
        command: str,
        agent: str,
        resume_session: Optional[str] = None,
        allowed_tools: List[str] = None
    ) -> TaskResult:
        """Execute a single task via claude -p."""

        start_time = datetime.now()
        result = TaskResult(task_id=task_id, status=TaskStatus.RUNNING)

        cmd = ["claude", "-p", command, "--output-format", "json"]

        if resume_session:
            cmd.extend(["--resume", resume_session])
        elif task_id in self.session_cache:
            cmd.extend(["--resume", self.session_cache[task_id]])

        if allowed_tools:
            cmd.extend(["--allowedTools", ",".join(allowed_tools)])

        # Add agent-specific system prompt
        agent_prompts = {
            'analyst': "You are a senior business analyst...",
            'architect': "You are a system architect...",
            'developer': "You are a senior developer...",
            'pm': "You are a product manager...",
            'qa': "You are a QA engineer..."
        }
        if agent in agent_prompts:
            cmd.extend(["--append-system-prompt", agent_prompts[agent]])

        logger.info(f"Executing task {task_id} with agent {agent}")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.working_dir
            )

            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                result.status = TaskStatus.FAILED
                result.error = stderr.decode() if stderr else "Unknown error"
                logger.error(f"Task {task_id} failed: {result.error}")
            else:
                output_data = json.loads(stdout.decode())
                result.status = TaskStatus.COMPLETED
                result.output = output_data.get('result', '')
                result.session_id = output_data.get('session_id')

                # Cache session for potential continuation
                if result.session_id:
                    self.session_cache[task_id] = result.session_id

                logger.info(f"Task {task_id} completed successfully")

        except Exception as e:
            result.status = TaskStatus.FAILED
            result.error = str(e)
            logger.exception(f"Task {task_id} raised exception")

        result.duration_seconds = (datetime.now() - start_time).total_seconds()
        return result


class DependencyResolver:
    """Resolves task dependencies and determines execution order."""

    def __init__(self, workflow_def: dict):
        self.workflow_def = workflow_def
        self.tasks = workflow_def['tasks']

    def get_ready_tasks(self, completed: Set[str], running: Set[str], failed: Set[str]) -> List[str]:
        """Get tasks that are ready to run (all dependencies met)."""
        ready = []

        for task_id, task_spec in self.tasks.items():
            # Skip if already completed, running, or failed
            if task_id in completed or task_id in running or task_id in failed:
                continue

            # Skip template tasks (they're instantiated dynamically)
            if task_spec.get('template', False):
                continue

            # Check if all dependencies are completed
            deps = task_spec.get('dependencies', [])
            if all(dep in completed for dep in deps):
                ready.append(task_id)

        return ready

    def expand_template_tasks(self, template_task_id: str, context: dict) -> List[dict]:
        """Expand template tasks into concrete instances."""
        task_spec = self.tasks[template_task_id]
        instances = []

        # Example: expand implement_story for each story in sprint_plan.yaml
        if template_task_id == 'implement_story':
            sprint_plan_path = Path(context['output_dir']) / 'sprint_plan.yaml'
            if sprint_plan_path.exists():
                with open(sprint_plan_path) as f:
                    sprint_data = yaml.safe_load(f)

                for story in sprint_data.get('stories', []):
                    story_id = story['id']
                    instance = {
                        'id': f"{template_task_id}:{story_id}",
                        'agent': task_spec['agent'],
                        'description': task_spec['description'].replace('{{story_id}}', story_id),
                        'command': task_spec['command'].replace('{{story_id}}', story_id),
                        'dependencies': task_spec['dependencies']
                    }
                    instances.append(instance)

        return instances


class WorkflowOrchestrator:
    """Main orchestrator for running complex workflows."""

    def __init__(self, workflow_file: Path, working_dir: Path):
        self.workflow_file = workflow_file
        self.working_dir = working_dir

        with open(workflow_file) as f:
            self.workflow_def = yaml.safe_load(f)

        self.config = self.workflow_def['config']
        self.state_file = Path(self.config['state_file'])
        self.output_dir = Path(self.config['output_dir'])
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.executor = ClaudeExecutor(working_dir)
        self.resolver = DependencyResolver(self.workflow_def)
        self.state = WorkflowState(workflow_name=self.workflow_def['name'])

        self.max_retries = self.config.get('max_retries', 3)
        self.retry_delay = self.config.get('retry_delay_seconds', 5)
        self.parallel_limit = self.config.get('parallel_limit', 3)

    async def run(self):
        """Execute the complete workflow."""
        logger.info(f"Starting workflow: {self.workflow_def['name']}")

        running_tasks: Set[str] = set()
        task_futures: Dict[str, asyncio.Task] = {}

        while True:
            # Get tasks ready to run
            ready_tasks = self.resolver.get_ready_tasks(
                self.state.completed_tasks,
                running_tasks,
                self.state.failed_tasks
            )

            # Expand template tasks
            expanded_tasks = []
            for task_id in ready_tasks:
                task_spec = self.workflow_def['tasks'][task_id]
                if task_spec.get('template', False):
                    instances = self.resolver.expand_template_tasks(
                        task_id,
                        {'output_dir': str(self.output_dir)}
                    )
                    expanded_tasks.extend(instances)
                else:
                    expanded_tasks.append({
                        'id': task_id,
                        **task_spec
                    })

            # Limit parallelism
            available_slots = self.parallel_limit - len(running_tasks)
            tasks_to_start = expanded_tasks[:available_slots]

            # Start new tasks
            for task in tasks_to_start:
                task_id = task['id']
                running_tasks.add(task_id)

                # Substitute variables in command
                command = task['command']
                command = command.replace('{{output_dir}}', str(self.output_dir))
                command = command.replace('{{feature_name}}',
                                        self.workflow_def.get('feature_name', 'Feature'))

                # Create async task
                future = asyncio.create_task(
                    self._execute_with_retry(task_id, command, task['agent'])
                )
                task_futures[task_id] = future

            # Wait for at least one task to complete
            if task_futures:
                done, pending = await asyncio.wait(
                    task_futures.values(),
                    return_when=asyncio.FIRST_COMPLETED
                )

                # Process completed tasks
                for future in done:
                    result: TaskResult = await future
                    task_id = result.task_id

                    # Update state
                    self.state.tasks[task_id] = result
                    running_tasks.discard(task_id)
                    del task_futures[task_id]

                    if result.status == TaskStatus.COMPLETED:
                        self.state.completed_tasks.add(task_id)
                        logger.info(f"✓ Task {task_id} completed")
                    elif result.status == TaskStatus.FAILED:
                        self.state.failed_tasks.add(task_id)
                        logger.error(f"✗ Task {task_id} failed after retries")

                    # Save state
                    self.state.save(self.state_file)

            # Check if workflow is complete
            total_tasks = len(self.workflow_def['tasks'])
            completed = len(self.state.completed_tasks)
            failed = len(self.state.failed_tasks)

            if completed + failed >= total_tasks and not running_tasks:
                break

            # Brief sleep to avoid tight loop
            await asyncio.sleep(1)

        # Final report
        logger.info(f"\n{'='*60}")
        logger.info(f"Workflow Complete: {self.workflow_def['name']}")
        logger.info(f"Completed: {len(self.state.completed_tasks)}")
        logger.info(f"Failed: {len(self.state.failed_tasks)}")
        logger.info(f"Duration: {(datetime.now() - self.state.started_at).total_seconds():.1f}s")
        logger.info(f"{'='*60}\n")

        if self.state.failed_tasks:
            logger.error("Failed tasks:")
            for task_id in self.state.failed_tasks:
                result = self.state.tasks[task_id]
                logger.error(f"  - {task_id}: {result.error}")

    async def _execute_with_retry(self, task_id: str, command: str, agent: str) -> TaskResult:
        """Execute task with retry logic."""
        retry_count = 0

        while retry_count <= self.max_retries:
            result = await self.executor.execute_task(task_id, command, agent)

            if result.status == TaskStatus.COMPLETED:
                return result

            retry_count += 1
            if retry_count <= self.max_retries:
                logger.warning(f"Retrying task {task_id} ({retry_count}/{self.max_retries})")
                await asyncio.sleep(self.retry_delay)
                result.retry_count = retry_count

        return result


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Run automated workflow")
    parser.add_argument('workflow', help='Path to workflow YAML file')
    parser.add_argument('--working-dir', default='.', help='Working directory')
    args = parser.parse_args()

    orchestrator = WorkflowOrchestrator(
        workflow_file=Path(args.workflow),
        working_dir=Path(args.working_dir)
    )

    await orchestrator.run()


if __name__ == '__main__':
    asyncio.run(main())
```

### 4.3 Usage

```bash
# Run the workflow
python orchestrator/main.py workflow_definition.yaml

# Resume from state file (if interrupted)
python orchestrator/main.py workflow_definition.yaml --resume
```

---

## 5. Example: Brainstorm-Plan-Build-Validate Flow

### 5.1 Workflow Definition

**`workflows/feature_pipeline.yaml`:**

```yaml
name: "Complete Feature Pipeline"
description: "From brainstorming to validated PRs with multiple parallel tasks"

config:
  max_retries: 3
  retry_delay_seconds: 10
  parallel_limit: 5
  state_file: "./pipeline_state.yaml"
  output_dir: "./feature_outputs"

variables:
  feature_name: "User Authentication System"
  repo_url: "https://github.com/org/repo"

tasks:
  brainstorm:
    agent: analyst
    description: "Brainstorm requirements"
    command: |
      Brainstorm requirements for {{feature_name}}.
      Output: {{output_dir}}/brainstorm.md
    allowed_tools:
      - Write
      - Read
    dependencies: []

  create_prd:
    agent: pm
    description: "Create Product Requirements Document"
    command: |
      Based on @{{output_dir}}/brainstorm.md, create a PRD.
      Output: {{output_dir}}/prd.md
    dependencies:
      - brainstorm

  design_architecture:
    agent: architect
    description: "Design system architecture"
    command: |
      Design architecture based on:
      - @{{output_dir}}/prd.md
      - @{{output_dir}}/brainstorm.md

      Output: {{output_dir}}/architecture.md
    dependencies:
      - create_prd

  create_epics:
    agent: pm
    description: "Break into epics and stories"
    command: |
      Based on:
      - @{{output_dir}}/prd.md
      - @{{output_dir}}/architecture.md

      Create epics and stories.
      Output: {{output_dir}}/epics.yaml
    dependencies:
      - create_prd
      - design_architecture

  # Template tasks (expanded per story)
  implement_story:
    template: true
    agent: developer
    description: "Implement {{story_id}}"
    command: |
      Implement story {{story_id}}.

      Context:
      - @{{output_dir}}/architecture.md
      - @{{output_dir}}/stories/{{story_id}}.md

      Output: {{output_dir}}/impl/{{story_id}}.md
    allowed_tools:
      - Read
      - Write
      - Edit
      - Bash
      - Grep
      - Glob
    dependencies:
      - create_epics

  run_tests:
    template: true
    agent: qa
    description: "Run tests for {{story_id}}"
    command: |
      Run tests for story {{story_id}}.

      Execute:
      - Unit tests
      - Integration tests

      Output: {{output_dir}}/tests/{{story_id}}_results.json
    allowed_tools:
      - Bash
      - Read
    dependencies:
      - "implement_story:{{story_id}}"

  create_pr:
    template: true
    agent: developer
    description: "Create PR for {{story_id}}"
    command: |
      Create GitHub PR for {{story_id}}.

      Steps:
      1. git checkout -b feature/{{story_id}}
      2. git add .
      3. git commit -m "feat: {{story_id}}"
      4. git push origin feature/{{story_id}}
      5. gh pr create --title "{{story_id}}" --body "@{{output_dir}}/impl/{{story_id}}.md"

      Output PR URL to: {{output_dir}}/prs/{{story_id}}.txt
    allowed_tools:
      - "Bash(git *:*)"
      - "Bash(gh *:*)"
      - Read
      - Write
    dependencies:
      - "run_tests:{{story_id}}"

  integration_test:
    agent: qa
    description: "Run full integration tests"
    command: |
      Run integration tests across all PRs.

      Check:
      - All PRs in {{output_dir}}/prs/
      - Cross-feature compatibility
      - No regressions

      Output: {{output_dir}}/integration_report.md
    allowed_tools:
      - Bash
      - Read
      - Grep
      - Glob
    dependencies:
      - create_pr  # All PRs complete

execution:
  sequential_phases:
    - name: "Discovery"
      tasks: [brainstorm, create_prd]

    - name: "Architecture"
      tasks: [design_architecture, create_epics]

    - name: "Implementation"
      tasks: [implement_story, run_tests, create_pr]
      parallel: true

    - name: "Validation"
      tasks: [integration_test]
```

### 5.2 Execution Flow

```
Phase 1: Discovery
├─ brainstorm (Analyst) ────────┐
│                                ├─▶ Outputs: brainstorm.md
└─ create_prd (PM) ◀────────────┘   Outputs: prd.md

Phase 2: Architecture
├─ design_architecture (Architect) ─┐
│  (depends: create_prd)             ├─▶ Outputs: architecture.md
└─ create_epics (PM) ◀──────────────┘   Outputs: epics.yaml with 5 stories
   (depends: create_prd, design_architecture)

Phase 3: Implementation (PARALLEL)
├─ implement_story:auth ─────▶ run_tests:auth ─────▶ create_pr:auth
├─ implement_story:session ──▶ run_tests:session ──▶ create_pr:session
├─ implement_story:profile ──▶ run_tests:profile ──▶ create_pr:profile
├─ implement_story:roles ────▶ run_tests:roles ────▶ create_pr:roles
└─ implement_story:audit ────▶ run_tests:audit ────▶ create_pr:audit
   │                           │                      │
   └───────────────────────────┴──────────────────────┘
                               │
Phase 4: Validation           │
└─ integration_test (QA) ◀────┘
   (depends: ALL create_pr tasks)
   Outputs: integration_report.md
```

---

## 6. Handling Dependencies and Parallelism

### 6.1 Dependency Graph

The orchestrator builds a dependency graph:

```python
def build_dependency_graph(tasks: dict) -> dict:
    """Build directed acyclic graph of task dependencies."""
    graph = {}

    for task_id, spec in tasks.items():
        graph[task_id] = {
            'deps': spec.get('dependencies', []),
            'dependents': []
        }

    # Build reverse dependencies
    for task_id, node in graph.items():
        for dep in node['deps']:
            if dep in graph:
                graph[dep]['dependents'].append(task_id)

    return graph
```

### 6.2 Parallel Execution Strategy

```python
def get_parallel_tasks(ready_tasks: List[str], max_parallel: int) -> List[str]:
    """Select tasks that can run in parallel."""

    # Priority order:
    # 1. Tasks with no dependents (leaves)
    # 2. Tasks with most dependents (unlock more work)
    # 3. Tasks by estimated duration (longest first)

    scored_tasks = []
    for task_id in ready_tasks:
        score = len(graph[task_id]['dependents']) * 10
        if not graph[task_id]['dependents']:
            score = 1  # Leaves have lower priority
        scored_tasks.append((score, task_id))

    scored_tasks.sort(reverse=True)
    return [tid for _, tid in scored_tasks[:max_parallel]]
```

### 6.3 Handling Cross-Task Dependencies

**Example: Story B depends on Story A's database schema**

```yaml
tasks:
  implement_story_a:
    outputs:
      - impl/story_a.md
      - database/schema_v1.sql  # Creates schema

  implement_story_b:
    command: |
      Implement story B.

      Prerequisites:
      - Database schema from @database/schema_v1.sql must exist

      Use the schema when implementing.
    dependencies:
      - implement_story_a  # Ensures schema exists first
```

The orchestrator ensures `story_a` completes before `story_b` starts.

---

## 7. Error Handling and Retry Logic

### 7.1 Retry Strategy

```python
async def execute_with_exponential_backoff(
    task_id: str,
    command: str,
    max_retries: int = 3,
    base_delay: float = 2.0
):
    """Retry with exponential backoff."""

    for attempt in range(max_retries + 1):
        try:
            result = await execute_task(task_id, command)

            if result.status == TaskStatus.COMPLETED:
                return result

            # Task failed, retry
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt)  # 2, 4, 8 seconds
                logger.warning(f"Retry {task_id} in {delay}s (attempt {attempt+1}/{max_retries})")
                await asyncio.sleep(delay)

        except Exception as e:
            logger.error(f"Task {task_id} raised exception: {e}")
            if attempt == max_retries:
                raise

    # All retries exhausted
    return TaskResult(task_id=task_id, status=TaskStatus.FAILED,
                     error="Max retries exceeded")
```

### 7.2 Failure Handling Strategies

| Strategy | When to Use | Implementation |
|----------|-------------|----------------|
| **Retry** | Transient failures (network, rate limit) | Exponential backoff |
| **Skip** | Optional tasks | Mark as SKIPPED, continue |
| **Abort** | Critical task failure | Stop entire workflow |
| **Continue** | Non-blocking failure | Mark as FAILED, continue with other tasks |
| **Manual Intervention** | Complex failures | Pause, notify user, wait for fix |

**Example Configuration:**

```yaml
tasks:
  critical_task:
    on_failure: abort  # Stop everything

  optional_task:
    on_failure: skip  # Continue without it

  flaky_task:
    on_failure: retry
    max_retries: 5
    retry_strategy: exponential
```

### 7.3 State Recovery

The orchestrator saves state after each task completion:

```yaml
# pipeline_state.yaml
workflow_name: "Complete Feature Pipeline"
started_at: "2024-01-15T10:30:00"
tasks:
  brainstorm:
    status: completed
    session_id: "abc-123"
    duration_seconds: 45.2
  create_prd:
    status: completed
    session_id: "def-456"
  design_architecture:
    status: running
    session_id: "ghi-789"
  implement_story:auth:
    status: failed
    error: "Tests failed"
    retry_count: 2
completed_tasks:
  - brainstorm
  - create_prd
failed_tasks:
  - "implement_story:auth"
```

**To resume:**

```bash
# Orchestrator reads pipeline_state.yaml
# Skips completed tasks
# Retries failed tasks
# Continues from where it left off
python orchestrator/main.py workflow.yaml --resume
```

---

## Summary: Key Takeaways

### How BMAD Works

1. **Manual Orchestration** - User loads agents and triggers workflows
2. **File-Based State** - YAML files track progress
3. **Prompt-Based Engine** - XML tags tell Claude how to execute
4. **Session Isolation** - Each agent is a separate Claude session

### Building Automated Orchestration

1. **Python Script as Orchestrator** - Main loop manages workflow
2. **`claude -p` for Execution** - Each task is a subprocess call
3. **YAML for Configuration** - Define workflows declaratively
4. **State Files for Persistence** - Survive crashes and restarts
5. **Dependency Graph** - Topological sort for execution order
6. **Async for Parallelism** - Run independent tasks concurrently
7. **Retry Logic** - Handle transient failures gracefully

### Implementation Checklist

- [ ] Define workflow in YAML (tasks, dependencies, config)
- [ ] Implement Python orchestrator with async execution
- [ ] Add dependency resolver and parallel executor
- [ ] Implement retry logic with exponential backoff
- [ ] Add state persistence and recovery
- [ ] Configure logging and monitoring
- [ ] Test with a simple workflow
- [ ] Scale to complex multi-PR workflows

With this architecture, you can build a fully automated orchestration system that manages complex workflows with dependencies, parallelism, error handling, and progress tracking - all using your Claude Max subscription without API keys.
