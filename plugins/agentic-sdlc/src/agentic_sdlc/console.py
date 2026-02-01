"""Console output utilities for workflow execution.

Provides structured, colored terminal output for workflow progress,
step results, errors, and summaries.
"""

from __future__ import annotations

import logging
import queue
import sys
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, TextIO

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)

# Sentinel value to signal consumer thread to stop
_STOP_SENTINEL = object()

# Maximum characters to accumulate in BASE mode before truncating (1MB)
_MAX_ACCUMULATED_TEXT = 1024 * 1024


class OutputLevel(Enum):
    """Output verbosity levels."""

    BASE = "base"  # Show step progress, summaries, and errors
    ALL = "all"  # Stream all Claude output in real-time


class Color(Enum):
    """ANSI color codes for terminal output."""

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    # Colors
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"

    # Bright colors
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_CYAN = "\033[96m"


def _supports_color() -> bool:
    """Check if the terminal supports color output."""
    if not hasattr(sys.stdout, "isatty"):
        return False
    return sys.stdout.isatty()


def _colorize(text: str, *colors: Color) -> str:
    """Apply color codes to text if supported."""
    if not _supports_color():
        return text
    color_codes = "".join(c.value for c in colors)
    return f"{color_codes}{text}{Color.RESET.value}"


@dataclass
class ParallelOutputHandler:
    """Handles parallel branch output display and message queuing.

    Extracted from ConsoleOutput to manage the complexity of parallel execution display.
    Supports two modes:
    - BASE mode: Multi-branch status display with in-place updates
    - ALL mode: Queue-based message streaming for ordered output
    """

    stream: TextIO = sys.stdout
    level: OutputLevel = OutputLevel.BASE
    _print_fn: Callable[[str], None] | None = None  # Callback for printing

    # Thread-local storage for branch context
    _thread_local: threading.local = field(default_factory=threading.local)

    # Queue-based streaming for parallel mode (ALL level)
    _message_queue: queue.Queue | None = field(default=None, repr=False)
    _consumer_thread: threading.Thread | None = field(default=None, repr=False)
    _consumer_running: bool = False

    # Parallel branch display for BASE mode
    _branches: list[str] = field(default_factory=list)  # Ordered list of branch names
    _branch_index: dict[str, int] = field(default_factory=dict)  # Branch name -> display line index
    _branch_done: dict[str, bool] = field(default_factory=dict)  # Branch name -> is completed
    _display_lock: threading.Lock = field(default_factory=threading.Lock)  # Thread-safe updates
    _deferred_messages: list[str] = field(default_factory=list)  # Messages to print after parallel completes
    _lines_per_branch: int = 4  # Header (1) + message lines (2) + blank (1)

    # State
    _active: bool = False

    def _print(self, message: str) -> None:
        """Print message using callback or directly to stream."""
        if self._print_fn:
            self._print_fn(message)
        else:
            print(message, flush=True, file=self.stream)

    @property
    def is_active(self) -> bool:
        """Check if parallel mode is active."""
        return self._active

    @property
    def has_branches(self) -> bool:
        """Check if branches are registered."""
        return bool(self._branches)

    def register_branches(self, branches: list[str]) -> None:
        """Register parallel branches and initialize their display.

        Call this before entering parallel mode to set up the multi-branch display.
        Layout per branch:
          [branch-name]
          <message line 1>
          <message line 2>
          <blank line>

        Args:
            branches: List of branch names in execution order
        """
        self._branches = list(branches)
        self._branch_index = {name: idx for idx, name in enumerate(branches)}
        self._branch_done = dict.fromkeys(branches, False)
        self._deferred_messages = []

        # In BASE mode, print initial branch layout
        if self.level == OutputLevel.BASE and _supports_color():
            for branch in branches:
                prefix = _colorize(f"[{branch}]", Color.CYAN, Color.BOLD)
                self._print(f"{prefix}")
                waiting = _colorize("waiting...", Color.DIM)
                self._print(f"  {waiting}")
                self._print("")  # Message line 2 (empty initially)
                self._print("")  # Blank line between branches

    def update_branch_line(self, branch: str, text: str, max_width: int = 100) -> None:
        """Update a specific branch's message display area.

        Uses ANSI escape codes to move to the correct lines and update them.
        Thread-safe via lock. Supports multi-line messages.

        Args:
            branch: Branch name to update
            text: Status text to display (can be multi-line or wrap)
            max_width: Maximum width per line before wrapping
        """
        if not _supports_color() or branch not in self._branch_index:
            return

        # Don't update if branch is already done
        if self._branch_done.get(branch, False):
            return

        with self._display_lock:
            idx = self._branch_index[branch]
            total_branches = len(self._branches)

            # Calculate total lines in the display area
            total_lines = total_branches * self._lines_per_branch

            # Calculate the starting line for this branch's message area
            # Each branch takes _lines_per_branch lines
            # Branch layout: header (line 0), message1 (line 1), message2 (line 2), blank (line 3)
            # We want to update lines 1 and 2 (the message lines)
            branch_start_line = idx * self._lines_per_branch
            message_line_1 = branch_start_line + 1
            message_line_2 = branch_start_line + 2

            # Lines up from current position (we're at the bottom of the display)
            lines_up_to_msg1 = total_lines - message_line_1
            lines_up_to_msg2 = total_lines - message_line_2

            # Prepare the message lines (wrap long text)
            # Split into lines that fit within max_width
            text = text.strip()
            if len(text) <= max_width:
                line1 = text
                line2 = ""
            else:
                # Try to break at a space
                break_point = text.rfind(" ", 0, max_width)
                if break_point == -1:
                    break_point = max_width
                line1 = text[:break_point].strip()
                line2 = text[break_point:].strip()
                if len(line2) > max_width:
                    line2 = line2[: max_width - 3] + "..."

            prefix = _colorize("...", Color.DIM)

            # Save cursor position
            self.stream.write("\033[s")

            # Update message line 1
            self.stream.write(f"\033[{lines_up_to_msg1}A")  # Move up
            self.stream.write("\033[K")  # Clear line
            self.stream.write(f"  {prefix} {line1}")

            # Update message line 2
            self.stream.write(f"\033[{lines_up_to_msg1 - lines_up_to_msg2}B")  # Move down to line 2
            self.stream.write("\r\033[K")  # Go to start of line and clear
            if line2:
                self.stream.write(f"  {prefix} {line2}")

            # Restore cursor position
            self.stream.write("\033[u")
            self.stream.flush()

    def mark_branch_done(self, branch: str, success: bool = True) -> None:
        """Mark a branch as completed with [Done] or [Failed] indicator.

        Args:
            branch: Branch name to mark as done
            success: Whether the branch completed successfully
        """
        if not _supports_color() or branch not in self._branch_index:
            return

        with self._display_lock:
            self._branch_done[branch] = True

            idx = self._branch_index[branch]
            total_branches = len(self._branches)
            total_lines = total_branches * self._lines_per_branch

            # Calculate the header line for this branch
            branch_start_line = idx * self._lines_per_branch
            lines_up_to_header = total_lines - branch_start_line

            # Also clear the message lines
            message_line_1 = branch_start_line + 1
            message_line_2 = branch_start_line + 2
            lines_up_to_msg1 = total_lines - message_line_1
            lines_up_to_msg2 = total_lines - message_line_2

            prefix = _colorize(f"[{branch}]", Color.CYAN, Color.BOLD)
            status = _colorize("[Done]", Color.BRIGHT_GREEN, Color.BOLD) if success else _colorize("[Failed]", Color.BRIGHT_RED, Color.BOLD)

            # Save cursor position
            self.stream.write("\033[s")

            # Update header line with status
            self.stream.write(f"\033[{lines_up_to_header}A")  # Move up to header
            self.stream.write("\033[K")  # Clear line
            self.stream.write(f"{prefix} {status}")

            # Clear message line 1
            self.stream.write(f"\033[{lines_up_to_header - lines_up_to_msg1}B")  # Move down
            self.stream.write("\r\033[K")  # Clear line

            # Clear message line 2
            self.stream.write(f"\033[{lines_up_to_msg1 - lines_up_to_msg2}B")  # Move down
            self.stream.write("\r\033[K")  # Clear line

            # Restore cursor position
            self.stream.write("\033[u")
            self.stream.flush()

    def _clear_display(self) -> None:
        """Clear the parallel branch display area."""
        if not self._branches or not _supports_color():
            self._branches = []
            self._branch_index = {}
            self._branch_done = {}
            return

        with self._display_lock:
            total_lines = len(self._branches) * self._lines_per_branch
            # Move up and clear each line
            for _ in range(total_lines):
                self.stream.write("\033[A\033[2K")  # Move up + clear entire line
            self.stream.flush()

        self._branches = []
        self._branch_index = {}
        self._branch_done = {}

    def enter(self) -> None:
        """Enter parallel mode - enables queue-based streaming in ALL mode."""
        self._active = True
        if self.level == OutputLevel.ALL:
            # Start message queue and consumer thread for real-time streaming
            self._message_queue = queue.Queue()
            self._consumer_running = True
            self._consumer_thread = threading.Thread(target=self._message_consumer, daemon=True)
            self._consumer_thread.start()

    def exit(self) -> None:
        """Exit parallel mode - stops consumer thread and flushes deferred messages."""
        # Clear parallel branch display in BASE mode and flush deferred messages
        if self.level == OutputLevel.BASE:
            if self._branches:
                self._clear_display()
            # Print all deferred messages now
            for msg in self._deferred_messages:
                self._print(msg)
            self._deferred_messages = []

        # Signal consumer to stop using sentinel value (avoids race condition)
        self._consumer_running = False
        if self._message_queue is not None:
            self._message_queue.put(_STOP_SENTINEL)
        if self._consumer_thread is not None:
            self._consumer_thread.join(timeout=5.0)
            if self._consumer_thread.is_alive():
                logger.warning("Consumer thread did not finish within timeout, some messages may be lost")
            self._consumer_thread = None
        self._message_queue = None
        self._active = False

    def defer_message(self, message: str) -> None:
        """Defer a message to be printed after parallel mode exits.

        Thread-safe. Used in BASE mode to avoid breaking the parallel display.

        Args:
            message: The formatted message to defer
        """
        with self._display_lock:
            self._deferred_messages.append(message)

    def set_branch(self, branch_name: str) -> None:
        """Set the current parallel branch name for message streaming.

        Uses thread-local storage to avoid conflicts between parallel threads.

        Args:
            branch_name: Name of the parallel branch being executed
        """
        # Store branch name and initialize accumulation state in thread-local storage
        self._thread_local.branch_name = branch_name
        self._thread_local.accumulated_text = ""
        self._thread_local.accumulated_role = ""
        self._thread_local.accumulated_model = None
        self._thread_local.base_accumulated_text = ""  # For BASE mode parallel display

    def get_current_branch(self) -> str | None:
        """Get the current thread's branch name."""
        return getattr(self._thread_local, "branch_name", None)

    def enqueue_current_message(self) -> None:
        """Enqueue the current accumulated message for printing by the consumer thread."""
        branch = self.get_current_branch()
        accumulated_text = getattr(self._thread_local, "accumulated_text", "")
        accumulated_role = getattr(self._thread_local, "accumulated_role", "")
        accumulated_model = getattr(self._thread_local, "accumulated_model", None)

        if (
            self.level == OutputLevel.ALL
            and self._active
            and accumulated_text.strip()
            and accumulated_role
            and branch
            and self._message_queue is not None
        ):
            # Enqueue message tuple for the consumer thread to print
            self._message_queue.put((branch, accumulated_role, accumulated_text.strip(), accumulated_model))

        # Reset accumulation state
        self._thread_local.accumulated_text = ""
        self._thread_local.accumulated_role = ""
        self._thread_local.accumulated_model = None

    def _message_consumer(self) -> None:
        """Consumer thread that prints messages from the queue in order.

        Runs until it receives the stop sentinel or the queue is None.
        Each message is printed atomically to avoid interleaving.
        Uses sentinel-based termination to avoid race conditions.
        """
        try:
            while True:
                if self._message_queue is None:
                    break
                try:
                    msg = self._message_queue.get(timeout=0.1)
                    # Check for stop sentinel
                    if msg is _STOP_SENTINEL:
                        self._message_queue.task_done()
                        break
                    branch, role, text, model = msg
                    self._print_branch_message(branch, role, text, model)
                    self._message_queue.task_done()
                except queue.Empty:
                    # If not running and queue is empty, exit
                    if not self._consumer_running:
                        break
                    continue
        except Exception as e:
            logger.error("Error in message consumer thread: %s", e, exc_info=True)

    def _print_branch_message(self, branch: str, role: str, text: str, model: str | None) -> None:
        """Print a single message with branch prefix.

        Args:
            branch: Branch name for the prefix
            role: Message role - "user" or "assistant"
            text: Message text content
            model: Optional model name
        """
        # Import here to avoid circular dependency
        from agentic_sdlc.runner import format_model_name

        formatted_model = format_model_name(model) if model else None
        branch_prefix = _colorize(f"[{branch}] ", Color.CYAN, Color.BOLD)

        if role == "user":
            prefix = _colorize(">", Color.BRIGHT_CYAN, Color.BOLD)
            label = _colorize(" [user]", Color.DIM)
            self._print(f"\n{branch_prefix}{prefix}{label}")
            for line in text.split("\n"):
                colored_line = _colorize(line, Color.GREEN)
                self._print(f"  {colored_line}")
        else:
            # Assistant message
            bullet = _colorize("*", Color.BRIGHT_GREEN, Color.BOLD)
            model_label = ""
            if formatted_model:
                model_label = " " + _colorize(f"[{formatted_model}]", Color.DIM)
            lines = text.split("\n")
            self._print(f"\n{branch_prefix}{bullet}{model_label} {lines[0]}")
            for line in lines[1:]:
                self._print(f"  {line}")

    def accumulate_text(self, text: str, role: str, model: str | None = None) -> None:
        """Accumulate text for the current thread's message (ALL mode).

        Args:
            text: Text to accumulate
            role: Message role
            model: Optional model name
        """
        current_role = getattr(self._thread_local, "accumulated_role", "")
        current_text = getattr(self._thread_local, "accumulated_text", "")

        # Detect role change - enqueue previous message before starting new one
        if current_role and current_role != role and current_text.strip():
            self.enqueue_current_message()
            current_text = ""

        # Accumulate text for current message in thread-local storage
        self._thread_local.accumulated_text = current_text + text
        self._thread_local.accumulated_role = role
        if model:
            self._thread_local.accumulated_model = model

    def accumulate_base_text(self, text: str) -> str:
        """Accumulate text for BASE mode display and return last line.

        Args:
            text: Text to accumulate

        Returns:
            The last line of accumulated text for display
        """
        current_text = getattr(self._thread_local, "base_accumulated_text", "")
        self._thread_local.base_accumulated_text = current_text + text
        accumulated = self._thread_local.base_accumulated_text.strip()
        if accumulated:
            lines = accumulated.split("\n")
            return lines[-1]
        return ""


