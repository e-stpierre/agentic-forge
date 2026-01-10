"""Ralph Wiggum loop state management and completion detection.

This module implements the Ralph Wiggum iterative loop pattern for Claude workflows.
Each iteration creates a fresh Claude session with the same prompt.
Completion is signaled via structured JSON output from Claude.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


@dataclass
class RalphLoopState:
    """State for a Ralph Wiggum loop execution."""

    active: bool
    iteration: int
    max_iterations: int
    completion_promise: str
    started_at: str
    prompt: str


def get_ralph_state_path(workflow_id: str, step_name: str, repo_root: Path) -> Path:
    """Get path to ralph loop state file."""
    safe_name = re.sub(r"[^\w\-]", "_", step_name)
    return repo_root / "agentic" / "workflows" / workflow_id / f"ralph-{safe_name}.md"


def create_ralph_state(
    workflow_id: str,
    step_name: str,
    prompt: str,
    max_iterations: int,
    completion_promise: str,
    repo_root: Path,
) -> RalphLoopState:
    """Create initial ralph loop state file."""
    state = RalphLoopState(
        active=True,
        iteration=1,
        max_iterations=max_iterations,
        completion_promise=completion_promise,
        started_at=datetime.now(timezone.utc).isoformat(),
        prompt=prompt,
    )

    _save_ralph_state(workflow_id, step_name, state, repo_root)
    return state


def load_ralph_state(
    workflow_id: str, step_name: str, repo_root: Path
) -> RalphLoopState | None:
    """Load ralph loop state from file."""
    state_path = get_ralph_state_path(workflow_id, step_name, repo_root)
    if not state_path.exists():
        return None

    content = state_path.read_text(encoding="utf-8")
    return _parse_ralph_state(content)


def update_ralph_iteration(
    workflow_id: str, step_name: str, repo_root: Path
) -> RalphLoopState | None:
    """Increment iteration counter in ralph state."""
    state = load_ralph_state(workflow_id, step_name, repo_root)
    if not state:
        return None

    state.iteration += 1
    _save_ralph_state(workflow_id, step_name, state, repo_root)
    return state


def deactivate_ralph_state(
    workflow_id: str, step_name: str, repo_root: Path
) -> None:
    """Mark ralph loop as inactive (completed or stopped)."""
    state = load_ralph_state(workflow_id, step_name, repo_root)
    if state:
        state.active = False
        _save_ralph_state(workflow_id, step_name, state, repo_root)


def delete_ralph_state(workflow_id: str, step_name: str, repo_root: Path) -> None:
    """Delete ralph loop state file."""
    state_path = get_ralph_state_path(workflow_id, step_name, repo_root)
    if state_path.exists():
        state_path.unlink()


def _save_ralph_state(
    workflow_id: str, step_name: str, state: RalphLoopState, repo_root: Path
) -> None:
    """Save ralph loop state to markdown file with YAML frontmatter."""
    state_path = get_ralph_state_path(workflow_id, step_name, repo_root)
    state_path.parent.mkdir(parents=True, exist_ok=True)

    frontmatter = {
        "active": state.active,
        "iteration": state.iteration,
        "max_iterations": state.max_iterations,
        "completion_promise": state.completion_promise,
        "started_at": state.started_at,
    }

    content = f"""---
{yaml.dump(frontmatter, default_flow_style=False).strip()}
---

# Ralph Loop Prompt

{state.prompt}
"""

    state_path.write_text(content, encoding="utf-8")


def _parse_ralph_state(content: str) -> RalphLoopState | None:
    """Parse ralph state from markdown with YAML frontmatter."""
    if not content.startswith("---"):
        return None

    parts = content.split("---", 2)
    if len(parts) < 3:
        return None

    try:
        frontmatter = yaml.safe_load(parts[1])
    except yaml.YAMLError:
        return None

    prompt_section = parts[2].strip()
    prompt = ""
    if "# Ralph Loop Prompt" in prompt_section:
        prompt = prompt_section.split("# Ralph Loop Prompt", 1)[1].strip()
    else:
        prompt = prompt_section

    return RalphLoopState(
        active=frontmatter.get("active", False),
        iteration=frontmatter.get("iteration", 1),
        max_iterations=frontmatter.get("max_iterations", 5),
        completion_promise=frontmatter.get("completion_promise", "COMPLETE"),
        started_at=frontmatter.get("started_at", ""),
        prompt=prompt,
    )


@dataclass
class CompletionResult:
    """Result of completion promise detection."""

    is_complete: bool
    promise_matched: bool
    promise_value: str | None
    output: str


def detect_completion_promise(
    output: str, expected_promise: str
) -> CompletionResult:
    """Detect completion promise in Claude's JSON output.

    Claude should output a JSON block with the following structure:
    ```json
    {
      "ralph_complete": true,
      "promise": "COMPLETE"
    }
    ```

    Args:
        output: The raw output from Claude
        expected_promise: The expected promise text

    Returns:
        CompletionResult indicating whether the promise was matched
    """
    # Try to find JSON in the output
    json_patterns = [
        # Code block with json tag
        r"```json\s*\n?(.*?)\n?```",
        # Code block without tag
        r"```\s*\n?(\{.*?\})\n?```",
        # Raw JSON object (greedy match for nested objects)
        r"(\{[^{}]*\"ralph_complete\"[^{}]*\})",
    ]

    for pattern in json_patterns:
        matches = re.findall(pattern, output, re.DOTALL | re.IGNORECASE)
        for match in matches:
            try:
                data = json.loads(match.strip())
                if isinstance(data, dict):
                    ralph_complete = data.get("ralph_complete", False)
                    promise_value = data.get("promise", "")

                    if ralph_complete:
                        promise_matched = (
                            str(promise_value).strip().upper()
                            == str(expected_promise).strip().upper()
                        )
                        return CompletionResult(
                            is_complete=True,
                            promise_matched=promise_matched,
                            promise_value=str(promise_value),
                            output=output,
                        )
            except json.JSONDecodeError:
                continue

    return CompletionResult(
        is_complete=False,
        promise_matched=False,
        promise_value=None,
        output=output,
    )


def build_ralph_system_message(
    iteration: int, max_iterations: int, completion_promise: str
) -> str:
    """Build system message for Ralph loop iteration.

    This message is prepended to the prompt to inform Claude about the loop context.
    """
    return f"""## Ralph Wiggum Loop - Iteration {iteration}/{max_iterations}

You are in a Ralph Wiggum iterative loop. Each iteration starts a fresh session.

**Completion Signal:**
When your task is FULLY complete, output a JSON block:
```json
{{
  "ralph_complete": true,
  "promise": "{completion_promise}"
}}
```

**IMPORTANT:**
- Only output the completion JSON when the task is genuinely finished
- Do not output false promises to exit early
- If you cannot complete the task, continue working - you have {max_iterations - iteration} iterations remaining

---

"""
