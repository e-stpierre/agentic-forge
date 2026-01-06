"""CLI entry point for agentic-core."""

import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Optional
from uuid import uuid4

import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from agentic_core import __version__

app = typer.Typer(
    name="agentic",
    help="Agentic Core - AI agent orchestration framework",
    no_args_is_help=True,
)


# Global context for storing options
class AppContext:
    """Application context for sharing state between commands."""

    skip_permissions: bool = False


_ctx = AppContext()

# Sub-command groups
infra_app = typer.Typer(help="Infrastructure management commands")
providers_app = typer.Typer(help="Provider management commands")
memory_app = typer.Typer(help="Memory management commands")
agents_app = typer.Typer(help="Agent management commands")
app.add_typer(infra_app, name="infra")
app.add_typer(providers_app, name="providers")
app.add_typer(memory_app, name="memory")
app.add_typer(agents_app, name="agents")

console = Console()


def _get_docker_dir() -> Path:
    """Get path to docker directory, checking multiple locations."""
    # 1. Check if installed as shared data (uv tool install)
    if sys.prefix != sys.base_prefix:
        # We're in a virtual environment
        shared_data_path = Path(sys.prefix) / "share" / "agentic-core" / "docker"
        if shared_data_path.exists():
            return shared_data_path

    # 2. Check relative to package for editable installs / development
    dev_path = Path(__file__).parent.parent.parent.parent / "docker"
    if dev_path.exists():
        return dev_path

    # 3. Return the expected installed path (will fail gracefully with helpful error)
    return Path(sys.prefix) / "share" / "agentic-core" / "docker"


DOCKER_DIR = _get_docker_dir()


def run_async(coro):
    """Run async coroutine in sync context."""
    return asyncio.run(coro)


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
    skip_permissions: bool = typer.Option(
        False,
        "--dangerously-skip-permissions",
        help="Skip permission prompts when executing Claude (use with caution).",
    ),
):
    """Agentic Core - AI agent orchestration framework."""
    _ctx.skip_permissions = skip_permissions


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
                        f"{p.get('PublishedPort', '')}" for p in ports if p.get("PublishedPort")
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


@infra_app.command("topics")
def infra_topics():
    """Create required Kafka topics for the messaging system."""
    from agentic_core.messaging import Topics, get_kafka_client

    console.print("[bold]Creating Kafka topics...[/bold]")

    try:
        kafka = get_kafka_client()

        # Check Kafka health first
        if not kafka.health_check():
            console.print("[red]Error:[/red] Cannot connect to Kafka.")
            console.print("Make sure infrastructure is running: [cyan]agentic infra up[/cyan]")
            raise typer.Exit(1)

        # Create topics
        kafka.ensure_topics()

        console.print("[green]Topics created successfully![/green]")
        console.print("\n[bold]Created topics:[/bold]")
        for topic in Topics.all_topics():
            retention = "infinite" if topic.retention_hours == -1 else f"{topic.retention_hours}h"
            console.print(f"  - {topic.name} (retention: {retention})")

    except Exception as e:
        console.print(f"[red]Error creating topics:[/red] {e}")
        raise typer.Exit(1)


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
    prompt: str = typer.Option(
        "Say 'Hello from agentic-core!'", "--prompt", "-p", help="Test prompt"
    ),
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


# Workflow commands


