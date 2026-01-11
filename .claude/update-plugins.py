#!/usr/bin/env -S uv run python
"""
Update all plugins from the local marketplace.

This script:
1. Creates a staged copy of the repo (excluding node_modules, .git, etc.)
2. Updates the marketplace from the staged copy
3. Reinstalls all plugins defined in marketplace.json
4. Force reinstalls the Python tools (agentic-core, agentic-sdlc)

Usage:
    uv run .claude/update-plugins.py

    Or run from anywhere:
    uv run path/to/update-plugins.py

    Reinstall specific plugins only:
    uv run .claude/update-plugins.py agentic-sdlc
    uv run .claude/update-plugins.py interactive-sdlc agentic-sdlc
"""

import argparse
import io
import json
import shutil
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

# Enable UTF-8 mode for Windows console output
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Python CLI tools (installed via uv tool install)
PYTHON_TOOLS = ["agentic-sdlc"]

# Patterns to exclude when creating staged copy
STAGING_IGNORE_PATTERNS = [
    "node_modules",
    ".pnpm",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    ".ruff_cache",
    "*.pyc",
    ".DS_Store",
    "dist",
]


# ANSI color codes
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    CLEAR_LINE = "\r\033[K"

    # Foreground colors
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"

    # Bright foreground colors
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"


# Status indicators
SPINNER = "\u25cb"  # ○ (hollow circle for "in progress")
CHECK = "\u2713"  # ✓
CROSS = "\u2717"  # ✗


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
        # Indent error details
        for line in error.strip().split("\n"):
            print(f"    {color(line, Colors.DIM)}")


def run_command(
    cmd: list[str], description: str, cwd: Path | None = None, silent: bool = True
) -> tuple[bool, str]:
    """
    Run a command and return (success, error_output).

    Args:
        cmd: Command to run
        description: Human-readable description for display
        cwd: Working directory
        silent: If True, capture output; if False, let it stream

    Returns:
        Tuple of (success: bool, error_output: str)
    """
    print_task_start(description)

    capture = subprocess.PIPE if silent else None
    result = subprocess.run(
        cmd, cwd=cwd, shell=True, stdout=capture, stderr=subprocess.STDOUT, text=True
    )

    if result.returncode != 0:
        error_msg = result.stdout if silent and result.stdout else f"Exit code: {result.returncode}"
        print_task_error(description, error_msg)
        return False, error_msg

    print_task_success(description)
    return True, ""


@contextmanager
def staged_marketplace(repo_root: Path, marketplace_name: str):
    """
    Create a staged copy of the repository and temporarily register it as the marketplace.

    This avoids Windows symlink issues with pnpm's node_modules/.pnpm structure
    by creating a clean copy without those directories, then registering that
    copy as the marketplace source for plugin installation.
    """
    staging_dir = repo_root / ".staging"

    # Clean up any leftover staging directory
    if staging_dir.exists():
        shutil.rmtree(staging_dir)

    try:
        print_task_start("Create staged copy")
        shutil.copytree(
            repo_root,
            staging_dir,
            ignore=shutil.ignore_patterns(*STAGING_IGNORE_PATTERNS),
            symlinks=False,
            dirs_exist_ok=False,
        )
        print_task_success("Create staged copy")

        # Remove existing marketplace and add staging directory as source
        run_command(
            ["claude", "plugin", "marketplace", "remove", marketplace_name],
            "Remove existing marketplace",
        )
        success, error = run_command(
            ["claude", "plugin", "marketplace", "add", "./.staging"],
            "Register staged marketplace",
            cwd=repo_root,
        )
        if not success:
            raise RuntimeError(f"Failed to register staging marketplace: {error}")

        yield staging_dir

    finally:
        # Restore original marketplace
        run_command(
            ["claude", "plugin", "marketplace", "remove", marketplace_name],
            "Remove staged marketplace",
        )
        run_command(
            ["claude", "plugin", "marketplace", "add", "./"],
            "Restore original marketplace",
            cwd=repo_root,
        )

        if staging_dir.exists():
            shutil.rmtree(staging_dir)