@dataclass
class ConsoleOutput:
    """Handles structured console output for workflows."""

    level: OutputLevel = OutputLevel.BASE
    stream: TextIO = sys.stdout
    _base_accumulated_text: str = ""  # Accumulated text for BASE mode streaming
    _base_last_display_lines: int = 0  # Track lines displayed for clearing
    _parallel_handler: ParallelOutputHandler | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        """Initialize parallel handler after dataclass init."""
        self._parallel_handler = ParallelOutputHandler(
            stream=self.stream,
            level=self.level,
            _print_fn=lambda msg: print(msg, flush=True, file=self.stream),
        )

    def _print(self, message: str, end: str = "\n") -> None:
        """Print message to stream."""
        print(message, end=end, flush=True, file=self.stream)

    def _print_inplace(self, message: str) -> None:
        """Print message in-place, overwriting previous in-place output.

        Uses ANSI escape sequences to clear previous lines and update display.
        Falls back to showing a "[streaming...]" indicator if terminal doesn't
        support ANSI escape sequences (e.g., Windows without VT100 support).

        Args:
            message: Message to display (can be multi-line)
        """
        # Prepare lines for display - show full message
        lines = message.strip().split("\n")
        num_lines = len(lines)

        if _supports_color():
            # Clear previous in-place lines by moving up N lines at once
            # then clearing from cursor to end of screen
            if self._base_last_display_lines > 0:
                # Move cursor up N lines in one operation
                self.stream.write(f"\033[{self._base_last_display_lines}A")
                # Clear from cursor to end of screen (removes all old content below)
                self.stream.write("\033[J")

            # Write all lines in a single operation for atomicity
            # This avoids issues with rapid line-by-line flushing on Windows
            content = "\n".join(lines) + "\n"
            self.stream.write(content)
            self.stream.flush()
        else:
            # Fallback for non-ANSI terminals: show last line only with indicator
            # This provides some feedback without cluttering the output
            last_line = lines[-1] if lines else ""
            truncated = last_line[:80] + "..." if len(last_line) > 80 else last_line
            self._print(f"  ... {truncated}")

        self._base_last_display_lines = num_lines

    def _clear_inplace(self) -> None:
        """Clear any in-place output that was displayed."""
        if self._base_last_display_lines > 0 and _supports_color():
            # Move cursor up N lines in one operation, then clear to end of screen
            self.stream.write(f"\033[{self._base_last_display_lines}A\033[J")
            self.stream.flush()
        self._base_last_display_lines = 0

    # Parallel mode delegation methods

    def register_parallel_branches(self, branches: list[str]) -> None:
        """Register parallel branches and initialize their display."""
        if self._parallel_handler:
            self._parallel_handler.register_branches(branches)

    def enter_parallel_mode(self) -> None:
        """Enter parallel mode."""
        if self._parallel_handler:
            self._parallel_handler.enter()

    def exit_parallel_mode(self) -> None:
        """Exit parallel mode."""
        if self._parallel_handler:
            self._parallel_handler.exit()

    def set_parallel_branch(self, branch_name: str) -> None:
        """Set the current parallel branch name for message streaming."""
        if self._parallel_handler:
            self._parallel_handler.set_branch(branch_name)

    def flush_parallel_branch(self, branch_name: str) -> None:
        """Flush any remaining messages for a branch (no-op, kept for compatibility)."""
        pass

    def mark_parallel_branch_done(self, branch: str, success: bool = True) -> None:
        """Mark a branch as completed."""
        if self._parallel_handler:
            self._parallel_handler.mark_branch_done(branch, success)

    def _is_parallel_mode(self) -> bool:
        """Check if parallel mode is active."""
        return self._parallel_handler is not None and self._parallel_handler.is_active

    def _should_defer_message(self) -> bool:
        """Check if messages should be deferred (during parallel BASE mode)."""
        if not self._parallel_handler:
            return False
        return self._parallel_handler.is_active and self.level == OutputLevel.BASE and self._parallel_handler.has_branches

    def _defer_message(self, message: str) -> None:
        """Defer a message to be printed after parallel mode exits."""
        if self._parallel_handler:
            self._parallel_handler.defer_message(message)

    # Workflow-level messages

    def workflow_start(self, workflow_name: str, workflow_id: str) -> None:
        """Print workflow start message."""
        header = _colorize(f"Workflow: {workflow_name}", Color.BOLD, Color.BRIGHT_CYAN)
        id_str = _colorize(f"[{workflow_id}]", Color.DIM)
        self._print(f"\n{header} {id_str}")
        self._print(_colorize("-" * 50, Color.DIM))

    def workflow_complete(self, workflow_name: str, status: str) -> None:
        """Print workflow completion message."""
        self._print(_colorize("-" * 50, Color.DIM))
        if status == "completed":
            status_str = _colorize("COMPLETED", Color.BOLD, Color.BRIGHT_GREEN)
        else:
            status_str = _colorize(status.upper(), Color.BOLD, Color.BRIGHT_RED)
        self._print(f"Workflow {workflow_name}: {status_str}\n")

    # Step-level messages

    def step_start(self, step_name: str, step_type: str | None = None, model: str | None = None) -> None:
        """Print step start message.

        Args:
            step_name: Name of the step
            step_type: Type of the step (prompt, parallel, etc.)
            model: Model name for BASE mode display (shown in brackets before step name)
        """
        # Import here to avoid circular dependency
        from agentic_sdlc.runner import format_model_name

        # In BASE mode, show model before step name
        model_str = ""
        if self.level == OutputLevel.BASE and model:
            formatted_model = format_model_name(model)
            if formatted_model:
                model_str = _colorize(f"[{formatted_model}] ", Color.DIM)

        step_str = _colorize(f"Step: {step_name}", Color.BOLD)
        type_str = _colorize(f"[{step_type}]", Color.DIM) if step_type else ""
        formatted = f"\n{model_str}{step_str} {type_str}"
        if self._should_defer_message():
            self._defer_message(formatted)
        else:
            self._print(formatted)

    def step_complete(self, step_name: str, summary: str | None = None) -> None:
        """Print step completion with optional summary.

        In ALL mode, skip the summary since full output was already streamed.
        In BASE mode, show the summary as it provides the only visible output.
        In parallel BASE mode, mark the branch as done and defer the message.
        """
        # In BASE mode (non-parallel), reset tracking state but don't clear display.
        # The streaming content stays visible, providing context for the completion.
        if self.level == OutputLevel.BASE and not self._is_parallel_mode():
            self._base_last_display_lines = 0
            self._base_accumulated_text = ""

        check = _colorize("[OK]", Color.BRIGHT_GREEN)
        name = _colorize(step_name, Color.GREEN)
        main_line = f"{check} {name} completed"

        # Build the full message including summary
        lines = [main_line]
        if summary and self.level == OutputLevel.BASE:
            summary_lines = summary.strip().split("\n")
            for line in summary_lines[:5]:
                truncated = line[:200] + "..." if len(line) > 200 else line
                lines.append(_colorize(f"    {truncated}", Color.DIM))
            if len(summary_lines) > 5:
                lines.append(_colorize(f"    ... ({len(summary_lines) - 5} more lines)", Color.DIM))

        if self._should_defer_message():
            # Mark the current branch as done
            branch = self._parallel_handler.get_current_branch() if self._parallel_handler else None
            if branch:
                self.mark_parallel_branch_done(branch)
            # Defer the completion message
            for line in lines:
                self._defer_message(line)
        else:
            for line in lines:
                self._print(line)

    def step_failed(self, step_name: str, error: str | None = None) -> None:
        """Print step failure with error details."""
        # In BASE mode (non-parallel), reset tracking state but don't clear display.
        if self.level == OutputLevel.BASE and not self._is_parallel_mode():
            self._base_last_display_lines = 0
            self._base_accumulated_text = ""

        cross = _colorize("[FAIL]", Color.BRIGHT_RED)
        name = _colorize(step_name, Color.RED)
        main_line = f"{cross} {name} failed"

        lines = [main_line]
        if error:
            error_lines = error.strip().split("\n")
            for line in error_lines[:10]:
                truncated = line[:200] + "..." if len(line) > 200 else line
                lines.append(_colorize(f"    {truncated}", Color.RED))
            if len(error_lines) > 10:
                lines.append(_colorize(f"    ... ({len(error_lines) - 10} more lines)", Color.DIM))

        if self._should_defer_message():
            # Mark the current branch as failed
            branch = self._parallel_handler.get_current_branch() if self._parallel_handler else None
            if branch:
                self.mark_parallel_branch_done(branch, success=False)
            for line in lines:
                self._defer_message(line)
        else:
            for line in lines:
                self._print(line)

    def step_retry(self, step_name: str, attempt: int, max_attempts: int, error: str | None = None) -> None:
        """Print retry message."""
        retry = _colorize(f"[RETRY {attempt}/{max_attempts}]", Color.YELLOW)
        name = _colorize(step_name, Color.YELLOW)
        main_line = f"{retry} {name}"

        lines = [main_line]
        if error:
            first_line = error.strip().split("\n")[0][:100]
            lines.append(_colorize(f"    Reason: {first_line}", Color.DIM))

        if self._should_defer_message():
            for line in lines:
                self._defer_message(line)
        else:
            for line in lines:
                self._print(line)

    # Ralph loop messages

    def ralph_iteration_start(self, step_name: str, iteration: int, max_iterations: int) -> None:
        """Print Ralph loop iteration header at the START of an iteration.

        Called before run_claude so streaming messages appear below the header.
        In BASE mode, print header and reset in-place state so streaming appears below.
        """
        # In BASE mode (non-parallel), print header and reset in-place tracking
        if self.level == OutputLevel.BASE and not self._is_parallel_mode():
            # Reset in-place state so streaming doesn't clear the header
            self._base_last_display_lines = 0
            self._base_accumulated_text = ""

        progress = _colorize(f"[{iteration}/{max_iterations}]", Color.CYAN)
        name = _colorize(step_name, Color.CYAN)
        self._print(f"{progress} {name} iteration")

    def ralph_iteration(self, step_name: str, iteration: int, max_iterations: int, summary: str | None = None) -> None:
        """Print Ralph loop iteration summary AFTER iteration completes.

        In ALL mode, show the summary since it provides context for iteration completion.
        In BASE mode (non-parallel), don't clear - let the final content stay visible,
        then next iteration will print its header below.
        """
        # In BASE mode (non-parallel), don't clear - let content stay visible
        # The next ralph_iteration_start() will reset state and print below
        if self.level == OutputLevel.BASE and not self._is_parallel_mode():
            return

        # In ALL mode, show iteration summary
        if summary and self.level == OutputLevel.ALL:
            summary_lines = summary.strip().split("\n")
            for line in summary_lines[:3]:  # Brief summary for iterations
                truncated = line[:150] + "..." if len(line) > 150 else line
                self._print(_colorize(f"    {truncated}", Color.DIM))

    def ralph_complete(self, step_name: str, iteration: int, max_iterations: int) -> None:
        """Print Ralph loop completion."""
        # In BASE mode (non-parallel), reset tracking state but don't clear display.
        # The streaming content stays visible, providing context for the completion.
        # Clearing is unreliable due to terminal line wrapping affecting cursor position.
        if self.level == OutputLevel.BASE and not self._is_parallel_mode():
            self._base_last_display_lines = 0
            self._base_accumulated_text = ""

        check = _colorize("[OK]", Color.BRIGHT_GREEN)
        name = _colorize(step_name, Color.GREEN)
        self._print(f"{check} {name} completed at iteration {iteration}/{max_iterations}")

    def ralph_max_iterations(self, step_name: str, max_iterations: int) -> None:
        """Print Ralph loop max iterations reached."""
        # In BASE mode (non-parallel), reset tracking state but don't clear display.
        if self.level == OutputLevel.BASE and not self._is_parallel_mode():
            self._base_last_display_lines = 0
            self._base_accumulated_text = ""

        warn = _colorize("[WARN]", Color.YELLOW)
        name = _colorize(step_name, Color.YELLOW)
        self._print(f"{warn} {name} reached max iterations ({max_iterations})")

    # Generic messages

    def info(self, message: str) -> None:
        """Print info message."""
        info_prefix = _colorize("[INFO]", Color.BLUE)
        formatted = f"{info_prefix} {message}"
        if self._should_defer_message():
            self._defer_message(formatted)
        else:
            self._print(formatted)

    def warning(self, message: str) -> None:
        """Print warning message."""
        warn = _colorize("[WARN]", Color.YELLOW)
        formatted = f"{warn} {message}"
        if self._should_defer_message():
            self._defer_message(formatted)
        else:
            self._print(formatted)

    def error(self, message: str) -> None:
        """Print error message."""
        err = _colorize("[ERROR]", Color.BRIGHT_RED)
        formatted = f"{err} {message}"
        if self._should_defer_message():
            self._defer_message(formatted)
        else:
            self._print(formatted)

    def stream_text(self, text: str, role: str = "assistant", model: str | None = None) -> None:
        """Stream text content from Claude's messages.

        In ALL mode: prints all text with visual indicators by role.
        In BASE mode: shows only the last line, overwriting previous output in-place.

        Args:
            text: Text content extracted from stream-json message (delta only)
            role: Message role - "user" or "assistant"
            model: Optional model name (e.g., "claude-sonnet-4-5-20250929")
        """
        # Import here to avoid circular dependency
        from agentic_sdlc.runner import format_model_name

        formatted_model = format_model_name(model) if model else None

        if self.level == OutputLevel.ALL:
            # Skip empty text
            if not text or not text.strip():
                return

            # In parallel mode, use handler to accumulate and queue messages
            if self._is_parallel_mode() and self._parallel_handler:
                self._parallel_handler.accumulate_text(text, role, model)
                return

            # Format with role indicator
            if role == "user":
                prefix = _colorize(">", Color.BRIGHT_CYAN, Color.BOLD)
                label = _colorize(" [user]", Color.DIM)
                # Print user message with prefix on first line
                self._print("")  # Blank line before
                self._print(f"{prefix}{label}")
                for line in text.split("\n"):
                    colored_line = _colorize(line, Color.GREEN)
                    self._print(f"  {colored_line}")
            else:
                # Assistant message - green bullet prefix with optional model
                bullet = _colorize("*", Color.BRIGHT_GREEN, Color.BOLD)
                model_label = ""
                if formatted_model:
                    model_label = " " + _colorize(f"[{formatted_model}]", Color.DIM)
                lines = text.split("\n")
                # Always start with blank line to separate from previous output
                self._print("")
                # First line gets the bullet and model label
                self._print(f"{bullet}{model_label} {lines[0]}")
                # Subsequent lines are indented to align
                for line in lines[1:]:
                    self._print(f"  {line}")
        elif self.level == OutputLevel.BASE:
            if role == "user":
                # In BASE mode, skip user prompts - only show assistant output
                return

            # In parallel mode, update the branch's dedicated line via handler
            if self._is_parallel_mode() and self._parallel_handler:
                branch = self._parallel_handler.get_current_branch()
                if branch and self._parallel_handler.has_branches:
                    last_line = self._parallel_handler.accumulate_base_text(text)
                    if last_line:
                        self._parallel_handler.update_branch_line(branch, last_line)
                return

            # Accumulate the text (with memory limit)
            self._base_accumulated_text += text
            if len(self._base_accumulated_text) > _MAX_ACCUMULATED_TEXT:
                # Truncate from the beginning, keeping the most recent content
                self._base_accumulated_text = self._base_accumulated_text[-_MAX_ACCUMULATED_TEXT:]

            # Show current message in-place (will be cleared when step completes)
            if self._base_accumulated_text.strip():
                prefix = _colorize("...", Color.DIM)
                # Get all lines of accumulated text for display
                lines = self._base_accumulated_text.strip().split("\n")
                # Format with prefix on first line, indent continuation lines
                formatted_lines = [f"{prefix} {lines[0]}"]
                for line in lines[1:]:
                    formatted_lines.append(f"    {line}")
                display_text = "\n".join(formatted_lines)
                self._print_inplace(display_text)

    def stream_complete(self) -> None:
        """Called when streaming is complete to finalize output.

        In BASE mode, keeps the in-place display visible until step_complete()
        clears it and shows the summary. This prevents blank screen between
        streaming and step completion.
        In ALL mode with parallel, buffers the complete message.
        Resets accumulated text for next stream (but preserves display state).
        """
        # In BASE mode, do NOT clear - keep message visible until step_complete
        # The display will be cleared by step_complete() when it shows the summary

        # In ALL mode with parallel, enqueue the current accumulated message for printing
        if self.level == OutputLevel.ALL and self._is_parallel_mode() and self._parallel_handler:
            self._parallel_handler.enqueue_current_message()

        # Reset accumulated text for next stream (preserves _base_last_display_lines for clearing later)
        self._base_accumulated_text = ""


