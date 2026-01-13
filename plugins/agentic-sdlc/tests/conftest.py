"""Shared fixtures for agentic-sdlc tests."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import pytest

if TYPE_CHECKING:
    from collections.abc import Generator


@pytest.fixture
def temp_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def mock_subprocess() -> Generator[MagicMock, None, None]:
    """Mock subprocess.Popen for Claude calls."""
    with patch("agentic_sdlc.runner.subprocess.Popen") as mock:
        process = MagicMock()
        process.communicate.return_value = ('{"success": true}', "")
        process.returncode = 0
        mock.return_value = process
        yield mock


@pytest.fixture
def sample_workflow_yaml() -> str:
    """Return a minimal valid workflow YAML."""
    return """
name: test-workflow
version: "1.0"
description: A test workflow
steps:
  - name: test-step
    type: prompt
    prompt: "Test prompt"
"""


@pytest.fixture
def sample_parallel_workflow_yaml() -> str:
    """Return a workflow with parallel steps."""
    return """
name: parallel-workflow
version: "1.0"
description: A workflow with parallel steps
steps:
  - name: parallel-step
    type: parallel
    steps:
      - name: branch-a
        type: serial
        steps:
          - name: task-a1
            type: prompt
            prompt: "Task A1"
      - name: branch-b
        type: serial
        steps:
          - name: task-b1
            type: prompt
            prompt: "Task B1"
"""


@pytest.fixture
def sample_conditional_workflow_yaml() -> str:
    """Return a workflow with conditional steps."""
    return """
name: conditional-workflow
version: "1.0"
description: A workflow with conditional steps
variables:
  - name: run_tests
    type: boolean
    default: true
steps:
  - name: check-tests
    type: conditional
    condition: "variables.run_tests"
    then:
      - name: run-tests
        type: command
        command: test-runner
    else:
      - name: skip-tests
        type: prompt
        prompt: "Tests skipped"
"""