def parse_args(all_plugins: list[str]) -> argparse.Namespace:
    """Parse command line arguments."""
    supported = list(dict.fromkeys(all_plugins + PYTHON_TOOLS))  # Deduplicated, order preserved

    parser = argparse.ArgumentParser(
        description="Update Claude Code plugins from the local marketplace.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Supported plugins:
  Claude Code plugins: {", ".join(all_plugins)}
  Python CLI tools:    {", ".join(PYTHON_TOOLS)}

Examples:
  %(prog)s                           # Reinstall everything
  %(prog)s agentic-core              # Reinstall only agentic-core
  %(prog)s agentic-sdlc         # Reinstall only agentic-sdlc
""",
    )
    parser.add_argument(
        "plugins",
        nargs="*",
        metavar="PLUGIN",
        help="Specific plugins to reinstall. If not provided, reinstalls all.",
    )

    args = parser.parse_args()

    # Validate requested plugins
    if args.plugins:
        invalid = [p for p in args.plugins if p not in supported]
        if invalid:
            parser.error(f"Invalid plugin(s): {', '.join(invalid)}\nSupported: {', '.join(supported)}")

    return args


def main():
    # Get the repository root (parent of .claude directory)
    script_dir = Path(__file__).parent.resolve()
    repo_root = script_dir.parent
    marketplace_path = repo_root / ".claude-plugin" / "marketplace.json"

    # Load marketplace.json to get plugin names
    if not marketplace_path.exists():
        print(f"{color(CROSS, Colors.BRIGHT_RED)} marketplace.json not found at {marketplace_path}")
        sys.exit(1)

    with open(marketplace_path) as f:
        marketplace = json.load(f)

    all_plugins = [p["name"] for p in marketplace.get("plugins", [])]

    # Parse arguments after loading marketplace (needed for validation)
    args = parse_args(all_plugins)

    # Determine which plugins to install
    if args.plugins:
        requested_claude_plugins = [p for p in args.plugins if p in all_plugins]
        requested_python_tools = [p for p in args.plugins if p in PYTHON_TOOLS]
    else:
        requested_claude_plugins = all_plugins
        requested_python_tools = PYTHON_TOOLS

    # Print minimal header
    plugins_str = ", ".join(args.plugins) if args.plugins else "all"
    print(f"\n{color('Claude Plugins Updater', Colors.BOLD)} [{plugins_str}]")

    success_count = 0
    error_count = 0
    marketplace_name = "agentic-forge"

    # Calculate total steps based on what we're installing
    has_claude_plugins = len(requested_claude_plugins) > 0
    has_python_tools = len(requested_python_tools) > 0
    total_steps = (2 if has_claude_plugins else 0) + (1 if has_python_tools else 0)
    current_step = 0

    # Step 1 & 2: Create staged copy, register as marketplace, and reinstall plugins
    if has_claude_plugins:
        current_step += 1
        print_step(current_step, total_steps, "Create Staged Marketplace")

        with staged_marketplace(repo_root, marketplace_name):
            # Reinstall each plugin from the staged marketplace
            current_step += 1
            print_step(current_step, total_steps, "Reinstall Claude Code Plugins")

            for plugin in requested_claude_plugins:
                # Uninstall first (ignore errors if not installed)
                run_command(
                    ["claude", "plugin", "uninstall", plugin],
                    f"Uninstall {plugin}",
                )
                # Install from staged marketplace
                success, _ = run_command(
                    ["claude", "plugin", "install", plugin],
                    f"Install {plugin}",
                )
                if success:
                    success_count += 1
                else:
                    error_count += 1

    # Step 3: Force reinstall Python tools (from original repo, not staged)
    if has_python_tools:
        current_step += 1
        print_step(current_step, total_steps, "Install Python CLI Tools")

        # Install agentic-sdlc
        agentic_sdlc_path = repo_root / "plugins" / "agentic-sdlc"
        if "agentic-sdlc" in requested_python_tools:
            if agentic_sdlc_path.exists():
                # Clean and build agentic-sdlc
                dist_dir = agentic_sdlc_path / "dist"
                if dist_dir.exists():
                    shutil.rmtree(dist_dir)

                run_command(
                    ["uv", "build"],
                    "Build agentic-sdlc",
                    cwd=agentic_sdlc_path,
                )

                run_command(
                    ["uv", "tool", "uninstall", "agentic-sdlc"],
                    "Uninstall agentic-sdlc",
                )

                # Install from the freshly built wheel to bypass uv cache
                wheel_files = list(dist_dir.glob("*.whl"))
                if wheel_files:
                    wheel_path = wheel_files[0]
                    success, _ = run_command(
                        ["uv", "tool", "install", "--force", "--reinstall", str(wheel_path)],
                        "Install agentic-sdlc",
                    )
                    if success:
                        success_count += 1
                    else:
                        error_count += 1
                else:
                    print_task_error("Install agentic-sdlc", "No wheel found after build")
                    error_count += 1
            else:
                print_task_error(
                    "Install agentic-sdlc", f"Path not found: {agentic_sdlc_path}"
                )
                error_count += 1

    # Summary line
    if error_count == 0:
        print(f"\n{color(CHECK, Colors.GREEN)} {color('Done!', Colors.BOLD)} {success_count} successful")
    else:
        print(
            f"\n{color(CROSS, Colors.BRIGHT_RED)} {color('Done with errors', Colors.BOLD)} "
            f"{success_count} successful, {error_count} failed"
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
