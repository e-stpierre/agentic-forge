"""CLI command handlers for agentic-forge."""

from agentic_forge.commands.config import cmd_config
from agentic_forge.commands.init import cmd_configure, cmd_init
from agentic_forge.commands.release_notes import cmd_release_notes
from agentic_forge.commands.resume import cmd_resume
from agentic_forge.commands.run import cmd_run
from agentic_forge.commands.shortcuts import cmd_input
from agentic_forge.commands.status import cmd_cancel, cmd_list, cmd_status
from agentic_forge.commands.update import cmd_update
from agentic_forge.commands.version import cmd_version
from agentic_forge.commands.workflows import cmd_workflows

__all__ = [
    "cmd_run",
    "cmd_resume",
    "cmd_status",
    "cmd_cancel",
    "cmd_list",
    "cmd_init",
    "cmd_configure",
    "cmd_config",
    "cmd_input",
    "cmd_version",
    "cmd_release_notes",
    "cmd_update",
    "cmd_workflows",
]
