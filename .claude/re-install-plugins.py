#!/usr/bin/env -S uv run python
"""
Reinstall agentic-forge from the local repository.

This script:
1. Cleans the dist/ directory
2. Builds the agentic-forge package with uv build
3. Uninstalls any existing version
4. Installs the freshly built wheel via uv tool install

Usage:
    uv run .claude/re-install-plugins.py

    Or run from anywhere:
    uv run path/to/re-install-plugins.py
"""

import io
import shutil
import subprocess
import sys
from pathlib import Path


def get_executable(name: str) -> str:
    """Resolve executable path for cross-platform subprocess calls.

    Uses shutil.which() to find the full path, allowing shell=False
    in subprocess calls while maintaining Windows compatibility.

    Args:
        name: Executable name (e.g., "uv", "git")

    Returns:
        Full path to the executable

    Raises:
        FileNotFoundError: If executable not found in PATH
    """
    path = shutil.which(name)
    if not path:
        raise FileNotFoundError(f"Executable not found in PATH: {name}")
    return path


# Enable UTF-8 mode for Windows console output
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


# ANSI color codes
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    CLEAR_LINE = "\r\033[K"

    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"

    BRIGHT_RED = "\033[91m"


# Status indicators
SPINNER = "\u25cb"  # hollow circle
CHECK = "\u2713"  # checkmark
CROSS = "\u2717"  # x mark


def color(text: str, *codes: str) -> str:
    """Apply color codes to text."""
    return f"{''.join(codes)}{text}{Colors.RESET}"


def print_step(step_num: int, total: int, text: str) -> None:
    """Print a step/section header."""
    print(f"\n{color(f'[{step_num}/{total}]', Colors.BOLD, Colors.BLUE)} {color(text, Colors.BOLD)}")


def print_task_start(description: str) -> None:
    """Print task start with spinner indicator (no newline)."""
    print(f"  {color(SPINNER, Colors.YELLOW)} {description}", end="", flush=True)


def print_task_success(description: str) -> None:
    """Overwrite current line with success indicator."""
    print(f"{Colors.CLEAR_LINE}  {color(CHECK, Colors.GREEN)} {description}")


def print_task_error(description: str, error: str | None = None) -> None:
    """Overwrite current line with error indicator and optional details."""
    print(f"{Colors.CLEAR_LINE}  {color(CROSS, Colors.BRIGHT_RED)} {description}")
    if error:
        for line in error.strip().split("\n"):
            print(f"    {color(line, Colors.DIM)}")


def run_command(
    cmd: list[str],
    description: str,
    cwd: Path | None = None,
    allow_failure: bool = False,
) -> tuple[bool, str]:
    """Run a command and return (success, error_output)."""
    print_task_start(description)

    exec_path = get_executable(cmd[0])
    resolved_cmd = [exec_path] + cmd[1:]

    result = subprocess.run(resolved_cmd, cwd=cwd, shell=False, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    if result.returncode != 0:
        if allow_failure:
            print_task_success(description)
            return True, ""
        error_msg = result.stdout if result.stdout else f"Exit code: {result.returncode}"
        print_task_error(description, error_msg)
        return False, error_msg

    print_task_success(description)
    return True, ""


def main():
    # Get the repository root (parent of .claude directory)
    script_dir = Path(__file__).parent.resolve()
    repo_root = script_dir.parent

    print(f"\n{color('Agentic Forge Reinstaller', Colors.BOLD)}")

    total_steps = 3
    error_count = 0

    # Step 1: Clean dist directory
    print_step(1, total_steps, "Clean build artifacts")
    dist_dir = repo_root / "dist"
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
        print_task_success("Removed dist/")
    else:
        print_task_success("dist/ already clean")

    # Step 2: Build package
    print_step(2, total_steps, "Build package")
    success, _ = run_command(
        ["uv", "build"],
        "Build agentic-forge",
        cwd=repo_root,
    )
    if not success:
        error_count += 1

    # Step 3: Install
    if error_count == 0:
        print_step(3, total_steps, "Install package")

        run_command(
            ["uv", "tool", "uninstall", "agentic-forge"],
            "Uninstall existing agentic-forge",
            allow_failure=True,
        )

        wheel_files = list(dist_dir.glob("*.whl"))
        if wheel_files:
            wheel_path = wheel_files[0]
            success, _ = run_command(
                ["uv", "tool", "install", "--force", "--reinstall", str(wheel_path)],
                "Install agentic-forge",
            )
            if not success:
                error_count += 1
        else:
            print_task_error("Install agentic-forge", "No wheel found after build")
            error_count += 1

    # Summary
    if error_count == 0:
        print(f"\n{color(CHECK, Colors.GREEN)} {color('Done!', Colors.BOLD)}")
    else:
        print(f"\n{color(CROSS, Colors.BRIGHT_RED)} {color('Failed', Colors.BOLD)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
