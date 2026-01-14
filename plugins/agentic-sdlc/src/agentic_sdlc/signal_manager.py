"""Signal handling for graceful shutdown."""

from __future__ import annotations

import signal
import sys
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

    from agentic_sdlc.logging.logger import WorkflowLogger
    from agentic_sdlc.progress import WorkflowProgress


class SignalManager:
    """Manages signal handling for graceful shutdown.

    Handles SIGINT/SIGTERM (Unix) and SIGINT/SIGBREAK (Windows) for clean
    workflow termination.
    """

    def __init__(self, on_shutdown: Callable[[], None] | None = None):
        """Initialize signal manager.

        Args:
            on_shutdown: Optional callback to execute on shutdown signal
        """
        self._shutdown_requested = False
        self._on_shutdown = on_shutdown
        self._install_handlers()

    def _install_handlers(self) -> None:
        """Install platform-appropriate signal handlers."""
        if sys.platform != "win32":
            signal.signal(signal.SIGINT, self._handle_shutdown)
            signal.signal(signal.SIGTERM, self._handle_shutdown)
        else:
            signal.signal(signal.SIGINT, self._handle_shutdown)
            signal.signal(signal.SIGBREAK, self._handle_shutdown)

    def _handle_shutdown(self, signum: int, frame: Any) -> None:
        """Handle shutdown signal."""
        self._shutdown_requested = True
        print("\nShutdown requested, cleaning up...")
        if self._on_shutdown:
            self._on_shutdown()

    @property
    def shutdown_requested(self) -> bool:
        """Check if shutdown has been requested."""
        return self._shutdown_requested

    def request_shutdown(self) -> None:
        """Programmatically request shutdown."""
        self._shutdown_requested = True


def handle_graceful_shutdown(
    progress: WorkflowProgress,
    logger: WorkflowLogger,
    repo_root: Path,
) -> None:
    """Handle graceful shutdown by cancelling workflow and cleaning up.

    Args:
        progress: Current workflow progress
        logger: Workflow logger
        repo_root: Repository root for cleanup
    """
    from agentic_sdlc.git.worktree import prune_orphaned
    from agentic_sdlc.progress import WorkflowStatus

    logger.info("orchestrator", "Performing graceful shutdown")
    progress.status = WorkflowStatus.CANCELLED.value

    # Clean up any orphaned worktrees
    prune_orphaned(repo_root)
