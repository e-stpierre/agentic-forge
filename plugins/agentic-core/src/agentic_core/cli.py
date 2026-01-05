"""CLI entry point for agentic-core."""

from typing import Optional

import typer
from rich.console import Console

from agentic_core import __version__

app = typer.Typer(
    name="agentic",
    help="Agentic Core - AI agent orchestration framework",
    no_args_is_help=True,
)

console = Console()


def version_callback(value: bool):
    """Print version and exit."""
    if value:
        console.print(f"[bold]agentic-core[/bold] v{__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        "-v",
        callback=version_callback,
        is_eager=True,
        help="Show version information.",
    ),
):
    """Agentic Core - AI agent orchestration framework."""
    pass


if __name__ == "__main__":
    app()
