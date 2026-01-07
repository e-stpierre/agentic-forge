#!/usr/bin/env -S uv run python
"""
Update all plugins from the local marketplace.

This script:
1. Creates a staged copy of the repo (excluding node_modules, .git, etc.)
2. Updates the marketplace from the staged copy
3. Reinstalls all plugins defined in marketplace.json
4. Force reinstalls the Python tools (core, agentic-sdlc, agentic-core)

Usage:
    uv run .claude/update-plugins.py

    Or run from anywhere:
    uv run path/to/update-plugins.py

    Reinstall specific plugins only:
    uv run .claude/update-plugins.py core agentic-sdlc
    uv run .claude/update-plugins.py pr-review-toolkit commit-commands
"""

import argparse
import json
import shutil
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

# Python CLI tools (installed via uv tool install)
PYTHON_TOOLS = ["core", "agentic-sdlc", "agentic-core"]

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

    # Background colors
    BG_RED = "\033[41m"
    BG_GREEN = "\033[42m"
    BG_BLUE = "\033[44m"


def color(text: str, *codes: str) -> str:
    """Apply color codes to text."""
    return f"{''.join(codes)}{text}{Colors.RESET}"


def print_header(text: str) -> None:
    """Print a section header."""
    print(f"\n{color('=' * 60, Colors.CYAN)}")
    print(color(f"  {text}", Colors.BOLD, Colors.BRIGHT_CYAN))
    print(color("=" * 60, Colors.CYAN))


def print_step(step_num: int, total: int, text: str) -> None:
    """Print a step indicator."""
    print(f"\n{color(f'[{step_num}/{total}]', Colors.BOLD, Colors.BLUE)} {color(text, Colors.BOLD)}")


def print_success(text: str) -> None:
    """Print a success message."""
    print(color(f"  [OK] {text}", Colors.GREEN))


def print_warning(text: str) -> None:
    """Print a warning message."""
    print(color(f"  [WARN] {text}", Colors.YELLOW))


def print_error(text: str) -> None:
    """Print an error message."""
    print(color(f"  [ERROR] {text}", Colors.BRIGHT_RED))


def print_info(text: str) -> None:
    """Print an info message."""
    print(color(f"  {text}", Colors.DIM))


