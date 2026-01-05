"""CLI entry point for agentic-core."""

import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from agentic_core import __version__

app = typer.Typer(
    name="agentic",
    help="Agentic Core - AI agent orchestration framework",
    no_args_is_help=True,
)

# Sub-command groups
infra_app = typer.Typer(help="Infrastructure management commands")
providers_app = typer.Typer(help="Provider management commands")
app.add_typer(infra_app, name="infra")
app.add_typer(providers_app, name="providers")

console = Console()

# Path to docker directory
DOCKER_DIR = Path(__file__).parent.parent.parent.parent / "docker"


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


# Infrastructure commands


def _run_docker_compose(command: list[str], capture: bool = False) -> subprocess.CompletedProcess:
    """Run docker compose command."""
    cmd = ["docker", "compose", "-f", str(DOCKER_DIR / "docker-compose.yml")] + command
    if capture:
        return subprocess.run(cmd, capture_output=True, text=True)
    return subprocess.run(cmd)


@infra_app.command("up")
def infra_up(
    detach: bool = typer.Option(True, "--detach/--no-detach", "-d", help="Run in background"),
):
    """Start infrastructure services (Kafka, PostgreSQL, Redis)."""
    if not DOCKER_DIR.exists():
        console.print(f"[red]Error:[/red] Docker directory not found at {DOCKER_DIR}")
        raise typer.Exit(1)

    console.print("[bold]Starting infrastructure...[/bold]")

    cmd = ["up"]
    if detach:
        cmd.append("-d")

    result = _run_docker_compose(cmd)

    if result.returncode == 0:
        console.print("[green]Infrastructure started successfully![/green]")
        console.print("\nServices:")
        console.print("  - Kafka: localhost:9094")
        console.print("  - Kafka UI: http://localhost:8080")
        console.print("  - PostgreSQL: localhost:5432")
        console.print("  - Redis: localhost:6379")
    else:
        console.print("[red]Failed to start infrastructure[/red]")
        raise typer.Exit(1)


@infra_app.command("down")
def infra_down(
    volumes: bool = typer.Option(False, "--volumes", "-v", help="Remove volumes"),
):
    """Stop infrastructure services."""
    console.print("[bold]Stopping infrastructure...[/bold]")

    cmd = ["down"]
    if volumes:
        cmd.append("-v")

    result = _run_docker_compose(cmd)

    if result.returncode == 0:
        console.print("[green]Infrastructure stopped successfully![/green]")
    else:
        console.print("[red]Failed to stop infrastructure[/red]")
        raise typer.Exit(1)


@infra_app.command("status")
def infra_status():
    """Show infrastructure status."""
    result = _run_docker_compose(["ps", "--format", "json"], capture=True)

    if result.returncode != 0:
        console.print("[red]Failed to get infrastructure status[/red]")
        console.print(result.stderr)
        raise typer.Exit(1)

    import json

    table = Table(title="Infrastructure Status")
    table.add_column("Service", style="cyan")
    table.add_column("Status", style="green")
    table.add_column("Ports")

    try:
        # Docker compose ps --format json returns one JSON object per line
        for line in result.stdout.strip().split("\n"):
            if line:
                container = json.loads(line)
                name = container.get("Service", container.get("Name", "unknown"))
                state = container.get("State", container.get("Status", "unknown"))
                ports = container.get("Publishers", [])

                port_str = ""
                if ports:
                    port_str = ", ".join(
                        f"{p.get('PublishedPort', '')}"
                        for p in ports
                        if p.get("PublishedPort")
                    )

                status_style = "green" if state == "running" else "red"
                table.add_row(name, f"[{status_style}]{state}[/{status_style}]", port_str)
    except json.JSONDecodeError:
        # Fallback: just print raw output
        console.print(result.stdout)
        return

    console.print(table)


@infra_app.command("logs")
def infra_logs(
    service: Optional[str] = typer.Argument(None, help="Service name (kafka, postgres, redis)"),
    follow: bool = typer.Option(False, "--follow", "-f", help="Follow log output"),
    tail: int = typer.Option(100, "--tail", "-n", help="Number of lines to show"),
):
    """Show infrastructure logs."""
    cmd = ["logs", f"--tail={tail}"]
    if follow:
        cmd.append("-f")
    if service:
        cmd.append(service)

    _run_docker_compose(cmd)


# Provider commands


@providers_app.command("list")
def providers_list():
    """List available AI CLI providers."""
    from agentic_core.providers import PROVIDERS, get_provider

    table = Table(title="Available Providers")
    table.add_column("Name", style="cyan")
    table.add_column("Session Resume")
    table.add_column("JSON Output")
    table.add_column("Tool Restrictions")
    table.add_column("Status")

    for name in sorted(PROVIDERS.keys()):
        provider = get_provider(name)
        caps = provider.capabilities

        # Check if provider is available
        is_healthy = provider.health_check()
        status = "[green]Available[/green]" if is_healthy else "[yellow]Not installed[/yellow]"
        if name == "mock":
            status = "[blue]Mock[/blue]"

        table.add_row(
            name,
            "[green]Yes[/green]" if caps.session_resume else "[red]No[/red]",
            "[green]Yes[/green]" if caps.json_output else "[red]No[/red]",
            "[green]Yes[/green]" if caps.tool_restrictions else "[red]No[/red]",
            status,
        )

    console.print(table)


@providers_app.command("test")
def providers_test(
    provider_name: str = typer.Argument(..., help="Provider name (claude, cursor, mock)"),
    prompt: str = typer.Option("Say 'Hello from agentic-core!'", "--prompt", "-p", help="Test prompt"),
):
    """Test a provider with a simple prompt."""
    from agentic_core.providers import get_provider

    try:
        provider = get_provider(provider_name)
    except ValueError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)

    console.print(f"[bold]Testing {provider_name} provider...[/bold]")

    # Health check first
    if not provider.health_check():
        console.print(f"[yellow]Warning:[/yellow] {provider_name} CLI not found or not working")
        if provider_name != "mock":
            console.print("Try using 'mock' provider for testing without a real CLI")
            raise typer.Exit(1)

    # Invoke the provider
    console.print(f"Prompt: {prompt}")
    console.print("")

    result = provider.invoke(prompt, timeout=60)

    if result.is_error:
        console.print(f"[red]Error:[/red] {result.error_message}")
        raise typer.Exit(1)

    console.print("[bold]Response:[/bold]")
    console.print(result.content)
    console.print("")

    if result.session_id:
        console.print(f"Session ID: {result.session_id}")
    if result.tokens_in:
        console.print(f"Tokens in: {result.tokens_in}")
    if result.tokens_out:
        console.print(f"Tokens out: {result.tokens_out}")
    if result.duration_ms:
        console.print(f"Duration: {result.duration_ms}ms")


if __name__ == "__main__":
    app()