@app.command("run")
def run_workflow(
    workflow_file: Path = typer.Argument(..., help="Path to workflow YAML file"),
    var: list[str] = typer.Option([], "--var", help="Variables (key=value)"),
    from_step: Optional[str] = typer.Option(None, "--from-step", help="Resume from step"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Validate without executing"),
    working_dir: Optional[Path] = typer.Option(None, "--working-dir", help="Working directory"),
    worktree: bool = typer.Option(False, "--worktree", "-w", help="Run in isolated git worktree"),
    branch: Optional[str] = typer.Option(None, "--branch", "-b", help="Branch name for worktree"),
    keep_worktree: bool = typer.Option(
        False, "--keep-worktree", help="Don't delete worktree after completion"
    ),
):
    """Run a workflow from a YAML file."""
    from agentic_core.workflow import WorkflowExecutor, WorkflowParser

    if not workflow_file.exists():
        console.print(f"[red]Error:[/red] Workflow file not found: {workflow_file}")
        raise typer.Exit(1)

    # Parse variables
    variables = {}
    for v in var:
        if "=" in v:
            key, value = v.split("=", 1)
            variables[key] = value
        else:
            console.print(f"[yellow]Warning:[/yellow] Invalid variable format: {v}")

    # Parse workflow
    parser = WorkflowParser(base_path=workflow_file.parent)
    try:
        workflow = parser.parse_file(workflow_file)
    except Exception as e:
        console.print(f"[red]Error parsing workflow:[/red] {e}")
        raise typer.Exit(1)

    console.print(f"[bold]Running workflow:[/bold] {workflow.name}")
    if dry_run:
        console.print("[yellow]Dry run mode - no execution[/yellow]")

    if worktree:
        from agentic_core.git.worktree import temporary_worktree

        # Use workflow name in branch if not specified
        safe_name = workflow.name.lower().replace(" ", "-")
        branch_name = branch or f"agentic/{safe_name}-{uuid4().hex[:8]}"
        console.print(f"[dim]Creating worktree: {branch_name}[/dim]")

        with temporary_worktree(branch_name, cleanup=not keep_worktree) as wt:
            console.print(f"[dim]Working in: {wt.path}[/dim]")

            # Execute workflow in worktree
            executor = WorkflowExecutor(working_dir=wt.path)

            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                task = progress.add_task("Executing workflow...", total=None)
                result = run_async(executor.run(workflow, variables, from_step, dry_run))
                progress.update(task, completed=True)

            if keep_worktree:
                console.print(f"\n[green]Worktree kept at:[/green] {wt.path}")
    else:
        # Execute workflow in specified or current directory
        executor = WorkflowExecutor(working_dir=working_dir or Path.cwd())

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Executing workflow...", total=None)
            result = run_async(executor.run(workflow, variables, from_step, dry_run))
            progress.update(task, completed=True)

    # Display result
    if result.status.value == "completed":
        console.print("\n[green]Workflow completed successfully![/green]")
    else:
        console.print(f"\n[red]Workflow {result.status.value}[/red]")
        if result.error:
            console.print(f"Error: {result.error}")

    console.print(f"Duration: {result.duration_ms}ms")
    console.print(f"Workflow ID: {result.workflow_id}")


@app.command("one-shot")
def one_shot(
    task: str = typer.Argument(..., help="Task description"),
    git: bool = typer.Option(False, "--git", help="Commit changes after completion"),
    pr: bool = typer.Option(False, "--pr", help="Create a pull request"),
    worktree: bool = typer.Option(False, "--worktree", "-w", help="Run in isolated git worktree"),
    branch: Optional[str] = typer.Option(None, "--branch", "-b", help="Branch name for worktree"),
    keep_worktree: bool = typer.Option(
        False, "--keep-worktree", help="Don't delete worktree after completion"
    ),
    provider: str = typer.Option(
        "claude", "--provider", "-p", help="Provider (claude, cursor, mock)"
    ),
    model: str = typer.Option("sonnet", "--model", "-m", help="Model to use"),
):
    """Run a quick one-shot task with full tool execution."""
    from agentic_core.runner import check_claude_available, run_claude

    console.print(f"[bold]One-shot task:[/bold] {task}")

    # Check if Claude is available (for non-mock providers)
    if provider == "claude" and not check_claude_available():
        console.print("[red]Error:[/red] Claude CLI not found. Is it installed?")
        console.print("Try: npm install -g @anthropic-ai/claude-code")
        raise typer.Exit(1)

    # Build enhanced prompt with git/pr instructions
    enhanced_prompt = task
    if git:
        enhanced_prompt += (
            "\n\nAfter completing the task, commit the changes with a descriptive message."
        )
    if pr:
        enhanced_prompt += "\n\nCreate a pull request with the changes."

    # Determine working directory
    working_dir = Path.cwd()

    if worktree:
        from agentic_core.git.worktree import temporary_worktree

        branch_name = branch or f"agentic/one-shot-{uuid4().hex[:8]}"
        console.print(f"[dim]Creating worktree: {branch_name}[/dim]")

        with temporary_worktree(branch_name, cleanup=not keep_worktree) as wt:
            console.print(f"[dim]Working in: {wt.path}[/dim]")

            result = run_claude(
                prompt=enhanced_prompt,
                cwd=wt.path,
                skip_permissions=_ctx.skip_permissions,
                print_output=True,
            )

            if keep_worktree:
                console.print(f"\n[green]Worktree kept at:[/green] {wt.path}")
    else:
        result = run_claude(
            prompt=enhanced_prompt,
            cwd=working_dir,
            skip_permissions=_ctx.skip_permissions,
            print_output=True,
        )

    if not result.success:
        console.print("\n[red]Task failed[/red]")
        if result.stderr:
            console.print(f"Error: {result.stderr}")
        raise typer.Exit(1)

    console.print("\n[green]Task completed successfully![/green]")


def _print_meeting_message(message) -> None:
    """Print a meeting message to the console with formatting."""
    # Format agent name with style based on role
    if message.agent_name == "facilitator":
        name_style = "bold magenta"
        icon = "[F]"
    elif message.agent_name == "user":
        name_style = "bold green"
        icon = "[U]"
    else:
        name_style = "bold cyan"
        icon = f"[{message.agent_name[0].upper()}]"

    # Print separator for readability
    console.print()
    console.rule(f"[{name_style}]{icon} {message.agent_name}[/{name_style}]", style="dim")

    # Print message content
    console.print(message.content)


@app.command("meeting")
def meeting_cmd(
    topic: str = typer.Argument(..., help="Meeting topic"),
    agents: str = typer.Option(
        "architect,developer", "--agents", "-a", help="Comma-separated agent names"
    ),
    rounds: int = typer.Option(3, "--rounds", "-r", help="Discussion rounds"),
    provider: str = typer.Option(
        "claude", "--provider", "-p", help="Provider (claude, cursor, mock)"
    ),
    interactive: bool = typer.Option(False, "--interactive", "-i", help="Enable human-in-the-loop"),
    output_dir: Optional[Path] = typer.Option(None, "--output", "-o", help="Output directory"),
    worktree: bool = typer.Option(False, "--worktree", "-w", help="Run in isolated git worktree"),
    branch: Optional[str] = typer.Option(None, "--branch", "-b", help="Branch name for worktree"),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Suppress real-time output"),
    use_kafka: bool = typer.Option(False, "--kafka", "-k", help="Publish messages to Kafka"),
):
    """Start a multi-agent meeting."""
    from agentic_core.agents.pool import AgentPool
    from agentic_core.meetings.orchestrator import MeetingOrchestrator

    agent_list = [a.strip() for a in agents.split(",")]

    console.print(f"[bold]Starting meeting:[/bold] {topic}")
    console.print(f"Participants: {', '.join(agent_list)}")
    console.print(f"Provider: {provider}")
    console.print(f"Rounds: {rounds}")

    # Set up Kafka client if requested
    kafka = None
    if use_kafka:
        from agentic_core.messaging import get_kafka_client

        kafka = get_kafka_client()
        if not kafka.health_check():
            console.print(
                "[yellow]Warning:[/yellow] Cannot connect to Kafka. Continuing without messaging."
            )
            kafka = None
        else:
            console.print("Kafka: [green]connected[/green]")
            kafka.ensure_topics()

    console.print()

    # Create agent pool
    pool = AgentPool()

    # Create agents with the specified provider
    for agent_name in agent_list:
        pool.create_agent(name=agent_name, provider=provider)

    # Set up message callback for streaming output
    on_message = None if quiet else _print_meeting_message

    # Create orchestrator with streaming callback and Kafka
    orchestrator = MeetingOrchestrator(agent_pool=pool, kafka=kafka, on_message=on_message)

    if worktree:
        from agentic_core.git.worktree import temporary_worktree

        branch_name = branch or f"agentic/meeting-{uuid4().hex[:8]}"
        console.print(f"[dim]Creating worktree: {branch_name}[/dim]")

        with temporary_worktree(branch_name, cleanup=False) as wt:
            console.print(f"[dim]Working in: {wt.path}[/dim]")

            state = run_async(
                orchestrator.run_meeting(
                    topic=topic,
                    agents=agent_list,
                    max_rounds=rounds,
                    interactive=interactive,
                )
            )

            console.print(f"\n[green]Worktree at:[/green] {wt.path}")
    else:
        state = run_async(
            orchestrator.run_meeting(
                topic=topic,
                agents=agent_list,
                max_rounds=rounds,
                interactive=interactive,
            )
        )

    console.print()
    console.rule("[bold]Meeting Completed[/bold]", style="green")
    console.print(f"Rounds: {state.current_round}")
    console.print(f"Messages: {len(state.transcript)}")

    if state.decisions:
        console.print("\n[bold]Decisions:[/bold]")
        for i, decision in enumerate(state.decisions, 1):
            console.print(f"  {i}. {decision}")

    if state.action_items:
        console.print("\n[bold]Action Items:[/bold]")
        for item in state.action_items:
            console.print(f"  - {item}")

    # Generate outputs
    if output_dir or state.config.outputs:
        outputs = run_async(orchestrator.generate_outputs(state, output_dir))
        if outputs:
            console.print("\n[bold]Outputs:[/bold]")
            for name, path in outputs.items():
                console.print(f"  {name}: {path}")


# Agent commands


@agents_app.command("list")
def agents_list():
    """List registered agents."""
    from agentic_core.agents.pool import AgentPool

    pool = AgentPool()
    # Load from default agents directory if it exists
    default_dir = Path.cwd() / "personas"
    if default_dir.exists():
        pool.agents_dir = default_dir
        pool.load_from_directory()

    agents = pool.list_agents()

    if not agents:
        console.print("[yellow]No agents registered.[/yellow]")
        console.print("Add agent persona files to the 'personas/' directory.")
        return

    table = Table(title="Registered Agents")
    table.add_column("Name", style="cyan")
    table.add_column("Provider")
    table.add_column("Model")
    table.add_column("Icon")

    for name in agents:
        config = pool.get_config(name)
        if config:
            table.add_row(name, config.provider, config.model, config.icon or "-")

    console.print(table)


@agents_app.command("test")
def agents_test(
    agent_name: str = typer.Argument(..., help="Agent name"),
    prompt: str = typer.Option("Hello, please introduce yourself.", "--prompt", "-p"),
    provider: str = typer.Option("claude", "--provider", help="Provider (claude, cursor, mock)"),
    model: str = typer.Option("sonnet", "--model", "-m", help="Model to use"),
):
    """Test an agent with a prompt."""
    from agentic_core.agents.pool import AgentPool

    pool = AgentPool()
    pool.create_agent(name=agent_name, provider=provider, model=model)
    session = pool.get_session(agent_name)

    console.print(f"[bold]Testing agent:[/bold] {agent_name}")
    console.print(f"Provider: {provider}")
    console.print(f"Model: {model}")
    console.print(f"Prompt: {prompt}\n")

    response = run_async(session.invoke(prompt))

    console.print("[bold]Response:[/bold]")
    console.print(response)


# Memory commands


@memory_app.command("search")
def memory_search(
    query: str = typer.Argument(..., help="Search query"),
    category: Optional[str] = typer.Option(None, "--category", "-c", help="Filter by category"),
    limit: int = typer.Option(5, "--limit", "-n", help="Maximum results"),
):
    """Search memories by semantic similarity."""
    from agentic_core.memory import MemoryManager

    manager = MemoryManager()

    if not manager.is_connected():
        console.print("[red]Error:[/red] Database connection required for memory operations.")
        console.print("\n[bold]To enable memory features:[/bold]")
        console.print("  1. Start infrastructure: [cyan]agentic infra up[/cyan]")
        console.print("  2. Wait for services to be ready: [cyan]agentic infra status[/cyan]")
        console.print("  3. Re-run this command")
        raise typer.Exit(1)

    results = run_async(manager.search(query, category=category, limit=limit))

    if not results:
        console.print(f"[yellow]No memories found matching:[/yellow] {query}")
        return

    console.print(f"[bold]Search results for:[/bold] {query}\n")
    for i, result in enumerate(results, 1):
        console.print(f"{i}. [{result.category}] {result.content[:100]}...")
        if result.metadata:
            console.print(f"   [dim]Metadata: {result.metadata}[/dim]")


@memory_app.command("add")
def memory_add(
    category: str = typer.Argument(
        ..., help="Category (lesson, pattern, error, decision, context)"
    ),
    content: str = typer.Argument(..., help="Memory content"),
    source: Optional[str] = typer.Option(None, "--source", "-s", help="Source of the memory"),
):
    """Add a memory manually."""
    from agentic_core.memory import MemoryManager

    valid_categories = ["lesson", "pattern", "error", "decision", "context"]
    if category not in valid_categories:
        console.print(f"[red]Invalid category.[/red] Valid: {', '.join(valid_categories)}")
        raise typer.Exit(1)

    manager = MemoryManager()

    if not manager.is_connected():
        console.print("[red]Error:[/red] Database connection required for memory operations.")
        console.print("\n[bold]To enable memory features:[/bold]")
        console.print("  1. Start infrastructure: [cyan]agentic infra up[/cyan]")
        console.print("  2. Wait for services to be ready: [cyan]agentic infra status[/cyan]")
        console.print("  3. Re-run this command")
        raise typer.Exit(1)

    metadata = {"source": source} if source else {}
    memory_id = run_async(manager.add(content, category=category, metadata=metadata))

    console.print("[green]Memory added successfully![/green]")
    console.print(f"ID: {memory_id}")
    console.print(f"Category: {category}")
    console.print(f"Content: {content[:100]}...")


@memory_app.command("list")
def memory_list_cmd(
    category: Optional[str] = typer.Option(None, "--category", "-c", help="Filter by category"),
    limit: int = typer.Option(20, "--limit", "-n", help="Maximum results"),
):
    """List memories by category."""
    from agentic_core.memory import MemoryManager

    manager = MemoryManager()

    if not manager.is_connected():
        console.print("[red]Error:[/red] Database connection required for memory operations.")
        console.print("\n[bold]To enable memory features:[/bold]")
        console.print("  1. Start infrastructure: [cyan]agentic infra up[/cyan]")
        console.print("  2. Wait for services to be ready: [cyan]agentic infra status[/cyan]")
        console.print("  3. Re-run this command")
        raise typer.Exit(1)

    memories = run_async(manager.list_memories(category=category, limit=limit))

    if not memories:
        if category:
            console.print(f"[yellow]No memories found in category:[/yellow] {category}")
        else:
            console.print("[yellow]No memories found.[/yellow]")
        return

    table = Table(title=f"Memories{f' ({category})' if category else ''}")
    table.add_column("ID", style="dim")
    table.add_column("Category", style="cyan")
    table.add_column("Content")
    table.add_column("Created", style="dim")

    for memory in memories:
        table.add_row(
            str(memory.id)[:8],
            memory.category,
            memory.content[:50] + "..." if len(memory.content) > 50 else memory.content,
            memory.created_at.strftime("%Y-%m-%d") if memory.created_at else "-",
        )

    console.print(table)


if __name__ == "__main__":
    app()
