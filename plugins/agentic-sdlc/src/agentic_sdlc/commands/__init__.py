"""CLI command handlers for agentic-sdlc."""

from agentic_sdlc.commands.config import cmd_config
from agentic_sdlc.commands.init import cmd_configure, cmd_init
from agentic_sdlc.commands.release_notes import cmd_release_notes
from agentic_sdlc.commands.resume import cmd_resume
from agentic_sdlc.commands.run import cmd_run
from agentic_sdlc.commands.shortcuts import cmd_analyze, cmd_input, cmd_oneshot
from agentic_sdlc.commands.status import cmd_cancel, cmd_list, cmd_status
from agentic_sdlc.commands.update import cmd_update
from agentic_sdlc.commands.version import cmd_version

__all__ = [
    "cmd_run",
    "cmd_resume",
    "cmd_status",
    "cmd_cancel",
    "cmd_list",
    "cmd_init",
    "cmd_configure",
    "cmd_config",
    "cmd_oneshot",
    "cmd_analyze",
    "cmd_input",
    "cmd_version",
    "cmd_release_notes",
    "cmd_update",
]
