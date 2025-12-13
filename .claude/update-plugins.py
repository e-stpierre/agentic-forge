#!/usr/bin/env -S uv run python
"""
Update all plugins from the local marketplace.

This script:
1. Updates the marketplace from the local repository
2. Reinstalls all plugins defined in marketplace.json
3. Force reinstalls the Python tools (core, sdlc)

Usage:
    python .claude/update-plugins.py

    Or run from anywhere:
    python path/to/update-plugins.py
"""

import json
import subprocess
import sys
from pathlib import Path


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


def main():
    # Print banner
    print(color("\n" + "=" * 60, Colors.BRIGHT_MAGENTA))
    print(color("      Claude Plugins Updater", Colors.BOLD, Colors.BRIGHT_MAGENTA))
    print(color("=" * 60, Colors.BRIGHT_MAGENTA))

    # Get the repository root (parent of .claude directory)
    script_dir = Path(__file__).parent.resolve()
    repo_root = script_dir.parent
    marketplace_path = repo_root / ".claude-plugin" / "marketplace.json"

    print_info(f"Repository: {repo_root}")
    print_info(f"Marketplace: {marketplace_path}")

    # Load marketplace.json to get plugin names
    if not marketplace_path.exists():
        print_error(f"marketplace.json not found at {marketplace_path}")
        sys.exit(1)

    with open(marketplace_path) as f:
        marketplace = json.load(f)

    plugins = [p["name"] for p in marketplace.get("plugins", [])]
    print(f"\n{color('Found plugins:', Colors.BOLD)} {color(', '.join(plugins), Colors.BRIGHT_YELLOW)}")

    total_steps = 3
    success_count = 0
    warning_count = 0

    # Step 1: Update the marketplace from local repository
    print_step(1, total_steps, "Update Marketplace")
    if run_command(
        ["claude", "plugin", "marketplace", "update", "claude-plugins"],
        "Update marketplace from local repository",
        cwd=repo_root,
    ):
        success_count += 1

    # Step 2: Reinstall each plugin (uninstall then install)
    print_step(2, total_steps, "Reinstall Claude Code Plugins")
    print_info(f"Reinstalling {len(plugins)} plugins...")

    for i, plugin in enumerate(plugins, 1):
        print(f"\n  {color(f'[{i}/{len(plugins)}]', Colors.CYAN)} {color(plugin, Colors.BRIGHT_BLUE)}")

        # Uninstall first (ignore errors if not installed)
        run_command(
            ["claude", "plugin", "uninstall", plugin],
            f"Uninstall {plugin}",
        )
        # Install from local marketplace
        if run_command(
            ["claude", "plugin", "install", plugin],
            f"Install {plugin}",
        ):
            success_count += 1
        else:
            warning_count += 1

    # Step 3: Force reinstall Python tools
    print_step(3, total_steps, "Install Python CLI Tools")

    # Note: sdlc depends on core, so we need to:
    # 1. Build core first so it's available as a local package
    # 2. Install sdlc with --find-links pointing to core's dist directory
    core_path = repo_root / "plugins" / "core"
    sdlc_path = repo_root / "plugins" / "sdlc"

    # Build core package first
    if core_path.exists():
        print(f"\n  {color('Building core package...', Colors.CYAN)}")

        # Clean and build core
        dist_dir = core_path / "dist"
        if dist_dir.exists():
            import shutil

            shutil.rmtree(dist_dir)
            print_info("Cleaned previous build artifacts")

        run_command(
            ["uv", "build"],
            "Build core package",
            cwd=core_path,
        )

        # Install core tool
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

    # Install sdlc with --find-links to locate core dependency
    if sdlc_path.exists():
        print(f"\n  {color('Installing sdlc package...', Colors.CYAN)}")

        core_dist = core_path / "dist"
        if core_dist.exists():
            if run_command(
                ["uv", "tool", "install", "--force", "--find-links", str(core_dist), str(sdlc_path)],
                "Install claude-sdlc CLI tools (with local core)",
            ):
                success_count += 1
            else:
                warning_count += 1
        else:
            # Fallback: try installing without find-links (may fail if core not in registry)
            print_warning("Core dist not found, trying without --find-links")
            if run_command(
                ["uv", "tool", "install", "--force", str(sdlc_path)],
                "Install claude-sdlc CLI tools",
            ):
                success_count += 1
            else:
                warning_count += 1
    else:
        print_warning(f"Python tool path not found: {sdlc_path}")
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
    print(color("    2. Run 'claude-sdlc --help' to verify CLI tools", Colors.DIM))
    print()


if __name__ == "__main__":
    main()