def run_command(cmd: list[str], description: str, cwd: Path | None = None) -> bool:
    """Run a command and return success status."""
    print(f"\n{color('>>>', Colors.MAGENTA)} {color(description, Colors.BOLD)}")
    print(color(f"   $ {' '.join(cmd)}", Colors.DIM))
    if cwd:
        print(color(f"   @ {cwd}", Colors.DIM))

    result = subprocess.run(cmd, cwd=cwd, shell=True)

    if result.returncode != 0:
        print_warning(f"{description} returned exit code: {result.returncode}")
        return False
    print_success(description)
    return True


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
        print_info("Cleaning up previous staging directory...")
        shutil.rmtree(staging_dir)

    try:
        print_info("Creating staged copy of repository...")
        print_info(f"Excluding: {', '.join(STAGING_IGNORE_PATTERNS)}")

        shutil.copytree(
            repo_root,
            staging_dir,
            ignore=shutil.ignore_patterns(*STAGING_IGNORE_PATTERNS),
            symlinks=False,
            dirs_exist_ok=False,
        )

        print_success(f"Staged copy created at {staging_dir}")

        # Remove existing marketplace and add staging directory as source
        # Note: Claude CLI requires relative paths starting with "./"
        print_info("Re-registering marketplace from staging directory...")
        run_command(
            ["claude", "plugin", "marketplace", "remove", marketplace_name],
            f"Remove existing {marketplace_name} marketplace",
        )
        if not run_command(
            ["claude", "plugin", "marketplace", "add", "./.staging"],
            f"Add staging directory as {marketplace_name} marketplace",
            cwd=repo_root,
        ):
            print_error("Failed to register staging marketplace")
            raise RuntimeError("Failed to register staging marketplace")

        yield staging_dir

    finally:
        # Restore original marketplace
        print_info("Restoring original marketplace registration...")
        run_command(
            ["claude", "plugin", "marketplace", "remove", marketplace_name],
            f"Remove staging {marketplace_name} marketplace",
        )
        run_command(
            ["claude", "plugin", "marketplace", "add", "./"],
            f"Re-add original {marketplace_name} marketplace",
            cwd=repo_root,
        )

        if staging_dir.exists():
            print_info("Cleaning up staging directory...")
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
  %(prog)s core agentic-sdlc         # Reinstall only core and agentic-sdlc
  %(prog)s pr-review-toolkit         # Reinstall only pr-review-toolkit
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
        print_error(f"marketplace.json not found at {marketplace_path}")
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

    # Print banner
    print(color("\n" + "=" * 60, Colors.BRIGHT_MAGENTA))
    print(color("      Claude Plugins Updater", Colors.BOLD, Colors.BRIGHT_MAGENTA))
    print(color("=" * 60, Colors.BRIGHT_MAGENTA))

    print_info(f"Repository: {repo_root}")
    print_info(f"Marketplace: {marketplace_path}")

    if args.plugins:
        print(f"\n{color('Requested plugins:', Colors.BOLD)} {color(', '.join(args.plugins), Colors.BRIGHT_YELLOW)}")
    else:
        print(f"\n{color('All plugins:', Colors.BOLD)} {color(', '.join(all_plugins + PYTHON_TOOLS), Colors.BRIGHT_YELLOW)}")

    success_count = 0
    warning_count = 0
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
            print_info(f"Reinstalling {len(requested_claude_plugins)} plugins from staged marketplace...")

            for i, plugin in enumerate(requested_claude_plugins, 1):
                print(f"\n  {color(f'[{i}/{len(requested_claude_plugins)}]', Colors.CYAN)} {color(plugin, Colors.BRIGHT_BLUE)}")

                # Uninstall first (ignore errors if not installed)
                run_command(
                    ["claude", "plugin", "uninstall", plugin],
                    f"Uninstall {plugin}",
                )
                # Install from staged marketplace
                if run_command(
                    ["claude", "plugin", "install", plugin],
                    f"Install {plugin}",
                ):
                    success_count += 1
                else:
                    warning_count += 1

    # Step 3: Force reinstall Python tools (from original repo, not staged)
    if has_python_tools:
        current_step += 1
        print_step(current_step, total_steps, "Install Python CLI Tools")

        # Note: agentic-sdlc depends on core, so we need to:
        # 1. Build core first so it's available as a local package
        # 2. Install agentic-sdlc with --find-links pointing to core's dist directory
        core_path = repo_root / "plugins" / "core"
        agentic_sdlc_path = repo_root / "experimental-plugins" / "agentic-sdlc"
        agentic_core_path = repo_root / "experimental-plugins" / "agentic-core"

        # Build core package first if core or agentic-sdlc is requested
        # (agentic-sdlc depends on core)
        needs_core_build = "core" in requested_python_tools or "agentic-sdlc" in requested_python_tools
        if needs_core_build and core_path.exists():
            print(f"\n  {color('Building core package...', Colors.CYAN)}")

            # Clean and build core
            dist_dir = core_path / "dist"
            if dist_dir.exists():
                shutil.rmtree(dist_dir)
                print_info("Cleaned previous build artifacts")

            run_command(
                ["uv", "build"],
                "Build core package",
                cwd=core_path,
            )

        # Install core tool
        if "core" in requested_python_tools:
            if core_path.exists():
                run_command(
                    ["uv", "tool", "uninstall", "claude-core"],
                    "Uninstall claude-core CLI tools",
                )
                if run_command(
                    ["uv", "tool", "install", "--force", str(core_path)],
                    "Install claude-core CLI tools",
                ):
                    success_count += 1
                else:
                    warning_count += 1
            else:
                print_warning(f"Python tool path not found: {core_path}")
                warning_count += 1

        # Install agentic-sdlc with --find-links to locate core dependency
        if "agentic-sdlc" in requested_python_tools:
            if agentic_sdlc_path.exists():
                print(f"\n  {color('Installing agentic-sdlc package...', Colors.CYAN)}")

                run_command(
                    ["uv", "tool", "uninstall", "agentic-sdlc"],
                    "Uninstall agentic-sdlc CLI tools",
                )

                core_dist = core_path / "dist"
                if core_dist.exists():
                    if run_command(
                        ["uv", "tool", "install", "--force", "--find-links", str(core_dist), str(agentic_sdlc_path)],
                        "Install agentic-sdlc CLI tools (with local core)",
                    ):
                        success_count += 1
                    else:
                        warning_count += 1
                else:
                    # Fallback: try installing without find-links (may fail if core not in registry)
                    print_warning("Core dist not found, trying without --find-links")
                    if run_command(
                        ["uv", "tool", "install", "--force", str(agentic_sdlc_path)],
                        "Install agentic-sdlc CLI tools",
                    ):
                        success_count += 1
                    else:
                        warning_count += 1
            else:
                print_warning(f"Python tool path not found: {agentic_sdlc_path}")
                warning_count += 1

        # Install agentic-core
        if "agentic-core" in requested_python_tools:
            if agentic_core_path.exists():
                print(f"\n  {color('Installing agentic-core package...', Colors.CYAN)}")

                # Clean and build agentic-core to ensure fresh wheel with latest docker files
                dist_dir = agentic_core_path / "dist"
                if dist_dir.exists():
                    shutil.rmtree(dist_dir)
                    print_info("Cleaned previous build artifacts")

                run_command(
                    ["uv", "build"],
                    "Build agentic-core package",
                    cwd=agentic_core_path,
                )

                run_command(
                    ["uv", "tool", "uninstall", "agentic-core"],
                    "Uninstall agentic-core CLI tools",
                )

                # Install from the freshly built wheel to bypass uv cache
                wheel_files = list(dist_dir.glob("*.whl"))
                if wheel_files:
                    wheel_path = wheel_files[0]
                    if run_command(
                        ["uv", "tool", "install", "--force", "--reinstall", str(wheel_path)],
                        "Install agentic-core CLI tools",
                    ):
                        success_count += 1
                    else:
                        warning_count += 1
                else:
                    print_warning("No wheel found after build")
                    warning_count += 1
            else:
                print_warning(f"Python tool path not found: {agentic_core_path}")
                warning_count += 1

    # Summary
    print(f"\n{color('=' * 60, Colors.BRIGHT_GREEN)}")
    if warning_count == 0:
        print(color("  Plugin Update Complete!", Colors.BOLD, Colors.BRIGHT_GREEN))
    else:
        print(color("  Plugin Update Complete (with warnings)", Colors.BOLD, Colors.YELLOW))
    print(color("=" * 60, Colors.BRIGHT_GREEN))

    print(f"\n  {color('Summary:', Colors.BOLD)}")
    print(f"    {color('Successful:', Colors.GREEN)} {success_count}")
    if warning_count > 0:
        print(f"    {color('Warnings:', Colors.YELLOW)} {warning_count}")

    print(f"\n  {color('Next steps:', Colors.BOLD)}")
    print(color("    1. Restart Claude Code to load updated plugins", Colors.DIM))
    print(color("    2. Run 'agentic-sdlc --help' to verify agentic-sdlc CLI", Colors.DIM))
    print(color("    3. Run 'agentic --help' to verify agentic-core CLI", Colors.DIM))
    print()


if __name__ == "__main__":
    main()