def extract_json(output: str) -> dict | None:
    """Extract and parse JSON from Claude's output.

    Looks for the last JSON code block (```json ... ```) in the output
    and parses it. Skills are expected to output a JSON block as their
    final structured output.

    Args:
        output: Full output text from Claude

    Returns:
        Parsed JSON as dict, or None if no valid JSON found
    """
    import json
    import re

    if not output:
        return None

    # Find all JSON code blocks
    pattern = r"```json\s*([\s\S]*?)```"
    matches = re.findall(pattern, output)

    if not matches:
        return None

    # Use the last JSON block (skills output their final JSON at the end)
    json_str = matches[-1].strip()

    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        return None


def extract_summary(output: str, max_lines: int = 5, max_chars: int = 500) -> str:
    """Extract a concise summary from Claude's output.

    Looks for key patterns like conclusions, results, or the last meaningful content.

    Args:
        output: Full output text
        max_lines: Maximum lines to include
        max_chars: Maximum characters to include

    Returns:
        Extracted summary string
    """
    if not output:
        return ""

    output = output.strip()

    # Look for explicit summary markers
    summary_markers = [
        "## Summary",
        "### Summary",
        "Summary:",
        "Result:",
        "Completed:",
        "Done:",
    ]

    for marker in summary_markers:
        if marker in output:
            idx = output.find(marker)
            summary_section = output[idx:]
            lines = summary_section.split("\n")
            # Take lines until next header or max lines
            result_lines = []
            for i, line in enumerate(lines[1:], 1):  # Skip marker line
                if i > max_lines:
                    break
                if line.startswith("#") and i > 1:
                    break
                result_lines.append(line)
            if result_lines:
                return "\n".join(result_lines).strip()[:max_chars]

    # If no markers, take the last meaningful lines
    lines = [line for line in output.split("\n") if line.strip()]
    if not lines:
        return ""

    # Take last few lines as summary
    last_lines = lines[-max_lines:]
    summary = "\n".join(last_lines)

    if len(summary) > max_chars:
        summary = summary[:max_chars] + "..."

    return summary
