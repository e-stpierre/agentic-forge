"""Hello command - Basic hello world demo."""

from __future__ import annotations

from claude_workflows.runner import run_claude, check_claude_available


def hello() -> int:
    """
    POC 1: Basic hello world demo.

    Invokes Claude with a simple command and captures output.
    """
    print("=" * 50)
    print("Claude Workflows: Hello Demo")
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
    print(f'Running: claude -p "{prompt}"')
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
        print("SUCCESS: Claude invocation completed")
    else:
        print("FAILED: Claude invocation failed")

    return 0 if result.success else 1
