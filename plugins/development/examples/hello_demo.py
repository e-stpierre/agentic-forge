#!/usr/bin/env python3
"""
POC 1: Invoke Claude with a command and capture output.

This script demonstrates the basic pattern of running Claude Code
via the CLI from Python and capturing the output.

Usage:
    python hello_demo.py

Requirements:
    - Claude Code CLI must be installed and available in PATH
    - The demo-hello command must be installed in the current project
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add workflows to path for imports
workflows_path = Path(__file__).parent.parent / "workflows"
sys.path.insert(0, str(workflows_path.parent))

from workflows.runner import run_claude, check_claude_available


def main() -> int:
    """Run the hello demo."""
    print("=" * 50)
    print("POC 1: Hello World via Claude CLI")
    print("=" * 50)
    print()

    # Check if Claude is available
    print("Checking Claude CLI availability...")
    if not check_claude_available():
        print("ERROR: Claude CLI is not available.")
        print("Please ensure 'claude' is installed and in your PATH.")
        return 1

    print("Claude CLI is available.")
    print()

    # Run the demo-hello command
    prompt = "/demo-hello"
    print(f"Running: claude -p \"{prompt}\"")
    print("-" * 50)

    result = run_claude(prompt, print_output=True)

    print("-" * 50)
    print()

    # Report results
    print("Results:")
    print(f"  Return code: {result.returncode}")
    print(f"  Success: {result.success}")

    if result.stderr:
        print(f"  Stderr: {result.stderr}")

    print()
    print("=" * 50)

    if result.success:
        print("POC 1 PASSED: Successfully invoked Claude and captured output")
    else:
        print("POC 1 FAILED: Claude invocation failed")

    return 0 if result.success else 1


if __name__ == "__main__":
    sys.exit(main())
